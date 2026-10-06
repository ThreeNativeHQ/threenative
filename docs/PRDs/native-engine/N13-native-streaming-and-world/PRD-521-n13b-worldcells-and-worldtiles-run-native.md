# PRD-521 — WorldCells and WorldTiles run native (N13b)

**Status:** IN PROGRESS
**Complexity:** 5 — the largest framework subsystem to port (cells, tiles, chunk merging, terrain, GPU-scene residency), with a deep spec suite to keep
**Owner:** João
**Work package:** N13 — [native-engine batch](../README.md) · [N13 umbrella](README.md)
**Depends on:** [PRD-520 (N13a)](PRD-520-n13a-bounded-streaming-admission-and-io-events.md), [PRD-519 (N12)](../PRD-519-n12-native-batching-visibility-lod-gpu-scene.md)

## Context

§11.3 says WorldCells, WorldTiles and GPU-scene streaming cannot stay hidden TypeScript engine implementations in a native-engine build. The required systems are ported and their TS packages become bindings. Today: `packages/core/src/world-cells.ts` (merged chunk groups, the 4 MiB first-draw cap, chain LOD, shadow prewarm), `packages/core/src/world-tiles.ts` (tiles, colliders, admission), `packages/core/src/world-gpu-scene.ts` (placement buffer and residency), `packages/core/src/world-package.ts` (`world.json` v1 manifest), `packages/core/src/world.ts` and `world-heightmap.ts` (the shared height buffer), and `packages/core/src/world-terrain-splat.ts`. Specs: `packages/core/__tests__/world-*.spec.ts`. The cooker is `packages/assets/src/world/`. §3 (R4) notes that per-object refresh, WorldCells streaming and shadow work are measured costs today.

## Solution

1. **World package reader.** The `world.json` v1 contract is validated natively with the same error codes as `world-validate.ts`. Cooked world content comes from the N10 package format.
2. **Cells and tiles.** Proposed `packages/runtime-native/src/engine/world/cells/` and `.../tiles/`. Residency by camera distance, chunk merging under the byte cap, chain LOD and shadow prewarm are ported rule for rule. Admission goes through PRD-520.
3. **Terrain and heights.** One native height buffer serves world queries, rendered geometry and the Rapier heightfield (N15). Its sample version bumps on `updateHeights`.
4. **GPU-scene residency.** The placement buffer is written natively when residency changes. Selection runs on the PRD-519 GPU kernel.
5. **Bindings.** `world-cells.ts`, `world-tiles.ts` and `world-gpu-scene.ts` become thin binding glue in the native profile, and the legacy backend keeps the TS (rollback). A native-engine build that reaches a TS world algorithm fails the artifact inspection (§15.2).

## Out of scope

- Virtual shadows and probes inside the world: [N14](../N14-native-render-chain-and-advanced-visuals/README.md)
- The end-to-end walk and memory proof: [PRD-522 (N13c)](PRD-522-n13c-a-world-loads-walks-and-unloads-without-growth.md)

## Execution Phases

#### Phase 1: Package and terrain
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/engine/world/package/`, `.../terrain/`
- [x] Native `world.json` validation accepts and rejects the `world-package.spec.ts` fixtures with the same codes. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_world_package` — 2026-10-05: 81 manifests (the spec's fixtures plus malformed variants), 0 differ in code, path, message or order, on Dawn, ASan, wgpu and Wasm. Red controls: insertion-order keys instead of `Object.entries` order, 12 differ; heightmapByteLength check removed, fails.
- [x] Native height sampling matches `world-heightmap.spec.ts` fixtures, and `updateHeights` bumps the sample version. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_world_heights` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact. `HeightSampler` and `Heightfield` (`src/engine/world/terrain/heights.{h,cpp}`) port `heightSamplerFromHeightmap` and `Heightfield.heightAt`/`updateHeights`/`version` operation for operation; a malformed update is refused by name (`TN_WORLD_HEIGHTFIELD_REGION`, `_SIZE`, `_SAMPLE`) and writes nothing, a success bumps the version by one. From the TS modules themselves (`tests/native-engine/world/heights-reference.ts`): a 33 x 17 heightmap sampled at 203 points (vertices, edges, outside, NaN, both infinities) and a six-step update scenario with heightAt probes: 326 values match bit for bit (NaN as NaN, whatever its sign bit). Red controls: no clamp to the last row (ASan overflow), no version bump (6 differ). Port by the save-tokens arm; reviewed, NaN handling corrected

#### Phase 2: Cells and tiles
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/world/cells/`, `.../tiles/`
- [ ] Residency, chunk merge under the byte cap and chain LOD decisions match the `world-cells*.spec.ts` fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_world_cells`
- [x] Tile admission and collider placement match the `world-terrain-tiles.spec.ts` and `world-tiles-cost.spec.ts` fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_world_tiles` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm (`native_engine_world_tiles`, 636 observations over 14 scenes, 0 differ). `TerrainTiles`' decisions (`src/engine/world/tiles/terrain_tiles.{h,cpp}`) against the real class (`world-tiles-reference.ts`): byte and resident budgets, forced first admission, deferral, eviction, LOD level per tile (distance, neighbour fixpoint, coarsest selectable), collider placement inside `colliderRadius` with its heights, bridge bytes and caps. The specs' remaining cases assert rendering (morph geometry, stitched topology, seams, merged draws), not admission or colliders, and are not compared. Red controls: resident budget off by one, 13 differ; collider grid one row off, 303; LOD distance ignored, 271.

#### Phase 3: GPU-scene residency and bindings
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/world/gpu_scene/`; `packages/core/src/world-cells.ts`, `world-tiles.ts`, `world-gpu-scene.ts` (binding glue)
- [x] The placement buffer after a scripted camera path matches the `world-gpu-scene.spec.ts` reference. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_world_gpu_scene` — 2026-10-05: 38 steps (the spec's walk, a gate path forward and back, biased-LOD steps, two shadow levels, a level with no keys), 0 differ in args, counts and drawn matrices, on Dawn, ASan and wgpu. Red controls: shadow pass biased, 1 differs; bias ignored, 4 differ; capacity `>=` to `>`, 5 differ. This is the CPU oracle; the GPU kernel is PRD-519.
- [ ] The native-engine artifact inspection finds no TS world implementation reachable from the world fixture. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_strict_artifact_inspect`
