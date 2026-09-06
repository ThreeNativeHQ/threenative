#!/usr/bin/env python3
"""Engine-owned patched quiche artifact builder (PRD-359 candidate).

Design: PRISTINE INPUT ONLY. verify_source accepts exactly the pinned
upstream HEAD, a byte-clean worktree, and the exact BoringSSL submodule HEAD
read from the actual checkout (plus nested submodules per the pinned tree).
Any prepatched/dirty/missing input is rejected BEFORE patching. Repeat builds
require a fresh owned checkout — the builder never resets, cleans, or deletes
caller data. CARGO_TARGET_DIR must point outside the source tree so build
outputs can never become source inputs.

Adapted from the external mystralengine/library-builder build-quiche.py
desktop recipes (QUICHE_REPO, ANDROID_ABIS, iOS SDKROOT selection, win /MT
crt-static). Upstream quiche is BSD-2-Clause (Cloudflare 2018-2019, COPYING);
carried patches are engine-authored.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

UPSTREAM_COMMIT = "020a43a0a5eed76f57dd3ce5012149aa576c594d"
BORINGSSL_PIN = "f1c75347daa2ea81a941e953f2263e0a4d970c8d"
BORINGSSL_REL = os.path.join("quiche", "deps", "boringssl")
QUICHE_VERSION = "0.24.6"
ARTIFACT_REVISION = "quiche-0.24.6-tn1"  # ThreeNative build rev; never reuse upstream -3
# Single exact release-tag value. Workflow triggers on it; builder validates
# it before BUILD and the publish step validates it before PUBLISH.
EXPECTED_TAG = "quiche-owned-v1"
REQUIRED_SYMBOLS = ["quiche_h3_config_set_additional_settings",
                    "quiche_connect", "quiche_accept"]
REQUIRED_HEADER_DECL = "quiche_h3_config_set_additional_settings"
# Deterministic packaging of identical inputs only — NOT a claim that the
# compiler emits byte-identical objects across machines (BoringSSL build paths
# embed absolute dirs). Same lib+header in, same zip bytes out.
ARCHIVE_MTIME = (2026, 1, 1, 0, 0, 0)
# Minimum toolchain that produced the locally proved linux-x64 archive.
MIN_TOOLCHAIN = {"rustc": (1, 96, 0), "cargo": (1, 96, 0),
                 "cmake": (4, 4, 2), "go": (1, 26, 3)}

PATCHES = [
    {"name": "quiche-webtransport-ffi.patch",
     "sha256": "da360ce1274173934421cd283ac6f4faddb9dbb2688b77f5a7aed284d9d2a8be"},
    {"name": "quiche-ip-san.patch",
     "sha256": "eabe59921bcd42bdd956d256e6a3628d54530a32384aa3023819811ed695b15a"},
]

# Downloader-consumed set (packages/runtime-native/scripts/download-deps.mjs).
# iOS arm64-simulator excluded: BoringSSL arm64 asm cross-compiles for device,
# not the simulator (gap already tracked in docs/realtimecommunication.md).
SUPPORTED_TARGETS = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "win-x64": "x86_64-pc-windows-msvc",
    "mac-arm64": "aarch64-apple-darwin",
    "mac-x86_64": "x86_64-apple-darwin",
    "android-arm64": "aarch64-linux-android",
    "android-armv7": "armv7-linux-androideabi",
    "android-x64": "x86_64-linux-android",
    "ios-arm64": "aarch64-apple-ios",
    "ios-sim-x64": "x86_64-apple-ios",
}


class BuildError(Exception):
    pass


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve(p):
    """Absolute, normalized path BEFORE any git -C use (workflow invokes from
    an outer cwd with sibling dirs)."""
    return str(Path(p).resolve())


def rust_target(target):
    try:
        return SUPPORTED_TARGETS[target]
    except KeyError:
        raise BuildError(f"TN_QUICHE_TARGET_UNSUPPORTED: {target}; "
                         f"supported: {sorted(SUPPORTED_TARGETS)}")


def verify_patches(patch_dir):
    patch_dir = resolve(patch_dir)
    for p in PATCHES:
        path = os.path.join(patch_dir, p["name"])
        if not os.path.isfile(path):
            raise BuildError(f"TN_QUICHE_PATCH_MISSING: {path}")
        actual = sha256_file(path)
        if actual != p["sha256"]:
            raise BuildError(f"TN_QUICHE_PATCH_MISMATCH: {p['name']}: "
                             f"expected {p['sha256']}, got {actual}")
    return patch_dir


def verify_source(src_dir):
    """PRISTINE ONLY: exact HEAD + clean tracked tree + no unexpected
    untracked inputs + exact actual submodule HEADs (incl. nested)."""
    src = resolve(src_dir)
    head = subprocess.check_output(
        ["git", "-C", src, "rev-parse", "HEAD"], text=True).strip()
    if head != UPSTREAM_COMMIT:
        raise BuildError(f"TN_QUICHE_SOURCE_MISMATCH: expected {UPSTREAM_COMMIT}, got {head}")
    modified = subprocess.check_output(
        ["git", "-C", src, "diff", "--name-only"], text=True).split()
    staged = subprocess.check_output(
        ["git", "-C", src, "diff", "--cached", "--name-only"], text=True).split()
    untracked = subprocess.check_output(
        ["git", "-C", src, "ls-files", "--others"],
        text=True).split()
    if modified or staged:
        raise BuildError(f"TN_QUICHE_SOURCE_DIRTY: modified={sorted(modified)} "
                         f"staged={sorted(staged)}; repeat builds require a fresh "
                         f"owned checkout")
    if untracked:
        raise BuildError(f"TN_QUICHE_SOURCE_DIRTY: untracked inputs {sorted(untracked)}; "
                         f"repeat builds require a fresh owned checkout")
    _verify_submodule(src, BORINGSSL_REL, BORINGSSL_PIN)
    return src


def _verify_submodule(src, rel, expected_pin):
    sub = os.path.join(src, rel)
    # Parent gitlink must pin the exact commit (proves the tree reference).
    try:
        pin = subprocess.check_output(
            ["git", "-C", src, "ls-tree", "HEAD", rel], text=True).strip()
    except subprocess.CalledProcessError:
        raise BuildError(f"TN_QUICHE_BORINGSSL_MISMATCH: no gitlink at {rel}")
    if not pin.startswith("160000 commit "):
        raise BuildError(f"TN_QUICHE_BORINGSSL_MISMATCH: {rel} is not a gitlink: {pin!r}")
    if pin.split()[2] != expected_pin:
        raise BuildError(f"TN_QUICHE_BORINGSSL_MISMATCH: gitlink {pin.split()[2]} != {expected_pin}")
    # Actual checkout bytes must BE that commit (gitlink alone proves nothing).
    if not os.path.isdir(os.path.join(sub, ".git")) and not os.path.isfile(
            os.path.join(src, ".git", "modules", *rel.split(os.sep), "HEAD")):
        # Non-checkout submodule content (plain dir without git metadata) is
        # still verifiable only if it is byte-clean against the pin — without
        # git metadata we cannot prove it, so reject.
        try:
            actual = subprocess.check_output(
                ["git", "-C", sub, "rev-parse", "HEAD"], text=True).strip()
        except subprocess.CalledProcessError:
            raise BuildError(f"TN_QUICHE_BORINGSSL_MISSING: {sub} has no checkout")
    else:
        try:
            actual = subprocess.check_output(
                ["git", "-C", sub, "rev-parse", "HEAD"], text=True).strip()
        except subprocess.CalledProcessError:
            raise BuildError(f"TN_QUICHE_BORINGSSL_MISSING: {sub} has no checkout")
    if actual != expected_pin:
        raise BuildError(f"TN_QUICHE_BORINGSSL_MISMATCH: actual checkout {actual} "
                         f"!= pinned {expected_pin}")
    # Submodule worktree itself must be clean.
    if subprocess.check_output(
            ["git", "-C", sub, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"],
            text=True).strip():
        raise BuildError(f"TN_QUICHE_BORINGSSL_DIRTY: {sub} worktree is not clean")
    # Nested submodules per the PINNED TREE (not the checkout): any gitlink
    # recorded at expected_pin must also be checked out exactly.
    try:
        tree = subprocess.check_output(
            ["git", "-C", sub, "ls-tree", "-r", expected_pin], text=True)
    except subprocess.CalledProcessError:
        return
    for line in tree.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] == "160000":
            nested_rel = parts[3]
            nested_pin = parts[2]
            _verify_submodule(sub, nested_rel, nested_pin)


def apply_one_patch(src_dir, patch_path):
    """Apply one already-checksummed patch. Paths resolved by the caller."""
    subprocess.check_call(["git", "-C", src_dir, "apply", patch_path])


def apply_patches(src_dir, patch_dir):
    src_dir, patch_dir = resolve(src_dir), resolve(patch_dir)
    for p in PATCHES:
        apply_one_patch(src_dir, os.path.join(patch_dir, p["name"]))


def _norm(sym):
    # nm/llvm-nm prefix '_' (Mach-O) and '@version' suffixes (GNU symver).
    return sym.lstrip("_").split("@")[0]


def defined_symbols_nm(nm_output):
    """Exact DEFINED names from portable `nm -g` output (no GNU-only flags).

    Definition lines carry an address + type letter; undefined lines have no
    address (`U sym` or `(undefined) external _sym`). Only address-bearing,
    non-U lines count. Handles `000... T name`, `000... (__TEXT,__text)
    external _name`, and `name T 000...` orders.
    """
    defined = set()
    for line in nm_output.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0].upper() == "U" or "(undefined)" in parts:
            continue
        if len(parts) == 3 and re.fullmatch(r"[0-9a-fA-F]+", parts[0]) \
                and len(parts[1]) == 1 and parts[1].upper() != "U":
            defined.add(_norm(parts[2]))
        elif len(parts) >= 3 and re.fullmatch(r"[0-9a-fA-F]+", parts[0]) \
                and "external" in parts:
            defined.add(_norm(parts[-1]))
        elif len(parts) == 3 and re.fullmatch(r"[0-9a-fA-F]+", parts[2]) \
                and len(parts[1]) == 1 and parts[1].upper() != "U":
            defined.add(_norm(parts[0]))
    return defined


def defined_symbols_dumpbin(dumpbin_output):
    """Exact EXTERNAL definitions from realistic `dumpbin /SYMBOLS` records:

    `004 00000000 SECT5  notype ()    External     | quiche_connect`
    UNDEF records reference; Static records are not exported. The name is the
    last `|`-separated field; SECT is parts[2] (index 0 is the member number).
    """
    defined = set()
    for line in dumpbin_output.splitlines():
        if "|" not in line:
            continue
        left, _, name = line.partition("|")
        name = name.strip()
        parts = left.split()
        if len(parts) >= 5 and parts[2].startswith("SECT") and "External" in parts:
            defined.add(_norm(name))
    return defined


def pick_inspector(nm_path=None, llvm_nm_path=None, dumpbin_path=None,
                   lib_suffix=".a"):
    """Fail closed when no supported inspector exists for the archive kind."""
    if lib_suffix == ".lib" and dumpbin_path:
        return ("dumpbin", dumpbin_path)
    for candidate in (nm_path, llvm_nm_path):
        if candidate:
            return ("nm", candidate)
    raise BuildError("TN_QUICHE_NO_NM: nm/llvm-nm (or dumpbin for .lib) "
                     "required to validate symbols")


def validate_archive(target, lib_path, header_path):
    """Required symbols DEFINED in the archive + required export in the header."""
    lib_path = resolve(lib_path)
    header_path = resolve(header_path)
    if not os.path.isfile(lib_path):
        raise BuildError(f"TN_QUICHE_LIB_MISSING: {lib_path}")
    if not os.path.isfile(header_path):
        raise BuildError(f"TN_QUICHE_HEADER_MISSING: {header_path}")
    kind, tool = pick_inspector(
        nm_path=shutil.which("nm"), llvm_nm_path=shutil.which("llvm-nm"),
        dumpbin_path=shutil.which("dumpbin"),
        lib_suffix=Path(lib_path).suffix)
    if kind == "dumpbin":
        out = subprocess.check_output([tool, "/SYMBOLS", lib_path],
                                      text=True, stderr=subprocess.DEVNULL)
        defined = defined_symbols_dumpbin(out)
    else:
        out = subprocess.check_output([tool, "-g", lib_path],
                                      text=True, stderr=subprocess.DEVNULL)
        defined = defined_symbols_nm(out)
    for sym in REQUIRED_SYMBOLS:
        if sym not in defined:
            raise BuildError(f"TN_QUICHE_SYMBOL_MISSING: {sym} not DEFINED in {lib_path}")
    with open(header_path) as f:
        if REQUIRED_HEADER_DECL not in f.read():
            raise BuildError(f"TN_QUICHE_HEADER_EXPORT_MISSING: {REQUIRED_HEADER_DECL} "
                             f"not declared in {header_path}")


def _version_tuple(text):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
    if not m:
        raise BuildError(f"TN_QUICHE_TOOLCHAIN: unparseable version: {text!r}")
    return tuple(int(x) for x in m.groups())


def check_toolchain(info):
    for tool, minimum in MIN_TOOLCHAIN.items():
        version = info.get(tool, "absent")
        if version == "absent":
            raise BuildError(f"TN_QUICHE_TOOLCHAIN: {tool} absent")
        if _version_tuple(version) < minimum:
            raise BuildError(f"TN_QUICHE_TOOLCHAIN: {tool} {version} below minimum "
                             f"{'.'.join(map(str, minimum))}")


def expected_layout(target):
    """Flat consumer layout per CMakeLists + download-deps: desktop quiche/
    holds the lib at top level; variant dirs hold include/ beside the lib."""
    lib_name = "quiche.lib" if target.startswith("win-") else "libquiche.a"
    return {"lib_name": lib_name, "members": [lib_name, "include/quiche.h"]}


def write_manifest(target, lib_path, header_path, out_dir, toolchain, archive_path=None):
    out_dir = resolve(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    check_toolchain(toolchain)
    lib_name = "quiche.lib" if target.startswith("win-") else "libquiche.a"
    manifest = {
        "artifact_revision": ARTIFACT_REVISION,
        "upstream_commit": UPSTREAM_COMMIT,
        "source_commit": UPSTREAM_COMMIT,
        "boringssl_pin": BORINGSSL_PIN,
        "quiche_version": QUICHE_VERSION,
        "target": target,
        "rust_target": rust_target(target),
        "expected_tag": EXPECTED_TAG,
        "patches": PATCHES,
        "artifacts": {
            lib_name: sha256_file(lib_path),
            "quiche.h": sha256_file(header_path),
        },
        "toolchain": toolchain,
    }
    if archive_path is not None:
        manifest["archive_sha256"] = sha256_file(archive_path)
    path = os.path.join(out_dir, f"manifest-{target}.json")
    with open(path, "w") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    return path


def check_release_tag(tag):
    if tag != EXPECTED_TAG:
        raise BuildError(f"TN_QUICHE_RELEASE_TAG: expected {EXPECTED_TAG}, got {tag}")


def package_archive(target, lib_path, header_path, out_dir):
    """Deterministic zip of identical inputs: flat layout, fixed mtime/perms,
    DEFLATED compression."""
    out_dir = resolve(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    layout = expected_layout(target)
    entries = sorted([(layout["members"][0], lib_path),
                      (layout["members"][1], header_path)])
    zip_path = os.path.join(out_dir, f"{ARTIFACT_REVISION}-{target}.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=6) as z:
        for name, src in entries:
            with open(src, "rb") as f:
                data = f.read()
            if not data:
                raise BuildError(f"TN_QUICHE_PACKAGE: refusing empty member {name}")
            info = zipfile.ZipInfo(name, date_time=ARCHIVE_MTIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)
    validate_package(zip_path, target)
    return zip_path


def validate_package(zip_path, target):
    """Exact members, non-empty, correct per-target lib name."""
    layout = expected_layout(target)
    with zipfile.ZipFile(zip_path) as z:
        names = sorted(z.namelist())
        if names != sorted(layout["members"]):
            raise BuildError(f"TN_QUICHE_PACKAGE: {zip_path} members {names}, "
                             f"expected {sorted(layout['members'])}")
        for info in z.infolist():
            if info.file_size == 0:
                raise BuildError(f"TN_QUICHE_PACKAGE: empty member {info.filename}")


def toolchain_info():
    def run(cmd):
        try:
            return subprocess.check_output(cmd, text=True,
                                           stderr=subprocess.DEVNULL).strip().splitlines()[0]
        except Exception:
            return "absent"
    return {"rustc": run(["rustc", "--version"]), "cargo": run(["cargo", "--version"]),
            "cmake": run(["cmake", "--version"]), "go": run(["go", "version"])}


def host_triple():
    machine = {"x86_64": "x86_64", "aarch64": "aarch64"}.get(os.uname().machine, "x86_64")
    system = {"Linux": "unknown-linux-gnu", "Darwin": "apple-darwin"}.get(
        os.uname().sysname, "unknown-linux-gnu")
    return f"{machine}-{system}"


def run_ip_san_tests(src_dir, target, host=None, run_tests=True):
    """Six-case ip_san integration suite. Host target: run for real (proves the
    IP-verifier branch). Cross targets: compile only (not runnable here) and
    report skipped — never claim a pass that did not execute."""
    rust_t = rust_target(target)
    host = host or host_triple()
    if rust_t != host or not run_tests:
        return {"status": "skipped", "reason": f"{rust_t} != host {host}"}
    proc = subprocess.run(["cargo", "test", "--target", rust_t,
                           "--test", "ip_san", "--features", "ffi"],
                          cwd=src_dir, capture_output=True, text=True)
    if proc.returncode != 0:
        raise BuildError(f"TN_QUICHE_IP_SAN_FAIL:\n{proc.stdout}\n{proc.stderr}")
    if "6 passed" not in proc.stdout and "test result: ok. 6 passed" not in proc.stdout:
        raise BuildError(f"TN_QUICHE_IP_SAN_COUNT:\n{proc.stdout}\n{proc.stderr}")
    return {"status": "passed", "tests": 6}


def check_target_dir(src_dir):
    """CARGO_TARGET_DIR must live OUTSIDE the source tree: build outputs must
    never become source inputs (and never pollute a pristine check)."""
    target_dir = os.environ.get("CARGO_TARGET_DIR")
    if not target_dir:
        raise BuildError("TN_QUICHE_TARGET_DIR: CARGO_TARGET_DIR must be set to a "
                         "directory outside the source tree")
    target_abs = resolve(target_dir)
    if target_abs == src_dir or target_abs.startswith(src_dir + os.sep):
        raise BuildError(f"TN_QUICHE_TARGET_DIR: {target_abs} is inside source {src_dir}")
    return target_abs


def build(target, src_dir, patch_dir, out_dir, jobs=4, run_tests=True,
          release_tag=None):
    rust_target(target)  # fail closed before any work
    if release_tag is not None:
        check_release_tag(release_tag)
    patch_dir = verify_patches(patch_dir)
    src_dir = verify_source(src_dir)  # pristine ONLY; raises otherwise
    target_abs = check_target_dir(src_dir)
    apply_patches(src_dir, patch_dir)
    info = toolchain_info()
    check_toolchain(info)
    rust_t = SUPPORTED_TARGETS[target]
    subprocess.check_call(["rustup", "target", "add", rust_t])
    env = os.environ.copy()
    env["CARGO_BUILD_JOBS"] = str(jobs)
    env["CARGO_TARGET_DIR"] = target_abs
    if target.startswith("win-"):
        env["RUSTFLAGS"] = (env.get("RUSTFLAGS", "") + " -C target-feature=+crt-static").strip()
    subprocess.check_call(["cargo", "build", "--target", rust_t,
                           "--package", "quiche", "--features", "ffi", "--release"],
                          cwd=src_dir, env=env)
    # IP-SAN proof runs INSIDE this single invocation (workflow calls once).
    ip_san = run_ip_san_tests(src_dir, target, run_tests=run_tests)
    lib_name = "quiche.lib" if target.startswith("win-") else "libquiche.a"
    built = os.path.join(target_abs, rust_t, "release", lib_name)
    header = os.path.join(src_dir, "quiche", "include", "quiche.h")
    validate_archive(target, built, header)
    out = resolve(out_dir)
    os.makedirs(os.path.join(out, "include"), exist_ok=True)
    staged_lib = os.path.join(out, lib_name)
    staged_inc = os.path.join(out, "include", "quiche.h")
    shutil.copy2(built, staged_lib)
    shutil.copy2(header, staged_inc)
    archive = package_archive(target, staged_lib, staged_inc, out)
    manifest = write_manifest(target, staged_lib, staged_inc, out, info,
                              archive_path=archive)
    print(f"archive: {archive}\nmanifest: {manifest}\nip_san: {ip_san}")
    return archive, manifest


def main():
    ap = argparse.ArgumentParser(description="Build engine-owned patched quiche archives")
    ap.add_argument("target", nargs="?", help=f"one of {sorted(SUPPORTED_TARGETS)}")
    ap.add_argument("--source-dir", required=False, default=None)
    ap.add_argument("--patch-dir", required=False, default=None)
    ap.add_argument("--out", required=False, default=None)
    ap.add_argument("--release-tag", required=False, default=None,
                    help=f"must equal {EXPECTED_TAG}")
    ap.add_argument("--check-release-tag", required=False, default=None,
                    help="validate a tag value and exit (no source/out needed)")
    ap.add_argument("-j", type=int, default=4)
    ap.add_argument("--no-tests", action="store_true")
    args = ap.parse_args()
    try:
        if args.check_release_tag is not None:
            check_release_tag(args.check_release_tag)
            print(f"release-tag ok: {args.check_release_tag}")
            return
        if not args.target:
            ap.error("target is required")
        if not args.source_dir or not args.patch_dir or not args.out:
            ap.error("--source-dir, --patch-dir and --out are required for builds")
        build(args.target, args.source_dir, args.patch_dir, args.out,
              jobs=args.j, run_tests=not args.no_tests,
              release_tag=args.release_tag)
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
