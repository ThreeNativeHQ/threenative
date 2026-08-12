# PRD-074 — SceneCollapse regression gate

Date: 2026-08-11
Raw evidence: `artifacts/prd-074-scene-collapse-current/profile-1786513588841.json`
Visual evidence: `docs/verification/visuals/prd-074-scene-collapse-fox-scale-before-2026-08-11.png`, `docs/verification/visuals/prd-074-scene-collapse-fox-scale-after-2026-08-11.png`

## Headline measured deltas

All timing rows use the current visual-verified NVIDIA/Turing run: 3 repeats, 120 before samples + 120 after samples per repeat, 60 warmup frames. Percent is `(before - after) / before` from the median of the three per-run medians unless otherwise labeled.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Draw calls, median sample | 1851 | 5 | -99.73% |
| SceneCollapse report draw candidates | 1850 | 4 | -99.78% |
| SceneCollapse report material identities | 15 | 3 | -80.00% |
| `renderer.render()` median of run medians | 3.500 ms | 0.200 ms | -94.29% |
| Frame median of run medians | 3.900 ms | 0.300 ms | -92.31% |
| Matrix-world median of run medians | 0.200 ms | 0.000 ms | -100.00% |
| `renderer.render()` p95, median of run p95s | 5.700 ms | 0.300 ms | -94.74% |
| Frame p95, median of run p95s | 6.173 ms | 0.545 ms | -91.16% |
| Matrix-world p95, median of run p95s | 0.300 ms | 0.000 ms | -100.00% |
| `renderer.render()` p95, aggregate 360 samples | 5.700 ms | 0.300 ms | -94.74% |
| Frame p95, aggregate 360 samples | 6.191 ms | 0.627 ms | -89.87% |
| Matrix-world p95, aggregate 360 samples | 0.400 ms | 0.000 ms | -100.00% |

This is a regression contract for the existing `SceneCollapse` behavior now gated by diagnostics, tests and real-renderer evidence. It is not a newly invented optimizer, auto-instancer, static-scene analyzer or user-facing performance preset.

## Per-run timing details

| Run | Render median before -> after | Frame median before -> after | Matrix median before -> after | Stable post-collapse draws |
| --- | ---: | ---: | ---: | --- |
| 1 | 3.500 -> 0.200 ms (-94.29%) | 3.932 -> 0.359 ms (-90.87%) | 0.200 -> 0.000 ms (-100.00%) | `[5]` over 300 frames |
| 2 | 3.400 -> 0.200 ms (-94.12%) | 3.791 -> 0.291 ms (-92.33%) | 0.200 -> 0.000 ms (-100.00%) | `[5]` over 300 frames |
| 3 | 3.600 -> 0.100 ms (-97.22%) | 3.900 -> 0.300 ms (-92.31%) | 0.200 -> 0.000 ms (-100.00%) | `[5]` over 300 frames |

The sample field named `materialIdentities` remains `15 -> 15` because it records the fixture's logical source material set. The serialized SceneCollapse report is the result-contract source for material folding: `15 -> 3` result material identities.

## Collapse diagnostics contract

Each run reported `status: applied`, `reasonCode: applied`, `schemaVersion: 1`, `sourceMeshes: 1850`, `mergedMeshes: 4`, `movingParts: 2`, `overlayMeshes: 0`, `overlayDraws: 0`.

| Run | Draw candidates | Material identities | Groups | Bake / observe / merge / copy / transform / color / sample |
| --- | --- | --- | --- | --- |
| 1 | 1850 -> 4 | 15 -> 3 | staticWorld 2, movingOwners 2, cameraOverlays 0 | 0.000 / 13.400 / 6.900 / 14.500 / 3.100 / 7.100 / 2.000 ms |
| 2 | 1850 -> 4 | 15 -> 3 | staticWorld 2, movingOwners 2, cameraOverlays 0 | 0.000 / 10.700 / 5.800 / 10.100 / 3.500 / 6.900 / 1.600 ms |
| 3 | 1850 -> 4 | 15 -> 3 | staticWorld 2, movingOwners 2, cameraOverlays 0 | 0.000 / 14.100 / 6.900 / 11.400 / 3.500 / 6.000 / 2.100 ms |

Skipped counters were all zero in this all-eligible fox-scale fixture. Separate semantic unit fixtures cover unsafe and unsupported objects.

The immutable applied report intentionally snapshots `transformRefresh` at zero. The profiler also captured current opt-in refresh diagnostics after post-collapse sampling and the 300-frame stability loop:

| Run | Refresh count | Last / max / mean refresh |
| --- | ---: | ---: |
| 1 | 420 | 0.000 / 0.100 / 0.006190 ms |
| 2 | 420 | 0.000 / 0.100 / 0.006905 ms |
| 3 | 420 | 0.000 / 0.100 / 0.004048 ms |

## Diagnostics overhead verdict

Temporary disabled-path microbenchmark methodology: compare the base commit `8888d45ef2e755fb4a35482607fab0bf185d4dda` `SceneCollapse` per-frame refresh path against the candidate with `measureTransformRefresh: false`, then compare candidate opt-in timing separately.

| Case | Median ms/frame | Delta |
| --- | ---: | ---: |
| Base commit | 0.000316543 | baseline |
| Candidate, diagnostics timing disabled | 0.000302244 | observed -4.52% vs base |
| Candidate, timing enabled | 0.000372793 | +23.34% vs candidate disabled |

Acceptance criterion is disabled-path regression overhead. The observed disabled delta is negative; treat that as noise-bound no-regression evidence, not as a product speedup. Measured disabled regression overhead is 0% for gate purposes and remains below the 1% threshold. Enabled timing is opt-in verification/profiling cost, not production/default cost.

The disposable `.tmp-prd074-overhead.mjs` used to obtain those numbers was removed; the methodology and results are recorded here instead of committing temp work.

## Semantic regression matrix

| Requirement / negative control | Evidence |
| --- | --- |
| Bounded applied/rejected/deferred result, stable reason codes, no retained Mesh/Material/Geometry/Scene refs | `packages/core/__tests__/collapse.spec.ts` diagnostics serialization test |
| No extra diagnostics traversal | traversal-count unit fixture asserts the same scan path, no second full scene traversal |
| Below-floor small overlay remains deferred/open, not silently collapsed | below-floor fixture reports `belowMeshFloorStillWatching` and keeps `collapse.report` unset for compatibility |
| Camera/HUD overlay fixture | exact fixture reports 16 overlay sources -> 2 overlay draws and `diagnostics.groups.cameraOverlays = 2` |
| Palette/material folding | palette-scale and collapse fixtures assert equal-looking material/color variants fold without material-semantic loss |
| Unsafe semantics preserved or explicitly counted | layers, renderOrder, render hooks, transparency, sprites, points, missing geometry/material/position fixtures preserve originals and count explicit skip reasons |
| Fake outcome/report-only reduction | real WebGPU renderer observed draw calls changing 1851 -> 5; not only an estimated/unit value |
| Stability | draw calls remained exactly `[5]` through 300 post-collapse frames for each of three repeats |

## Visual verdict

The current raw collector produced before/after PNGs. One representative pair was copied into `docs/verification/visuals/` with semantic names.

- Before image: nonblank, recognizable low-poly/voxel fox-scale scene with sky, cloud blocks, floating islands, terrain, trees, cabin/farm geometry and overlay status panel. No obvious catastrophic renderer failure.
- After image: nonblank and recognizable with the same scene composition and status panel. No obvious catastrophic renderer failure.
- The before/after hashes differ (`dda09d76...` vs `2ce7fbe...`) and the scene has representation/animation differences after collapse, especially moving yellow ring/overlay-like elements and pose/cloud changes. This report does not claim pixel parity from unequal hashes; the gate is semantic fixtures plus visual recognition and real draw-count stability.

## Adapter and source evidence

- Evidence class: `visual-verified`.
- Browser: headed, display `:157`, presentation verification enabled.
- Adapter class: `hardware`; adapter `{ architecture: "turing", vendor: "nvidia" }`.
- Host: AMD Ryzen 9 5900X, Node v20.19.6, Linux 7.1.4-1-cachyos.
- Source metadata in raw JSON records branch `experiment/native-cpu-profiling` and base SHA `8888d45ef2e755fb4a35482607fab0bf185d4dda`; implementation was intentionally uncommitted at measurement time.
- Raw prior run remains under `artifacts/prd-074-scene-collapse/`; current rerun is `artifacts/prd-074-scene-collapse-current/profile-1786513588841.json` and is ignored, not staged.

## Android / Pixel 8 status

`/home/joao/Android/Sdk/platform-tools/adb devices -l` saw only `emulator-5554`, an x86_64 emulator (`model:sdk_gphone64_x86_64`). No physical Pixel 8 was attached. Physical Pixel 8 install/device mutation was not performed, and the Pixel 8 gate remains open.

## Limitations

- Physical Pixel 8 timing and install verification remain open because no Pixel 8 device was available.
- Visual comparison is recognition/nonblank plus semantic/unit coverage; no deterministic frozen pixel-parity capture was claimed.
- The regression threshold is scoped to the disabled/default diagnostics timing path. Opt-in transform-refresh timing has measurable cost and must remain disabled unless profiling.
- The all-eligible real-renderer fox-scale fixture has zero skipped counters; unsafe negative controls are unit-level semantic fixtures rather than part of that specific renderer run.
