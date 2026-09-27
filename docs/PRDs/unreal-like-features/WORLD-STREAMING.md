# World streaming PRDs (459–461, and 458)

A streamed world that is **smooth**, **invisible**, and **sized for the map**. Read `/AGENTS.md` and
`docs/PRDs/AGENTS.md` first; [PRD-448](../done/unreal-like-features/PRD-448-world-cells-blender-export-and-streaming.md)
built the path these three continue.

The motivating case is Machinefall's 2 km map — 218 assets, 128,233 placements, 25 resident 128 m
cells at ring 2 — streamed on WebGPU. Streaming itself works: 0 failed loads. What is unfinished is
the frame it costs and the edge you can see.

| # | PRD | Outcome | Order | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [459 — one admission budget per frame](PRD-459-smooth-streaming-one-admission-budget-per-frame.md) | Streaming stops costing a frame: p95 ≤ 16.7 ms, max ≤ 33 ms, prefetched ahead of the camera, pipelines warm before first draw | First | — |
| 2 | [460 — invisible streaming transitions](PRD-460-invisible-streaming-transitions.md) | No pop: a dithered fade as instances arrive and leave, a crossfade across LOD levels, hysteresis on the cull gate | After 459 (459 owns *when* a batch appears, 460 owns *how*) | 459 |
| 3 | [461 — view distance basics](PRD-461-view-distance-basics.md) | Terrain radius independent of the prop ring, colliders only near the player, fog that puts the stream edge out of sight, a default recipe for a 2 km map | Independent of 1 and 2; **blocked on the in-flight `terrain.streamRadius` / `terrain.colliderRadius` options** | in-flight change |
| 4 | [458 — open worlds hold 60 fps by default](PRD-458-open-worlds-hold-60-fps-by-default.md) | Clustered batches culled per camera and shadow level, safe one-level-per-frame shadows, foliage cutout + AutoLOD, material dedupe by default; 60 fps on the machinefall map | After 459 (uses its budget and prewarm) | 459, 453, 456, 457, 377 |

459–461 are `NOT STARTED`; 458 is `PROPOSED`. Two prerequisites already landed on `feat/world-cells-scatter-lod`:
`aded4a85a` (per-instance package `lods`, rebuild skip, the `rebuildsPerUpdate` cap) and `f7164f850`
(terrain seam/LOD thrash, ~39 ms/frame). Landing separately, and treated as **prerequisites rather
than scope**: multi-primitive scatter assets, transparent scatter drawn as cutout, and the
`terrain.streamRadius` / `terrain.colliderRadius` options.

## Later (not scheduled)

One line each, none of it committed:

- **HLOD / impostor forests** — far-view stand-ins for whole cells, so a 2 km map has a silhouette
  past the prop ring rather than fog.
- **AutoLOD (`TN_discrete_lod`) chains consumed per instance by `WorldCells`**, retiring authored
  `lods` GLBs: the pipeline already bakes index-only discrete chains
  (`packages/assets/src/lod/`, selected per frame by `packages/core/src/model-lod.ts`). The bake
  declines a `BLEND` canopy — only `OPAQUE` materials are eligible
  (`packages/assets/src/lod/eligibility.ts:115`) — so the export has to mark canopies `MASK`.
- **GPU-driven scatter** — one global instance buffer, compute culling, indirect draws. Gated on
  measured draw calls and instance counts; at 25 cells × 218 assets the win is unproven.
- **Explicitly out of scope for 2 km worlds:** virtual texturing, virtualized geometry,
  large-world coordinates, occlusion culling, simulation LOD.
