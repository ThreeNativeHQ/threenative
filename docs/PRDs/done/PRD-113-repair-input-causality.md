---
prd_contract: v1
---

# PRD-113 repair — Anonymous movement must demonstrate input sensitivity

**Status: SUPERSEDED, 2026-08-15.** Its lane (`lane-113-repair-r2`, `8412788`) drew
REQUEST_CHANGES at its own two-review limit, and the defect it names was closed instead by
`docs/PRDs/done/PRD-113-repair-causal-baseline-and-pointer-input.md` at `5af281e`. Nothing here is
outstanding; the remaining PRD-113 work lives in `PRD-113-repair-sealed-behavior-proof.md`.

Originally: fresh repair after review 2 of
`linchpin/production-repair-113-r1` at `46187a8616f37b7deb16f32dfd8f67958692498b`.
The previous repair correctly omitted anonymous selectors and preserved named-state equality, but
its movement proof still accepted concurrent autonomous motion. This repair is intentionally
separate from that lane; the two-review limit has been reached there.

**Complexity: 4 → MEDIUM mode.** Four existing playtest runner/test files; no new package,
assertion kind, public scenario field, gameplay edit, archive edit, or native runtime change.

## 1. Context

Review 2 found two concrete defects:

1. `packages/playtest/src/runner/runner.ts` selects the entity with the largest displacement in
   an input-labelled interval. An entity falling, animating, or otherwise moving independently
   during that interval can therefore satisfy anonymous movement even when the game ignores the
   input. The current regression freezes its autonomous entity during the input interval and does
   not cover that false positive.
2. `packages/playtest/src/runner/androidRunner.ts` decides that a step is movement-driving from
   the previously held keys, then releases all keys when the step has no `press` field. A wait
   after a `release: false` step is consequently labelled input-driven even though native input
   has been released, so Android can accept autonomous motion that browser does not.

The contract is consumer-neutral: the runner may not learn a gameplay entity name or add an
assertion field. Anonymous movement must use the existing observed transforms and the existing
step input semantics.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | input-sensitive anonymous movement evidence | `packages/playtest/src/runner/runner.ts:167` via the standalone runner | active-interval-only largest-displacement selection | yes; anonymous movement requires input-on versus input-off contrast | an autonomous candidate moving during both intervals must not pass |
| 2 | effective held-input parity on device | `packages/playtest/src/runner/androidRunner.ts:180` via Android/iOS device playtests | release-on-omitted-`press` behavior that diverged from browser | yes; omitted `press` preserves the current held set | a wait after `release: false` must retain the same classification on device and browser |
| 3 | removal-sensitive runner/device regressions | `packages/playtest/src/runner/runner.ts:285` via `buildReport` | green-only movement and selector tests | yes; each defect has a declared red mutation | removing causal contrast or held-state parity makes focused tests exit 1 |

## 4. Execution Phases

### Phase 1: Input-sensitive anonymous movement

**Files (4):**

- `packages/playtest/src/runner/runner.ts` - EDIT: retain bounded input-on and input-off samples,
  require causal contrast for anonymous movement, and fail closed when it is unavailable
- `packages/playtest/src/runner/androidRunner.ts` - EDIT: classify steps from effective held input
  and keep the native sampling intervals aligned with the browser runner
- `packages/playtest/__tests__/runner.spec.ts` - EDIT: add responsive/autonomous contrast cases and
  removal-sensitive input regression
- `packages/playtest/__tests__/device-playtest.spec.ts` - EDIT: prove omitted-press held-state
  parity and the native causal movement control

**Implementation:**

- [ ] Replace active-interval-only anonymous selection with an input-on versus input-off contrast;
  no whole-scenario fallback remains for anonymous movement.
- [ ] Make a candidate that moves independently during the input interval and the no-input control
  interval fail, while a candidate whose displacement is input-sensitive passes.
- [ ] Make missing contrast fail through the existing movement assertion result rather than pass
  vacuously or infer causality from a gameplay name.
- [ ] Reconcile native held keys only when the scenario supplies a new held-key set; an omitted
  `press` field preserves the current held state just as the browser runner does.
- [ ] Ensure movement interval classification happens after effective input reconciliation and that
  release-only/no-input intervals are not tagged as input-driven.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `packages/playtest/src/runner/runner.ts:167` consumes the causal sample set.
- [ ] Registration: browser and Android/iOS runners continue using the same existing
  `assert.movement` contract; no new public field or protocol member is added.
- [ ] Old path: largest active-interval/whole-scenario selection is removed for anonymous movement.
- [ ] Ledger rows filled: #1, #2, and #3.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `packages/playtest/__tests__/runner.spec.ts` | `anonymous movement rejects concurrent autonomous motion` | an autonomous entity moving during both input-on and input-off intervals cannot satisfy anonymous movement | remove input-on/input-off contrast and rerun; `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: autonomous motion passed anonymous movement; exit: 1` |
| `packages/playtest/__tests__/runner.spec.ts` | `anonymous movement passes an input-sensitive candidate` | the candidate whose active displacement exceeds its no-input control passes | remove the candidate contrast or revert to largest active displacement; same command; `result: RED observed: input-sensitive movement proof was removed; exit: 1` |
| `packages/playtest/__tests__/device-playtest.spec.ts` | `device wait preserves held input classification` | an omitted-`press` step after `release: false` matches browser effective input state | restore release-on-omitted-`press`; `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts`; `result: RED observed: native wait classification diverged from browser; exit: 1` |
| `packages/playtest/__tests__/device-playtest.spec.ts` | `anonymous device movement keeps selector omission` | anonymous device samples still omit `entities` rather than sending an empty list | restore `entities: []`; same command; `result: RED observed: anonymous device selector regression passed after the contract was removed; exit: 1` |

**Revert check:**

- Remove the input-off contrast and restore largest active-interval selection. The autonomous
  candidate control must become green, proving the new runner contract is removal-sensitive.
- Restore Android's release-on-omitted-`press` loop. The device held-state regression must become
  red, proving the native parity fix is live.

**Verification Plan:**

- `pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts packages/playtest/__tests__/device-playtest.spec.ts`
- Run every declared mutation to red, restore the exact four-file patch, and rerun the focused suite.
- `pnpm typecheck && pnpm lint && pnpm test`
- `pnpm budgets`
- Confirm the worktree contains only the four allowed files and the commit is on the fresh lane
  branch based on `46187a8616f37b7deb16f32dfd8f67958692498b`.

**User Verification:**

- Action: run the focused runner/device suite from the repository root → Expected: a concurrent
  autonomous mover fails anonymous movement, an input-sensitive mover passes, and omitted-press
  device steps retain browser parity.

## 5. Required behavior

### 2.1 Input-sensitive anonymous movement

For an anonymous `assert.movement.minDistance`, a positive result must contain an input-on versus
input-off contrast for the selected observed entity. A transform that merely changes during a
step containing a key or pointer is insufficient.

- Capture bounded no-input control intervals around the movement-driving interval using the same
  browser/native observation protocol.
- Select a candidate only when its input-on displacement is distinguishable from its surrounding
  no-input displacement; a candidate that moves independently at the same rate must not satisfy
  the assertion.
- If the runner cannot establish that contrast, fail closed with the existing movement failure
  path. Do not fall back to largest whole-scenario displacement or largest active-interval
  displacement.
- Keep explicit `movement.entity` and `scenario.subject` behavior unchanged.
- Keep the existing browser/device omitted-selector request contract unchanged.

The exact internal sampling representation may change, but it must not add a public scenario or
assertion field. The direct regression must include both an input-responsive candidate and an
autonomous candidate that moves during the input interval; removing the input response must turn
the report red even when the autonomous candidate continues to move.

### 2.2 Browser/native step-state parity

Browser and Android/iOS must classify the same scenario step from the same effective held-input
state.

- A step with no `press` field is a wait/current-input step; it must not silently release keys
  that a preceding `release: false` step intentionally held.
- Movement sampling must be bracketed by the effective input state actually used for the advance,
  not by stale state from before step input reconciliation.
- A release-only or no-input interval must never be recorded as input-driven movement.
- Add a device-path regression for a held input followed by a no-`press` step and assert that the
  native movement evidence matches the browser classification.

## 6. Scope

Change only:

- `packages/playtest/src/runner/runner.ts`
- `packages/playtest/src/runner/androidRunner.ts`
- `packages/playtest/__tests__/runner.spec.ts`
- `packages/playtest/__tests__/device-playtest.spec.ts`

Do not edit this PRD, the previous repair PRD, benchmark archives, verification documents,
`packages/playtest/src/scenario.ts`, the protocol, or any package outside this list. Preserve the
honest committed archive evidence: the separate physics-puzzle replay remains `1/6` and is not a
claim of positive acceptance.

## Negative Controls

Every control must be run red, then restored before delivery.

| Gate | Negative control | Expected result | Exact command/result |
| --- | --- | --- | --- |
| causal movement | make the responsive candidate ignore input while an autonomous candidate moves during the input interval and the no-input control interval | anonymous movement fails; the autonomous candidate cannot be selected as proof | `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: autonomous motion passed anonymous movement; exit: 1` |
| contrast guard | remove the input-off comparison or revert to active-interval-only selection | the focused movement regression fails | `command: pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts`; `result: RED observed: input-sensitive movement proof was removed; exit: 1` |
| native held-state parity | restore Android's release-on-omitted-`press` behavior | the device step-state regression fails | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts`; `result: RED observed: native wait classification diverged from browser; exit: 1` |
| selector contract | restore `entities: []` for anonymous device samples | the existing anonymous selector regression fails | `command: pnpm exec vitest run packages/playtest/__tests__/device-playtest.spec.ts`; `result: RED observed: anonymous device selector regression passed after the contract was removed; exit: 1` |

Required green commands after all controls are restored:

```sh
pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts packages/playtest/__tests__/device-playtest.spec.ts
pnpm typecheck && pnpm lint && pnpm test
pnpm budgets
```

The final report must include exact focused counts, every observed-red exit/result, the four-file
scope check, the final commit SHA, and the full chained gate result. Do not claim that this repair
closes the separate committed physics-puzzle archive criterion.

## Acceptance Criteria

- [ ] Anonymous movement passes only with an observed input-on versus input-off contrast for the
  selected entity; active-interval displacement alone never proves causality.
- [ ] An autonomous entity moving during both the input and no-input intervals cannot satisfy the
  anonymous movement assertion, even if it has the largest active displacement.
- [ ] An input-sensitive candidate passes the anonymous movement assertion without a gameplay name,
  new assertion field, or protocol change.
- [ ] Missing causal contrast fails closed through the existing movement failure path.
- [ ] Browser and Android/iOS classify omitted-`press` steps from the same effective held-input
  state; a wait after `release: false` does not silently release native keys.
- [ ] Release-only and no-input intervals are never recorded as input-driven movement evidence.
- [ ] All declared red controls fail before restoration, then focused tests, the full chained gate,
  and budgets pass after restoration.
- [ ] Only the four scoped files change, and the separate physics-puzzle `1/6` archive evidence is
  preserved rather than relabeled.

## Checkpoint Protocol

After Phase 1, the reviewer must verify:

1. The exact four-file inventory is unchanged; a production runner file and both browser/native
   call paths are edited.
2. Anonymous movement has an input-on versus input-off contrast and no active-only fallback; the
   concurrent-autonomous-motion control is observed red after removing the contrast.
3. Android omitted-`press` behavior matches browser effective held state, and its mutation is
   observed red.
4. Anonymous selector omission remains intact; no public field, gameplay identifier, archive, or
   verification document was added or edited.
5. Every green gate has a restored-red control, exact exit/result, final commit, and clean scope;
   a green-only causality claim is UNVERIFIED and blocks delivery.
