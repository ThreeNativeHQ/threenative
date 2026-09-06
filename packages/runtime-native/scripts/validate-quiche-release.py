#!/usr/bin/env python3
"""Standalone fail-closed release validator for owned quiche artifacts.

Fails closed until ALL 9 downloader targets verify (1 linux + 1 win +
2 mac + 3 android + 2 ios). Linux-only CI names the missing targets
instead of green-skipping. Every identity field is anchored to the
read-only producer constants/map (never to cross-manifest agreement
alone): uniform alteration of any one of them still fails. Emits the
explicit 18-file gh-release list (ZIP + manifest per target).

Usage: python3 validate-quiche-release.py --dist <dir>
    --tag quiche-owned-v1 [--builder <path>] [--emit <file>]
"""
import argparse
import hashlib
import importlib.util
import json
import os
import sys
import zipfile

NINE_COUNT = 9  # 1 linux + 1 win + 2 mac + 3 android + 2 ios

# Exact manifest shape the producer writes (write_manifest). Missing,
# unexpected, or mistyped fields fail; no fallthrough accepts metadata
# the producer never wrote.
REQUIRED_TYPES = {
    "artifact_revision": str,
    "upstream_commit": str,
    "source_commit": str,
    "boringssl_pin": str,
    "quiche_version": str,
    "target": str,
    "rust_target": str,
    "expected_tag": str,
    "patches": list,
    "artifacts": dict,
    "toolchain": dict,
    "archive_sha256": str,
}


class ReleaseError(Exception):
    pass


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_builder(path=None):
    if path is None:
        d = os.path.dirname(os.path.abspath(__file__))
        while True:
            cand = os.path.join(d, "packages", "runtime-native",
                                "scripts", "build-quiche-owned.py")
            if os.path.isfile(cand):
                path = cand
                break
            parent = os.path.dirname(d)
            if parent == d:
                raise ReleaseError("producer build-quiche-owned.py not found")
            d = parent
    spec = importlib.util.spec_from_file_location(
        "build_quiche_owned", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_manifest(path):
    try:
        with open(path) as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        raise ReleaseError(f"TN_QUICHE_RELEASE_MALFORMED: {path}: {e}")
    if not isinstance(m, dict):
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {path} is not a JSON object")
    return m


def _hex(value, length, what):
    if not isinstance(value, str) or len(value) != length:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {what} must be {length} hex chars")
    try:
        int(value, 16)
    except ValueError:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {what} is not hex: {value!r}")


def check_manifest_shape(m, man_path, target, builder):
    """Exact key set, JSON types, hex formats, and per-target identity."""
    if set(m) != set(REQUIRED_TYPES):
        missing = sorted(set(REQUIRED_TYPES) - set(m))
        extra = sorted(set(m) - set(REQUIRED_TYPES))
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {man_path} missing={missing} "
            f"unexpected={extra}")
    for key, want in REQUIRED_TYPES.items():
        if not isinstance(m[key], want):
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MALFORMED: {man_path} {key} is "
                f"{type(m[key]).__name__}, expected {want.__name__}")
    _hex(m["upstream_commit"], 40, f"{man_path} upstream_commit")
    _hex(m["source_commit"], 40, f"{man_path} source_commit")
    _hex(m["boringssl_pin"], 40, f"{man_path} boringssl_pin")
    _hex(m["archive_sha256"], 64, f"{man_path} archive_sha256")
    if not isinstance(m["patches"], list) or not m["patches"]:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {man_path} patches is not a "
            f"non-empty list")
    for p in m["patches"]:
        if set(p) != {"name", "sha256"} or not isinstance(p["name"], str) \
                or not p["name"].endswith(".patch"):
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MALFORMED: {man_path} bad patch entry {p!r}")
        _hex(p["sha256"], 64, f"{man_path} patch {p['name']}")
    layout = builder.expected_layout(target)
    if set(m["artifacts"]) != {layout["lib_name"], "quiche.h"}:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {man_path} artifacts keys "
            f"{sorted(m['artifacts'])}, expected "
            f"{sorted([layout['lib_name'], 'quiche.h'])}")
    for name, digest in m["artifacts"].items():
        _hex(digest, 64, f"{man_path} artifacts[{name}]")
    if set(m["toolchain"]) != {"rustc", "cargo", "cmake", "go"} or \
            not all(isinstance(v, str) for v in m["toolchain"].values()):
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MALFORMED: {man_path} toolchain must map "
            f"rustc/cargo/cmake/go to version strings")
    try:
        builder.check_toolchain(m["toolchain"])
    except Exception as e:
        raise ReleaseError(f"TN_QUICHE_RELEASE_TOOLCHAIN: {man_path}: {e}")
    if m["target"] != target:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MISMATCH: {man_path} targets "
            f"{m['target']}, dir says {target}")
    if m["rust_target"] != builder.SUPPORTED_TARGETS[target]:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_MISMATCH: {man_path} rust_target "
            f"{m['rust_target']} != producer "
            f"{builder.SUPPORTED_TARGETS[target]} for {target}")
    if m["expected_tag"] != builder.EXPECTED_TAG:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_TAG: {man_path} says "
            f"{m['expected_tag']}, expected {builder.EXPECTED_TAG}")


def validate(dist, builder, tag=None):
    """Validate a dist dir of quiche-owned-<target>/ (each: ZIP+manifest).
    Returns the explicit 18-file gh-release list. Raises ReleaseError."""
    tag = builder.EXPECTED_TAG if tag is None else tag
    if tag != builder.EXPECTED_TAG:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_TAG: expected {builder.EXPECTED_TAG}, "
            f"got {tag}")
    expected = sorted(builder.SUPPORTED_TARGETS)
    if len(expected) != NINE_COUNT:
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_TARGETS: producer lists {len(expected)}, "
            f"expected {NINE_COUNT}")
    try:
        entries = sorted(os.listdir(dist))
    except OSError as e:
        raise ReleaseError(f"TN_QUICHE_RELEASE_DIST: {dist}: {e}")
    seen, manifests, files = {}, {}, []
    flat_single = [e for e in entries
                   if e.startswith("manifest-") and e.endswith(".json")]
    if flat_single and not any(os.path.isdir(os.path.join(dist, e))
                               for e in entries):
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_INCOMPLETE: {dist} is a single-target "
            f"producer out dir ({flat_single}), not a 9-target dist. "
            f"Linux-only CI cannot publish yet — missing "
            f"{[t for t in expected if t != 'linux-x64']}; have ['linux-x64']")
    for entry in entries:
        full = os.path.join(dist, entry)
        if not os.path.isdir(full):
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_UNEXPECTED: {full} is not a target dir")
        matches = [t for t in expected if entry == f"quiche-owned-{t}"]
        if not matches:
            # A copy/rename of a target dir still claims its manifest target:
            # report it as a duplicate, not a mystery entry.
            claimed = None
            try:
                for f in os.listdir(full):
                    if f.startswith("manifest-") and f.endswith(".json"):
                        claimed = read_manifest(
                            os.path.join(full, f)).get("target")
            except OSError:
                claimed = None
            if claimed in expected:
                raise ReleaseError(
                    f"TN_QUICHE_RELEASE_DUPLICATE: {entry} also claims "
                    f"target {claimed} (already shipped as "
                    f"quiche-owned-{claimed})")
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_UNEXPECTED: {entry} names no known target")
        target = matches[0]
        if target in seen:
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_DUPLICATE: target {target} twice "
                f"({seen[target]} and {entry})")
        seen[target] = entry
        try:
            kind_files = sorted(os.listdir(full))
        except OSError as e:
            raise ReleaseError(f"TN_QUICHE_RELEASE_DIST: {full}: {e}")
        want_zip = f"{builder.ARTIFACT_REVISION}-{target}.zip"
        want_man = f"manifest-{target}.json"
        if sorted(kind_files) != sorted([want_zip, want_man]):
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MEMBERS: {entry} holds {kind_files}, "
                f"expected [{want_zip}, {want_man}] (ZIP+manifest only)")
        zip_path = os.path.join(full, want_zip)
        man_path = os.path.join(full, want_man)
        m = read_manifest(man_path)
        check_manifest_shape(m, man_path, target, builder)
        manifests[target] = m
        files += [zip_path, man_path]
    missing = [t for t in expected if t not in seen]
    if missing:
        have = sorted(seen)
        raise ReleaseError(
            f"TN_QUICHE_RELEASE_INCOMPLETE: missing {missing}; "
            f"have {have}. Linux-only CI cannot publish yet — the "
            f"future platform-matrix row must provide: "
            f"{', '.join(missing)}")
    # Anchor EVERY identity field to the producer — cross-manifest agreement
    # alone would pass a uniformly altered set.
    anchors = {
        "artifact_revision": builder.ARTIFACT_REVISION,
        "upstream_commit": builder.UPSTREAM_COMMIT,
        "source_commit": builder.UPSTREAM_COMMIT,
        "boringssl_pin": builder.BORINGSSL_PIN,
        "quiche_version": builder.QUICHE_VERSION,
        "expected_tag": builder.EXPECTED_TAG,
        "patches": builder.PATCHES,
    }
    first = manifests[expected[0]]
    for key, want in anchors.items():
        if first[key] != want:
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MISMATCH: {key} {first[key]!r} != "
                f"producer {want!r}")
        for t in expected[1:]:
            if manifests[t][key] != first[key]:
                raise ReleaseError(
                    f"TN_QUICHE_RELEASE_MISMATCH: {key} differs in {t}")
    # Per-target: real layout check + outer digest + per-member digests.
    for t in expected:
        m = manifests[t]
        zip_path = os.path.join(dist, seen[t],
                                f"{builder.ARTIFACT_REVISION}-{t}.zip")
        try:
            builder.validate_package(zip_path, t)
        except Exception as e:
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MEMBERS: {zip_path}: {e}")
        actual_outer = sha256_file(zip_path)
        if actual_outer != m["archive_sha256"]:
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_SHA256: {zip_path} hashes "
                f"{actual_outer}, manifest says {m['archive_sha256']}")
        with zipfile.ZipFile(zip_path) as z:
            members = {i.filename: z.read(i.filename)
                       for i in z.infolist()}
        layout = builder.expected_layout(t)
        if sorted(members) != sorted(layout["members"]):
            raise ReleaseError(
                f"TN_QUICHE_RELEASE_MEMBERS: {zip_path} holds "
                f"{sorted(members)}, expected {sorted(layout['members'])}")
        for name, data in members.items():
            if not data:
                raise ReleaseError(
                    f"TN_QUICHE_RELEASE_EMPTY: {zip_path}:{name} is empty")
            short = os.path.basename(name)
            if short not in m["artifacts"]:
                raise ReleaseError(
                    f"TN_QUICHE_RELEASE_MALFORMED: {t} manifest lacks "
                    f"digest for {name}")
            actual = hashlib.sha256(data).hexdigest()
            if actual != m["artifacts"][short]:
                raise ReleaseError(
                    f"TN_QUICHE_RELEASE_SHA256: {zip_path}:{name} hashes "
                    f"{actual}, manifest says {m['artifacts'][short]}")
    return sorted(files)


def main():
    ap = argparse.ArgumentParser(description="Fail-closed quiche release gate")
    ap.add_argument("--dist", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--builder", required=False, default=None)
    ap.add_argument("--emit", required=False, default=None)
    args = ap.parse_args()
    try:
        builder = load_builder(args.builder)
        files = validate(args.dist, builder, tag=args.tag)
    except ReleaseError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"release ok: {len(files)} files "
          f"({NINE_COUNT} targets x ZIP+manifest)")
    for p in files:
        print(p)
    if args.emit:
        with open(args.emit, "w") as f:
            f.write("\n".join(files) + "\n")


if __name__ == "__main__":
    main()
