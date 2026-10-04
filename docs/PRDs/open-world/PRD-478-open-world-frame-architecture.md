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

## Iteration method

A timing round under PRD-475 cost 1–3 hours, most of it waiting for a quiet machine shared with CI runners and other lanes. Each phase iterates on load-independent signals and times on the RTX 2080 only to land:

1. **Counters gate the inner loop.** Each phase names a counter that falls when its mechanism works: level re-renders per walk (Phase 1), submitted draws per level render (Phase 2), main-thread block-rebuild and seam span time (Phase 3). Counters run under any machine load; a candidate that does not move its counter gets no timing round.
2. **One build per round.** A candidate ships behind a URL query flag for its A/B (the `?tnBundles=` pattern), so every arm is the same bundle; the flag is removed when the phase lands.
3. **A paired walk.** map-walk replays the same route at a fixed simulation step, so the arms are compared frame by frame over the movement interval, not as two distributions of `fps < 100` windows.
4. **Pixel diff, then a side-by-side review.** Same-pose captures identical to the previous arm need no judging. Any difference gets a develop | previous | candidate triptych per pose, reviewed side by side by a pairwise judge or the owner, plus the 3 blind raters and the pop series. Raters scoring one image at a time passed a shadow regression that the triptychs showed at a glance (Phase 1, 2026-10-02).
5. **Timing in a booked window.** Timing rounds book a slot on the `ci-pipeline` claim board (`gpu-timing`) when CI is idle, instead of polling for a quiet machine.

## Execution Phases

#### Phase 1: Shadow windows move only when the camera does
**Status:** IN PROGRESS
**Files:** `packages/core/src/render/virtual-shadow-pages.ts`, `packages/core/src/render/virtual-shadow.ts`; `packages/core/__tests__/`; Machinefall `playtests/scenes/map-walk.playtest.json`
- [ ] The iteration tooling above works on map-walk: two runs of one build with the same flag report the same level re-render count, and the paired walk compares the arms frame by frame over the movement interval. proof: two same-arm runs with equal counters plus one paired-walk report.
  - 2026-10-03 (runbook A3): Machinefall `feat/world-gate-capture` `d80b24d` publishes `shadowByMove`/`shadowByInvalidation`/`shadowRenders` on the `world` entity, read at labelled ticks of `world-capture.playtest.json`. Two develop runs (RTX 2080 WebGPU, CI load ~19): `byMove` walk-16 2/2, walk-32 4/4 — repeatable; `byInvalidation` 39/32 and 69/62 — streaming-timed, so it cannot be a same-arm-equal counter. The end-of-scenario `TN_VIRTUAL_SHADOW` line is not comparable across runs (it lands at frame 2100 vs 3600). Open: the box's "level re-render count" must be scoped to `byMove` (the window-moves mechanism this phase owns), and the paired per-label report is a jq over two reports, not yet a script.
- [ ] A refresh-step change with a stationary camera neither moves a level's window nor re-renders it; a real move of step + 1 texel re-renders; every origin stays on the per-level texel grid. proof: red-green `virtual-shadow-pages.spec.ts` and `virtual-shadow.spec.ts` cases (unit-green on `feat/prd-478-shadow-snap` `748348c9c`, not yet on this branch).
- [ ] Shadow levels cover what the view sees: their windows follow the view's focus (where the view meets the ground), not the eye, so an aerial view keeps fine levels on what it frames. A tall caster's shadow does not end at a level's guard square. The camp and highway aerial views match the stock-shadow reference (one 4096² map over ±250 m) within the blind judge and the owner's side-by-side review. proof: red-green spec on the window centre for a raised camera, plus the `?refShadow=1` reference triptychs on #401.
- [ ] Measured on map-walk against cut12n and cut12n with `adaptiveRefresh: false`: walking render p95, GPU p95 and level re-render rate, plus AC-3's blind A/B and pop series. proof: `TN_FRAME_BUDGET` walk/idle split, `?tnFrameSpans=1`, `scripts/visual-ab.ts`.
- [ ] No shadow without its tree at the first playable frame: the adaptive LOD bias holds until the world is prewarmed and the main pass draws it. proof: red-green spec `world-gpu-scene.spec.ts` "holds the bias through the load and rises once the main pass draws the world"; Machinefall start pose with and without the fix (pending GPU capture). Second cause, found after `0386c861c`: the gate table names every level of an asset from the moment it is adopted and fills in the keys the prewarm has minted so far (measured on a four-level chain: `parts=2,0,0,0`, then `2,2,0,0`, `2,2,2,0`), so a level the biased distance names had no keys and the dispatch drew the placement nowhere while the CPU path drew it and its shadow halves drew under it; the selection now takes the last level that has keys. proof: red-green spec `world-gpu-scene.spec.ts` "draws the last source level that has keys when the biased gate names one that has none" (red `expected +0 to be 1`, green after `world-gpu-scene.ts` `drawableLevel`).

Measured on Machinefall (WebGPU, RTX 2080), the bias climbed 1.080 → 2.332 over six `TN_LOD_BIAS` steps, every one of them before the loading overlay dropped — the GPU time there is compiles, uploads and prewarm, which coarsening selection cannot reduce.

First candidate (2026-10-02, `748348c9c` on `feat/prd-478-shadow-snap`): unit-green, level re-renders per walk 682 → 172 by frame 1500, blind raters Δ 0 on all 8 poses, pop band 25.905 against develop's 25.940. Rejected on the owner's side-by-side review: camp overview grows a straight-edged dark wedge by the gate, and highway air's floating tree shadow on the road gets larger and darker. That road leak already exists on develop and cut12n. Next: a red spec for the sampled-versus-rendered window, then the fix; check whether the develop leak shares the cause.

Follow-up (2026-10-02): `eb803490d` keeps a held level's render-time depth (it fixed the road leak's growth). `0ef0f51b9` corrects the wide-caster depth span, which multiplied by `W.y` instead of dividing, and stops dropping casters by their ground distance from the window centre. Both are correct by spec, but the camp wedge stayed. A stock-shadow reference capture showed why: in aerial views the virtual shadows miss most shadow on develop as well (canopy, buildings, the watchtower, fences). The levels follow the eye at half-widths 24, 96 and 320 m with 512² maps, so a high camera leaves the scene in the coarsest level, at about 1.25 m per texel. The wedge is real tree shadow, cut where a finer level's square ends. The owner decided the coverage fix belongs in this phase (box above).

CPU repair pass (owner request, 2026-10-02): keep `VirtualShadowNode`, work only in this checkout, four separate local commits; no push, browser or GPU execution. Reuse the existing CPU frame and shader-graph fixtures. Repair complexity: 3 → LOW (two implementation files and existing level state); integration remains source shadow slot → `setup` / `updateBefore` / `dispose`.

- [x] Boundary coverage: retain resolvable canopy and both-half chunk proxies; blend the finer map across its guard edge. proof: CPU receiver-ray and WGSL specs: 95 focused tests passed; post-commit core gate: 177 files, 2290 passed / 2 skipped, exit 0. Coarse scale now stays 1 (base gates 0.141/0.563/1.875 m at 512, previously up to 1.125/4.5/15 m); alpha omission removed; merged proxies go from one caster half to both. Fine fixture stays 4 draws/render, idle 0; resolved coarse omissions now draw.
- [x] Aerial focus: measure the view's intersection with received terrain; preserve walking eye follow. proof: raised-camera frame specs (received geometry and a sloped resident Heightfield): focus 150 m ahead, walking eye follow and 60 idle frames with no additional draws/renders; 113 focused tests passed; post-commit core gate: 177 files, 2293 passed / 2 skipped, exit 0.
- [x] Stair steps: isolate projection/filter/bias cause and test the measurable correction. proof: CPU WGSL specs verify slope-derived per-map comparison bias, reversed-depth sign, derivatives before divergent selection, and receiverPlaneBias=false; 84 focused tests passed. The existing guard blend addresses edge aliasing. Stock PCF uses one comparison depth across offset taps, which admits slope acne; attribution of the pictured diagonal band remains unverified without GPU capture. Post-commit core gate: 177 files, 2295 passed / 2 skipped, exit 0.
- [x] Resource lifetime: release every level/mover target on dispose and source removal, count targets and bytes. proof: stock-target disposal-count specs: all 6 targets released exactly once on node disposal or source removal (red: 2 each / 0 each); default PCF storage 7.5 MiB for three 512 levels and 320 MiB for two 4096 levels, including half-size movers. 74 focused tests passed, including a 30 m CPU walk whose focus/bias draws and renders match eye follow. Post-commit core gate: 177 files, 2299 passed / 2 skipped, exit 0. Final type/lint/quality results go in the requested report. Coverage adds a resolved coarse draw (fixture 3 → 4), so the owner's whole-walk no-increase requirement is not established; focus/bias have equal moving-walk counters.

Visual parity and GPU performance remain unverified in this pass because the owner prohibits GPU execution. The original visual/performance boxes stay open.

#### Phase 2: Fewer shadow submissions
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `packages/core/src/world-gpu-scene.ts`
- [ ] A shadow level draws GPU-scene keys with its own light-frustum visibility, never the main camera's. Total level-0 draws (keys plus residual layer-0 and proxy draws) are counted against the 630 candidates measured today, and the per-level instance set matches the cluster path's within the texel gate. proof: red-green spec counting submitted draws and comparing instance sets.
  - Plan 2026-10-03: **A selection** (this run, engine only) → **B the box** (world and node) → **C measure** (map-walk `gpuShadow` p95 against Phase 1, then AC-3). A is `packages/core/src/world-gpu-scene.ts` and nothing else: the selection reference `cullAndSelect` grows the shadow variant (the level's own planes, its own rendered centre, its texel gate, the chain level its map draws at), a twin of the main kernel beside it, `dispatchShadow(renderer, level)`, twin args/drawn ranges minted only when a provider registers, and `?tnShadowGpuKeys` off by default. No world, node or mesh moves, so the shipped picture is byte-identical whatever the flag says. B is where `WorldCells` registers the provider and dresses the shadow keys, and where `#renderLevel` dispatches between `#probe` and `updateShadow` with the level's own four numbers.
  - Plan 2026-10-03 findings, from the trace of `virtual-shadow.ts` `updateBefore`/`#probe`/`#renderLevel` and `world-gpu-scene.ts` `dispatch`/`#buildKernel`:
    - **One level render per frame.** `budgetSpent` takes the frame's single granted render, finest level first; the mover renders that follow are one per level and only while tracked casters exist, which a static world has none of. So a shadow dispatch happens once a frame on one level: the twin ranges have to survive one shadow dispatch before the next main dispatch overwrites them, not a frame's worth of levels.
    - **The shadow set needs disjoint args and drawn ranges.** `WorldCells#update` submits `gpu.dispatch(renderer, camera)` and three reads those records in the same frame. A shadow kernel that shared them would zero every `instanceCount` before the main pass drew it — the dressed forest that draws nothing while the readback says the counts were right. Same two buffers, at a twin offset: `argsIndex + shadowArgs`, `start + shadowDrawn`.
    - **~+2.7 MB**, the main drawn capacity a second time (64 B per instance slot × the sum of the key capacities; the twin args records are 20 B each and noise beside it), measured on the earlier Machinefall pass. Nothing is allocated until a provider registers, so this is the whole cost of the flag being on and zero when it is off.
    - **Prewarm-promise risk.** `#probe` renders *both* caster halves while any caster is still owed its prewarm draw, because the choice below would otherwise leave the half it did not pick with unbuilt shadow nodes until that level's next window move. A GPU-key map draws no caster mesh, so the draw that pays `awaitPrewarmDraw` has to have happened before it, or the loading gate never settles. B settles the promise first rather than carrying the halves forever.
    - **LOD-by-level-centre vs placement-level.** The cluster path chooses no LOD per placement at all: it draws every instance of a key in the squares the window covers, and `#probe` swaps a coarse level's geometry for the coarsest chain level. A GPU key per placement has to pick one, and the only distance a shadow map has is the level's own centre — so the selection is by level centre with a per-level base, and a placement near the camera but far from a coarse level's centre is drawn coarser in the shadow than in the main pass, a silhouette that does not match. That is the risk C measures, against the blind judge rather than by argument.
    - The selection is made against the level's **rendered** window centre, not the followed one: `offsetU`/`offsetV` exist because a deferred level's map sits where it was drawn, and a selection against anything else is a fragment reaching past a rendered map.
- [ ] map-walk `gpuShadow` p95, GPU total p95 and walking CPU render p95 measured against Phase 1, with AC-3's blind A/B and pop series. proof: `TN_FRAME_BUDGET` walk/idle split plus `scripts/visual-ab.ts`.

#### Phase 3: Streaming jobs in a worker
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`, `world-tiles.ts`, a worker entry next to them
- [ ] Terrain block merges and seam reconciliation run in a worker; the main thread only swaps attributes, and the settled terrain is byte-identical to the inline path. proof: red-green spec comparing worker and inline geometry, plus main-thread span time for block rebuild and seam pass near 0.
- [ ] Hosts without workers run the same jobs inline, with an unchanged result. proof: the native conformance case or a `--target` desktop playtest of a streamed world.
