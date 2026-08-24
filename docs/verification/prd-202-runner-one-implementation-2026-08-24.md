# PRD-202 runner one implementation — 2026-08-24

Status: implementation verified on the browser and simulated device paths. The required live
desktop-native navigation parity and live Android abort proof are unverified because the available
native lanes do not provide a usable matching run in this worktree; the attempted commands and
their outputs are recorded below.

## Red-first and mutation evidence

Before implementation, the new focused guard was run with three tests and all three were red:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts
3 failed
- expected steps.ts not to contain `function setupRequest(`
- expected sampling.ts not to contain server lifecycle concerns
- expected Android abort message, received `Desktop playtest interrupted by signal.`
```

Phase 1 mutation: replacing shared `Math.hypot(...)` with the naive square-root sum made the
cross-lane path test red:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts -t "same shared path length"
FAIL: expected 1.4142135623730951e+308, received Infinity
```

Phase 2 mutation: adding a local `failureReport` wrapper to `androidRunner.ts` made the
duplication guard red:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts -t "one implementation"
FAIL: expected androidRunner.ts not to match `function failureReport(`
```

Phase 3 mutation: importing `pageLifecycleDiagnostic` from the old `sampling.ts` path made the
package build fail loudly:

```text
pnpm --filter @threenative/playtest build
ERROR: No matching export in "src/runner/sampling.ts" for import "pageLifecycleDiagnostic"
TS2305: Module "./sampling.js" has no exported member
```

All mutations were reverted before the green runs.

## Green verification

```text
pnpm --filter @threenative/playtest build                         PASS
pnpm --filter @threenative/playtest typecheck                     PASS
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts \
  packages/playtest/__tests__/setup-reporting.spec.ts \
  packages/playtest/__tests__/runner-orchestration.spec.ts        3 files, 18 tests PASS
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts  9 tests PASS
pnpm exec vitest run packages/playtest/__tests__                    52 files, 524 tests PASS
pnpm typecheck                                                     PASS
pnpm lint                                                          exit 0; 292 existing warnings
```

The lane test proves one `Math.hypot` path implementation, equal web/native failure-report key
sets, target labels for browser/Android/desktop/iOS, and an aborted Android device run reporting
`Android playtest interrupted by signal.`.

## Required cross-lane proof

The browser WebGPU navigation run was part of the required `pnpm test:playtest` command and passed:

```text
scenario: navigation-routes-around-blocker
target: web
pathLength: 9.680368318337951
pass: true
```

Desktop attempts were made with the same navigation scenario and with a native-compatible smoke
scenario. The navigation scenario stopped before launch because native transport cannot observe
the scenario's `noNetworkErrors` assertion:

```text
code: TN_PLAYTEST_UNSUPPORTED_ON_TARGET
message: Desktop desktop target does not support network assertions.
target: desktop
pass: false
```

The native-compatible attempt then confirmed that no native game executable is available:

```text
node packages/playtest/dist/runner/cli.js playtests/physics-desktop.playtest.json \
  --target desktop --project examples/native-smoke \
  --executable /tmp/threenative-missing-navigation
code: TN_PLAYTEST_SCENARIO_UNREADABLE
message: spawn /tmp/threenative-missing-navigation ENOENT
pass: false
```

No desktop-native path length was observed, so exact browser/desktop path agreement is **unverified**
and is not claimed.

## Android abort attempt

The first Android attempt failed closed because three devices were connected and no serial was
selected:

```text
message: adb shell rm -f ... failed: adb: more than one device/emulator
```

The emulator lane was then selected with `--device emulator-5554`. It reached the installed app but
failed before a clean abort test because the app emitted 497 console/runtime errors and failed its
visibility assertion. The focused pre-aborted Android run still passed with the exact message
`Android playtest interrupted by signal.`; the live emulator abort proof is **unverified**.

## Required gate

```text
pnpm test:playtest                                                  PASS
```

The earlier root `pnpm test` attempts stopped in `packages/playtest/__tests__/orphan-cleanup.sh`,
which observed six Chromium processes left by its own signal-teardown probe. A later full root run
passed after the lockfile/build work completed; the expected sandbox probes still printed their
normal temporary-worktree diagnostics without failing their assertions:

```text
pnpm test                                                       PASS
199 test files, 1,895 tests passed
```

## Acceptance status

- Shared path math and duplicate-helper guard: green, with red mutations above.
- Browser navigation path length: `9.680368318337951`, green.
- Desktop-native navigation path-length equality: unverified; no native executable/bundle was
  available and the native transport rejects the browser-only network assertion.
- Failure-report fields and target-named abort helper: green in focused tests; live Android abort
  remains unverified because the selected emulator app failed before the abort exercise.
- Sampling split: green; `sampling.ts` retains sampling/runtime-observation concerns only, with
  camera and server lifecycle in separate focused modules.

## Review-round repair evidence

The review-specific controls were added before implementation and run against the unchanged
repair baseline. The focused suite reported 5 failures in 12 tests:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts
5 failed | 7 passed
- expected cli.ts not to contain `function safePart(`
- expected Browser interruption message, received []
- public Android runner resolved a failure report instead of rejecting with `Android playtest interrupted by signal.`
- public iOS runner resolved a failure report instead of rejecting with `iOS playtest interrupted by signal.`
```

The lane contract was then run with an Android-only distance mutation, changing its report input
to `(accumulatedPathLength(pathPositions) ?? 0) + 1`. The browser adapter stayed correct while the
native adapter changed, so the contract failed:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts -t "browser and device lanes report"
FAIL: expected 1.15 to be 0.15000000000000002
```

The mutation was reverted before the repair implementation. The repair now uses the actual browser
runner and device runner report paths, imports CLI `safePart` from `shared.ts`, labels browser signal
exits, and routes Android/iOS public entry points through a signal-aware device wrapper.

## Review-round repair green evidence

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts
12 tests PASS

pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts \
  packages/playtest/__tests__/setup-reporting.spec.ts \
  packages/playtest/__tests__/runner-orchestration.spec.ts
3 files, 27 tests PASS

browser pathLength: 0.15000000000000002
native pathLength: 0.15000000000000002
```

The lane suite's public abort tests cover the browser handler and Android/iOS entry points with
target-labelled errors. Desktop remains covered by its existing signal tests. No live Android,
iOS, or desktop-native run was claimed in this repair: the dated record above still documents the
available emulator/native-lane failures and the resulting unverified status.

## Final repair gate evidence

The final focused run included the runner-lane repair, orchestration, and existing runner suites:

```text
pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts \
  packages/playtest/__tests__/runner-orchestration.spec.ts \
  packages/playtest/__tests__/runner.spec.ts
3 files, 74 tests PASS
```

The package and repository gates also passed:

```text
pnpm --filter @threenative/playtest build                         PASS
pnpm --filter @threenative/playtest typecheck                    PASS
pnpm typecheck                                                    PASS
pnpm lint                                                         PASS (295 existing warnings)
pnpm budgets                                                      PASS (existing LOC/census diagnostics)
pnpm tsx scripts/count-loc.ts                                    PASS
pnpm test                                                         PASS (199 files, 1,895 tests)
pnpm test:playtest                                                 PASS (four browser scenarios)
```

The fresh browser scenario reported `pathLength: 9.725507065552236` and `pass: true`. Native
Android, iOS, and desktop execution remains unverified; no native result is claimed here.
