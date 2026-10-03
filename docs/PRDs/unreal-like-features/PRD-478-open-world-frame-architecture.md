# PRD-478 — Open-world frame architecture: walking at 120 fps

**Status:** IN PROGRESS
**Complexity:** 8 (HIGH) — 10+ engine files (+3), worker boundary and GPU-driven shadow levels are new mechanisms (+3), engine and Machinefall release separately (+2); risk override: none
**Owner:** João
**Depends on:** PRD-475 (draft #384: its cuts and instruments are the baseline)

## Context

PRD-475 set Machinefall's `?scene=map-walk` a target of CPU and GPU p95 ≤ 8.3 ms on the RTX 2080 WebGPU adapter, with no visual loss against develop `a602467db`. Its tuning reached the idle and median frame, but not the walking tail:

| Frame | PRD-475 (cut12k–m) | develop `a602467db` |
| --- | --- | --- |
| Idle frame p50 | 2.6–4.8 ms | 5–7 ms |
| Walking render p50 | 7.0–8.4 ms | 8.3–10.4 ms |
| Walking render p95 | 19–26 ms | 18–25 ms |

The tail is structural. An unminified 25 s walk trace has 390 of 1491 rAFs over 12 ms, averaging 20 ms. All of it runs on one main thread, and the heavy jobs land in the same frames. Disjoint sampled attribution of a long frame (conditional means, not additive p95s):

| Share of a long frame | ms | What it is |
| --- | --- | --- |
| WorldCells streaming | 5.40 | terrain follow 2.1, prop drain 0.9, seam pass 0.9, block rebuild 0.8, LOD transitions 0.5, stale scan 0.5 (nested entries overlap) |
| Direct-draw loop | 5.34 | three's per-draw submission: geometry, node, binding and pipeline stages at about 21 µs of JS per draw |
| Other sampled work | 4.20 | `RenderCameraCull.apply` 0.97, an apply/step path 0.90, simulation 0.42, GC 0.18 |
| Shadow level re-render | 3.00 | `#renderLevel` 1.96, `#probe` 0.90. Level 0 submits ~500 draws per render. |
| Node builds | 1.33 | shaders for clusters admitted mid-walk, outside the buckets above |
| Unsampled | 0.70 | |

An earlier reading counted ~7.5 ms of "three bookkeeping" (`needsRefresh`, `updateForRender`, `getNodeBuilderState`/`getMonitor`). Those are inclusive stacks: `getMonitor`'s 4.48 ms contains the 3.00 ms of shadow and 1.33 ms of builds. `NodeMaterialObserver.needsRefresh` itself is 0.28 ms, so settling refreshes cannot recover that number.

Budget arithmetic at 21 µs per traversed draw: 300 main + 500 shadow draws is 16.8 ms before streaming. Reserving 3 ms for other work leaves room for about 250 traversed draws per frame, so a shadow re-render frame needs far fewer submissions, not just fewer refreshes.

Three things were tried and failed. Each is recorded in PRD-475's Phase 2 notes:
- **Dirty-gated scans:** two landed as exact cuts. The others were already gated.
- **Shared measured frame budget** (streaming deferred in shadow frames): walking p95 got worse, 26–35 ms against 21.5–24.7, because deferral stacked the backlog. It was reverted.
- **GPU-driven shadow casters, half-choice correction, layer-0 consolidation, cadence changes:** all rejected because they could not be proved bit-identical.

## Solution

Change where the frame's work runs, not how much of it a frame skips:

1. **Shadow windows move only when the camera does.** The adaptive refresh step also set the virtual shadow map's snapping grid, so a step change moved a stationary window and re-rendered the level, which raised the measured cost and the step again. The window origin now snaps to a fixed per-level page grid, and the step is only the drift threshold before it re-centres.
2. **Fewer shadow submissions.** Shadow levels draw from per-key GPU-scene outputs with their own light-frustum visibility and the cluster path's LOD and texel gates, so a level re-render submits about the key count plus residual layer-0 and proxy draws, not ~500 batches.
3. **Streaming off the main thread.** WorldCells' CPU-heavy, DOM-free jobs run in a worker, terrain block merges and seam reconciliation first, with transferable buffers and no shared mutable state. The main thread keeps GPU uploads (`addInSlices`) and scene-graph edits, and publishes a job's result atomically. Hosts without workers run the same job inline with the same result.

## Decisions

- 2026-10-02, João: the PRD-475 tuning stops and the remaining walking tail moves here as architecture work.
- 2026-10-02, decided by the agent under João's delegation ("do what you want"): the visual bar is PRD-475's AC-3, a blind same-pose judge equal to develop, plus the pop series. It is not bit-exact output. That bar is what admits GPU-driven shadows, which cannot be proved identical draw for draw.
- 2026-10-02, decided by the agent under João's delegation, after an independent review of the trace: the phases are reordered to shadow window stability, then shadow submissions, then worker streaming. Observer settling (the old Phase 1) is parked. Its candidate (`dac531f6e`, `feat/prd-478-sol-phase1`) settled 36 of 39 fixture draws but walked slower in the browser (walking p95 27.5 and 38.6 ms against 22.5 and 25.9 ms on cut12n), and the observer is 0.28 ms of a long frame. Further observer work is capped at half a day and needs a measured win first.

## Acceptance Criteria

- [ ] AC-1 [local]: Machinefall `?scene=map-walk` walking CPU render p95 ≤ 8.3 ms. Read as the walk/idle split of `TN_FRAME_BUDGET` windows, where a window under 100 fps counts as walk, over 3 interleaved runs against develop on a quiet RTX 2080. proof: `TN_FRAME_BUDGET` windows from `playtest perf`.
- [ ] AC-2 [local]: the same walk's GPU p95 ≤ 8.3 ms, from timestamp-query `gpuMain + gpuShadow + gpuOther + gpuCompute`. proof: the same windows.
- [ ] AC-3 [local]: no visual loss. 3 fresh blind raters score every map-walk and map-views pose at or above develop `a602467db`, the pop road band matches develop, and a frame-by-frame judge finds no late objects or shadows. proof: `scripts/visual-ab.ts` score plus the pop series.

## Execution Phases

#### Phase 1: Shadow windows move only when the camera does
**Status:** IN PROGRESS
**Files:** `packages/core/src/render/virtual-shadow-pages.ts`, `packages/core/src/render/virtual-shadow.ts`; `packages/core/__tests__/`
- [ ] A refresh-step change with a stationary camera neither moves a level's window nor re-renders it; a real move of step + 1 texel re-renders; every origin stays on the per-level texel grid. proof: red-green `virtual-shadow-pages.spec.ts` and `virtual-shadow.spec.ts` cases (unit-green on `feat/prd-478-shadow-snap` `748348c9c`, not yet on this branch).
- [ ] Measured on map-walk against cut12n and cut12n with `adaptiveRefresh: false`: walking render p95, GPU p95 and level re-render rate, plus AC-3's blind A/B and pop series. proof: `TN_FRAME_BUDGET` walk/idle split, `?tnFrameSpans=1`, `scripts/visual-ab.ts`.

#### Phase 2: Fewer shadow submissions
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `packages/core/src/world-gpu-scene.ts`
- [ ] A shadow level draws GPU-scene keys with its own light-frustum visibility, never the main camera's. Total level-0 draws (keys plus residual layer-0 and proxy draws) are counted against the 630 candidates measured today, and the per-level instance set matches the cluster path's within the texel gate. proof: red-green spec counting submitted draws and comparing instance sets.
- [ ] map-walk `gpuShadow` p95, GPU total p95 and walking CPU render p95 measured against Phase 1, with AC-3's blind A/B and pop series. proof: `TN_FRAME_BUDGET` walk/idle split plus `scripts/visual-ab.ts`.

#### Phase 3: Streaming jobs in a worker
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`, `world-tiles.ts`, a worker entry next to them
- [ ] Terrain block merges and seam reconciliation run in a worker; the main thread only swaps attributes, and the settled terrain is byte-identical to the inline path. proof: red-green spec comparing worker and inline geometry, plus main-thread span time for block rebuild and seam pass near 0.
- [ ] Hosts without workers run the same jobs inline, with an unchanged result. proof: the native conformance case or a `--target` desktop playtest of a streamed world.
