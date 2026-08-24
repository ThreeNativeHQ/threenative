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

The root `pnpm test` gate was attempted twice after lockfile install and a successful root build.
Both attempts stopped in `packages/playtest/__tests__/orphan-cleanup.sh`, which observed six
Chromium processes left by its own signal-teardown probe. The reported PIDs were gone immediately
after each command exited; the independent playtest Vitest suite was green as recorded above.

## Acceptance status

- Shared path math and duplicate-helper guard: green, with red mutations above.
- Browser navigation path length: `9.680368318337951`, green.
- Desktop-native navigation path-length equality: unverified; no native executable/bundle was
  available and the native transport rejects the browser-only network assertion.
- Failure-report fields and target-named abort helper: green in focused tests; live Android abort
  remains unverified because the selected emulator app failed before the abort exercise.
- Sampling split: green; `sampling.ts` retains sampling/runtime-observation concerns only, with
  camera and server lifecycle in separate focused modules.
