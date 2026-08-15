---
prd_contract: v1
---

# PRD-110 repair — Device scenarios inherit a default they cannot observe

**Status: COMPLETE, 2026-08-15.** Implemented in `81cf96a` and integrated in `7920182`; the
review-2 blocker on the capped lane is closed.
`linchpin/prd-110-verification-fails-closed-r2` at `9de0611`. This document does not reopen or
edit the source PRD.

**Complexity: 1 → LOW mode.** Four existing files in one package; no new module, schema field,
public vocabulary, or platform claim.

**Exact review-2 defect.** At baseline `packages/playtest/src/runner/androidRunner.ts:354`,
`unsupportedAssertion` tests the resolved diagnostics policy. Because resolution defaults
`noNetworkErrors` to `true`, an existing device scenario which says nothing about network policy is
rejected before launch even though the Android and iOS transports cannot observe network traffic.
The current main tree already shows the intended narrow predicate at `androidRunner.ts:352`; the
repair lane must receive that behavior and prove it against real scenarios rather than copy a green
unit shape.

## 1. Context

**Problem.** `examples/native-smoke/playtests/device-smoke.playtest.json` intentionally omits an
`assert.diagnostics.noNetworkErrors` member and is the scenario used by the iOS simulator verifier.
On `9de0611`, the resolved default turns that omission into an explicit device-only requirement and
returns `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` before the app can reach its visibility assertion.

**Current behavior at the blocked baseline.**

- Explicit `noNetworkErrors: true` is correctly unsupported on device because there is no CDP
  network observer.
- An omitted field is incorrectly treated as the same explicit request.
- Browser execution still has a real network observer and must continue to fail on a seeded failed
  request under the closed default.
- `noNetworkErrors: false` still requires the existing non-empty
  `networkErrorsOptOutReason`; this repair must not weaken or bypass that validator.

**Files analyzed.**

- `9de0611:packages/playtest/src/runner/androidRunner.ts:341-382`
- `9de0611:packages/playtest/__tests__/device-playtest.spec.ts:207-248`
- `9de0611:packages/playtest/__tests__/ios-device-playtest.spec.ts:37-117`
- `9de0611:packages/playtest/__tests__/negative-fixtures.spec.ts:46-79`
- `examples/native-smoke/playtests/device-smoke.playtest.json`
- `examples/native-smoke/playtests/device-smoke-network.playtest.json`

## 2. Solution

Treat only the authored value `scenario.assert?.diagnostics?.noNetworkErrors === true` as a device
network assertion. Keep resolved defaults unchanged for targets that can collect network evidence.
Load the repository's existing `device-smoke.playtest.json` in both Android and iOS runner tests so
the regression cannot be satisfied by another hand-written inline scenario. Keep the explicit
network scenario as the unsupported control, and strengthen the browser fixture to show a real
failed request still yields exit `1` and a failed diagnostics row.

**Data changes:** none. The public scenario shape and opt-out reason contract remain unchanged.

## 3. Integration points

**Reachability.** `packages/playtest/src/runner/cli.ts` dispatches `--target android|ios` into
`runAndroidPlaytest` / `runIosPlaytest`; both reach `unsupportedAssertion` before driver launch.
The existing iOS simulator verifier calls the same CLI with
`examples/native-smoke/playtests/device-smoke.playtest.json`.

**Caller census (record output during implementation):**

```sh
rg -n "unsupportedAssertion\(|runAndroidPlaytest\(|runIosPlaytest\(" \
  packages/playtest/src packages/runtime-native/scripts -g '*.ts' -g '*.mjs'
rg -n "device-smoke\.playtest\.json" packages/runtime-native packages/playtest -g '*.mjs' -g '*.md'
```

Expected: the CLI and iOS simulator verifier remain live non-test callers; no second device-policy
resolver appears.

**Revert check.** Restore the baseline resolved-policy predicate at `androidRunner.ts:354` and run
the focused device tests. Both real `device-smoke` regressions must fail before driver preparation.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | explicit-intent device network guard | `packages/playtest/src/runner/cli.ts:97` | resolved-default guard at baseline `androidRunner.ts:354` | yes, same conditional replaced | explicit `device-smoke-network` still exits `2` before launch |
| 2 | real Android/iOS scenario regression | `packages/runtime-native/scripts/verify-ios-simulator.mjs:238` | inline-only default-policy test | yes, misleading default-is-unsupported test removed/replaced | revert #1 and both target regressions fail |
| 3 | browser closed-default network proof | `packages/playtest/src/runner/runner.ts:197` | no replacement | n/a | seeded request to `127.0.0.1:1` exits `1` with failed diagnostics |

## 4. Execution Phases

### Phase 1: Omitted network policy reaches device assertions

**User-testable vertical slice.** A user can run the existing device-smoke scenario on either
device runner and reach its visibility assertion; an explicitly requested network assertion still
fails unsupported before launch.

**Files (3):**

- `packages/playtest/src/runner/androidRunner.ts` — EDIT: gate unsupported network observation on
  the authored field, not `resolveDiagnosticsPolicy`.
- `packages/playtest/__tests__/device-playtest.spec.ts` — EDIT: load the existing device-smoke
  scenario for Android; retain an explicit-network unsupported case.
- `packages/playtest/__tests__/ios-device-playtest.spec.ts` — EDIT: load the same existing scenario
  for iOS; retain the explicit-network unsupported case.

**Implementation.**

1. Replace only the baseline conditional; do not change diagnostics resolution or report policy.
2. Remove the review-2 test that asserts omitted policy is unsupported.
3. Assert both real-scenario runs prepare the driver, reach the intended semantic assertion, and
   return the assertion's real pass/fail exit rather than infrastructure exit `2`.
4. Assert `device-smoke-network.playtest.json` still returns
   `TN_PLAYTEST_UNSUPPORTED_ON_TARGET`, exit `2`, with `driver.prepared === false`.

**Focused gate:**

```sh
pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts \
  packages/playtest/__tests__/ios-device-playtest.spec.ts
```

**Revert check:** restoring `resolveDiagnosticsPolicy(...).noNetworkErrors` makes the two
device-smoke tests red while the explicit unsupported control remains green.

### Phase 2: Browser network failure remains fail-closed

**User-testable vertical slice.** A browser scenario that omits network policy and performs a real
failed request reports the captured URL/error, a failed diagnostics row, and exit `1`.

**Files (1):**

- `packages/playtest/__tests__/negative-fixtures.spec.ts` — EDIT: strengthen the existing
  `network-only` fixture assertions; do not replace the real browser run with a mock.

**Implementation.**

1. Assert the report contains at least one captured network observation from the seeded request.
2. Assert the diagnostics row is present and red under the default policy.
3. Assert `TN_PLAYTEST_NETWORK_ERROR` and exit `1`; an absent observation must fail the test.
4. Run and retain the existing validator assertion that `noNetworkErrors: false` without a
   non-empty reason is rejected. Do not relax the public reason contract to make a device test
   pass; this phase does not edit that validator test.

**Focused gate:**

```sh
pnpm exec vitest run packages/playtest/__tests__/negative-fixtures.spec.ts \
  packages/playtest/__tests__/fails-closed.spec.ts
```

**Revert check:** disable browser network capture or seed a successful request; the strengthened
network fixture must fail because it no longer observes the requested red condition.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
| --- | --- | --- | --- |
| omitted policy launches | temporarily restore the `9de0611` resolved-policy conditional | the existing device-smoke run is rejected before `driver.prepared` | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts packages/playtest/__tests__/ios-device-playtest.spec.ts`; result: RED observed: omitted-policy device-smoke returned TN_PLAYTEST_UNSUPPORTED_ON_TARGET before driver preparation; exit: 1 |
| explicit request unsupported | temporarily change explicit `noNetworkErrors: true` to omitted | the unsupported-control assertion observes a launched driver | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts packages/playtest/__tests__/ios-device-playtest.spec.ts`; result: RED observed: explicit network scenario was launched instead of returning TN_PLAYTEST_UNSUPPORTED_ON_TARGET; exit: 1 |
| browser default stays closed | temporarily make the seeded request return HTTP 200 or suppress collection | the network fixture loses its captured failed request and red diagnostics row | `command: pnpm exec vitest run packages/playtest/__tests__/negative-fixtures.spec.ts`; result: RED observed: seeded network failure was not captured as a failed diagnostics observation; exit: 1 |
| opt-out reason contract | construct `noNetworkErrors: false` without `networkErrorsOptOutReason` | scenario validation accepts an invalid opt-out | `command: pnpm exec vitest run packages/playtest/__tests__/fails-closed.spec.ts`; result: RED observed: noNetworkErrors false without a non-empty reason was accepted; exit: 1 |

Workers record exact exit codes and failure text before restoring each mutation. Planned expected
reds are not PASS evidence.

## Acceptance Criteria

**Consumer-scoped acceptance.** The existing CLI/device-verifier and browser runner must exhibit
the following behavior; file presence alone is not completion.

- [x] The existing `device-smoke.playtest.json`, with no explicit network policy, launches through
  both fake device transports and reaches its intended assertion rather than exit `2`.
- [x] The existing explicit network scenario remains unsupported on Android and iOS before launch.
- [x] A real seeded browser network failure under omitted policy produces a captured observation,
  failed diagnostics row, and exit `1`.
- [x] `noNetworkErrors: false` without a non-empty reason still fails scenario validation.
- [x] Caller census names the CLI/device verifier path; the revert check breaks the real scenario.
- [x] Focused tests and `pnpm typecheck && pnpm lint && pnpm test` pass after every observed-red
  mutation is restored.

## Verification Evidence

Contract conformance: prd_contract: v1

Completed evidence: `81cf96a` preserves omitted-policy device launches while explicit network
assertions remain unsupported on Android/iOS fake transports. The final targeted device lane passed
21/21 tests (`device-playtest.spec.ts` and `ios-device-playtest.spec.ts`), and the repository gates
were rerun on the integration branch. No Android hardware, iOS hardware, or new simulator result
is claimed; these are transport-contract tests only.

## Checkpoint Protocol

After each phase, the reviewer must compare the lane against this PRD and report PASS only when:

1. The exact file inventory matches and at least one pre-existing production file is edited.
2. Integration Ledger callers are filled with real non-test `file:line` values.
3. The caller census and revert check are pasted, and the old resolved-policy path is gone.
4. Every phase gate was observed red by its specified control and green after restoration.
5. No source PRD, scenario contract, generated `CLAUDE.md`, or unrelated worktree file changed.

Any missing observation, test-only caller, weakened opt-out reason, or unsupported explicit request
that launches is a checkpoint FAIL.
