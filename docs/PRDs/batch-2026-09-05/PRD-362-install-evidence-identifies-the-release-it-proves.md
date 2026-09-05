---
prd_contract: v1
---

# PRD-362 — Install evidence identifies the release it proves

**Status:** PROPOSED
**Priority:** 3 — start today; complete before declaring the next release installable.
**Complexity:** 2 (6–10 files) = **2 → LOW mode**.
**Estimate:** 3–5 engineering hours, plus registry and native proof execution.
**Owner layer:** repository release verification. Sequence after PRD-361 for the shared caller.

## Problem and evidence

Today's `pnpm alpha:bar` accepts A2 from `registry-install-2026-08-16.md`, describing
`create-threenative@0.2.2`. Meanwhile the existing registry verifier invokes
`npm create threenative@latest` (`scripts/verify-registry-install.ts:401`). Neither the evidence
model nor the invocation proves that the version intended by the current release is the one tested.
This does not prove the current installer is broken; it proves A2 cannot establish its identity.

Inspected: `scripts/alpha-bar.ts:136` through `evidenceRow`, `scripts/verify-registry-install.ts`,
`scripts/release.ts`, their three unit suites, and `docs/verification/alpha-bar.md`.
Evidence blocks contain row, status, source and detail; A2 selects blocks by row, reconciles statuses,
then orders filenames. There is no structured release subject or installed-version comparison.

The existing [PRD-120](../done/PRD-120-the-alpha-bar-is-runnable.md) owns the runnable bar;
[PRD-119](../done/PRD-119-the-alpha-release-train.md) owns publication. This is a narrow identity
repair. No evidence-expiration policy, new release service, or changes to A3–A6 semantics.

## Solution and integration ledger

Pass the expected scaffolder version and publish-set identity from the existing release caller to
the registry verifier. Scaffold that exact version, inspect the generated project's installed
first-party versions, and retain lockfile registry checks. Produce a structured report that A2
validates against the current target before accepting a status. Historical runs remain historical.

| New thing | Live caller / intended wiring | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- |
| Explicit registry install target | `scripts/release.ts` → `scripts/verify-registry-install.ts:401` | Unqualified `latest` in release verification | Replace in phase 1 | Registry latest differs; exact intended version still requested |
| Installed subject report | Existing registry runner after install and before successful return | Human detail string as identity | Delegate to measured report in phase 1 | Lockfile has different first-party version: fail |
| Subject-aware A2 | `scripts/alpha-bar.ts` → existing `evidenceRow` call for A2 | Row-only historical pass | Replace only A2 grading in phase 2 | Change target version: old pass becomes unmeasured |

Final caller anchors are filled during implementation. No new product UI: output appears in the
existing release and alpha commands. Data: A2 evidence references a JSON report containing target
scaffolder version, intended publish-set name/version map, actual installed first-party versions,
registry resolution/integrity information, executed step outcomes and source commit if available.
The report must distinguish publish-set packages from those actually exercised by this template;
it must not claim the starter imports every optional tooling package.

## Phase 1 — The registry consumer proves its intended version

Files (4, existing): `scripts/verify-registry-install.ts`,
`scripts/__tests__/verify-registry-install.spec.ts`, `scripts/release.ts`,
`scripts/__tests__/release.spec.ts`.

1. Write a red test where the requested release differs from `latest`; assert exact scaffolder
   invocation and the actual installed first-party dependency identity, using the existing runner seam.
2. Add explicit expected-target input to the existing verifier and wire the release's version map
   into it. Standalone execution derives a documented target from the workspace; it must not silently
   fall back to latest when a target is missing or malformed.
3. Measure the installed dependency graph and emit the structured report before owned temp cleanup.
   Compare only actually installed first-party packages against the intended map, while recording
   unexercised publish-set packages separately. Preserve all existing build/test/doctor/native/MCP steps.
4. Test wrong version, missing identity, local specifier and failed required step. Reverting explicit
   version invocation or installed-version comparison must make the corresponding test fail.

Command: `pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts scripts/__tests__/release.spec.ts`.
An independent reviewer verifies that production `main` actually invokes the changed verifier.

## Phase 2 — A2 cannot reuse proof for another release

Files (5): EDIT `scripts/alpha-bar.ts`, `scripts/__tests__/alpha-bar.spec.ts`,
`docs/verification/alpha-bar.md`; NEW `docs/verification/registry-install-2026-09-05.md` and
`docs/verification/registry-install-2026-09-05.json` when an actual run produces evidence.

1. Require a resolvable report and matching target identity for A2. Missing/legacy/mismatched reports
   become unmeasured with a concrete rerun action. A measured failed current-target run stays failed.
2. Reconcile conflicting statuses only within the same target. Old releases neither rescue nor
   poison the current result. A matching target with contradictory runs remains unmeasured.
3. Run the real registry verifier against the explicit target and retain actual outputs. If target
   artifacts or native prerequisites are absent, record the failure and leave A2 non-green; do not
   publish as part of this PRD or mark the live-proof criterion complete using mocked execution.
4. Regenerate the alpha table. Preserve the August record unchanged. Run the focused suites and
   prove changing only the target version invalidates yesterday's otherwise passing report.

Command: `pnpm exec vitest run scripts/__tests__/alpha-bar.spec.ts scripts/__tests__/verify-registry-install.spec.ts`.
Negative controls: remove the report; alter its installed version; restore the old row-only A2
selection. Each must invalidate the appropriate test. No invented green report is acceptance evidence.

## Completion

- [ ] The live release verifier names and measures the exact release it was asked to verify.
- [ ] A2 rejects absent or mismatched identity, accepts a measured matching success, and preserves failures.
- [ ] A real registry run proves the intended consumer, including existing required native steps;
  absent published versions or native evidence keep this criterion open.
- [ ] Final integration anchors, observed negative controls and independent phase reviews are recorded.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` ran successfully with outputs linked here.

Next action (under 2 minutes): compare the A2 subject in `docs/verification/alpha-bar.md` with the
scaffolder invocation at `scripts/verify-registry-install.ts:401`.
