# PRD-200 evaluator plumbing verification — 2026-08-23

## Scope

This lane single-sources the anti-vacuous evaluator guard, changes `buildReport` to
an options object, and dispatches movement evidence to per-kind evaluators. The
movement verdict fixture records the pre-refactor assertion and diagnostic
projections for fulfilled and empty evidence cases.

## Red controls observed

- Phase 1 baseline guard scan found 18 inline predicate matches before the helper
  existed. Reintroducing a duplicate predicate in `triviality-guard.ts` made the
  focused semantics spec fail:

  ```text
  AssertionError: expected [ { count: 2, path: "triviality-guard.ts" } ] to deeply equal [ { count: 1, path: "triviality-guard.ts" } ]
  Tests 1 failed | 11 passed
  ```

- Phase 2 transpose mutation kept TypeScript green but corrupted the direct report
  values: `before=[2,0,0]`, `after=[0,0,0]`, `distance=2`. After the options-object
  refactor, a positional mutation failed with:

  ```text
  src/runner/runner.ts(515,47): error TS2554: Expected 1 arguments, but got 6.
  ```

- Phase 3 dispatch mutation (`contacts` routed to the settled evaluator) made the
  focused scenario spec fail:

  ```text
  RED observed: assertion family result missing for 'contacts'
  ```

- Final guard scan returned `1`; the only predicate is in
  `packages/playtest/src/triviality-guard.ts`. The positional `buildReport` scan
  returned `No positional buildReport callers`.

## Golden verdicts and playtests

- The focused evaluator and scenario specs passed, including an empty golden diff
  for the byte-identical fulfilled and empty movement-evidence projections:

  ```text
  JSON.stringify(projectMovement(fulfilled)) === JSON.stringify(golden.fulfilled)
  JSON.stringify(projectMovement(empty)) === JSON.stringify(golden.empty)
  diff: empty
  ```
- `pnpm test:playtest` passed all four browser scenarios, including movement,
  camera, axis movement, and navigation-around-blocker report generation.
- `pnpm test:templates` completed with all scaffolded template playtests passed.
- `pnpm test` passed: 198 test files and 1,884 tests.

## Other gates

- `pnpm typecheck` passed.
- `pnpm lint` exited 0 with 295 inherited complexity warnings.
- `pnpm budgets` exited 0; it reported existing framework LOC and native census
  drift but no budget failure.
- `pnpm quality` exited 0: 68 findings (11 new, 9 grew, 48 inherited, 0 waived).
- Meaningful nonblank/non-comment LOC across the touched production, test, and
  fixture paths decreased from 11,500 to 11,492 (-8), excluding this evidence
  record.
