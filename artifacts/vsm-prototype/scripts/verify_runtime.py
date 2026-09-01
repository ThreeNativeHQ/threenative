#!/usr/bin/env python3
"""Validate captured runtime proof and image integrity."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = {
    "comparison": ROOT / "report/comparison.json",
    "debug": ROOT / "report/virtual-pages-debug.json",
    "invalidation": ROOT / "report/cache-invalidation.json",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def verify_image(path: Path) -> dict:
    require(path.exists(), f"missing screenshot: {path}")
    with Image.open(path) as image:
        require(image.size == (1600, 900), f"unexpected screenshot size for {path}: {image.size}")
        rgb = image.convert("RGB")
        stat = ImageStat.Stat(rgb)
        spread = sum(stat.stddev) / 3
        require(spread > 24, f"screenshot appears blank or flat: {path} (spread={spread:.2f})")
        return {"path": str(path.relative_to(ROOT)), "size": list(image.size), "luminanceSpread": spread}


def verify_capture(mode: str, path: Path) -> dict:
    require(path.exists(), f"missing capture diagnostics: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    require(not payload.get("error"), f"capture failed for {mode}: {payload.get('error')}")
    require(payload.get("console_errors") == [], f"console errors in {mode}: {payload.get('console_errors')}")
    debug = payload.get("debug") or {}
    stats = debug.get("stats") or {}
    assertions = debug.get("assertions") or {}

    require(debug.get("mode") == mode, f"wrong proof mode in {path}")
    require(assertions.get("boundedPhysicalPool") is True, f"boundedPhysicalPool failed in {mode}")
    require(assertions.get("validPageTable") is True, f"validPageTable failed in {mode}")
    require(assertions.get("renderedVirtualPages") is True, f"renderedVirtualPages failed in {mode}")
    require(assertions.get("cacheReuseObserved") is True, f"cacheReuseObserved failed in {mode}")
    require(assertions.get("noOverflow") is True, f"noOverflow failed in {mode}")
    require(stats.get("resident", 0) > 0, f"no resident pages in {mode}")
    require(stats.get("resident", 0) <= stats.get("physicalCapacity", 0), f"physical capacity exceeded in {mode}")
    require(stats.get("reuseRatio", 0) >= 0.8, f"cache reuse below threshold in {mode}")
    require(debug.get("pageTableValidEntries", 0) > 0, f"page table is empty in {mode}")

    if mode == "comparison":
        comparison = debug.get("conventionalComparison") or {}
        require(comparison.get("resolution") == [1024, 1024], "baseline shadow resolution proof missing")
        require(comparison.get("virtualized") is False, "baseline must remain non-virtualized")
    elif mode == "debug":
        require(sum(debug.get("residentByLevel", [])) == stats.get("resident"), "residency level counts do not add up")
    elif mode == "invalidation":
        invalidationProof = debug.get("invalidationProof") or {}
        require(invalidationProof.get("moved") is True, "invalidation target did not move")
        require(invalidationProof.get("invalidatedPages", 0) > 0, "no pages were selectively invalidated")
        require(invalidationProof.get("renderedAfterMove", 0) > 0, "invalidated pages were not rerendered")

    screenshot = verify_image(path.with_suffix(".png"))
    return {
        "mode": mode,
        "frame": debug.get("frame"),
        "stats": stats,
        "assertions": assertions,
        "invalidationProof": debug.get("invalidationProof"),
        "image": screenshot,
        "consoleWarnings": payload.get("console_warnings", []),
    }


def main() -> None:
    results = {mode: verify_capture(mode, path) for mode, path in CAPTURES.items()}
    output = ROOT / "report/runtime-proof.json"
    existing_proof = {}

    if output.exists():
        try:
            existing_proof = json.loads(output.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing_proof = {}

    verified_at = datetime.now(timezone.utc).isoformat()
    if (
        existing_proof.get("feature") == "ThreeNative Virtual Shadow Maps"
        and existing_proof.get("result") == "pass"
        and existing_proof.get("captures") == results
        and isinstance(existing_proof.get("verifiedAt"), str)
    ):
        verified_at = existing_proof["verifiedAt"]

    proof = {
        "feature": "ThreeNative Virtual Shadow Maps",
        "verifiedAt": verified_at,
        "result": "pass",
        "captures": results,
    }
    output.write_text(json.dumps(proof, indent=2), encoding="utf-8")
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()
