# ARM-NOTES — PRD-112 racing packed-gate lane

## Setup
- Read .arm-brief.md. Plan: reproduce racing-alone vs packed-7 sequence, isolate root cause, fix at root, prove 2x green, push + PR.
- Setup: `CI=true pnpm install --frozen-lockfile && CI=true pnpm build` → exit 0 (workspace built).
- Gate located: `pnpm verify:golden-path` → `sh scripts/xvfb.sh tsx scripts/verify-golden-path.ts`.
  Layers: pack, scaffold, install, mcp, dev, test, build web, assert artifact. `TN_GOLDEN_PATH_TEMPLATES`
  narrows the template list; `TN_GOLDEN_PATH_SCENARIOS` caps scenarios (CI sets "1").
  On a dev machine with TN_PLAYTEST_ALLOW_SOFTWARE=1 the `test` layer drives ALL non-visual scenarios
  (racing: boost, outcome, rescue, reverse, touch-controls) — that is the lane that ran
  `racing-finish-behind-rival-is-dnf`. CI's golden-path job (TN_GOLDEN_PATH_SCENARIOS=1) would only
  run `boost`, so the observed failure is a full-sweep run, not the CI one-scenario run.
- MEASUREMENT TRAP (cost one run): a TMPDIR inside the worktree makes the scaffolded project's
  `pnpm install` walk up into the repo workspace — "Scope: all 30 workspace projects" — so it never
  installs its own node_modules and layer `mcp` dies `MODULE_NOT_FOUND
  .../node_modules/@threenative/core/mcp/assets.mjs`. /tmp here is a 32G tmpfs (RAM), so TMPDIR
  must be disk-backed AND outside the repo. Using /home/joao/.tn-tmp.
- Killed the in-repo-TMPDIR run, restarted repro: RUN A (racing alone) then RUN B (all 7 templates).

## Resume 2026-09-25 (second arm)
- Prior arm left UNCOMMITTED engine edits (packages/core/src/{game,loop,playtest}.ts) implementing
  `FixedStepLoop.freezeClock()` + `IGamePluginRuntime.freezeClock` + playtest bridge call; not in
  ARM-NOTES. Kept and verified as the in-progress root-cause fix.
- Prior repro results recovered from .tmp/repro-driver.log: RUN A (racing alone) exit=0 at 14:02;
  RUN B (all 7 packed) exit=1 at 14:10. RUN B failed at racing layer `test` with
  TN_PLAYTEST_PAGE_UNREACHABLE (page.goto 15000ms) on the 2nd racing scenario, not the documented
  assertion — a load-dependent flake on the same loaded sequence.
- ROOT CAUSE (layer = engine packages/core, not template/gate/runner): the packed `racing` outcome
  scenario is tick-driven, but the browser runner pumps live rAF frames during the startup compile
  wait; each live frame advanced the fixed-step sim by wall clock. `packages/create-threenative/
  templates/racing/src/scenes/Race.ts:179` does `elapsed += dt` unconditionally and DNFs at
  `TIME_LIMIT = 90`; the 3-lap scenario needs ~47s, so >43s of boot wall-clock DNFs the race early
  and `advanceRace` stops updating the car -> completedLaps never reaches 3. Quiet boot = 164 ticks
  (2.73s); loaded software boot clears 43s. racing alone passes, only in-sequence after 5 templates
  it fails. Fix freezes the live clock for an announced runner so ticks are the only clock.
- Next: add regression tests (loop.spec + playtest.spec wiring), rebuild dist, run full 7-template
  packed gate twice, typecheck+lint, push + PR.
- [resume 15:08] orchestrator: previous run stalled 34 min after notes 'Next: add regression tests…'; fix edits are uncommitted in the tree — review them, finish from 'Next'.
- [resume 15:10] Reviewed fix diff + added regression tests (loop.spec, playtest.spec). Focused tests green:
  `vitest run packages/core/__tests__/loop.spec.ts packages/core/__tests__/playtest.spec.ts` → 2 files, 49 tests pass.
- RED observed: `git stash push -- packages/core/src/playtest.ts` then the new playtest.spec test fails
  `expected 61 to be +0` (61 live-frame updates leaked into a tick-counted run); restored → green.
- Machine is heavily loaded (several other agent lanes building concurrently) — this IS the load the brief
  describes; confirms the sequence/load dependence.
- Next: `CI=true pnpm build` (dist serves the gate's packWorkspace(build=false)), typecheck+lint, then full 7-template gate twice.
- [resume 16:15] orchestrator: paid models hit usage limit; now on space-bunny-free. Resume from 'Next'.
- [resume 16:12] Reviewed committed fix a2a2ca8ba (freezeClock in loop.ts/game.ts/playtest.ts + 2 regression
  tests). Commit is local-only, no PR yet. Load average 10.9 (other lanes building) = the load the bug needs.
  Next: CI=true pnpm build → typecheck+lint → full 7-template gate x2 → push + PR + auto-merge.
  TMPDIR=/home/joao/.tn-tmp (disk, outside repo — an in-repo TMPDIR makes scaffold installs walk up into
  the workspace and layer `mcp` dies MODULE_NOT_FOUND).
- [16:16] `CI=true pnpm build` exit 0; typecheck exit 0; lint exit 0 (after deleting a stray
  `.tmp/opencode-data` pnpm store the worktree's own scratch dir had left for biome to scan — all
  373 "errors" were json formatting in that store, none in the change).
- [16:16] GATE RUN 1 (all 7 templates, full non-visual sweep): exit 1, but NOT racing —
  `action-rpg` layer `test` died on its 4th scenario `action-rpg-touch-controls` with
  `$.entities[1].bounds.height must contain only finite JSON numbers`. A symptom the fix introduced.
- [16:19] A/B on the single template (TN_GOLDEN_PATH_TEMPLATES=action-rpg, ~90s/run):
  HEAD (freeze) → touch-controls NaN, 90s, deterministic. HEAD~1 core/src rebuilt → touch-controls
  PASSES (firstTick 81, lastTick 140) and the run dies later on `action-rpg-boss-win` with
  TN_PLAYTEST_PAGE_NAVIGATED / "Target page, context or browser has been closed" (a load-related
  crash on this loaded machine, separate from my change).
- [16:23] MECHANISM, measured not guessed: action-rpg's `render/touch-controls.ts` lays itself out
  in `update()` (Play.ts:436 → `touch?.update(...)` → `#layout`), parenting a 72-unit ring group to
  the camera at local z=-1. A frozen clock means `update` never runs, so at the run's FIRST sample
  (taken before the run's first `advance()`) the overlay is still at its constructed pose: parented
  at the camera's own origin. Reproduced the observation math standalone (`projectedBounds` +
  `point.project`): un-laid-out overlay -> bounds 1.9e19 (NaN at the run's camera pose); after
  `#layout` -> 144px. w=0 -> Infinity -> Infinity-Infinity = NaN. The overlay is the entity the
  scenario asks about (`movement`/`visibility` on touch-controls).
- [16:24] ROOT CAUSE, second half: freezing the clock correctly stops wall-clock time reaching a
  tick-counting run, but a *frozen* clock must not stop the game being *called* — scenes compute
  per-frame state in `update`, and a run reads its first observation before its first tick. Fix:
  `FixedStepLoop.#primeFrame()` — one `onUpdate(0)` on the first live frame after the freeze, not
  spent while the boot hold is set (the scene has not entered then), and armed by the transition
  into frozen only, so `advance()`'s implied freeze does not spend one per counted step.
  dt 0 = no time lands, `#tick` does not move.
- [16:25] RED/GREEN: disabling the `#primeFrame()` call fails 3 tests (`expected [] to deeply equal
  [ +0 ]` ×2, `expected +0 to be 1`); with it 50/50 pass in loop.spec + playtest.spec.
  Next: rebuild core, re-run action-rpg alone, then the full 7-template gate twice.
- [16:26] Baseline observation for the report: HEAD~1 pass/fail per scenario is
  fail/inventory/progress/touch-controls PASS, boss-win PAGE_NAVIGATED crash — so the golden path
  is ALSO not green on this machine before my change. The gate target is the 7-template sweep with
  racing's `racing-finish-behind-rival-is-dnf` green; any other red must be reported by name.
- [16:26] Second-order damage, measured the same way: a frozen clock alone broke
  `platformer-one-way` — the character captures its visual-attachment baseline on its first grounded
  contact, so a run starting at tick 0 read `visualAttached: false` where the unfixed run starting
  at tick 59 read `true` (platformer alone: 15/15 exit 0 at HEAD~2, 1/15 at HEAD). The boot this
  removed was the defect, not a fixture: 59 ticks on a quiet machine, thousands on a loaded one.
- [16:37] FIX, final shape: `freezeClock(settleSteps = FROZEN_SETTLE_STEPS=60)` +
  `FixedStepLoop.#primeFrame()` = `advance(60)` once, on the first live frame after the hold
  releases, so the world is settled by a FIXED count instead of by boot wall clock. `#tick` moves
  with it (the simulation really is that old and the report says so). `settleSteps: 0` is a real
  answer; negative/fractional throw. Note: a zero-dt prime is NOT available —
  `IPhysicsSimulation.step requires a positive finite deltaTime`.
- [16:40] racing alone: 5/5 exit 0, `firstTick: 60` on every scenario including
  `racing-finish-behind-rival-is-dnf`. platformer alone: 15/15 exit 0, `platformer-one-way`
  firstTick 60 (baseline 59, one-step prime 0).
- [16:48] **GATE RUN 3: exit 0** (16:41:50→16:48:32), 51/51 scenarios green, 10 templates
  (action-rpg, defense, minimal, platformer, puzzle, racing, runner, sailing, shooter, starter).
  **GATE RUN 4: exit 0** (16:48:42→16:55:01), 51/51 green. `racing-finish-behind-rival-is-dnf`
  reports firstTick 60 / frames 2648 / lastTick 2736 in BOTH runs — bit-identical under different
  machine load, which is the determinism the fix is for. (The trailing failure in each log is the
  gate's own mutation control, which must fail.)
- [16:57] typecheck exit 0; lint exit 0. Lint needed `.tmp/` kept free of scratch: a pnpm store
  left in `.tmp/opencode-data` by tooling gave 373 phantom "errors" and my own probe script 1 more.
  Scratch now lives in /home/joao/.tn-tmp/lane.
- [17:05] Tests: `vitest run packages` = 358 files / 4288 tests pass, exit 0 (covers core 1541,
  playtest+create-threenative 1936). `pnpm test` aborts at `packages/runtime-native` with 18
  failures, ALL of the form "<cmake executable> is not built. Run: cmake --build ..." —
  `packages/runtime-native/build` does not exist because `pnpm native:build` is opt-in and was
  never run in this worktree. No native test imports FixedStepLoop or freezeClock. Reported as
  environmental, not as a green.
- Next: push branch fix/prd-112-racing-sequence, open ONE PR to develop with auto-merge.
- [17:07] Merged origin/develop into the branch (it was 3 commits behind; the commits are
  docs/PRD-449, a packages/assets test fix, and a pnpm fix — none touch packages/core). Re-verified
  after the merge: install exit 0, build exit 0, typecheck exit 0, lint exit 0, `vitest run packages`
  358 files / 4288 tests pass. (The `pnpm install` in that batch recreated `.tmp/opencode-data`, which
  is what made lint red the first time — delete it and lint is green.)
- [17:07] PR #339 → develop, squash, auto-merge enabled (mergeState BLOCKED = waiting on
  ci-required, which is the intended flow). Title:
  "fix(prd-112): a playtest run's simulation was driven by boot wall clock, not by its own ticks".

FINAL REPORT:
Root cause: a tick-counting playtest run was also simulated by wall clock. The boot hold ends when
the runner attaches, then the runner pumps live rAF frames through the whole startup compile wait
(30-60s on a software adapter, a function of machine load) and every frame ran onUpdate off real
seconds. racing's Race.ts accumulates `elapsed += dt` and DNFs at 90s while the 3-lap scenario needs
47.0s, so boot time ate the 42.7s of headroom; measured 164 ticks (2.73s) before the first key press
on a quiet machine, 40s+ in the loaded packed sequence. Racing alone passed only because its boot
was short.
Layer: engine `packages/core` (fixed-step loop + playtest bridge) — not the template, gate or runner.
Two second-order defects found by running the gate, not by reasoning: (a) a frozen clock also
starved the game's first `update`, leaving action-rpg's camera-parented touch overlay on the camera
origin -> `point.project` divides by zero w -> NaN bounds; (b) the boot being removed was what
settled the world, so platformer's character read `visualAttached: false` at tick 0 vs `true` at
tick 59. Both fixed by settling the world in a FIXED 60 steps (`FROZEN_SETTLE_STEPS`) instead of in
boot time. A zero-dt prime is impossible: `IPhysicsSimulation.step requires a positive finite
deltaTime`.
Files: packages/core/src/{loop,playtest,game}.ts + packages/core/__tests__/{loop,playtest}.spec.ts
+ ARM-NOTES.md. 3 commits on fix/prd-112-racing-sequence (+1 merge).
Gate results, packed `pnpm verify:golden-path`, TN_PLAYTEST_ALLOW_SOFTWARE=1, full non-visual sweep:
  RUN 3  exit 0  16:41:50->16:48:32  51/51 scenarios  10 templates
  RUN 4  exit 0  16:48:42->16:55:01  51/51 scenarios  10 templates
  racing-finish-behind-rival-is-dnf: firstTick 60 / frames 2648 / lastTick 2736 in BOTH runs —
  bit-identical under different load, which is the determinism the fix buys.
  Before the fix: racing alone exit 0, packed exit 1 (racing layer `test`).
A/B on the same machine, one variable changed: action-rpg touch-controls NaN with the freeze, passes
at HEAD~1; platformer 15/15 at HEAD~2, 14/15 with a one-step prime, 15/15 with the 60-step settle.
Other gates: typecheck exit 0, lint exit 0, `vitest run packages` 358 files / 4288 tests pass.
Not green, reported honestly: `pnpm test` aborts at packages/runtime-native with 18 failures, all
"<cmake executable> is not built" — `packages/runtime-native/build` does not exist because
`pnpm native:build` is opt-in and was never run here; no native test imports the changed symbols.
PR: #339 -> develop, squash, auto-merge enabled (BLOCKED on ci-required).
Scratch traps: /tmp is a 32GB tmpfs here so TMPDIR=/home/joao/.tn-tmp; a TMPDIR inside the repo
makes scaffold installs walk up into the workspace and layer `mcp` dies MODULE_NOT_FOUND; and
`.tmp/opencode-data` (721MB pnpm store the tooling rewrites into the worktree) is git-ignored but
not biome-ignored, producing hundreds of phantom lint errors.
