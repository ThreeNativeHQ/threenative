---
prd_contract: v1
---

# PRD-116 repair: make the budgets command consume its native census

**Status:** OPEN

Complexity: 1 → LOW mode.

The first PRD-116 repair made the evidence assertion removal-sensitive only when paired with a
Vitest command. Review 2 rejected that boundary: the declared `pnpm budgets` negative control
must itself fail when the native LOC census in the verification record is stale or incomplete.
This repair widens the implementation scope to the budget producer, its tests, and the existing
verification record.

## Context

The native runtime kill switch is measured by `scripts/check-budgets.ts`, while the current area
census is recorded in `docs/verification/PRD-116-native-physics-actuation.md`. Today the budget
command measures source files but does not read that record, so deleting a census row leaves
`pnpm budgets` green. The previous repair's physics Vitest assertion catches the mismatch only in
a separate command and does not satisfy the exact declared control.

## Solution

- Make the `pnpm budgets` entry point parse the existing native census when it is present.
- Require the census row sum and recorded total to equal the measured native runtime LOC before
  the command prints its success line.
- Keep temporary/fixture budget roots without the production verification record valid; only the
  repository's existing record is a required consumer of this contract.
- Add focused red/green tests for an omitted row and a stale total, without changing the native
  LOC threshold or hiding its warning.

No API, package, schema, or platform surface changes.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | Removal-sensitive native census validation in the budgets command | `scripts/check-budgets.ts:329` via the `pnpm budgets` entry point | source-only native LOC measurement that ignored the verification census | yes; the command now consumes the existing record before reporting success | omit one census row and run `pnpm budgets`; it exits 1 |
| 2 | Regression coverage for the exact budgets consumer | `scripts/check-budgets.ts:329` is exercised by the repository command; focused tests call the same enforcement path | manual-only census assertion in the physics suite | yes; the required command owns the failure | change the recorded total and run `pnpm budgets`; it exits 1 |

## 4. Execution Phases

### Phase 1: Budgets consume the native census - `pnpm budgets` rejects stale evidence

**Files (3):**

- `scripts/check-budgets.ts` - EDIT: parse the existing native census and include reconciliation errors in the `pnpm budgets` enforcement path
- `scripts/__tests__/budgets.spec.ts` - EDIT: prove omitted rows and stale totals fail the same enforcement path, with restored-green coverage
- `docs/verification/PRD-116-native-physics-actuation.md` - EDIT: keep the current census/table and gate wording aligned with the command that consumes it

**Implementation:**

- [ ] Add a repository-relative verification-record lookup that is optional for synthetic fixture
  roots and required when the record exists in the real workspace.
- [ ] Parse every counted-area row and the record total; compare their sum with measured
  `nativeRuntimeLoc` and return an actionable budget error on any mismatch.
- [ ] Route the new error through `enforceBudgets`, which is the `pnpm budgets` entry point, while
  preserving the 50,000 warning as a non-fatal review trigger.
- [ ] Add tests that remove a row and alter the total, observe the exact command fail, restore the
  record, and observe the command pass.

**Wiring (the phase is not done without this):**

- [ ] Caller edited: `scripts/check-budgets.ts:329` enforces census reconciliation before success.
- [ ] Registration: the existing root `package.json` `budgets` script continues to invoke
  `tsx scripts/check-budgets.ts`; no new command is added.
- [ ] Old path: the separate manual-only kill-switch proof is superseded by the budgets command;
  the existing physics assertion may remain as defense-in-depth.
- [ ] Ledger rows filled: #1 and #2.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `scripts/__tests__/budgets.spec.ts` | `should reject an incomplete native census when enforcing budgets` | an omitted area row makes `pnpm budgets` exit 1 with a census mismatch | omit `vitest.config.ts` from the real record; `command: pnpm budgets`; `result: RED observed: native census sum no longer equals measured native runtime LOC; exit: 1` |
| `scripts/__tests__/budgets.spec.ts` | `should reject a stale native census total when enforcing budgets` | a changed record total makes `pnpm budgets` exit 1 with a total mismatch | change `70,845` to `70,844`; `command: pnpm budgets`; `result: RED observed: recorded native census total disagrees with measured native runtime LOC; exit: 1` |
| `scripts/__tests__/budgets.spec.ts` | `should pass the restored native census` | the unchanged record passes and the 50,000 trigger remains visible | disable census validation; `command: pnpm exec vitest run scripts/__tests__/budgets.spec.ts`; `result: RED observed: the removal-sensitive budget contract test no longer detects stale census evidence; exit: 1` |

**Revert check:**

- Remove the census reconciliation from `enforceBudgets` and rerun the omitted-row control. The
  exact `pnpm budgets` command must return to green, proving the pre-existing command did not
  enforce the evidence contract.

**Verification Plan:**

- `pnpm exec vitest run scripts/__tests__/budgets.spec.ts`
- `pnpm budgets`
- `pnpm typecheck && pnpm lint && pnpm test`
- Run the omitted-row and stale-total mutations against the real verification record, capture the
  exact red commands, restore the record, and rerun all green commands.
- Confirm the caller census points to `scripts/check-budgets.ts` and the 50,000 trigger remains
  visible in the output.

**User Verification:**

- Action: run `pnpm budgets` from the repository root → Expected: the command reports the measured
  native LOC and succeeds only when the existing PRD-116 area census reconciles exactly.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| budgets census consumer | omit one counted area from the existing native census | the exact budgets command detects that the evidence no longer reconciles | `command: pnpm budgets`; `result: RED observed: native census sum no longer equals measured native runtime LOC; exit: 1` |
| budgets total consumer | change the recorded total without changing source files | the exact budgets command detects stale recorded evidence | `command: pnpm budgets`; `result: RED observed: recorded native census total disagrees with measured native runtime LOC; exit: 1` |
| focused contract tests | remove the new reconciliation assertion | the focused tests lose their removal-sensitive proof | `command: pnpm exec vitest run scripts/__tests__/budgets.spec.ts`; `result: RED observed: stale census control passed after the enforcement assertion was removed; exit: 1` |
| repository gates | restore baseline budget-only enforcement | the full repository gate no longer catches stale PRD-116 evidence | `command: pnpm typecheck && pnpm lint && pnpm test`; `result: RED observed: the committed budget-consumer regression is absent; exit: 1` |

## Acceptance Criteria

- [ ] Running `pnpm budgets` against the current repository record succeeds and reports the
  measured native runtime LOC.
- [ ] Omitting any counted native area makes the exact `pnpm budgets` command exit non-zero before
  reporting `budgets ok`.
- [ ] Changing the recorded total while leaving source files untouched makes the exact
  `pnpm budgets` command exit non-zero.
- [ ] Synthetic budget fixtures without the production verification record remain usable in the
  existing unit suite.
- [ ] The 50,000 native LOC trigger remains unchanged and visible; its warning stays non-fatal.
- [ ] Caller census identifies `scripts/check-budgets.ts` as the live consumer, and the old
  source-only command path is gone.
- [ ] Focused tests, `pnpm budgets`, and `pnpm typecheck && pnpm lint && pnpm test` pass after all
  controls are restored.

## Checkpoint Protocol

After Phase 1, the reviewer must verify:

1. The exact three-file inventory is unchanged and `scripts/check-budgets.ts` is an existing
   production file edited by the phase.
2. The `pnpm budgets` process, not only a separate Vitest command, reads the existing census and
   fails on both an omitted row and a stale total.
3. The real record is restored before green gates; synthetic roots without the record still pass
   their existing tests.
4. `LIMITS.nativeRuntimeLoc` remains `50_000`, its warning remains visible, and no platform claim
   is added.
5. The caller census and revert check are recorded with exact commands and observed-red output;
   a green-only control is UNVERIFIED and blocks delivery.

## Verification Evidence

Contract conformance: prd_contract: v1

Worker and reviewer must append exact command output, observed-red controls, the final commit,
and the restored-green gate results here. Until then this PRD remains OPEN.
