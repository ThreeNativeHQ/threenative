---
prd_contract: v1
---

# PRD-114 repair — Published diagnostics and archived dependency resolution must match raw evidence

**Status: COMPLETE, 2026-08-15.** Implemented in `39c2d14` and integrated on the production
readiness branch; the review-2 blocker on the capped lane is closed.
`linchpin/prd-114-paired-round-on-the-repaired-instrument-r2` at `a042641`. The measured round
remains VOID; this repair does not rerun builders or promote a comparison.

**Complexity: 1 → LOW mode.** Five existing files in documentation and scripts; no new module,
package, public vocabulary, game code, or benchmark claim.

**Exact review-2 defects.** The two round-7 documents reverse the committed arms' diagnostics
outcomes, and `scripts/sweep-archive.ts:113` recognizes only `from "../sibling"` imports. A root
sibling used solely by `import "../threenative.config.js"` can still be omitted while
`assertArchiveResolves` reports green.

## 1. Context

**Problem.** The raw committed reports are authoritative:

- Framework `docs/benchmark/sweeps/physics-puzzle-2026-08-15-4/proof.json` records world seed
  `90210` versus expected `6132` (fail) and zero console/network/runtime diagnostics (diagnostics
  pass) in both scenarios.
- Vanilla `docs/benchmark/sweeps/physics-puzzle-2026-08-15-3/proof.json` records world seed `6132`
  (pass) and one console plus one runtime diagnostic (diagnostics fail) in both scenarios.

Baseline `round-7-2026-08-15.md:37-40` and
`score-physics-puzzle-round-7-2026-08-15.md:24-27` state the reverse. The overall paired result is
still VOID because neither archive is a fresh paired builder output and both sealed scenarios fail.

The archive guard introduced in the lane is also syntactically incomplete. Its regular expression
matches `import x from "../x"`, but not a side-effect-only ESM dependency. A source file can depend
on a missing root sibling without binding a symbol, and that project will fail to boot after archive.

**Files analyzed.**

- `a042641:docs/verification/round-7-2026-08-15.md`
- `a042641:docs/verification/score-physics-puzzle-round-7-2026-08-15.md`
- both committed round-7 `proof.json` files and their runner reports
- `a042641:scripts/sweep-archive.ts:98-133`
- `a042641:scripts/__tests__/sweep-archive.spec.ts:152-165`

## 2. Solution

Correct only the framework/vanilla seed and diagnostics sentences from the raw files; preserve all
cost figures, archive identities, failed proof counts, limitations, and the VOID conclusion.

Extend the existing relative-import extraction inside `assertArchiveResolves` to recognize both
bound `from` imports and side-effect imports, with single or double quotes. Keep its current scope:
authored `src/` files, `../` relative specifiers, and existing TypeScript `.js` candidate mapping.
Do not turn this repair into a general JavaScript parser or dynamic-import feature.

**Data changes:** none. Existing evidence files are corrected, not regenerated.

## 3. Integration points

**Reachability.** `archiveSandbox` calls `assertArchiveResolves` after copying the project shell and
before returning the archive path. `pnpm sweep:archive` is the live CLI consumer. The round ledger
and score document are consumed by `pnpm round:next`, `pnpm round:deletions`, and human review.

**Caller census (paste during implementation):**

```sh
rg -n "assertArchiveResolves\(|archiveSandbox\(" scripts package.json -g '*.ts' -g '*.json'
rg -n "round-7-2026-08-15|score-physics-puzzle-round-7" \
  scripts docs/verification -g '*.ts' -g '*.md'
```

Expected: the archive guard is reached by `archiveSandbox`, and no second dependency-resolution
guard competes with it.

**Revert check.** Restore the `from`-only matcher; the side-effect missing-sibling fixture archives
successfully, so its regression test fails. Restore either reversed evidence sentence; a focused
document assertion against committed `proof.json` fails.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | corrected framework/vanilla diagnostics record | `scripts/round-next.ts:91` | reversed prose at baseline docs | yes | document test derives expected seed/diagnostics from committed proofs |
| 2 | side-effect relative import extraction | `scripts/sweep-archive.ts:225` | `from`-only extraction | yes | missing `../threenative.config.js` side-effect import rejects archive and removes partial output |
| 3 | retained VOID verdict | `scripts/round-deletions.ts:70` | no replacement | n/a | any promotion to win/loss contradicts recorded stop condition and fails review |

## 4. Execution Phases

### Phase 1: Published arm outcomes match committed proof data

**User-testable vertical slice.** A reader can trace each round-7 seed and diagnostics statement to
the corresponding committed `proof.json` without encountering an arm reversal.

**Files (3):**

- `docs/verification/round-7-2026-08-15.md` — EDIT: framework seed fail/diagnostics pass; vanilla
  seed pass/diagnostics fail; preserve VOID.
- `docs/verification/score-physics-puzzle-round-7-2026-08-15.md` — EDIT: make the same correction
  in the functional narrative; preserve measured cost and limitations.
- `scripts/__tests__/round-ledger.spec.ts` — EDIT: derive the two arms' seed and diagnostics
  outcomes from committed `proof.json` and require both published documents to agree.

**Implementation.**

1. Read values directly from both committed `proof.json` files; do not infer from prose.
2. State that both arms still fail their sealed scenarios for other rows.
3. Leave proof counts, hashes, LOC/byte deltas, archive paths, and VOID verdict unchanged unless a
   raw-file comparison proves another transcription error.
4. Extend the existing round-ledger test home with a focused assertion that parses the raw files
   and checks both documents, including their retained VOID verdict; do not duplicate the proof
   facts in a new production module.

**Verification command:**

```sh
node -e 'const fs=require("node:fs"); for (const p of ["docs/benchmark/sweeps/physics-puzzle-2026-08-15-4/proof.json","docs/benchmark/sweeps/physics-puzzle-2026-08-15-3/proof.json"]) { const v=JSON.parse(fs.readFileSync(p,"utf8")); console.log(p, v.scenarios.map(s=>s.assertions.filter(a=>a.id==="world.seed"||a.id==="diagnostics").map(a=>[a.id,a.pass]))); }'
pnpm exec vitest run scripts/__tests__/round-ledger.spec.ts
```

**Revert check:** swap the two derived outcome summaries in either document; the focused
round-ledger test reports the mismatch against committed raw data.

### Phase 2: Side-effect imports participate in archive resolution

**User-testable vertical slice.** Archiving a project whose source executes
`import "../threenative.config.js"` succeeds only when the sibling is present; removing it rejects
the archive and deletes the partial destination.

**Files (2):**

- `scripts/sweep-archive.ts` — EDIT: recognize side-effect and `from` relative imports with both
  quote styles in the existing resolver.
- `scripts/__tests__/sweep-archive.spec.ts` — EDIT: add the side-effect missing-sibling red control
  and a present-sibling positive case through `archiveSandbox`.

**Implementation.**

1. Extract `../` specifiers from static import declarations only; preserve the existing resolution
   boundary and candidate list.
2. Test the exact side-effect syntax from review 2.
3. Assert error text names `src/main.ts -> ../threenative.config.js` and the archive root remains
   empty after rejection.
4. Retain the existing bound-import regression so neither syntax replaces the other.

**Focused gate:**

```sh
pnpm exec vitest run scripts/__tests__/sweep-archive.spec.ts
```

**Revert check:** restore the baseline matcher; the new side-effect fixture incorrectly archives,
and the test expecting rejection fails.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
| --- | --- | --- | --- |
| evidence transcription | temporarily swap the framework/vanilla expected summaries | the raw-backed document check detects the committed proof mismatch | `command: pnpm exec vitest run scripts/__tests__/round-ledger.spec.ts`; result: RED observed: published diagnostics outcome disagreed with committed proof.json; exit: 1 |
| side-effect dependency | remove the root sibling from a fixture using `import "../threenative.config.js"` | archive throws and leaves no destination | `command: pnpm exec vitest run scripts/__tests__/sweep-archive.spec.ts`; result: RED observed: missing side-effect sibling was not rejected and a partial archive remained; exit: 1 |
| syntax retention | remove bound-import extraction while keeping side-effect extraction | the existing bound-import regression fails | `command: pnpm exec vitest run scripts/__tests__/sweep-archive.spec.ts`; result: RED observed: bound relative import was no longer resolved by the archive guard; exit: 1 |
| VOID preservation | temporarily label the paired result win/loss | the round-ledger test rejects promotion because no fresh pair exists | `command: pnpm exec vitest run scripts/__tests__/round-ledger.spec.ts`; result: RED observed: VOID paired-round conclusion was replaced by an unsupported win/loss label; exit: 1 |

## Acceptance Criteria

**Consumer-scoped acceptance.** Round readers and archive consumers must receive the following
correct results; corrected prose or resolver code that is not exercised is insufficient.

- [x] Both verification documents say framework seed fail/diagnostics pass and vanilla seed
  pass/diagnostics fail, exactly matching committed `proof.json` assertion rows.
- [x] The round remains VOID; no functional, visual, parity, fresh-builder, native, or deletion
  conclusion is promoted.
- [x] `archiveSandbox` rejects a missing sibling referenced only by a static side-effect relative
  import, names the source/specifier, and removes the partial archive.
- [x] Present siblings, bound imports, single quotes, and double quotes retain coverage.
- [x] Caller census and revert checks show the guard is live in `pnpm sweep:archive`.
- [x] Focused tests and `pnpm typecheck && pnpm lint && pnpm test` pass after controls are restored.

## Verification Evidence

Contract conformance: prd_contract: v1

Completed evidence: `39c2d14` aligns the raw diagnostics outcomes, adds the side-effect sibling
resolver guard, and adds six round-ledger regression tests plus archive fixtures. The focused
archive suite passed 12/12 and the round-ledger suite passed 6/6; the paired round remains VOID,
with no fresh-builder, native, or deletion claim.

## Checkpoint Protocol

After each phase, the reviewer must verify:

1. Only the phase's exact file inventory changed and every file was pre-existing.
2. Integration Ledger callers are filled with real non-test `file:line` values.
3. Raw evidence, caller census, and revert check are pasted rather than summarized.
4. Each gate was observed red as specified, then restored green.
5. Cost numbers, hashes, archive identities, and the VOID conclusion did not drift.

Any evidence regeneration, fresh-round claim, source-PRD edit, generated `CLAUDE.md` edit,
dynamic-import scope expansion, or surviving side-effect blind spot is checkpoint FAIL.
