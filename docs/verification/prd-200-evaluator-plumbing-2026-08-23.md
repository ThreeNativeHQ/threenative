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

## Repair round 1 — review findings closed

- The physical LOC calculation was rerun against the staged repaired tree with the
  verification record excluded:

  ```text
  $ git diff --cached --numstat edbee19fe90c672305568764b98e36620c507e9^ -- ':!docs/verification/prd-200-evaluator-plumbing-2026-08-23.md' | awk 'BEGIN{a=0;d=0;srca=0;srcd=0} {a+=$1;d+=$2;if ($3 ~ /^packages\/playtest\/src\//) {srca+=$1;srcd+=$2}} END{printf "physical LOC excluding verification record: additions=%d deletions=%d net=%d\n",a,d,a-d; printf "packages/playtest/src: additions=%d deletions=%d net=%d\n",srca,srcd,srca-srcd}'
  physical LOC excluding verification record: additions=987 deletions=988 net=-1
  packages/playtest/src: additions=704 deletions=716 net=-12
  ```

- Full pre/post serialized-verdict parity was rerun with the fixture generated from
  `edbee19fe90c672305568764b98e36620c507e9^`:

  ```text
  $ pnpm exec vitest run packages/playtest/__tests__/evaluator-semantics.spec.ts -t 'pre/post serialized verdicts'
  PRD-200 verdict parity: 512 scenarios; diff: empty
  Test Files 1 passed (1)
  Tests 1 passed (1)
  ```

  The test enumerates the same `rg --files -g '*.playtest.json' -g '!**/.worktrees/**'`
  inventory, requires all 512 paths in the fixture, and compares the complete
  serialized `{ assertions, diagnostics }` projection byte-for-byte.

- Focused evaluator/scenario specs after the repair: `pnpm exec vitest run
  packages/playtest/__tests__/evaluator-semantics.spec.ts
  packages/playtest/__tests__/runner-orchestration.spec.ts
  packages/playtest/__tests__/runner.spec.ts
  packages/playtest/__tests__/scenario.spec.ts
  packages/playtest/__tests__/setup-reporting.spec.ts` — exit 0, 5 files and 123
  tests passed. The earlier red mutation evidence above remains unchanged.
- The package gate was rerun alone after a concurrent first attempt observed a
  temporary-directory race: `pnpm --filter @threenative/playtest test` — exit 0,
  no orphans and publint passed. The package build also passed with
  `pnpm --filter @threenative/playtest build`.

## Required repair gates

- `pnpm typecheck` — exit 0; all 16 participating workspace projects passed.
- `pnpm lint` — exit 0; 295 inherited complexity warnings, no errors.
- `pnpm budgets` — exit 0; capability docs, generated references, and budgets passed;
  existing framework LOC and native census notices remained informational.
- `pnpm quality` — exit 0; 68 findings (11 new, 9 grew, 48 inherited, 0 waived).
- `pnpm test:playtest` — exit 0; all four browser scenarios passed with
  `pass: true`, NVIDIA WebGPU adapter evidence, and no assertion failures.
