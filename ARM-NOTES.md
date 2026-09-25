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
