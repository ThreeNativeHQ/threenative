#!/usr/bin/env python3
"""Focused release-gate tests: fail closed until ALL 9 targets verify.

SYNTHETIC VALIDATION, NOT PLATFORM PROOF: the green 9-target set below is
assembled from dummy bytes via the real producer (package_archive +
write_manifest) to prove the GATE logic (missing/tampered/wrong-tag
rejected, complete set accepted). It proves nothing about any platform.
Real platform proof is one builder invocation per target with ip_san 6/6.

Run: python3 test-validate-quiche-release.py (repo root auto-detected).
"""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
import zipfile

_HERE = os.path.dirname(os.path.abspath(__file__))


def _repo_root():
    d = _HERE
    while True:
        cand = os.path.join(d, "packages", "runtime-native",
                            "scripts", "build-quiche-owned.py")
        if os.path.isfile(cand):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise RuntimeError("repo root not found above " + _HERE)
        d = parent


REPO = _repo_root()


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BUILDER = _load("build_quiche_owned",
                os.path.join(REPO, "packages", "runtime-native",
                             "scripts", "build-quiche-owned.py"))


def _validator_path():
    """Candidate-adjacent now; integrated scripts dir when the tracked row
    lands (workflow + validator + test(s))."""
    for cand in (os.path.join(_HERE, "validate-quiche-release.py"),
                 os.path.join(REPO, "packages", "runtime-native",
                              "scripts", "validate-quiche-release.py")):
        if os.path.isfile(cand):
            return cand
    raise RuntimeError("validate-quiche-release.py not found")


VALIDATOR = _load("validate_quiche_release", _validator_path())

TOOLCHAIN_GOOD = {"rustc": "rustc 1.96.0 (x)", "cargo": "cargo 1.96.0 (x)",
                  "cmake": "cmake version 4.4.2",
                  "go": "go version go1.26.3 linux/amd64"}

NINE = sorted(BUILDER.SUPPORTED_TARGETS)
assert len(NINE) == 9, NINE


def rewrite_manifest(manifest_path, mutate):
    """Rewrite one manifest via mutate(dict). Re-point archive_sha256 only
    when the ZIP itself is untouched, so the mutated FIELD is what fires."""
    with open(manifest_path) as f:
        m = json.load(f)
    mutate(m)
    with open(manifest_path, "w") as f:
        f.write(json.dumps(m, indent=2) + "\n")


def make_target(dist_root, target, tag=None, lib_bytes=None,
                header_bytes=None, mutate=None):
    """Synthetic per-target out dir via the REAL producer packaging path."""
    d = os.path.join(dist_root, f"quiche-owned-{target}")
    os.makedirs(d)
    lib_name = ("quiche.lib" if target.startswith("win-")
                else "libquiche.a")
    lib = os.path.join(d, lib_name)
    with open(lib, "wb") as f:
        f.write(lib_bytes if lib_bytes is not None
                else (b"synthetic-lib-" + target.encode()))
    inc = os.path.join(d, "include")
    os.makedirs(inc)
    with open(os.path.join(inc, "quiche.h"), "wb") as f:
        f.write(header_bytes if header_bytes is not None
                else b"/* synthetic quiche.h */\n")
    staged_inc = os.path.join(d, "include", "quiche.h")
    archive = BUILDER.package_archive(target, lib, staged_inc, d)
    manifest = BUILDER.write_manifest(target, lib, staged_inc, d,
                                      dict(TOOLCHAIN_GOOD,
                                           target_inputs=target_inputs(target)),
                                      archive_path=archive)
    if tag is not None:
        rewrite_manifest(manifest,
                         lambda m: m.__setitem__("expected_tag", tag))
    if mutate is not None:
        rewrite_manifest(manifest, mutate)
    # Ship only what CI uploads: ZIP + manifest, never expanded lib/cache.
    for p in (lib, staged_inc):
        os.remove(p)
    shutil.rmtree(inc)
    return d


def target_inputs(target):
    result = {"rust_target": BUILDER.SUPPORTED_TARGETS[target]}
    if target == "win-x64":
        result.update({"cl": "/msvc/cl.exe", "link": "/msvc/link.exe",
                       "lib": "/msvc/lib.exe", "INCLUDE": "set", "LIB": "set",
                       "crt": "/MT,+crt-static"})
    elif target in BUILDER.APPLE_SDK:
        sdk, arch, deployment = BUILDER.APPLE_SDK[target]
        result.update({"xcrun": "/usr/bin/xcrun", "sdk": sdk,
                       "sdk_path": "/sdk", "arch": arch,
                       "clang": "/usr/bin/clang", "ar": "/usr/bin/ar",
                       "ranlib": "/usr/bin/ranlib"})
        if deployment is not None:
            result["deployment_target"] = deployment
    elif target in BUILDER.ANDROID_ARCH:
        triple, _ = BUILDER.ANDROID_ARCH[target]
        driver = ("armv7a-linux-androideabi" if target == "android-armv7"
                  else triple) + BUILDER.ANDROID_API + "-clang"
        result.update({"ndk": f"/ndk/{BUILDER.ANDROID_NDK_PIN}",
                       "api": BUILDER.ANDROID_API, driver: f"/ndk/bin/{driver}",
                       "llvm-ar": "/ndk/bin/llvm-ar",
                       "llvm-ranlib": "/ndk/bin/llvm-ranlib"})
    return result


def mutate_all(dist_root, targets, mutate):
    for t in targets:
        rewrite_manifest(
            os.path.join(dist_root, f"quiche-owned-{t}",
                         f"manifest-{t}.json"), mutate)


def tamper_member_bytes(zip_path, member, extra=b"TAMPERED"):
    with zipfile.ZipFile(zip_path) as z:
        items = {i.filename: z.read(i.filename) for i in z.infolist()}
    items[member] = items[member] + extra
    with zipfile.ZipFile(zip_path, "w",
                         compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in items.items():
            z.writestr(name, data)


def sha256_file(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class ReleaseGateTests(unittest.TestCase):
    def test_missing_targets_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            make_target(tmp, "linux-x64")
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            msg = str(ctx.exception)
            for missing in ("win-x64", "mac-arm64", "ios-arm64"):
                self.assertIn(missing, msg)

    def test_tampered_zip_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            d = os.path.join(tmp, "quiche-owned-linux-x64")
            z = os.path.join(
                d, f"{BUILDER.ARTIFACT_REVISION}-linux-x64.zip")
            with open(z, "ab") as f:
                f.write(b"\x00")
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("SHA256", str(ctx.exception))

    def test_tampered_member_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            d = os.path.join(tmp, "quiche-owned-linux-x64")
            z = os.path.join(
                d, f"{BUILDER.ARTIFACT_REVISION}-linux-x64.zip")
            tamper_member_bytes(z, "libquiche.a")
            # Re-point the outer digest so only the member check can fire.
            mpath = os.path.join(d, "manifest-linux-x64.json")
            with open(mpath) as f:
                m = json.load(f)
            m["archive_sha256"] = sha256_file(z)
            with open(mpath, "w") as f:
                f.write(json.dumps(m, indent=2) + "\n")
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("libquiche.a", str(ctx.exception))

    def test_wrong_tag_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t, tag="quiche-owned-v2")
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v2")
            self.assertIn("quiche-owned-v1", str(ctx.exception))

    def test_malformed_manifest_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mpath = os.path.join(tmp, "quiche-owned-linux-x64",
                                 "manifest-linux-x64.json")
            with open(mpath, "w") as f:
                f.write("{not json")
            with self.assertRaises(VALIDATOR.ReleaseError):
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")

    def test_duplicate_manifests_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            dup = os.path.join(tmp, "quiche-owned-linux-x64-copy")
            shutil.copytree(os.path.join(tmp, "quiche-owned-linux-x64"),
                            dup)
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("duplicate", str(ctx.exception).lower())

    def test_empty_member_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            # package_archive refuses empties, so craft the empty zip here
            # (manifest via the real producer first, then overwrite the ZIP).
            make_target(tmp, "linux-x64")
            d = os.path.join(tmp, "quiche-owned-linux-x64")
            z = os.path.join(
                d, f"{BUILDER.ARTIFACT_REVISION}-linux-x64.zip")
            with zipfile.ZipFile(z, "w") as zf:
                zf.writestr("libquiche.a", b"x")
                zf.writestr("include/quiche.h", b"")
            mpath = os.path.join(d, "manifest-linux-x64.json")
            with open(mpath) as f:
                m = json.load(f)
            m["archive_sha256"] = sha256_file(z)
            with open(mpath, "w") as f:
                f.write(json.dumps(m, indent=2) + "\n")
            for t in [t for t in NINE if t != "linux-x64"]:
                make_target(tmp, t)
            with self.assertRaises(VALIDATOR.ReleaseError):
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")

    def test_uniform_source_commit_mutation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "source_commit", "f" * 40))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("source_commit", str(ctx.exception))

    def test_uniform_boringssl_pin_mutation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "boringssl_pin", "e" * 40))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("boringssl_pin", str(ctx.exception))

    def test_uniform_version_mutation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "quiche_version", "0.0.0"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("quiche_version", str(ctx.exception))

    def test_uniform_patches_mutation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "patches", [{"name": "fake.patch",
                             "sha256": "a" * 64}]))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("patches", str(ctx.exception).lower())

    def test_per_target_rust_target_mutation_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            rewrite_manifest(
                os.path.join(tmp, "quiche-owned-win-x64",
                             "manifest-win-x64.json"),
                lambda m: m.__setitem__("rust_target",
                                        "x86_64-unknown-linux-gnu"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("rust_target", str(ctx.exception))

    def test_extra_field_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "asset_url", "https://example.invalid/x.zip"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("unexpected", str(ctx.exception))

    def test_missing_field_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.pop("archive_sha256"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("archive_sha256", str(ctx.exception))

    def test_mistyped_field_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            mutate_all(tmp, NINE, lambda m: m.__setitem__(
                "patches", "quiche-webtransport-ffi.patch"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("patches", str(ctx.exception))

    def test_missing_target_inputs_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            rewrite_manifest(
                os.path.join(tmp, "quiche-owned-linux-x64",
                             "manifest-linux-x64.json"),
                lambda m: m["toolchain"].pop("target_inputs"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("target_inputs", str(ctx.exception))

    def test_target_inputs_pin_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            rewrite_manifest(
                os.path.join(tmp, "quiche-owned-android-arm64",
                             "manifest-android-arm64.json"),
                lambda m: m["toolchain"]["target_inputs"].__setitem__(
                    "api", "22"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("NDK/API", str(ctx.exception))

    def test_unexpected_target_input_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            rewrite_manifest(
                os.path.join(tmp, "quiche-owned-linux-x64",
                             "manifest-linux-x64.json"),
                lambda m: m["toolchain"]["target_inputs"].__setitem__(
                    "unexpected", "metadata"))
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("target_inputs keys", str(ctx.exception))

    def test_emit_file_lists_all_18(self):
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            out = os.path.join(tmp, "validated-assets.txt")
            files = VALIDATOR.validate(tmp, BUILDER,
                                       tag="quiche-owned-v1")
            with open(out, "w") as f:
                f.write("\n".join(files) + "\n")
            with open(out) as f:
                lines = [ln.strip() for ln in f if ln.strip()]
            self.assertEqual(len(lines), 18)
            self.assertEqual(sorted(lines), sorted(files))
            for p in lines:
                self.assertTrue(os.path.isfile(p), p)

    def test_green_complete_synthetic_nine(self):
        """Synthetic gate-logic green only — not platform proof."""
        with tempfile.TemporaryDirectory() as tmp:
            for t in NINE:
                make_target(tmp, t)
            files = VALIDATOR.validate(tmp, BUILDER,
                                       tag="quiche-owned-v1")
            self.assertEqual(len(files), 18)
            self.assertTrue(all(p.endswith((".zip", ".json"))
                                for p in files))
            for t in NINE:
                self.assertTrue(any(f"manifest-{t}.json" in p
                                    for p in files), t)
                self.assertTrue(any(f"-{t}.zip" in p for p in files), t)

    def test_rejects_actual_linux_only_output(self):
        """The real producer shape (linux-x64 only) must NOT publish."""
        with tempfile.TemporaryDirectory() as tmp:
            make_target(tmp, "linux-x64")
            with self.assertRaises(VALIDATOR.ReleaseError) as ctx:
                VALIDATOR.validate(tmp, BUILDER, tag="quiche-owned-v1")
            self.assertIn("win-x64", str(ctx.exception))
        # And the actual linux-only producer dir is still linux-only.
        root_out = os.path.join(
            REPO, "artifacts", "networking-359", "quiche-owned-build",
            "root-out")
        self.assertTrue(os.path.isfile(
            os.path.join(root_out, "manifest-linux-x64.json")),
            "actual producer output moved; update this control")
        self.assertFalse(
            os.path.isfile(os.path.join(root_out, "manifest-win-x64.json")),
            "unexpected win-x64 manifest in linux-only output")


if __name__ == "__main__":
    unittest.main()
