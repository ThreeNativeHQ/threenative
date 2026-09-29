# PRD-473 — Streamed open worlds hold 120 fps: a GPU-driven world

**Status:** PROPOSED — filed 2026-09-28.
**Complexity:** 9 (HIGH): compute culling, indirect draws, cached draw commands, runtime impostor bake and cook-time HLOD across core, assets and the three patch. Risk override: none.
**Owner:** engine
**Depends on:** [PRD-458 60 fps by default](PRD-458-open-worlds-hold-60-fps-by-default.md) (instanced chain LOD, main-pass cell culling, asset dedupe, chunk merge, shadow caster split, streaming prewarm).

## Context

Unreal 5 draws a streamed world at 120 fps without the game tuning anything. Four mechanisms do most of that work:
- **GPU Scene:** instance data lives on the GPU, and a compute pass culls and picks LOD per instance.
- **Cached mesh draw commands:** the CPU re-issues nothing for static content.
- **HLOD:** distant cells become one merged proxy.
- **Impostors:** distant foliage becomes billboards baked from the real mesh.

After PRD-458, ThreeNative still pays per draw and per instance on the CPU.

**Evidence** (machinefall `?scene=map-walk`, a 20 m/s flyover, RTX 2080 WebGPU, 1600×900, Xvfb + `TN_FRAME_BUDGET` + `TN_FRAME_SPANS`, 2026-09-28, after PRD-458's fixes):

| Cost (per frame) | Measured | Cause |
|---|---|---|
| Draw submission | 350–500 draws × ~20 µs of three.js JS each (Nodes/Bindings/Geometries updateForRender, pipeline lookup, encoder calls) = 7–10 ms | Every draw re-walks three's per-object path even when nothing about it changed |
| Main-cull repacks + LOD refilter | ~1–2 ms, plus uploads, when the visible set changes | Culling and per-instance LOD selection run on the CPU and rewrite instance buffers |
| Shadow level renders | fine 48 m: ~4/s × 222 draws × 6.9 ms; mid/coarse: 614 draws, 11–15 ms | The same per-draw JS path, per level camera |
| GPU vertex load | main 16–27 M triangles, shadow levels up to 30 M | Distant trees keep 37–58% of LOD0 triangles; hand-placed chunks draw full detail at every distance |

120 fps needs CPU and GPU frame p95 ≤ 8.3 ms. At ~20 µs per draw, the CPU budget allows ~250 draws for everything, so per-draw CPU cost must fall by an order of magnitude, not by tuning.

three r185 already provides the building blocks:
- `BufferGeometry.setIndirect` issues `drawIndexedIndirect`, so the instance count lives in a GPU buffer.
- `BundleGroup` records a pass's draws into a `GPURenderBundle` once and replays it: the replay skips pipeline, binding and encode work until `bundleGroup.version` changes.
- TSL compute with storage buffers and atomics.
- `InstanceNode` reads a storage-buffer `instanceMatrix` by `instance_index`, and `firstInstance` offsets it.

## Solution

1. **GPU instance scene.**
   - WorldCells keeps every resident placement in one storage buffer: matrix, asset key, and per-instance LOD and size data. It is written only when residency changes, as dirty ranges.
   - One compute dispatch per rendered camera (the main camera plus each shadow level camera) does frustum culling, picks each instance's LOD level by projected size, and applies the shadow size gate.
   - It appends survivors into one shared compacted matrix buffer, into each `asset:level:part` region, with an atomic counter into that key's `DrawIndexedIndirect` arguments.
   - Main and caster batches draw indirect with `firstInstance` = region start, and `frustumCulled = false`.
   - This deletes the CPU repack, the refilter and per-key cull for batched scatter.
2. **Cached draw commands.**
   - World batches (main and casters) and merged static chunks live in `BundleGroup`s: per pass, and per virtual-shadow level for casters.
   - Because instance counts are indirect, streaming, culling and LOD changes never invalidate a bundle. Only a structural change bumps `version`: a key minted or retired, or a material or geometry swapped. So does the settled-static contract.
   - Per-frame CPU for the world becomes O(bundles), not O(draws).
3. **Foliage impostors (automatic).**
   - When an asset with foliage is adopted, the engine bakes an octahedral impostor with the game's own renderer: N×N views into an atlas render target (albedo+alpha, normal, depth).
   - The impostor becomes a final LOD level beyond the chain, switched by projected size like any level, drawn as one instanced quad per tree.
   - It also casts into the coarse shadow levels.
   - The bake runs once per unique asset behind the loading prewarm, and is cached by the cooked content hash.
4. **HLOD for hand-placed chunks.** The cook bakes, per world cell, a merged and simplified proxy of that cell's chunks: one mesh per material group, simplified to a projected-error budget. WorldCells swaps a chunk for its cell's HLOD proxy beyond the HLOD distance, and the proxy also casts into the coarse shadow levels.
5. **Measured promise.** The machinefall map holds CPU and GPU frame p95 ≤ 8.3 ms with 0 console errors, with no game-side option.

Consumer flow: unchanged. A game calls `WorldCells.load({ … })` and builds with `threenative build`. The cook adds HLOD proxies, the runtime bakes impostors and builds the GPU scene, and no option is required. Every mechanism has an off switch for debugging: `gpuScene: false`, `bundles: false`, `impostors: false`, `hlod: false`.

Risks:
- **Native.** WebGPU compute and indirect draws must exist on the native runtime (Dawn). An unsupported backend falls back to PRD-458's CPU path, reported by a `TN_WORLD_GPU_SCENE` marker naming why. It is never silent.
- **Bundles and per-object state.** A per-object uniform that changes (a mover) would re-record a bundle. Movers stay outside bundles; world batches are static by construction.
- **Impostor look.** Parallax and lighting at the switch distance. The switch is chosen by projected size (a few pixels of error), and the atlas carries normals so lighting matches.
- **Atomic append order is nondeterministic.** Draw order within a key can vary frame to frame. Opaque plus depth test makes that invisible; alpha-tested foliage is order-independent.

## Acceptance Criteria
- [x] AC-1 [local]: WorldCells culls and LOD-selects every batched instance on the GPU. A 200-frame walk performs 0 CPU instance-buffer repacks and 0 CPU level refilters for batched scatter, and the drawn instance set equals the CPU reference path's set, frame by frame, on the fixture. proof: `pnpm exec vitest run packages/core/__tests__/world-gpu-scene.spec.ts` plus a browser readback census on machinefall. Result: 30/30 in the spec, 2020/2022 in `pnpm exec vitest run packages/core` (2 pre-existing skips). Browser at 863f83258 on machinefall `?scene=map-walk`: `TN_WORLD_GPU_SCENE_VALIDATE ok compared=200 … meshMismatched=0`, and the same-pose screenshot is the CPU path's picture. GPU frame p50 went 10–18 ms → 9–15 ms and CPU p95 improved, so the scene flipped to the default here.
- [ ] AC-2 [local]: world batches and static chunks replay from render bundles. A 200-frame walk re-records bundles only on key mint/retire, and per-frame JS in the render phase for the world is ≤ 1.5 ms at 400 world draws. proof: `world-bundles.spec.ts` (bundle version counters) plus `TN_FRAME_SPANS` on machinefall.
- [ ] AC-3 [local]: a foliage asset gets an automatic octahedral impostor as its last LOD level, drawn beyond the chain, casting into the coarse shadow levels. Past the impostor distance, triangles per tree are 2. proof: `world-impostors.spec.ts` plus a visual-baseline capture at the switch distance.
- [ ] AC-4 [local]: the cook bakes a per-cell HLOD proxy for hand-placed chunks, and WorldCells draws it beyond the HLOD distance: one draw per material group per cell. proof: `packages/assets/__tests__/hlod.spec.ts` plus the `TN_WORLD_CHUNK_MERGE` / `TN_WORLD_HLOD` markers on machinefall.
- [ ] AC-5 [local]: machinefall `?scene=map-walk` holds CPU frame p95 ≤ 8.3 ms and GPU p95 ≤ 8.3 ms on the RTX 2080 WebGPU adapter, with 0 console errors and no game-side performance option. proof: the walk harness's `TN_FRAME_BUDGET` windows.
- [ ] AC-6 [local]: every mechanism falls back to PRD-458's CPU path on a backend without compute/indirect support, reporting why in `TN_WORLD_GPU_SCENE`. proof: a unit test with a backend lacking `drawIndexedIndirect`.

## Phases
1. GPU instance scene (AC-1, AC-6): the largest CPU and GPU win, and the prerequisite for bundles.
   - [x] One compute dispatch culls and LOD-selects every resident placement into a shared compacted matrix buffer, and every main key draws its own region of it through an indirect record. proof: `pnpm exec vitest run packages/core/__tests__/world-gpu-scene.spec.ts`.
   - [x] A backend without compute, storage buffers or `drawIndexedIndirect` falls back to the CPU path and names why in `TN_WORLD_GPU_SCENE`. proof: the same spec's `gpuSceneUnsupported` cases.
   - [x] The scene is on by default, and `gpuScene: false` / `?tnGpuScene=0` / `TN_GPU_SCENE=0` is the CPU path. proof: the same spec, with the CPU-path test asking for `gpuScene: false` explicitly.
2. Cached draw commands (AC-2).
   - [ ] Every GPU-dressed main batch mesh is parented under one `BundleGroup`, so a settled walk replays its draws instead of re-walking three's per-object path. proof: `pnpm exec vitest run packages/core/__tests__/world-bundles.spec.ts`.
   - [ ] `bundleGroup.needsUpdate` moves only on a structural change, and `stats().bundle` counts the records against the keys minted and retired. proof: the same spec's 200-frame streaming walk.
3. Impostors (AC-3) and HLOD (AC-4), in parallel: they are independent.
4. Measure and tune (AC-5).
