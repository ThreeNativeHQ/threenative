# PRD-478 — Open-world frame architecture: walking at 120 fps

**Status:** NOT STARTED
**Complexity:** 8 (HIGH) — 10+ engine files (+3), worker boundary and GPU-driven shadow pass are new mechanisms (+3), engine and Machinefall release separately (+2); risk override: none
**Owner:** João
**Depends on:** PRD-475 (draft #384: its cuts and instruments are the baseline)

## Context

PRD-475 set Machinefall's `?scene=map-walk` a target of CPU and GPU p95 ≤ 8.3 ms on the RTX 2080 WebGPU adapter, with no visual loss against develop `a602467db`. Its tuning reached the idle and median frame, but not the walking tail:

| Frame | PRD-475 (cut12k–m) | develop `a602467db` |
| --- | --- | --- |
| Idle frame p50 | 2.6–4.8 ms | 5–7 ms |
| Walking render p50 | 7.0–8.4 ms | 8.3–10.4 ms |
| Walking render p95 | 19–26 ms | 18–25 ms |

The tail is structural. An unminified 25 s walk trace has 390 of 1491 rAFs over 12 ms, averaging 20 ms. All of it runs on one main thread, and the heavy jobs land in the same frames:

| Share of a long frame | ms | What it is |
| --- | --- | --- |
| three's per-object bookkeeping | ~7.5 | `needsRefresh` 2.2, `updateForRender` ~2.5, `getNodeBuilderState`/`getMonitor` ~2.8. Every draw whose material holds any node refreshes every frame: `NodeMaterialObserver` short-circuits on `hasNode`. |
| WorldCells streaming | ~5.5 | admit 0.9, terrain block rebuild 0.8, seam pass 1.0, LOD transitions 0.5, stale collection 0.5, candidate admit 0.4, main cull 0.4 |
| Shadow level re-render | ~3.0 | `#renderLevel` 2.0, `#probe` 0.9. Level 0 submits ~500 draws per render, at about 21 µs of JS per draw. |
| Node builds | ~1.8 | shaders for clusters admitted mid-walk |

Three things were tried and failed. Each is recorded in PRD-475's Phase 2 notes:
- **Dirty-gated scans:** two landed as exact cuts. The others were already gated.
- **Shared measured frame budget** (streaming deferred in shadow frames): walking p95 got worse, 26–35 ms against 21.5–24.7, because deferral stacked the backlog. It was reverted.
- **GPU-driven shadow casters, half-choice correction, layer-0 consolidation, cadence changes:** all rejected because they could not be proved bit-identical.

## Solution

Change where the frame's work runs, not how much of it a frame skips:

1. **Draws refresh only when an input changed.** A three patch in `packages/core/patches/three@0.185.1.patch` derives `NodeMaterialObserver.hasNode` from the built graph's dynamic inputs: uniforms, OBJECT-update nodes, `reference()` nodes and storage. A material holding only constant or versioned inputs then takes the existing settled path. This may land in PRD-475 first; if so, this phase measures it and closes.
2. **Streaming off the main thread.** WorldCells' CPU-heavy, DOM-free work runs in a worker: terrain block merges (`mergeLevelGeometry`), seam reconciliation, batch matrix building on admit, stale and max-distance scans. The main thread keeps only GPU uploads (attribute swaps, `addInSlices`) and scene-graph edits, with transferable buffers and no shared mutable state. Native hosts keep the same contract: the job runs inline when no worker exists, and the result shape is unchanged.
3. **GPU-driven shadow casters.** Shadow levels reuse the main pass's GPU scene (`world-gpu-scene.ts`): one indirect draw per key per level, with instances culled on the GPU against the level frustum and the same LOD and texel gate as the cluster path. This replaces ~250 cluster batches per level-0 render with about the key count.

## Decisions

- 2026-10-02, João: the PRD-475 tuning stops and the remaining walking tail moves here as architecture work.
- 2026-10-02, decided by the agent under João's delegation ("do what you want"): the visual bar is PRD-475's AC-3, a blind same-pose judge equal to develop, plus the pop series. It is not bit-exact output. That bar is what admits GPU-driven shadows, which cannot be proved identical draw for draw.

## Acceptance Criteria

- [ ] AC-1 [local]: Machinefall `?scene=map-walk` walking CPU render p95 ≤ 8.3 ms. Read as the walk/idle split of `TN_FRAME_BUDGET` windows, where a window under 100 fps counts as walk, over 3 interleaved runs against develop on a quiet RTX 2080. proof: `TN_FRAME_BUDGET` windows from `playtest perf`.
- [ ] AC-2 [local]: the same walk's GPU p95 ≤ 8.3 ms, from timestamp-query `gpuMain + gpuShadow + gpuOther + gpuCompute`. proof: the same windows.
- [ ] AC-3 [local]: no visual loss. 3 fresh blind raters score every map-walk and map-views pose at or above develop `a602467db`, the pop road band matches develop, and a frame-by-frame judge finds no late objects or shadows. proof: `scripts/visual-ab.ts` score plus the pop series.

## Execution Phases

#### Phase 1: Refresh only what changed
**Status:** NOT STARTED
**Files:** `packages/core/patches/three@0.185.1.patch`; `packages/core/__tests__/`
- [ ] Settled draws with constant-only node graphs skip refresh. The stock shadow material goes from 1 refresh per frame to 0. A material whose `uniform().value` changes every frame still uploads it, and skinned, moved, version-bumped, OBJECT-update and `reference()` draws still refresh. proof: red-green observer spec plus the WorldCells + VirtualShadowNode fixture's refresh count per settled frame.
- [ ] Measured on map-walk: walking render p95 and idle p50 against develop, plus AC-3's A/B. proof: `TN_FRAME_BUDGET` walk/idle split plus `scripts/visual-ab.ts`.

First candidate (2026-10-02, unit lane only, commit `3ca39f9c3` on `feat/prd-475-sol-observer`): the observer certifies a built graph as settled only for constants, attributes, the stock world matrix, numeric material properties covered by `refreshUniforms` and stock shared camera groups; everything else stays dynamic. The stock shadow material settles (1 → 0 refreshes per settled frame), but in the WorldCells + VirtualShadowNode fixture only 3 of 39 draws settle: instanced casters carry an unclassified FRAME update. Uploaded values match a forced-refresh arm on every pass. Next: classify the instanced FRAME update before measuring in the browser.

#### Phase 2: Streaming work in a worker
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`, `world-tiles.ts`, a worker entry next to them
- [ ] Terrain block merges and seam reconciliation run in a worker. The main thread only swaps attributes, and the settled terrain is byte-identical to the inline path. proof: red-green spec comparing worker and inline geometry, plus main-thread trace time for `#rebuildDirtyBlocks`/`#seamPass` near 0.
- [ ] Admit-time batch building and stale/max-distance scans run in the worker, with the same resident set and instance matrices as inline. proof: red-green spec plus walk trace WorldCells `update` ≤ 1.5 ms per long frame.
- [ ] Hosts without workers run the same jobs inline, with an unchanged result. proof: the native conformance case or a `--target` desktop playtest of a streamed world.

#### Phase 3: GPU-driven shadow casters
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `packages/core/src/world-gpu-scene.ts`
- [ ] Shadow levels draw GPU-scene keys with one indirect draw per key per level. Level-0 shadow draws fall from ~500 to under 60, and the per-level instance set matches the cluster path's within the texel gate. proof: red-green spec counting submitted draws and comparing instance sets.
- [ ] map-walk `gpuShadow` p95 and walking CPU render p95 measured against develop, with AC-3's blind A/B and pop series. proof: `TN_FRAME_BUDGET` walk/idle split plus `scripts/visual-ab.ts`.
