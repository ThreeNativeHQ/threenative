#!/usr/bin/env python3
"""Compare TN_TRAA_DUMP directories (stdlib only; frames are zero-based, 18..23).

python3 packages/runtime-native/scripts/compare-traa-dumps.py /tmp/traa-browser /tmp/traa-native
Add --epsilon N to ignore absolute differences <= N (default: exact comparison).
Run --self-test for a CPU-only check of decoding, divergence, and malformed input.
Reports first divergence in the dumped window, not in unobserved frames 0..17.
Textures are tightly packed top-left RGBA float32 LE; projection matrices are column-major.
"""

import argparse
import contextlib
import io
import json
import math
from pathlib import Path
import struct
import tempfile

TEXTURES = ("beauty", "velocity", "history", "resolved")
FRAMES = range(18, 24)


def metadata(directory, name):
    return json.loads((directory / f"{name}.json").read_text())


def texture(directory, name):
    meta = metadata(directory, name)
    shape = tuple(meta[key] for key in ("width", "height", "channels"))
    if any(type(value) is not int or value <= 0 for value in shape):
        raise ValueError(f"{directory}/{name}: invalid dimensions {shape}")
    if (meta["dtype"], meta["byteOrder"], meta["origin"]) != (
        "float32", "little", "top-left"
    ) or shape[2] != 4:
        raise ValueError(f"{directory}/{name}: unsupported format")
    raw = (directory / f"{name}.bin").read_bytes()
    count = math.prod(shape)
    if len(raw) != count * 4:
        raise ValueError(f"{directory}/{name}: expected {count * 4} bytes, got {len(raw)}")
    values = struct.unpack(f"<{count}f", raw)
    if not all(math.isfinite(value) for value in values):
        raise ValueError(f"{directory}/{name}: non-finite pixels")
    return shape, values


def frame_metadata(directory, name):
    meta = metadata(directory, name)
    frame = meta["frame"]
    if type(frame) is not int or frame < 0 or meta["indexBase"] != 0 or meta["frameCount"] != frame + 1:
        raise ValueError(f"{directory}/{name}: invalid frame count/index base")
    if type(meta["jitterIndex"]) is not int or not 0 <= meta["jitterIndex"] < 31:
        raise ValueError(f"{directory}/{name}: invalid jitter index")
    for key, size in (("jitterPixels", 2), ("projectionMatrix", 16)):
        if len(meta[key]) != size or not all(math.isfinite(value) for value in meta[key]):
            raise ValueError(f"{directory}/{name}: invalid {key}")
    if name != "capture" and frame != int(name.removeprefix("frame-")):
        raise ValueError(f"{directory}/{name}: frame metadata does not match filename")
    return meta


def compare(browser, native, epsilon=0):
    first = {}
    for directory in (browser, native):
        capture = frame_metadata(directory, "capture")
        print(f"capture {directory}: frame={capture['frame']} count={capture['frameCount']} "
              f"jitterIndex={capture['jitterIndex']} jitter={capture['jitterPixels']}")
    captures = [frame_metadata(directory, "capture") for directory in (browser, native)]
    if any(captures[0][key] != captures[1][key] for key in ("frame", "frameCount", "jitterIndex")):
        print("CAPTURE SEQUENCE DIFFERS")
    for frame in FRAMES:
        a, b = [frame_metadata(directory, f"frame-{frame}") for directory in (browser, native)]
        jitter_error = max(abs(x - y) for x, y in zip(a["jitterPixels"], b["jitterPixels"]))
        matrix_error = max(abs(x - y) for x, y in zip(a["projectionMatrix"], b["projectionMatrix"]))
        print(f"frame {frame}: jitter browser={a['jitterPixels']} (index {a['jitterIndex']}) "
              f"native={b['jitterPixels']} (index {b['jitterIndex']}); projection max abs={matrix_error:.9g}")
        if jitter_error > epsilon or matrix_error > epsilon or a["jitterIndex"] != b["jitterIndex"]:
            first.setdefault("jitter/projection", frame)
        for kind in TEXTURES:
            name = f"frame-{frame}-{kind}"
            shape_a, values_a = texture(browser, name)
            shape_b, values_b = texture(native, name)
            if shape_a != shape_b:
                raise ValueError(f"{name}: dimensions differ: {shape_a} vs {shape_b}")
            errors = [abs(x - y) for x, y in zip(values_a, values_b)]
            maximum, mean = max(errors), math.fsum(errors) / len(errors)
            print(f"  {kind:8s} max abs={maximum:.9g} mean abs={mean:.9g}")
            if maximum > epsilon:
                first.setdefault(kind, frame)
    print(f"First divergence in frames 18..23 (epsilon={epsilon:g}): "
          f"{min(first.values()) if first else 'none'}; by input/output: {first}")
    return first


def self_test():
    with tempfile.TemporaryDirectory(prefix="tn-traa-compare-") as root:
        browser, native = (Path(root) / name for name in ("browser", "native"))
        for directory in (browser, native):
            directory.mkdir()
            for frame in FRAMES:
                meta = {"frame": frame, "frameCount": frame + 1, "indexBase": 0,
                        "jitterIndex": frame, "jitterPixels": [0.25, -0.125], "projectionMatrix": [0] * 16}
                (directory / f"frame-{frame}.json").write_text(json.dumps(meta))
                for kind in TEXTURES:
                    name = f"frame-{frame}-{kind}"
                    (directory / f"{name}.json").write_text(json.dumps({
                        "width": 1, "height": 1, "channels": 4, "dtype": "float32",
                        "byteOrder": "little", "origin": "top-left"}))
                    (directory / f"{name}.bin").write_bytes(struct.pack("<4f", 0, 0.5, -0.125, 1))
            (directory / "capture.json").write_text(json.dumps(meta))
        with contextlib.redirect_stdout(io.StringIO()):
            assert compare(browser, native) == {}
            (native / "frame-20-beauty.bin").write_bytes(struct.pack("<4f", 0, 0.75, -0.125, 1))
            assert compare(browser, native) == {"beauty": 20}
            assert compare(browser, native, 0.25) == {}
        (native / "frame-18-velocity.bin").write_bytes(b"bad")
        try:
            texture(native, "frame-18-velocity")
        except ValueError:
            pass
        else:
            raise AssertionError("truncated dump was accepted")
    print("TRAA comparer self-test passed (little-endian floats, first divergence, epsilon, invalid size)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("browser", type=Path, nargs="?")
    parser.add_argument("native", type=Path, nargs="?")
    parser.add_argument("--epsilon", type=float, default=0)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.epsilon) or args.epsilon < 0:
        parser.error("--epsilon must be finite and nonnegative")
    if args.self_test:
        self_test()
    elif args.browser is None or args.native is None:
        parser.error("provide browser and native dump directories")
    else:
        compare(args.browser, args.native, args.epsilon)
