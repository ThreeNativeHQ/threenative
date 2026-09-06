"""Focused builder tests: pristine-only source, exact symbols, consumer
layout, manifest ZIP digest, toolchain enforcement, single release tag.

Run: python3 packages/runtime-native/scripts/test-build-quiche-owned.py
Source-byte verification uses REAL temporary git repos (committed fixtures),
never mocked status output. Each repair below was red-tested by removing it.
"""
import os
import subprocess
import tempfile
import unittest
import zipfile
from unittest import mock

import importlib.util

_spec = importlib.util.spec_from_file_location(
    "build_quiche_owned",
    os.path.join(os.path.dirname(__file__), "build-quiche-owned.py"))
assert _spec is not None and _spec.loader is not None
b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b)

TOOLCHAIN_GOOD = {"rustc": "rustc 1.96.0 (x)", "cargo": "cargo 1.96.0 (x)",
                  "cmake": "cmake version 4.4.2",
                  "go": "go version go1.26.3 linux/amd64"}


def fixture_archive(tmp, symbols=None, with_header=True):
    if symbols is None:
        symbols = ["quiche_h3_config_set_additional_settings",
                   "quiche_connect", "quiche_accept"]
    src = os.path.join(tmp, "stub.c")
    with open(src, "w") as f:
        for s in symbols:
            f.write(f"void *{s} = (void*)0;\n")
    obj = os.path.join(tmp, "stub.o")
    subprocess.check_call(["cc", "-c", src, "-o", obj])
    lib = os.path.join(tmp, "libquiche.a")
    subprocess.check_call(["ar", "rcs", lib, obj])
    inc = os.path.join(tmp, "include")
    if with_header:
        os.makedirs(inc)
        with open(os.path.join(inc, "quiche.h"), "w") as f:
            f.write("int quiche_h3_config_set_additional_settings"
                    "(void *c, const unsigned long *p, unsigned long n);\n")
    return lib, inc


def git_repo(tmp, name="repo"):
    repo = os.path.join(tmp, name)
    os.makedirs(repo)
    subprocess.check_call(["git", "init", "-q", repo])
    subprocess.check_call(["git", "-C", repo, "config", "user.email", "t@t"])
    subprocess.check_call(["git", "-C", repo, "config", "user.name", "t"])
    return repo


def commit_all(repo, msg):
    subprocess.check_call(["git", "-C", repo, "add", "-A"])
    subprocess.check_call(["git", "-C", repo, "commit", "-qm", msg])


def source_fixture(tmp, submodule_head="pin-ok"):
    """Real git repo: committed sources + a REAL submodule checkout whose
    actual HEAD we control. submodule_head: 'pin-ok' (matches builder pin
    recorded below), 'wrong', or 'missing'."""
    repo = git_repo(tmp)
    sub_src = git_repo(tmp, "subsrc")
    with open(os.path.join(sub_src, "ssl_lib.cc"), "w") as f:
        f.write("// boringssl fixture\n")
    commit_all(sub_src, "sub")
    sub_head = subprocess.check_output(
        ["git", "-C", sub_src, "rev-parse", "HEAD"], text=True).strip()
    if submodule_head == "wrong":
        with open(os.path.join(sub_src, "ssl_lib.cc"), "a") as f:
            f.write("// second commit\n")
        commit_all(sub_src, "sub2")
    if submodule_head in ("pin-ok", "wrong"):
        subprocess.check_call(["git", "-C", repo, "-c", "protocol.file.allow=always",
                               "submodule", "add", "-q", sub_src, "quiche/deps/boringssl"])
    for rel in ["quiche/src/tls/mod.rs", "quiche/src/h3/ffi.rs",
                "quiche/include/quiche.h", "quiche/Cargo.toml"]:
        path = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(f"// {rel}\n")
    commit_all(repo, "base")
    if submodule_head == "wrong":
        # Commit graph pins the recorded SHA but the actual checkout is newer.
        subprocess.check_call(["git", "-C", os.path.join(repo, "quiche", "deps", "boringssl"),
                               "checkout", "-q", "master" if _has_master(sub_src) else "main"],
                              stderr=subprocess.DEVNULL)
    return repo, sub_head


def _has_master(sub_src):
    out = subprocess.check_output(["git", "-C", sub_src, "branch", "--list", "master"],
                                  text=True)
    return bool(out.strip())


class TestTargets(unittest.TestCase):
    def test_downloader_consumed_set_is_supported(self):
        for target in ["linux-x64", "win-x64", "mac-arm64", "mac-x86_64",
                       "android-arm64", "android-armv7", "android-x64",
                       "ios-arm64", "ios-sim-x64"]:
            self.assertIn(target, b.SUPPORTED_TARGETS, target)

    def test_unsupported_target_fails_closed(self):
        with self.assertRaises(b.BuildError):
            b.rust_target("linux-arm64")
        with self.assertRaises(b.BuildError):
            b.rust_target("ios-sim-arm64")

    def test_artifact_revision_is_not_upstream_identity(self):
        self.assertNotIn("quiche-0.24.6-3", b.ARTIFACT_REVISION)
        self.assertIn("0.24.6", b.ARTIFACT_REVISION)


class TestPatches(unittest.TestCase):
    def test_pins_both_patches_with_digests(self):
        names = [p["name"] for p in b.PATCHES]
        self.assertIn("quiche-webtransport-ffi.patch", names)
        self.assertIn("quiche-ip-san.patch", names)
        for p in b.PATCHES:
            self.assertRegex(p["sha256"], r"^[0-9a-f]{64}$", p["name"])

    def test_ip_san_digest_matches_reviewed_patch(self):
        entry = next(p for p in b.PATCHES if p["name"] == "quiche-ip-san.patch")
        self.assertEqual(entry["sha256"],
                         "eabe59921bcd42bdd956d256e6a3628d54530a32384aa3023819811ed695b15a")

    def test_tampered_patch_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "quiche-ip-san.patch")
            with open(bad, "w") as f:
                f.write("tampered")
            with self.assertRaises(b.BuildError):
                b.verify_patches(tmp)


class TestPristineSource(unittest.TestCase):
    """verify_source accepts ONLY exact-HEAD + clean + correct actual
    submodule HEAD. Any prepatched/dirty/missing input is rejected."""

    def _pin_builder(self, repo, sub_head):
        import re
        real_head = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"],
                                            text=True).strip()
        path = os.path.join(os.path.dirname(__file__), "build-quiche-owned.py")
        src = open(path).read()
        src = re.sub(r'UPSTREAM_COMMIT = "[0-9a-f]{40}"',
                     f'UPSTREAM_COMMIT = "{real_head}"', src)
        src = re.sub(r'BORINGSSL_PIN = "[0-9a-f]{40}"',
                     f'BORINGSSL_PIN = "{sub_head}"', src)
        import importlib.util as iu
        mod_path = os.path.join(repo, "..", "builder-under-test.py")
        with open(mod_path, "w") as f:
            f.write(src)
        spec = iu.spec_from_file_location("builder_under_test", mod_path)
        assert spec is not None and spec.loader is not None
        mod = iu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_pristine_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            mod.verify_source(repo)  # must not raise

    def test_ignored_compilation_inputs_rejected(self):
        for submodule in (False, True):
            with self.subTest(submodule=submodule), tempfile.TemporaryDirectory() as tmp:
                repo, sub_head = source_fixture(tmp)
                mod = self._pin_builder(repo, sub_head)
                scope = os.path.join(repo, "quiche/deps/boringssl") if submodule else repo
                exclude = subprocess.check_output(
                    ["git", "-C", scope, "rev-parse", "--git-path", "info/exclude"],
                    text=True).strip()
                if not os.path.isabs(exclude):
                    exclude = os.path.join(scope, exclude)
                with open(exclude, "a") as f:
                    f.write("\ninjected.h\n")
                with open(os.path.join(scope, "injected.h"), "w") as f:
                    f.write("#define ALTER_COMPILED_INPUT 1\n")
                subprocess.check_call(["git", "-C", scope, "check-ignore", "-q", "injected.h"])
                with self.assertRaisesRegex(mod.BuildError, "DIRTY"):
                    mod.verify_source(repo)

    def test_dirty_tracked_file_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            with open(os.path.join(repo, "quiche", "src", "tls", "mod.rs"), "a") as f:
                f.write("// dirty\n")
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_SOURCE_DIRTY"):
                mod.verify_source(repo)

    def test_modified_allowed_path_rejected(self):
        # Writing ARBITRARY data into a patch-touched path is NOT an
        # acceptable "patched" state: only the builder may patch, from pristine.
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            with open(os.path.join(repo, "quiche", "src", "tls", "mod.rs"), "a") as f:
                f.write("// attacker was here\n")
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_SOURCE_DIRTY"):
                mod.verify_source(repo)

    def test_wrong_submodule_head_rejected(self):
        # Parent gitlink can look right while the actual checkout differs;
        # verify_source reads the real submodule HEAD.
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            sub = os.path.join(repo, "quiche", "deps", "boringssl")
            with open(os.path.join(sub, "evil.c"), "w") as f:
                f.write("evil\n")
            subprocess.check_call(["git", "-C", sub, "add", "-A"])
            subprocess.check_call(["git", "-C", sub, "-c", "user.name=t",
                                   "-c", "user.email=t@t", "commit", "-qm",
                                   "evil"])
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_(BORINGSSL|SOURCE_DIRTY)"):
                mod.verify_source(repo)

    def test_missing_submodule_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp, submodule_head="missing")
            mod = self._pin_builder(repo, sub_head)
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_BORINGSSL"):
                mod.verify_source(repo)

    def test_extra_untracked_input_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            with open(os.path.join(repo, "extra_helper.rs"), "w") as f:
                f.write("malicious\n")
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_SOURCE_DIRTY"):
                mod.verify_source(repo)

    def test_staged_change_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            with open(os.path.join(repo, "quiche", "Cargo.toml"), "a") as f:
                f.write("# staged\n")
            subprocess.check_call(["git", "-C", repo, "add", "quiche/Cargo.toml"])
            with self.assertRaisesRegex(mod.BuildError, "TN_QUICHE_SOURCE_DIRTY"):
                mod.verify_source(repo)

    def test_relative_paths_resolved_from_outer_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, sub_head = source_fixture(tmp)
            mod = self._pin_builder(repo, sub_head)
            outer = os.path.join(tmp, "outer")
            os.makedirs(outer)
            rel = os.path.relpath(repo, outer)
            cwd = os.getcwd()
            try:
                os.chdir(outer)
                mod.verify_source(rel)  # must not raise
            finally:
                os.chdir(cwd)


class TestExactSymbols(unittest.TestCase):
    def test_explicit_archive_inspector_is_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp)
            calls = []

            def fake_check_output(args, **kwargs):
                calls.append(args)
                return ("0000000000000000 (__TEXT,__text) external "
                        "_quiche_h3_config_set_additional_settings\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_connect\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_accept\n")

            with mock.patch.object(b.subprocess, "check_output",
                                  side_effect=fake_check_output):
                b.validate_archive("ios-arm64", lib,
                                   os.path.join(inc, "quiche.h"),
                                   nm_path="/usr/bin/llvm-nm")

            self.assertEqual(calls, [["/usr/bin/llvm-nm", "-g", b.resolve(lib)]])

    def test_apple_archive_probe_uses_portable_nm_invocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp)
            calls = []

            def fake_check_output(args, **kwargs):
                calls.append(args)
                return ("0000000000000000 (__TEXT,__text) external "
                        "_quiche_h3_config_set_additional_settings\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_connect\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_accept\n")

            with mock.patch.object(b.shutil, "which",
                                  side_effect=lambda name: "/usr/bin/nm"
                                  if name == "nm" else None), \
                    mock.patch.object(b.subprocess, "check_output",
                                      side_effect=fake_check_output):
                b.validate_archive("ios-arm64", lib,
                                   os.path.join(inc, "quiche.h"))

            self.assertEqual(calls, [["/usr/bin/nm", "-g", b.resolve(lib)]])

    def test_apple_archive_probe_retries_target_arch(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp)
            calls = []

            def fake_check_output(args, **kwargs):
                calls.append(args)
                if len(calls) == 1:
                    raise subprocess.CalledProcessError(1, args)
                return ("0000000000000000 (__TEXT,__text) external "
                        "_quiche_h3_config_set_additional_settings\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_connect\n"
                        "0000000000000000 (__TEXT,__text) external "
                        "_quiche_accept\n")

            with mock.patch.object(b.shutil, "which",
                                  side_effect=lambda name: "/usr/bin/nm"
                                  if name == "nm" else None), \
                    mock.patch.object(b.subprocess, "check_output",
                                      side_effect=fake_check_output):
                b.validate_archive("ios-arm64", lib,
                                   os.path.join(inc, "quiche.h"))

            normalized = b.resolve(lib)
            self.assertEqual(calls, [
                ["/usr/bin/nm", "-g", normalized],
                ["/usr/bin/nm", "-g", "-arch", "arm64", normalized],
            ])

    def test_undefined_only_rejected(self):
        defined = b.defined_symbols_nm(
            "                 U quiche_connect\n"
            "0000000000000000 T quiche_accept\n")
        self.assertNotIn("quiche_connect", defined)
        self.assertIn("quiche_accept", defined)
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp, symbols=["quiche_accept"])
            with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_SYMBOL_MISSING"):
                b.validate_archive("linux-x64", lib, os.path.join(inc, "quiche.h"))

    def test_prefix_match_fake_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(
                tmp, symbols=["quiche_connect_extra", "quiche_accept",
                              "quiche_h3_config_set_additional_settings"])
            with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_SYMBOL_MISSING"):
                b.validate_archive("linux-x64", lib, os.path.join(inc, "quiche.h"))

    def test_bsd_nm_without_defined_only_flag(self):
        # macOS nm has no --defined-only: parser must filter U-lines itself.
        out = ("0000000000000000 (__TEXT,__text) external _quiche_connect\n"
               "                 (undefined) external _quiche_accept\n")
        defined = b.defined_symbols_nm(out)
        self.assertIn("quiche_connect", defined)
        self.assertNotIn("quiche_accept", defined)

    def test_dumpbin_realistic_records(self):
        out = ("004 00000000 SECT4  notype       Static       | .debug$S\n"
               "005 00000000 SECT5  notype ()    External     | quiche_connect\n"
               "006 00000000 UNDEF  notype ()    External     | quiche_accept\n"
               "007 00000000 SECT5  notype ()    Static       | helper\n")
        defined = b.defined_symbols_dumpbin(out)
        self.assertIn("quiche_connect", defined)
        self.assertNotIn("quiche_accept", defined)
        self.assertNotIn("helper", defined)

    def test_unsupported_inspector_fails_closed(self):
        with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_NO_NM"):
            b.pick_inspector(nm_path=None, llvm_nm_path=None,
                             dumpbin_path=None, lib_suffix=".a")

    def test_missing_symbol_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp, symbols=["quiche_connect"])
            with self.assertRaises(b.BuildError):
                b.validate_archive("linux-x64", lib, os.path.join(inc, "quiche.h"))

    def test_missing_header_export_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, _ = fixture_archive(tmp, with_header=False)
            with self.assertRaises(b.BuildError):
                b.validate_archive("linux-x64", lib, os.path.join(tmp, "include", "quiche.h"))


class TestPackage(unittest.TestCase):
    def test_deflated_and_flat_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp)
            archive = b.package_archive("linux-x64", lib,
                                        os.path.join(inc, "quiche.h"), tmp)
            with zipfile.ZipFile(archive) as z:
                self.assertEqual(sorted(z.namelist()),
                                 ["include/quiche.h", "libquiche.a"])
                for info in z.infolist():
                    self.assertEqual(info.compress_type, zipfile.ZIP_DEFLATED,
                                     info.filename)

    def test_rejects_missing_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.zip")
            with zipfile.ZipFile(bad, "w") as z:
                z.writestr("libquiche.a", b"x")
            with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_PACKAGE"):
                b.validate_package(bad, "linux-x64")

    def test_rejects_empty_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.zip")
            with zipfile.ZipFile(bad, "w") as z:
                z.writestr("libquiche.a", b"")
                z.writestr("include/quiche.h", b"x")
            with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_PACKAGE"):
                b.validate_package(bad, "linux-x64")

    def test_rejects_wrong_target_lib(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.zip")
            with zipfile.ZipFile(bad, "w") as z:
                z.writestr("libquiche.a", b"x")
                z.writestr("include/quiche.h", b"x")
            with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_PACKAGE"):
                b.validate_package(bad, "win-x64")


class TestManifestToolchainTag(unittest.TestCase):
    def test_manifest_hashes_final_zip_and_win_lib(self):
        with tempfile.TemporaryDirectory() as tmp:
            lib, inc = fixture_archive(tmp)
            archive = b.package_archive("win-x64", lib,
                                        os.path.join(inc, "quiche.h"), tmp)
            out = b.write_manifest("win-x64", lib, os.path.join(inc, "quiche.h"),
                                   tmp, toolchain=dict(TOOLCHAIN_GOOD),
                                   archive_path=archive)
            import json
            with open(out) as f:
                manifest = json.load(f)
            self.assertEqual(manifest["source_commit"], b.UPSTREAM_COMMIT)
            self.assertIn("quiche.lib", manifest["artifacts"])
            self.assertNotIn("libquiche.a", manifest["artifacts"])
            self.assertEqual(manifest["archive_sha256"], b.sha256_file(archive))

    def test_absent_tool_fails_closed(self):
        info = dict(TOOLCHAIN_GOOD, cargo="absent")
        with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_TOOLCHAIN"):
            b.check_toolchain(info)

    def test_old_rustc_fails_closed(self):
        info = dict(TOOLCHAIN_GOOD, rustc="rustc 1.70.0", cargo="cargo 1.70.0")
        with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_TOOLCHAIN"):
            b.check_toolchain(info)

    def test_single_exact_tag_value(self):
        self.assertEqual(b.EXPECTED_TAG, "quiche-owned-v1")
        b.check_release_tag("quiche-owned-v1")  # must not raise
        with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_RELEASE_TAG"):
            b.check_release_tag("quiche-0.24.6-tn1")
        with self.assertRaisesRegex(b.BuildError, "TN_QUICHE_RELEASE_TAG"):
            b.check_release_tag("quiche-0.24.6-3")


class TestIpSanContract(unittest.TestCase):
    def test_cross_target_only_compiles(self):
        result = b.run_ip_san_tests("/nonexistent-src", "android-arm64",
                                    host="x86_64-unknown-linux-gnu")
        self.assertEqual(result["status"], "skipped")

    def test_all_cross_targets_report_skipped_never_passed(self):
        host = "x86_64-unknown-linux-gnu"
        for target in ["win-x64", "mac-arm64", "mac-x86_64",
                       "android-arm64", "android-armv7", "android-x64",
                       "ios-arm64", "ios-sim-x64"]:
            with self.subTest(target=target):
                result = b.run_ip_san_tests("/nonexistent-src", target,
                                            host=host)
                self.assertEqual(result["status"], "skipped")
                self.assertNotEqual(result.get("status"), "passed")


def _fake_tool(path):
    import stat
    if os.name == "nt":
        path += ".cmd"
    with open(path, "w") as f:
        f.write("@echo off\r\nexit /b 0\r\n" if os.name == "nt"
                else "#!/bin/sh\nexit 0\n")
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP)


def _fake_xcrun(tmp, fail=False):
    path = os.path.join(tmp, "xcrun" + (".cmd" if os.name == "nt" else ""))
    with open(path, "w") as f:
        if os.name == "nt":
            f.write("@echo off\r\n")
            if fail:
                f.write("exit /b 1\r\n")
            else:
                f.write('if "%~3"=="--show-sdk-path" echo /sdk\r\n'
                        'if "%~3"=="-f" echo /sdk/bin/%~4\r\n'
                        "exit /b 0\r\n")
        elif fail:
            f.write("#!/bin/sh\nexit 1\n")
        else:
            f.write("#!/bin/sh\n"
                    "case \"$*\" in\n"
                    "  *--show-sdk-path) echo /sdk ;;\n"
                    "  *-f*) echo /sdk/bin/$4 ;;\n"
                    "  *) exit 1 ;;\n"
                    "esac\n")
    os.chmod(path, 0o755)
    return path


class TestTargetEnvPins(unittest.TestCase):
    def test_platform_pins(self):
        self.assertEqual(b.ANDROID_NDK_PIN, "27.1.12297006")
        self.assertEqual(b.ANDROID_API, "21")
        self.assertEqual(b.ANDROID_ARCH["android-armv7"][0],
                         "armv7-linux-androideabi")
        self.assertEqual(b.APPLE_SDK["ios-arm64"],
                         ("iphoneos", "arm64", "14.0"))
        self.assertEqual(b.APPLE_SDK["ios-sim-x64"],
                         ("iphonesimulator", "x86_64", "14.0"))


class TestTargetEnvWin(unittest.TestCase):
    def test_missing_cl_fails(self):
        with self.assertRaises(b.BuildError) as ctx:
            b.prepare_target_env("win-x64", dict(os.environ, PATH="/nonexistent"))
        self.assertIn("TN_QUICHE_MSVC_MISSING", str(ctx.exception))

    def test_missing_sdk_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in ("cl", "link", "lib"):
                _fake_tool(os.path.join(tmp, t))
            env = dict(os.environ, PATH=tmp)
            env.pop("INCLUDE", None)
            env.pop("LIB", None)
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("win-x64", env)
            self.assertIn("TN_QUICHE_MSVC_SDK", str(ctx.exception))

    def test_dynamic_crt_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in ("cl", "link", "lib"):
                _fake_tool(os.path.join(tmp, t))
            env = dict(os.environ, PATH=tmp, INCLUDE="x", LIB="y", CL="/MD")
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("win-x64", env)
            self.assertIn("TN_QUICHE_MSVC_CRT", str(ctx.exception))

    def test_debug_crt_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in ("cl", "link", "lib"):
                _fake_tool(os.path.join(tmp, t))
            env = dict(os.environ, PATH=tmp, INCLUDE="x", LIB="y",
                       RUSTFLAGS="/MTd")
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("win-x64", env)
            self.assertIn("TN_QUICHE_MSVC_CRT", str(ctx.exception))

    def test_static_crt_selected(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in ("cl", "link", "lib"):
                _fake_tool(os.path.join(tmp, t))
            env = dict(os.environ, PATH=tmp, INCLUDE="x", LIB="y")
            sel = b.prepare_target_env("win-x64", env)
            self.assertEqual(sel["crt"], "/MT,+crt-static")
            self.assertIn("+crt-static", env["RUSTFLAGS"])
            self.assertIn("/MT", env["CFLAGS"])
            self.assertIn("/MT", env["CXXFLAGS"])


class TestTargetEnvApple(unittest.TestCase):
    def test_missing_xcrun_fails(self):
        with self.assertRaises(b.BuildError) as ctx:
            b.prepare_target_env("mac-arm64",
                                 dict(os.environ, PATH="/nonexistent"))
        self.assertIn("TN_QUICHE_XCRUN_MISSING", str(ctx.exception))

    def test_wrong_sdk_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            _fake_xcrun(tmp, fail=True)
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("mac-arm64",
                                     dict(os.environ, PATH=tmp))
            self.assertIn("TN_QUICHE_SDK_MISSING", str(ctx.exception))

    def test_sdk_and_cxx_are_bound_to_selected_arch(self):
        with tempfile.TemporaryDirectory() as tmp:
            _fake_xcrun(tmp)
            env = dict(os.environ, PATH=tmp)
            sel = b.prepare_target_env("mac-arm64", env)
            self.assertEqual(sel["sdk"], "macosx")
            self.assertEqual(sel["arch"], "arm64")
            self.assertEqual(env["SDKROOT"], "/sdk")
            self.assertEqual(env["CC"], "/sdk/bin/clang")
            self.assertEqual(env["CXX"], "/sdk/bin/clang++")
            self.assertIn("-arch arm64", env["CFLAGS"])
            self.assertIn("-isysroot /sdk", env["CFLAGS"])
            self.assertIn("-arch arm64", env["CXXFLAGS"])
            self.assertIn("-isysroot /sdk", env["CXXFLAGS"])


class TestTargetEnvAndroid(unittest.TestCase):
    def _ndk(self, tmp, rev="27.1.12297006", tools=True):
        ndk = os.path.join(tmp, "ndk")
        bindir = os.path.join(ndk, "toolchains", "llvm", "prebuilt",
                              b._ndk_host_dir(), "bin")
        os.makedirs(bindir)
        with open(os.path.join(ndk, "source.properties"), "w") as f:
            f.write(f"Pkg.Revision = {rev}\n")
        if tools:
            for t in ("aarch64-linux-android21-clang",
                      "aarch64-linux-android21-clang++",
                      "armv7a-linux-androideabi21-clang",
                      "armv7a-linux-androideabi21-clang++",
                      "x86_64-linux-android21-clang",
                      "x86_64-linux-android21-clang++",
                      "llvm-ar", "llvm-ranlib"):
                _fake_tool(os.path.join(bindir, t))
        return ndk, bindir

    def test_missing_ndk_fails(self):
        env = dict(os.environ, ANDROID_NDK_HOME="/nonexistent-ndk",
                   ANDROID_NDK_ROOT="", ANDROID_HOME="/none",
                   ANDROID_SDK_ROOT="")
        with self.assertRaises(b.BuildError) as ctx:
            b.prepare_target_env("android-arm64", env)
        self.assertIn("TN_QUICHE_NDK_MISSING", str(ctx.exception))

    def test_wrong_pin_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            ndk, _ = self._ndk(tmp, rev="26.1.10909125")
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("android-arm64",
                                     dict(os.environ, ANDROID_NDK_HOME=ndk))
            self.assertIn("TN_QUICHE_NDK_MISMATCH", str(ctx.exception))

    def test_armv7_driver_bound(self):
        with tempfile.TemporaryDirectory() as tmp:
            ndk, bindir = self._ndk(tmp)
            env = dict(os.environ, ANDROID_NDK_HOME=ndk)
            sel = b.prepare_target_env("android-armv7", env)
            want = b._find_executable(bindir, "armv7a-linux-androideabi21-clang")
            self.assertIsNotNone(want)
            self.assertEqual(sel["armv7a-linux-androideabi21-clang"], want)
            self.assertEqual(env["CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER"],
                             want)
            self.assertEqual(
                env["CXX_armv7_linux_androideabi"],
                b._find_executable(bindir, "armv7a-linux-androideabi21-clang++"),
            )
            self.assertEqual(env["CMAKE_ANDROID_ARCH_ABI"], "arm")

    def test_arm64_and_x64_vars(self):
        with tempfile.TemporaryDirectory() as tmp:
            ndk, _ = self._ndk(tmp)
            env = dict(os.environ, ANDROID_NDK_HOME=ndk)
            b.prepare_target_env("android-arm64", env)
            self.assertIn("aarch64-linux-android21-clang",
                          env["CC_aarch64_linux_android"])
            env2 = dict(os.environ, ANDROID_NDK_HOME=ndk)
            b.prepare_target_env("android-x64", env2)
            self.assertEqual(env2["CMAKE_ANDROID_ARCH_ABI"], "x86_64")

    def test_missing_driver_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            ndk, _ = self._ndk(tmp, tools=False)
            with self.assertRaises(b.BuildError) as ctx:
                b.prepare_target_env("android-arm64",
                                     dict(os.environ, ANDROID_NDK_HOME=ndk))
            self.assertIn("TN_QUICHE_NDK_TOOL_MISSING", str(ctx.exception))

    def test_linux_passthrough(self):
        sel = b.prepare_target_env("linux-x64", dict(os.environ))
        self.assertEqual(sel["rust_target"], "x86_64-unknown-linux-gnu")


class TestOuterCwdPatchFlow(unittest.TestCase):
    def test_apply_from_outer_cwd_with_sibling_patch_dir(self):
        import shutil as _shutil
        with tempfile.TemporaryDirectory() as tmp:
            repo = git_repo(tmp)
            target = os.path.join(repo, "hello.txt")
            with open(target, "w") as f:
                f.write("hello\n")
            commit_all(repo, "base")
            # Generate a real patch from a real modification.
            with open(target, "w") as f:
                f.write("hello patched\n")
            patch_text = subprocess.check_output(
                ["git", "-C", repo, "diff"], text=True)
            subprocess.check_call(["git", "-C", repo, "checkout", "--", "."])
            patch_dir = os.path.join(tmp, "patches")
            os.makedirs(patch_dir)
            with open(os.path.join(patch_dir, "hello.patch"), "w") as f:
                f.write(patch_text)
            outer = os.path.join(tmp, "outer")
            os.makedirs(outer)
            cwd = os.getcwd()
            try:
                os.chdir(outer)
                b.apply_one_patch(os.path.relpath(repo, outer),
                                  os.path.join(os.path.relpath(patch_dir, outer),
                                               "hello.patch"))
            finally:
                os.chdir(cwd)
            with open(target) as f:
                self.assertEqual(f.read(), "hello patched\n")


if __name__ == "__main__":
    unittest.main()
