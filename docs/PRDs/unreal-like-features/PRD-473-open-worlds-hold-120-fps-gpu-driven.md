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

## Shadow bundle feasibility

**Not feasible** for the caster halves under three r185, so stage 2 is not attempted. The bundle *is* recorded per camera — `RenderBundles.js:39-48` keys on `[bundleGroup, camera, renderContext]`, fetched with the camera at `Renderer.js:3182-3184` and replayed at `1292` — so each level's ortho camera would get its own record. But a record's render list is built once, when `version` moves (`Renderer.js:1270-1272`), and `_projectObject` bakes the object's `visible`, `layers.test(camera.layers)` and `frustum.intersectsObject` into it at that moment (`Renderer.js:3082-3132`; children are re-projected only at `3204-3213`). A replay while `version` is unchanged reuses that frozen list (`Renderer.js:1319-1341`) and re-reads none of the three. The shadow node mutates exactly those on every level render: `#probe` sets `level.shadow.camera.layers` (`packages/core/src/render/virtual-shadow.ts:1031-1035`), flips cluster/wide with the window (`1030`), hides sub-texel casters and swaps in coarse geometry (`1007-1010`, `943-946`), and `#restoreHidden` puts them back (`1050-1053`), while the camera is re-placed each render (`1612`) and `updateMatrices` runs before `renderer.render(scene, shadow.camera)` (`ShadowNode.js:702-710`). Caster meshes keep `frustumCulled = true` (`world-cells.ts:4773-4783`), so their culling is baked stale as the window moves. Correctness would need a `needsUpdate` bump on every level render — re-paying the per-draw cost the bundle exists to remove, with no non-rendering frame to replay on — and a bundled caster cannot be hidden or re-layered, which negates the probe's texel gate and cluster/wide split. Solution item 2's "per virtual-shadow level for casters" half needs re-planning (GPU-side caster culling, AC-1, is the real answer).

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
   - **Bundles: measured no gain, default off, and why.** On machinefall's map-walk, with bundles on (the old default) the trees near the camera were not drawn while their shadows were: the adaptive texel gate in `VirtualShadowNode#probe` hides sub-texel casters with `visible = false` and `#restoreHidden` puts them back, and a bundle bakes each object's `visible` into the render list it records — a re-record taken while a tree was gate-hidden lost the tree for good. A/B on the same walk also measured no CPU p50/p95 gain, because the main thread is mostly idle and the frame is GPU/present bound. So `bundles` is now opt-in (`bundles: true`, `?tnBundles=1` or `TN_BUNDLES=1`), and the gate skips a bundled mesh so opting in cannot reproduce the conflict.
3. Impostors (AC-3) and HLOD (AC-4), in parallel: they are independent.
4. Measure and tune (AC-5).

## Phase 3 executable plan

**First step (pick one): cook-time per-cell HLOD caster proxies, not GPU-driven indirect casters.**

Why, from the code:
- A merged, position-only caster already exists and is already correct for a depth pass:
  `buildChunkShadowProxies` groups a chunk's covered opaque meshes by `side`, builds
  `shadowProxyGeometry`, flips `castShadow = false` on the covered meshes and puts the proxy on
  `VIRTUAL_SHADOW_CASTER_LAYER` (`packages/core/src/world-cells.ts:2019-2058`, `2067-2109`), and
  `#probe` bills it as a cluster and window-culls it for free
  (`packages/core/src/render/virtual-shadow.ts:1015-1020`). Cooking the same proxy per cell, from a
  simplified merge, changes where the geometry comes from and nothing else — no new layer, no new
  dispatch, no fallback path.
- Indirect casters cannot bring the w=640 count down. The wide layer is already one draw per
  `asset:level:part` mesh (`virtual-shadow.ts:1018-1019`); `BufferGeometry.setIndirect` moves only
  the instance *count* into a GPU buffer, so the record, the mesh and its draw submission stay one
  per key. The measured w=640 break is per-draw JS (11–19 ms), so only fewer draws cuts it.
- The coarse level already submits the chain's coarsest geometry (`virtual-shadow.ts:941-946`), so
  the wide bill is now draw count, not LOD detail; a per-cell merge is the only candidate that
  collapses many keys into one draw.
- It is also exactly AC-4's bake, so the shadow fix rides on work already required rather than a
  parallel mechanism. GPU casters stay the documented fallback (step 4).

Steps (each: files, the number that proves it, the smallest test):

0. Baseline marker, no production change. Add `draws` to `IVirtualShadowLevelStat`
   (`virtual-shadow.ts:246-253`), set from `clusterDraws + wideDraws` in `#probe`, print it in the
   `TN_VIRTUAL_SHADOW` line (`virtual-shadow.ts:1645-1672`). proof: a `?tnShadowStats=1` walk prints
   the width=640 row; it is ~336 today. test: `world-shadow-caster-cost.spec.ts`, assert the reported
   count equals the meshes the level's camera actually submits.
1. Cook bakes one merged, simplified, position-only proxy per cell. Files:
   `packages/assets/src/lod/hlod.ts` (new; error budget in cell-local units), wired through
   `packages/assets/src/pass-chain.ts` and `packages/assets/src/compile.ts`; input is the cells the
   world export already names (`tn_world_chunk`, `packages/blender-mcp/src/index.ts:101`); output one
   GLB plus material-group count and error per cell, keyed on the source hash so it caches. proof:
   `TN_WORLD_HLOD cells=N proxies=M maxError=…` at build, mirroring `TN_WORLD_CHUNK_MERGE`
   (`world-cells.ts:5726`); each proxy's triangles ≤ the budget, deterministic across runs. test:
   `packages/assets/__tests__/hlod.spec.ts`.
2. WorldCells draws the proxy beyond its distance, main and caster. Files:
   `packages/core/src/world-cells.ts` — load the cell proxy with the cell; past the distance hide
   `cell.chunks` and show the proxy; a copy on `VIRTUAL_SHADOW_CASTER_LAYER` with `castShadow = true`
   and `frustumCulled = false`, on the fold where `#cullCells`/refilter already flips cell
   visibility. Distance comes from the proxy's own projected error, no game option. proof:
   `TN_WORLD_HLOD draws=… replaced=…` and the `TN_VIRTUAL_SHADOW` width=640 draw count below 120.
   test: extend `world-shadow-caster-cost.spec.ts` — a cell past the distance submits one caster draw
   per material group, near cells submit their chunks. red-green: remove the swap, the count returns
   to ~336 and the test fails.
3. Far-tree impostors (AC-3), independent of 1–2. Cook: `packages/assets/src/lod/impostor.ts` (new)
   bakes an N×N octahedral atlas (albedo+alpha, normal) from the chain's base geometry; emit it as an
   extra level after the last discrete level, carrying the chain's own `error` and 2 triangles. The
   switch distance is `chainDistances`' formula (`world-cells.ts:2533-2549`) fed the last level's
   error, so no game-side value exists. Runtime: `packages/core/src/model-lod.ts` already selects by
   projected error, so the impostor switches like any level; put its quad on both caster layers.
   proof: `TN_WORLD_IMPOSTOR asset=… levels=… switch=…`; past the switch, triangles per tree are 2,
   read from `?tnShadowStats=1` plus a `visuals:baseline` capture at the switch. test:
   `packages/core/__tests__/world-impostors.spec.ts` + `packages/assets/__tests__/impostor.spec.ts`.
4. Risks and what to cut. Cook cost and package size grow by one proxy per cell: bake behind the
   content-hash cache and skip a cell whose merged error already fits the budget (proxy == chunks, no
   win). Pop at the swap distance: switch by projected error, not metres; if it still pops, cut step
   2's main-pass half and ship the caster proxy alone, because the measured break is the shadow
   level. Impostor parallax or lighting at the switch: normals in the atlas, switch by the chain's
   last error; if it still reads wrong, fall back to the coarse chain and leave AC-3's box open (it
   is independent). If step 2 cannot get width=640 under 120 draws, re-plan the wide half onto
   GPU-driven indirect casters (`packages/core/src/world-gpu-scene.ts`), which removes the per-draw
   JS even though one record per key remains; never plan per-level `BundleGroup`s (see the
   feasibility section above).

## Terrain tile draw reduction

**Fact (measured).** In the machinefall streamed map the main pass submits ~225 draws, ~110 unnamed
non-instanced terrain-tile meshes: `buildLevel` (`world-tiles.ts:401`) makes one
`new Mesh(geometry, surface)` per tile per LOD level (`:490`), parented into a `LOD` at the tile
origin (`:2178`); `streamRadius 8` = 289 resident tiles × `lodFactors [1,2,4]` (one visible level
each) plus stitch bridges. Each ~30 µs of three's per-object JS (~3 ms/frame), never merged — the
CPU-bound mobile/native bill.

**(1) Per-tile difference: geometry only.** A level geometry is `position`/`normal`/`index`
(`:492-495`) — heights baked, no uv, no per-tile attribute or uniform; all tiles share the
game-owned `MeshSurface` (`:15`), the splat `MeshStandardNodeMaterial` reading `positionWorld` and
shared textures (`world-terrain-splat.ts:337-348`); the LOD adds a translation. So a merge cannot
change the look if the same vertices land at the same world positions, and adjacent same-LOD tiles
sample the same field on the same grid (`fieldHeightGrid` `:372`, `edgeSamplesFor` `:332`) — their
shared edges already coincide.

**(2) Chosen: merge same-LOD settled tiles into super-tiles.** Group by
`${lod}:${floor(tileX/K)},${floor(tileZ/K)}` (K≈4), one merged `Mesh` per block, rebuilt only when
membership or LOD changes.
- Reject **GPU indirect (c)**: `setIndirect` moves only the instance *count* into a GPU buffer, so
  record + mesh + submission stay one per key (`world-gpu-scene.ts`); a tile = one geometry = one
  instance per key. It removes cull/repack, not draws.
- Reject **instanced + height texture (b)**: the shared flat grid needs the surface to sample a
  per-tile height texture and rebuild normals in-shader — the engine owning the game's `surface`
  (rule 3).
- Reject **three `BatchedMesh`**: the LOD morph writes per-tile vertices on the CPU
  (`updateLodTransitionGeometry` `:1194`, writes `:1233`, `:1252`) and `BatchedMesh` copies geometry
  into one buffer with no per-instance vertex write; `deleteGeometry` compacts. More churn than a
  merge.
- **Change (all `world-tiles.ts`):** new `mergeLevelGeometry` (beside `buildLevel` `:401`)
  concatenates each tile level's `position`/`normal`/`index` at the tile origin, keeps
  block-perimeter skirts, names the mesh; `#markBlockDirty` from `#admitCandidate` `:2239`,
  `#evict` `:2707`, `#disposeTile` `:2718`, `#setLodLevel` `:2339`; `#rebuildDirtyBlocks` on the
  `IAdmissionBudget` pattern (`:39`), one per frame, at the end of `follow`; `#setLodVisibility`
  `:2379` and the morph skip a tile while `lodTransition !== undefined`. `#stitch`/
  `stitchGeometryData` (`:869`) unchanged — a bridge reads `level.edgeSamples` and the field, not the
  meshes.

**(3) Culling, transitions/stitch, shadows.** Blocks get their own bounds
(`computeBoundingBox`/`Sphere`, `:492-495`) and `frustumCulled = true`; culling becomes per block, so
a same-LOD segment behind the camera is drawn — hence K small. A morphing tile stays individual for
its three frames, so `updateLodTransitionGeometry`/`restoreLevelSurface` are untouched and the block
re-merges after; membership changes only on stream/LOD events. Bridges stay per-pair. Tiles are
receive-only (`mesh.receiveShadow`, `:2185`, bridge `:2529`; no `castShadow` in the file), so
merging touches no caster and the merged mesh sets the same flag.

**(4) Ordered steps, each with its number.**
0. No production change: add a `terrainTiles` stat (`tiles`/`blending`/`blocks`/`draws`) beside
   `lodTransitions` (`:1853`), printed `TN_TERRAIN_TILES`, and run the playtest `scene-nodes`
   main-pass census on machinefall `?scene=map-walk`. proof: `draws≈110`, equal to the unnamed
   `Mesh`es the main pass submits. test: assert the stat equals that mesh set.
1. Merge behind `mergeTiles:false`. proof: the census falls ≥4× (~110 → ≤25), the same-pose
   screenshot is the pre-merge picture, `TN_TERRAIN_VALIDATE` `maxSeamGap`/`maxLodPop` unchanged.
   test: `world-tiles.spec.ts` — a settled 3×3 same-LOD island is one draw whose positions equal the
   tiles' concatenation.
2. Budget block rebuilds (one per frame), exclude blending tiles. proof: no `TN_FRAME_SPANS` stall
   while walking, `blendingTiles`/`lodTransitions` unchanged. test: existing LOD-transition cases
   plus one blending case.
3. Default on, `mergeTiles:false` escape. proof: the census ≤25 with no game option.
Cut if: a seam appears → merge interior edges only, or one block per LOD tier; rebuild stalls show
in `TN_FRAME_SPANS` → enlarge K or revert to default-off; the picture differs → fix the origin
offset, do not ship.

**(5) Risks.** *Seams*: same-LOD edges only — never merge across LOD; gate on `maxSeamGap`
before/after. *Popping*: a block rebuild changes the visible set; blend-end re-merge is the only
trigger. *Streaming churn*: each admission/eviction dirties one O(block) rebuild — budget one per
frame, watch `TN_FRAME_SPANS`. *Memory*: a block duplicates settled level vertices; free the
per-tile level geometry once merged (keep `edgeSamples`+field for stitching) or charge it to
`residentByteBudget` — never hold both.

## Cook: a terminal coarse level on every chain (shipped ahead of GPU scene)

The problem table's "distant trees keep 37–58% of LOD0 triangles" is a *generation* stall, not a
culling one: `LockBorder` on an open or thin tree lets the error ladder stop at 87% kept, so a far
tree still submits ~16k triangles and the shadow levels tens of millions. The cook now appends one
terminal level to every chain — `packages/assets/src/lod/generate.ts` for triangles, cut by
`max(1500, 5% of LOD0)` with `Prune` and no border lock; `packages/assets/src/lod/cards.ts` for
foliage cards, which merges LOD0 cells into a coarser grid to get under the same target. It is
exempt from the saving gate, needs no game option, and the runtime already reads its recorded error
through `chainDistances` (`packages/core/src/world-cells.ts:2524`). `LOD_GENERATOR_VERSION` moved to
2 so a re-cook replaces stale chains; the artifact schema stayed at 1, so chains baked before this
still load. Measured on the synthetic open mesh (16 patches x 24 segments, 18,432 triangles): the
ladder reaches 1,536 and the terminal level 1,500. Proof:
`pnpm exec vitest run packages/assets/__tests__/lod-generation.spec.ts packages/assets/__tests__/foliage-lod.spec.ts`.
