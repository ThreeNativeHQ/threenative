---
prd_contract: v1
---

# PRD-113 repair — require a zero-motion causal baseline and classify pointer movement

**Status: COMPLETE, 2026-08-15.** Implemented in `8f9eba3`, with the browser regression completed
in `efdd6a8`; this fresh repair after review 2 of
`lane-113-repair-r2` at `8412788d4acce7e648cd4bd6dc324e73cf5a47cb`.
That lane is blocked at its two-review limit; this PRD is a new lane and must not receive a
third review under the old lane identity.

**Complexity: 4 → MEDIUM mode.** Four existing playtest runner/test files; no new package,
assertion kind, public scenario field, protocol member, gameplay edit, archive edit, or native
runtime change.

## 1. Context

Review 2 found two concrete defects in the previous repair:

1. `packages/playtest/src/runner/runner.ts:857` accepts an input-on movement rate whenever it is
   merely greater than the maximum input-off rate. An autonomous entity moving 1 unit during an
   input-off interval, 2 units during the input interval, and 1 unit during the next input-off
   interval therefore passes. The causal contract requires independent motion in any control
   interval to fail closed.
2. `packages/playtest/src/runner/runner.ts:588` and
   `packages/playtest/src/runner/androidRunner.ts:229` classify movement only from held keys,
   buttons, and touches. A buttonless `pointerPosition` still dispatches a pointer-move event on
   both targets but is recorded as input-off, so pointer-driven anonymous movement cannot pass.

The repair keeps the existing four-file contract. Anonymous movement remains consumer-neutral:
it uses observed transforms and declared step input only, without learning a gameplay entity name
or adding an assertion field.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | strict zero-motion input-off baseline | `packages/playtest/src/runner/runner.ts:857` via anonymous movement selection | rate-only input-on comparison that accepts faster autonomous motion | yes; every valid input-off interval for a candidate must have zero displacement | autonomous 1/2/1 motion fails even though input-on rate is higher |
| 2 | buttonless pointer-position causality | `packages/playtest/src/runner/runner.ts:588` and `packages/playtest/src/runner/androidRunner.ts:229` | held-state-only classification | yes; explicit pointer movement is input-driven for its interval | removing the pointer-position classification makes browser/device pointer movement fail |
| 3 | removal-sensitive regressions | `packages/playtest/src/runner/runner.ts:306` via `buildReport` | green-only causal and pointer tests | yes; each new defect has an observed red mutation | focused runner/device tests exit 1 after either repair is removed |

## 2. Execution Phases

### Phase 1: Strict anonymous causal baseline

**Files (4):**

- `packages/playtest/src/runner/runner.ts` — EDIT: require every valid input-off interval for a
  candidate to have zero movement before selecting input-on evidence; use the existing movement
  failure path when the baseline is not established
- `packages/playtest/src/runner/androidRunner.ts` — EDIT: classify an explicit `pointerPosition`
  step as input-driven for its advance, including when `buttons` is omitted
- `packages/playtest/__tests__/runner.spec.ts` — EDIT: add the faster-autonomous 1/2/1 control and
  a browser pointer-position classification regression; preserve the render-time and contrast tests
- `packages/playtest/__tests__/device-playtest.spec.ts` — EDIT: prove buttonless native pointer
  movement is input-driven and preserve the held-state/selector regressions

**Implementation:**

- [x] Anonymous movement selects a candidate only when it has valid input-on movement and every
  observed input-off interval for that candidate has zero displacement; a nonzero control interval
  fails closed even if the input-on rate is larger.
- [x] Invalid or missing interval duration remains fail-closed through the existing movement path.
- [x] The browser runner records a step with `pointerPosition` as input-driven for that step even
  when the pointer has no held button; release-only samples remain input-off.
- [x] The Android/iOS runner records the same buttonless `pointerPosition` step as input-driven;
  its existing pointer release behavior and held-key parity remain unchanged.
- [x] No public scenario/assertion/protocol field, gameplay identifier, or package is added.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `packages/playtest/src/runner/runner.ts:857` consumes the strict causal baseline.
- [x] Browser input path edited: `packages/playtest/src/runner/runner.ts:588` uses the same explicit
  pointer-position semantics as the scenario helper.
- [x] Native input path edited: `packages/playtest/src/runner/androidRunner.ts:229` matches browser
  classification for buttonless pointer movement.
- [x] Existing four-file scope remains exact; no source PRD, archive, verification document,
  protocol, or unrelated package is edited.

## 3. Tests Required

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `packages/playtest/__tests__/runner.spec.ts` | `anonymous movement rejects faster autonomous motion` | an entity moving 1 unit off, 2 units on, and 1 unit off cannot satisfy anonymous movement | restore the rate-only `inputOnRate > inputOffRate` selection; runner suite exits 1 |
| `packages/playtest/__tests__/runner.spec.ts` | `buttonless pointer movement drives the browser step` | `playtestStepDrivesMovement` and the browser step path classify `pointerPosition` without buttons as input-driven | remove the pointer-position branch; runner suite exits 1 |
| `packages/playtest/__tests__/device-playtest.spec.ts` | `buttonless native pointer movement drives anonymous evidence` | a native pointer-move interval is classified input-driven and the anonymous movement report passes | remove `step.pointerPosition !== undefined` from native classification; device suite exits 1 |
| `packages/playtest/__tests__/runner.spec.ts` | existing render-frame and contrast controls | constant-speed render motion fails; input-sensitive render motion passes; missing contrast fails | restore the divisor-of-1 or active-only path; runner suite exits 1 |
| `packages/playtest/__tests__/device-playtest.spec.ts` | existing held-state and selector controls | omitted-press parity and anonymous selector omission remain green | restore either old native behavior or `entities: []`; device suite exits 1 |

## Negative Controls

Every declared control must be run red and restored before delivery.

| Gate | Negative control | Expected result | Exact command/result |
|---|---|---|---|
| causal baseline | change the candidate guard back to `inputOnRate > inputOffRate` | the faster-autonomous test passes incorrectly and the runner suite exits 1 | `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: faster autonomous motion passed anonymous movement; exit: 1` |
| browser pointer | remove explicit `pointerPosition` input classification from the browser step path/helper | pointer classification regression fails | `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: buttonless pointer step was classified as input-off; exit: 1` |
| native pointer | remove explicit `pointerPosition` input classification from Android | native pointer anonymous movement fails | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts`; `result: RED observed: native buttonless pointer movement was classified as input-off; exit: 1` |
| prior causal controls | restore the pre-repair rate-only/active-only selection or divisor-of-1 duration | preserved causality regressions fail | `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: preserved causal regression failed after repair removal; exit: 1` |
| prior native controls | restore release-on-omitted-press or anonymous `entities: []` | preserved device regressions fail | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts`; `result: RED observed: preserved native regression failed after repair removal; exit: 1` |

Required green commands after all controls are restored:

```sh
pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts packages/playtest/__tests__/device-playtest.spec.ts
pnpm typecheck && pnpm lint && pnpm test
pnpm budgets
```

The final report must include exact focused counts, every observed-red exit/result, the four-file
scope check, the final commit SHA, and the full chained gate result. The separate committed
physics-puzzle replay archive remains `1/6`; this repair must not relabel or claim it.

## 5. Acceptance Criteria

- [x] Anonymous movement passes only when the selected entity has positive input-on movement and
  zero displacement in every valid input-off interval recorded for that entity.
- [x] An autonomous entity moving during any input-off interval cannot satisfy anonymous movement,
  even when its input-on displacement/rate is larger.
- [x] Missing, invalid, or incomparable causal samples fail closed through the existing movement
  assertion result.
- [x] Browser and Android/iOS classify a buttonless `pointerPosition` step as input-driven for its
  interval; release-only and no-input intervals remain input-off.
- [x] Existing omitted-press held-state parity, anonymous selector omission, render-time duration,
  and positive input-sensitive movement behavior remain intact.
- [x] All new and preserved red controls fail before restoration; focused tests, the full chained
  gate, and budgets pass after restoration.
- [x] Only the four scoped files change, and the separate physics-puzzle archive evidence remains
  `1/6`.

## 6. Checkpoint Protocol

Before review, verify:

1. The exact four-file inventory is unchanged and both browser/native input paths are edited.
2. The faster-autonomous 1/2/1 control is observed red after removing the strict zero-motion guard.
3. Buttonless pointer movement is observed red on the browser helper/path and native device path
   after removing the explicit pointer classification.
4. The render-frame duration and prior held-state/selector controls remain present and restored.
5. Every green gate has restored-red evidence, an exact commit, clean scope, and no archive claim;
   green-only causality is unverified and blocks delivery.

## 7. Scope

Change only:

- `packages/playtest/src/runner/runner.ts`
- `packages/playtest/src/runner/androidRunner.ts`
- `packages/playtest/__tests__/runner.spec.ts`
- `packages/playtest/__tests__/device-playtest.spec.ts`

Do not edit this PRD, the previous repair PRDs, benchmark archives, verification documents,
`packages/playtest/src/scenario.ts`, the protocol, or any package outside this list. Base the fresh
lane on `8412788d4acce7e648cd4bd6dc324e73cf5a47cb` and commit only the four scoped files.

## Verification Evidence

Completed evidence: `8f9eba3` enforces the zero-motion causal baseline and pointer classification;
`efdd6a8` adds the browser pointer regression. The focused browser/device runner coverage passed,
the targeted Android/iOS transport suite passed 21/21, and the separate physics-puzzle archive
remains explicitly `1/6`; this repair does not relabel that archive or claim a parity result.
