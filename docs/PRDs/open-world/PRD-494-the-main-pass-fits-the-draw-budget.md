# PRD-494 — The main pass fits the draw budget

**Status:** PROPOSED
**Complexity:** 3 (LOW); risk override: none
**Owner:** agent
**Depends on:** PRD-478's measurement method; it works alongside PRD-478 Phase 2, which owns shadow submissions.

## Context

A probe on 2026-10-03 measured the walk with engine code identical to `origin/develop` `4d5e07c98`. Setup: Machinefall `?scene=map-walk`, headed WebGPU on an RTX 2080 (nvidia/turing), 1280×720, DPR 1, 3 runs. The host was busy with CI load during the runs, so the numbers are noisy.

| Walking (fps < 100 windows) | p50 | p95 |
| --- | --- | --- |
| CPU render | 6.9 ms | **21.2 ms** |
| GPU (timestamp) | 7.0 ms | 10.1 ms |
| Main-pass draws | 323 | 337 |

The CPU, not the GPU, is what stands between the walk and 120 fps.
The largest single CPU cost is three's per-draw submission: the `draw` span (`_renderObjectDirect`, probed in [`span-probes.ts`](../../../packages/core/src/profiling/span-probes.ts)) costs 3.8–8.5 ms per frame on average at 16–26 µs per draw.
At 330 draws that is about 7.3 ms on its own, before shadows, streaming or simulation.
PRD-478 found the same ceiling: at ~21 µs per draw, a frame has room for about 250 traversed draws in total. Its Phase 2 cuts shadow-level draws, and **no PRD cuts main-pass draws**.

The mechanism already exists and is off by default. `WorldCells`' `bundles` option ([`world-cells.ts`](../../../packages/core/src/world-cells.ts), the `bundles` doc comment) records every GPU-dressed main batch into one `BundleGroup` and replays it.
It was turned off because an earlier map-walk measurement found "no CPU p50/p95 gain (the main thread is mostly idle and the frame is GPU/present bound)".
Today's spans contradict that reason. Either bundles do not cover most of the 323 draws, or that measurement could not see the per-draw cost.

## Solution

1. Attribute the 323 main draws by source: GPU-scene keys, bundled meshes, terrain tiles, proxies and impostors, characters and props outside `WorldCells`. One counter per source goes on the existing `TN_FRAME_BUDGET` / `stats()` path; no new meter.
2. Take the largest unbundled source onto a path that does not cost a JS traversal per draw: extend the bundle to it, or merge it into GPU-scene keys. The attribution decides which. Re-measure `bundles` with the span probe on walking p95, the statistic the old decision never looked at, and turn it on by default if it wins. The `bundles: false` override stays, and its marker reports when it is overridden.
3. Measure against PRD-478's AC-1 method.

## Acceptance Criteria

- [ ] AC-1 [local]: on map-walk, walking main-pass traversed draws (draws that go through `_renderObjectDirect`) are ≤ 120 at p95, with the same picture: a blind A/B equal to develop, plus the PRD-477 pop series. proof: `TN_FRAME_BUDGET` walk windows plus `?tnFrameSpans=1`, then `pnpm visuals:ab --raters 3`.
- [ ] AC-2 [local]: the walking `draw` span p95 drops by at least 4 ms against develop over 3 interleaved runs. proof: `playtest perf --file` on the span runs.

## Blocked on

- A quiet host for final numbers: the CI runners (`tn-local`) share this machine. Unblocked by pausing the runner pool while it reports busy=0.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Draw attribution | `WorldCells.stats()` and the `TN_FRAME_BUDGET` line, read by `playtest perf` | none (new counters on the existing meter) | Phase 1 |
| Default draw path | `WorldCells.load` with no `bundles` option | `bundles` off by default → whichever path wins, with the override kept | AC-1, AC-2 |

## Execution Phases

#### Phase 1: Know where the main draws come from
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`, `packages/core/src/profiling/FrameCounters.ts`
- [x] Main-pass draws are counted per source and the sources sum to the total. proof: red-green spec in `packages/core/__tests__/` on a fixture world with every source present.
  Implementation: `passes.main.drawsBySource` — one `IFrameBudgetSummary` per source (`gpuScene`, `bundles`, `terrain`, `proxies`, `chunks`, `instanced`, `sky`, `other`; absent, never zeros, when no draw could be named) on the existing `TN_FRAME_BUDGET` window, classified at three's per-draw counter `info.update` in [`render-pass-budget.ts`](../../../packages/core/src/render-pass-budget.ts) and folded into the window by [`frame-budget.ts`](../../../packages/core/src/frame-budget.ts); the origins are `userData.tnDrawSource`, written by `WorldCells#dressGpu` and by the chunk-shadow and impostor-aggregate meshes in [`world-cells.ts`](../../../packages/core/src/world-cells.ts), by every layer-0 mesh of a prepared chunk (`#attachChunks`) and every main-role batch mesh (`#dressMesh`, overwritten by the GPU-scene dress) in the same file, by every mesh [`world-tiles.ts`](../../../packages/core/src/world-tiles.ts) creates, and by `Daylight`'s sky box in [`render/daylight.ts`](../../../packages/core/src/render/daylight.ts), plus the `userData.tnBundled` marker the world already keeps; printed on one line by `threenative-playtest perf` ([`perf.ts`](../../../packages/playtest/src/runner/perf.ts)). Spec: [`draw-sources.spec.ts`](../../../packages/core/__tests__/draw-sources.spec.ts), 9 tests — red with the field missing (`expected [] to deeply equal [ Array(4) ]`), green after. `chunks`, `instanced` and `sky` were added when the map-walk's `other` was found to hold a hand-placed chunk's draws (100–183 p50), and each has a producer case of its own: [`world-cells-chunk-merge.spec.ts`](../../../packages/core/__tests__/world-cells-chunk-merge.spec.ts), [`world-bundles.spec.ts`](../../../packages/core/__tests__/world-bundles.spec.ts), [`daylight.spec.ts`](../../../packages/core/__tests__/daylight.spec.ts). What stays in `other` is game-owned geometry no engine system can name — a character's meshes, the `ProjectionMirror`'s prop batches and Machinefall's own `water.glb`, one mesh per 128 m cell.
- [x] Map-walk attribution with `bundles` off and on, 3 runs each. proof: `TN_FRAME_BUDGET` walk windows with the per-source counters, recorded on this box. **Result 2026-10-03** (Machinefall map-walk, RTX 2080 WebGPU, core `796241dde`, 3 interleaved runs per arm, CI load 38–114 so no timing claim): bundles **off** — walking-window p50 draws 200–337, by source gpuScene 28–178, terrain 27–84, other 18–183 (the start of the route is gpuScene-heavy, the clearing other-heavy). Bundles **on** — gpuScene moves to `bundles` (66–210 replayed), traversed draws fall to 47–241, and the largest source left on the per-draw path is **other** (100–183), then terrain (27–94). Bundled replays are not in `passes.main.draws` (three never traverses them), so with bundles on the per-source sum exceeds `draws`; the spec's sum holds for traversed sources. Phase 2's subject: name what `other` holds (WorldCells' hand-placed chunk meshes are untagged today) before choosing its path. **Named 2026-10-03** (`c32735e36`, bundles on, 2 runs, load ~52): `chunks` 106–194 draws/frame p50 — the dominant per-draw source — then terrain 27–70, instanced 127 in the first window only, sky 1, other 2. Phase 2 takes `chunks` off the per-draw path.

#### Phase 2: Take the dominant source off the per-draw path
**Status:** NOT STARTED
**Files:** chosen by Phase 1; expected `world-cells.ts`, `world-gpu-scene.ts`
- [ ] The largest unbundled source draws without per-object traversal, and its picture matches the old path. proof: red-green spec counting `_renderObjectDirect` calls for that source, plus a map-walk same-pose capture.
- [ ] The default follows the measurement: bundles (or the merged path) on by default only if AC-2 holds, with `bundles: false` still honoured and reported on `TN_WORLD_BUNDLE`. proof: red-green spec on the default and the override.

#### Phase 3: Prove it on the walk and on native
**Status:** NOT STARTED
- [ ] AC-1 and AC-2 measured. proof: as stated on each AC.
- [ ] The same world draws through the native host with the new default. proof: a `--target desktop` playtest of a streamed world (the PRD-477 Phase 2 scenario once it exists), with the `TN_WORLD_BUNDLE` line in its log.
