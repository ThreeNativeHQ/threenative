# PRD-146 playtest frames versus ticks — verification

Date: 2026-08-17

The selected contract-preserving answer is path (a): `holdFrames` and `waitFrames` remain
accepted deprecated aliases. On a bridge advertising `runtime.fixedStep`, their duration is
added to the fixed-step tick total. New generated scenarios and documentation use the canonical
`holdTicks` and `waitTicks` spelling.

The defect is an engine bug in the playtest harness: the schema accepted a duration that the
fixed-step runner did not execute.

## Implementation

- `runner.ts` adds legacy frame aliases to the tick total only for fixed-step bridges; live RAF
  timing remains unchanged for non-fixed-step bridges.
- `scenario.ts` documents both aliases as deprecated and keeps the fail-closed validation rules.
- `runner/init.ts` writes `holdTicks`.
- The co-located parser test now uses `holdTicks` and `waitTicks`, so it no longer locks in the
  old spelling as the preferred contract.
- The browser E2E suite uses an inert RAF loop for the fixed-step fixture and asserts that the
  reported bridge tick delta equals the requested duration for both legacy aliases.
- Generated template guidance/examples and current playtest documentation use ticks; generated
  `AGENTS.md` mirrors are synchronized.

## Repair round 1

The reviewer-found E2E defect was an engine-test defect: the fixture's RAF callback moved the
subject by `0.05` on every browser frame, so movement could pass without `bridge.advance`. In
`mode=physics`, the callback now remains scheduled but does not call `step()`. The test records
`report.before.tick` and `report.after.tick` and requires their delta to equal `8`.

The repaired fixture and test were applied to the implementation branch in a temporary detached
worktree. The fixture's RAF loop stayed inert for `mode=physics`, and the test required the
bridge tick delta rather than movement distance.

## Repair round 2

The second proof review added a matching `waitFrames` regression. Both alias cases now use the
inert fixed-step fixture, a non-visual diagnostics assertion, and an explicit `after.tick -
before.tick === 8` check.

The negative-control procedure was corrected to start from the repaired commit's actual parent,
`076af33`. In a temporary detached worktree, the current fixture and E2E test changes were
applied to that parent and passed before mutation:

```text
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/e2e-runner.spec.ts
1 file passed; 17 tests passed; exit 0
```

The procedure then removed only the shared fixed-step alias mapping from `runner.ts`, changing
the tick total from:

```ts
playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step) + (fixedStep ? frames : 0)
```

to the pre-alias total:

```ts
playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step)
```

The same command reproduced the proof failure: 2 of 17 tests failed, the `holdFrames` and
`waitFrames` cases, and each observed a tick delta of `0` instead of `8`. This mutation tests the
parent implementation directly; `c609e2d` was not used as the negative-control base.

## Acceptance evidence

### 1. Parser test

The exact PRD command was attempted:

```text
pnpm vitest run packages/playtest/src/scenario.test.ts
No test files found, exiting with code 1
```

This repository's root Vitest config includes `packages/**/__tests__/**/*.spec.ts`, while this
co-located file is a Node `node:test` file. The explicit harness override passed instead:

```text
pnpm exec tsx --test packages/playtest/src/scenario.test.ts
5 tests passed; exit 0
```

The package's collected focused suite also passed:

```text
pnpm --filter @threenative/playtest build
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/scenario.spec.ts packages/playtest/__tests__/runner.spec.ts
2 files passed; 84 tests passed; exit 0
```

### 2–3. Fixed-step measurement

After `pnpm --filter @threenative/playtest build`, the real fixture bridge was run with the same
movement assertion and a 198-duration step under each spelling, with the scenario's normal
default screenshots/artifacts enabled. The fixture's WebGL surface is intentionally uniform, so
the visual guard reports `TN_CAPTURE_BLANK`; the semantic movement result is still observed:

| step key | before tick | after tick | observed tick delta | distance | semantic assertion |
| --- | ---: | ---: | ---: | ---: | --- |
| `holdFrames: 198` | 0 | 198 | 198 | 9.900000000000006 | pass |
| `holdTicks: 198` | 0 | 198 | 198 | 9.900000000000006 | pass |

Both runs execute exactly the requested 198 fixed ticks. The CLI report's overall `pass` is false
only because the normal screenshot guard emits `TN_CAPTURE_BLANK` after observing a two-colour
uniform canvas; the report names the WebGL adapter as SwiftShader. The prescribed `sh scripts/xvfb.sh`
rerun produced the same tick and capture result, so this is an artifact-fixture limitation rather
than a changed acceptance criterion.

The new E2E wait-alias case uses `waitFrames: 8` with diagnostics rather than a movement assertion;
it observed `before.tick: 0`, `after.tick: 8`, and an exact delta of `8`. This keeps the wait proof
about fixed-step execution, not visual movement.

The committed browser regression also passed:

```text
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/e2e-runner.spec.ts
1 file passed; 17 tests passed; exit 0
```

### 4. CLI initialization

`node packages/playtest/dist/runner/cli.js init` created the smoke scenario with
`"holdTicks": 8`, confirming that a new project no longer receives the deprecated spelling.

Running that exact, unchanged generated file against the fixture with normal screenshots reached
the assertions: `before.tick: 0`, `after.tick: 8`, `frames: 8`, and
`distance: 0.39999999999999997`; both diagnostics and movement assertions passed. The CLI exited 1
because the fixture's uniform WebGL canvas triggered `TN_CAPTURE_BLANK` (with the same result when
the canonical run was wrapped in `sh scripts/xvfb.sh`). Row 4's required overall exit 0 is
therefore unavailable in this environment; the limitation is named rather than hidden by
disabling screenshots or changing the criterion.

### 5. Repository gates

- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0; only existing cognitive-complexity warnings were reported.
- `pnpm --filter @threenative/playtest test`: exit 1 after its build/publint and PRD146 E2E
  suite passed; its inherited root Vitest run reported 132 passed files and 1,214 passed tests
  (1,215 total). The one failure was the unrelated `packages/physics/__tests__/actuation.spec.ts`
  native LOC census (`expected src 38082, observed 38095`, with stale area counts).
- `pnpm test`: exit 1 during the serialized workspace package tests; the nested playtest gate
  reported the same 132 passed files and 1,214 passed tests (1,215 total), with the same unrelated
  native LOC census failure. The workspace stopped before the final root Vitest command.
- `pnpm test:templates`: exit 1 after the action-RPG `survives` scenario passed; the next
  scenario hit the pre-existing Vite artifact-watch reload diagnostic
  `TN_PLAYTEST_PAGE_NAVIGATED`. This is the PRD-148 template-server defect, outside this lane.

### 6. Remaining legacy-key hits

The required command returned 630 matching lines. Every hit falls into one of these deliberate
groups:

| root/group | lines | reason retained |
| --- | ---: | --- |
| `packages/playtest` | 203 | deprecated compatibility API/docs, fixed-step runner handling, Android/device path, compatibility fixtures/tests, and ignored generated `dist` output |
| `packages/create-threenative` | 6 | generated `AGENTS.md`/`CLAUDE.md` explicitly document the aliases as deprecated |
| `packages/runtime-native` | 8 | existing Android production-profile workload and its contract tests; Android is explicitly outside this PRD's acceptance path |
| `docs/benchmark` | 399 | archived generated benchmark inputs and type snapshots |
| `docs/verification` | 6 | historical pre-fix ledgers, measurements, and this verification record |
| `docs/PRDs` | 7 | historical/proposed records that preserve the original wording |
| `docs/architecture` | 1 | the current API example's explicit deprecated-alias note |

No current template scenario, current performance example, or current architecture example uses
the deprecated spelling as its preferred vocabulary.
