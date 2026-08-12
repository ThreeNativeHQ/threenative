# ThreeNative render-work reduction findings — 2026-08-11

## Evidence contract

Baseline source: `8c5fc40a3723fe7a78eae05d2f9ed6f373c34264` in isolated worktree `/home/joao/projects/threejs-webgpu-profiling`.

The new browser matrix used Chromium WebGPU through Google SwiftShader. It is diagnostic evidence for JS/Three.js CPU scaling and harness behavior only; it is not shipping GPU or mobile frame-rate evidence. Raw artifacts are ignored under `artifacts/native-cpu-profile/`.

Physical-device evidence cited below comes from the existing Pixel 8 performance reports in this repository and remains the authority for Android direction.

## Controlled browser findings

All rows used the same seeded visible box workload, shared visual parameters, flat hierarchy, 0% dirty transforms, 60 warm-up frames, 120 samples, and three repeats. `renderer.renderAsync()` wall time includes renderer/backend/driver scheduling and is not pure synchronous JS CPU attribution.

| logical objects | representation | passes | draw calls | median render range |
|---:|---|---:|---:|---:|
| 1,000 | independent meshes, shared geometry/material | 1 | 1,001 | 1.10–1.20 ms |
| 1,000 | independent meshes, distinct equal-looking materials | 1 | 1,001 | 1.60–2.00 ms |
| 1,000 | instanced | 1 | 2 | 0.20 ms |
| 1,000 | merged static geometry | 1 | 2 | 0.20 ms |
| 4,000 | independent meshes, shared geometry/material | 1 | 4,001 | 5.70–6.90 ms |
| 4,000 | independent meshes, distinct equal-looking materials | 1 | 4,001 | 8.60–10.00 ms |
| 4,000 | independent meshes, shared geometry/material | 2 | 8,002 | 10.60–12.10 ms |
| 4,000 | independent meshes, distinct equal-looking materials | 2 | 8,002 | 19.80–20.70 ms |
| 4,000 | instanced | 1 | 2 | 0.20 ms |
| 4,000 | merged static geometry | 1 | 2 | 0.20 ms |

At 4,000 objects, reducing 4,001 draws to 2 reduced diagnostic median render wall time from 5.70–6.90 ms to 0.20 ms. Distinct material identity added roughly 2.7–3.1 ms at the same object/draw count. A redundant second pass approximately doubled draw calls and the expensive independent-mesh path.

The timer floor makes the exact difference between instancing and merging unknowable in this environment. The valid conclusion is that both dominate independent render objects for a compatible workload, not that either is universally faster.

## Existing physical-device evidence

The repository's Pixel 8 game data already found:

- `renderer.render()` around 8.5 ms at rest and around 15.0 ms while driven before draw folding;
- roughly 93 HUD draws costing around 11.4 ms;
- reducing 76 overlay meshes to 11 draws improved observed frame rate from roughly 55–71 fps to 83–116 fps, with about 106 fps median afterward;
- native binding, submit, and present work around 1 ms;
- `SceneCollapse` transform refresh around 1.85–2.01 ms and game update around 0.45 ms.

This independently supports the browser matrix's direction: first remove render objects, draws, unnecessary material identities, and redundant passes. Do not start a Rust scene mirror or native transform kernel.

## Repository ownership findings

Already implemented and therefore not new PRDs:

- general draw folding and static merging: `packages/core/src/collapse.ts`;
- camera/HUD overlay folding above a threshold;
- palette/shared-material folding through vertex colors;
- generated starter HUD instancing;
- GPU particle/sprite batching;
- compile warm-up reachability.

Existing owners that continue:

- `PRD-069-per-draw-cost.md`: physical-device knee localization and `BundleGroup` proof;
- `PRD-071-cheap-bundle.md`: game-readable renderer info. Its `compileAsync` premise is stale and must be reconciled before implementation.

## Ranked decisions

1. **Renderer-stage attribution and truthful counters** — proceed. Current total render time cannot distinguish traversal/list/sort from material/node/binding/pipeline/backend work.
2. **SceneCollapse outcome regression gate** — proceed. The largest proven device win exists, but automatic folding lacks a durable before/after draw/material/pass evidence contract.
3. **Generated-source render workload diagnostics** — proceed, advisory only. Game authors need exact object/material/pass hotspots and explicit stock Three.js alternatives without framework auto-rewriting scene semantics.
4. **BundleGroup physical-device experiment** — continue under PRD-069, not a new PRD. Only static, reliably visible sets qualify.
5. **Native transforms/culling or Rust scene mirror** — reject for now. The measured cost and compatibility risk do not justify them.

## Unknowns and required honesty

- Browser SwiftShader cannot establish Pixel/Android gains.
- `renderAsync()` is not pure JS CPU time.
- Pipeline and bind-group transition counts remain unmeasured.
- The current matrix proves equivalent geometry placement and logical count, but does not yet have image-diff acceptance.
- Dynamic instancing update cost and `BundleGroup` invalidation cost remain unmeasured.
