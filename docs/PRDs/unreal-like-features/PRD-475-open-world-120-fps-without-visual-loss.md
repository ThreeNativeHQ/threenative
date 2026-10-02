# PRD-475 — Machinefall's open world at 120 fps with no visual loss

**Status:** IN PROGRESS
**Complexity:** 5 (MEDIUM) — 6–10 engine files (+2), engine and Machinefall release separately (+2), GPU-pass state (+1 risk); risk override: none
**Owner:** João
**Depends on:** PRD-473 (merged at 75% in #375 as `a602467db`)

## Context

Machinefall's streamed world (`?scene=map-walk`) is the open-world proof. #375 restored its look: forest shadows on road and floor, and the full forest after a camera jump. Impostors went back to opt-in because their card dropped the forest's shadow. That look, at develop `a602467db`, is the reference this PRD must not lose. The owner said "it should be FAST + look AAA": no frame-time win may cost the look.

Where it stands, per PRD-473:

- **GPU:** p50 9–15 ms after the GPU scene went default-on.
- **CPU:** window p95 13.2 ms.
- **What limits the frame:** the GPU and present wait. The main thread is mostly idle; the main pass draws 16–27 M triangles; the wide shadow level spends 11–19 ms of per-draw JS.
- **Timing was not claimed:** under the box's load (~30), two identical walks read render p50 21.4 vs 9.0 ms.
- **Bundles:** measured no gain and are opt-in, because a bundle bakes `visible` and lost gate-hidden trees.

Develop's recent cuts the game has not picked up yet:

- PRD-458 world streaming (`4f9638c2e`).
- PRD-473's terminal coarse LOD. `LOD_GENERATOR_VERSION` 2 needs a re-cook.
- PRD-462's spread material checks: frame p50 10.4–13.6 → 3.5–5.9 ms on the colour lane.
- The one-palette skinned draw (`0107bc7d0`).

Machinefall still pins pre-develop tarballs:

- main: `pr375-binding-054d0f866554`.
- `feat/prd-458-engine-pin`: `pr375-stabilize-2a776d82d056`.

No develop-tip tarball exists.

Instruments, all shipped:

- `TN_FRAME_BUDGET` (`packages/core/src/frame-budget.ts`) splits the frame into phases (`update|render|overlay|ui|residual|hostGap`).
- The same marker gives per-pass GPU times (`gpuMain|gpuShadow|gpuOther|gpuCompute`) as timestamp-query p50/p95, plus draws and triangles per pass.
- `playtest perf` (`packages/playtest/src/runner/perf.ts`) prints them.
- Under the private Xvfb, fps is suppressed: the present wait lands in update, with a ~50 ms swap floor. CPU is therefore read from the phase partition and GPU from timestamps, never from fps.

## Solution

1. **Sync, then measure on develop.** Pack core and assets from develop with `pnpm --filter <pkg> pack`, and pin Machinefall's `apps/client` to them, including `pnpm.overrides`. Re-cook the world with `pnpm world:post`. Then record the baseline: the frame phases and the per-pass GPU split on the Turing WebGPU adapter. Capture the same-pose reference images at the same time.
2. **Cut what the baseline ranks first, in the engine.** Every fix lives in `packages/core/src/` behind the convention that the engine decides; Machinefall gets no performance option. Candidates, each kept only if it moves its own meter and passes the visual A/B:
   - Shadows: redraw a clip level only when its casters or the light moved, instead of every frame. Draw the wide levels from the GPU scene's cull.
   - Main pass: triangle cost per screen pixel: LOD gates, and an impostor that casts the forest's shadow. That is the condition under which impostors may come back.
   - CPU: per-draw JS on the shadow and main passes. Bundles return only if they keep gate-hidden trees hidden.
3. **Hold it.** The map-walk scenario asserts the budget, so a regression reds the game's own test.

Quiet-machine rule: compare timings only with load average below 4. Interleave arms (A, B, A, B) over at least 3 runs each. When load stays high, record the run as unverified, never as a result.

Risks:

- A cut that reads as "faster" can be a cut that draws less. Every Phase 2 box therefore carries the same-pose A/B, and draws and triangles are compared alongside milliseconds.
- Caching shadow levels can leave stale shadows on moving casters. The A/B includes a pose taken while walking.

## Acceptance Criteria

- [ ] AC-1 [local]: Machinefall `?scene=map-walk` CPU frame p95 ≤ 8.3 ms. CPU means the summed phases excluding the present wait, over 3 interleaved runs on the RTX 2080 WebGPU adapter, with 0 console errors and no game-side performance option. proof: `TN_FRAME_BUDGET` windows via `node packages/playtest/dist/runner/cli.js perf` on the map-walk run — Evidence: pending.
- [ ] AC-2 [local]: the same walk's GPU p95 ≤ 8.3 ms, from timestamp-query `gpu` p95 (`gpuMain + gpuShadow + gpuOther + gpuCompute`). proof: the same `TN_FRAME_BUDGET` windows — Evidence: pending.
- [ ] AC-3 [local]: no visual loss against develop `a602467db`. Fresh blind raters score the after-captures no lower than the reference on all 4 map-walk and all 4 map-views poses, including the road and forest-floor shadows. proof: `pnpm visuals:ab --before <ref> --after <candidate> --raters 3` — Evidence: pending.
- [ ] AC-4 [local]: no tree or shadow pops in on approach. A fine capture series along the map-walk highway leg shows no element appearing or swapping LOD within 40 m of the camera. proof: map-walk capture series plus a fresh judge subagent — Evidence: pending.

## Blocked on

- Presented 120 fps on a real 120 Hz+ display. Xvfb's swap floor cannot show it. Unblocked by João running `?scene=map-walk` on the desktop monitor and reading the fps overlay.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Develop engine in the game | Machinefall `apps/client/package.json` `file:` tarball pins and `pnpm.overrides` | Replaces the `pr375-*` pins | Phase 1 box 1 |
| World frame cost | `?scene=map-walk` → `WorldCells.update` (`packages/core/src/world-cells.ts`) → GPU scene and `VirtualShadowNode` (`packages/core/src/render/virtual-shadow.ts`) | Changed in place; the CPU path stays as the fallback for backends without indirect draws | AC-1, AC-2 |
| Budget regression guard | Machinefall `apps/client/playtests/scenes/map-walk.playtest.json` `assert.performance` | Tightens the current `maxFrameMsP95: 250` | Phase 3 box 1 |

## Decisions

- 2026-10-01 (João): a follow-up PRD targets 120 fps with no visual compromise ("FAST + look AAA"). Impostors stay opt-in until they cast the forest's shadow.
- 2026-10-01 (João, via this PRD): PRD-473's AC-5 (map-walk at 120 fps) moves here. PRD-473 keeps its mechanisms: GPU cull, bundles, impostors, HLOD and fallback.
- 2026-10-01: the visual reference is develop `a602467db`, the look restored in #375, and not the older `pr375-binding` build.

## Execution Phases

#### Phase 1: Sync Machinefall with develop and record the baseline
**Files:** Machinefall `apps/client/package.json`, `pnpm-lock.yaml`, and the re-cooked `public/world/*`; `docs/verification/runtime-perf-state.md` (perf findings update in place).

- [x] Machinefall runs develop's engine: the core and assets tarballs packed from develop `a602467db` or later are pinned, the world is re-cooked, and map-walk passes. proof: `pnpm test:scenes` (map-walk) in Machinefall, 0 console errors. — machinefall `feat/prd-475-develop-engine` `2ba8f21`. Core 0.3.4 and assets 0.3.5 tarballs from `a602467db`; installed dist tree hash equals the engine build. map-walk ran 5 times on nvidia/turing with 0 console errors; 4 green, 1 red on `state.failures` 1, the unlogged cell failure in Phase 2. map-views is green with 4 distinct poses.
- [x] The baseline is recorded in `docs/verification/runtime-perf-state.md`. It covers the CPU phases p50/p95 and the `gpuMain/gpuShadow/gpuOther/gpuCompute` p50/p95, with draws and triangles per pass, over 3 quiet-machine map-walk runs. The same-pose reference captures (4 walk, 4 views) are saved as the AC-3 `--before` directory. proof: `node packages/playtest/dist/runner/cli.js perf` on the runs. — 3 runs at load 3.4–3.8: frame p50 12.3 / p95 26.3 ms, CPU render 12.1 / 26.1 ms, GPU 7.4 / 11.3 ms (main 5.6, shadow 1.1), draws main 318 and shadow 200. References are in `artifacts/prd-475/reference/` (gitignored): 4 walk and 4 views.

**Status:** DONE. The CPU render phase leads: render p50 is 1.6× GPU p50, and update/overlay/ui read 0. Phase 2 therefore starts with CPU attribution.

**Verification:** the scenario run plus the perf report. The ranking of costs decides the order of Phase 2.

#### Phase 2: Cut the frame where the baseline says, in the engine
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `packages/core/src/world-cells.ts`, `packages/core/src/world-gpu-scene.ts`, plus their specs. These are expected, not fixed: the baseline names the real ones.

Budget split, to be confirmed against the baseline: shadows 2.5 ms GPU, main 5 ms GPU, CPU render phase 4 ms.

- [ ] Shadow passes: map-walk `gpuShadow` p95 ≤ 2.5 ms. The shadow pass's share of CPU render time halves against the baseline, with a red-green spec on the mechanism and AC-3's A/B at the four walk poses. proof: `pnpm exec vitest run packages/core/__tests__/<shadow spec>` plus `playtest perf`.
- [ ] Main pass: map-walk `gpuMain` p95 ≤ 5 ms, with a red-green spec on the mechanism and the same A/B. proof: the mechanism's spec plus `playtest perf`.
- [x] A failed world load names itself: `WorldCells` prints the asset or cell and the error behind a `TN_WORLD_CELL_FAILURE` marker instead of only counting it (`world-cells.ts` `#startAssetLoad`, `#startChunkLoad`, `#attachChunks`). proof: a red-green spec in `packages/core/__tests__/` with a rejecting loader. — `packages/core/__tests__/world-cells.spec.ts::WorldCells > names a refused world load in a TN_WORLD_CELL_FAILURE marker`, red without the marker, green with it; core 2184/2184.
- [ ] CPU render phase p95 ≤ 4 ms on map-walk, with a red-green spec on the mechanism and the same A/B. proof: the mechanism's spec plus `playtest perf`.

**Verification:** each cut is measured A/B against the build before it, interleaved and on a quiet machine. A cut that fails its meter, or the visual A/B, is reverted and recorded under Decisions.

Cut 1 (terrain super-tiles, PRD-473 plan): landed in ec9a739ad, b9442ec5a, bc998f510, 8349962ce, 0421ed329; Machinefall A/B pending.
Cut 1 fix: Machinefall correctness pair (same build, merge off/on) found the ring shrinking 289 → 248 because block bytes were charged to tile admission; blocks are now reported (`blockBytes`), not charged — 68a3691d2. Terrain draws 289 → 33–42, main draws p50 289–343 → 158–258.
Cut 1 fix 2: a block kept drawing the ground of a tile that had left it — a second copy at the level the tile left, for as many frames as the one-per-frame rebuild queue took to reach it — and counted that tile twice, so the `tiles` stat drifted off 289; a departure now dissolves its block for the frames before the rebuild brings it back — f8a990abe; per-frame walk invariant `world-terrain-merge-walk.spec.ts` (red at frame 18, green after; draws stay under the unmerged ring's 81).
Cut 2 (memoised shadow-caster table): landed in d47a24dfc; Machinefall A/B pending.

#### Phase 3: Hold 120 fps with the look intact
**Status:** NOT STARTED
**Files:** Machinefall `apps/client/playtests/scenes/map-walk.playtest.json`; this PRD.

- [ ] map-walk's own scenario reds when CPU or GPU p95 exceeds 8.3 ms. It uses the performance assertion on the render and GPU series, not fps, which Xvfb suppresses. proof: `pnpm test:scenes` green on the candidate and red on the Phase 1 baseline build.
- AC-1 to AC-4 above close this phase.

**Verification:** AC-1 to AC-4 evidence, then `pnpm typecheck && pnpm lint && pnpm test`, and the Machinefall pin moved to the final tarball.
