# PRD-202 guard-closure follow-up — 2026-08-24

Parent lane: `dcd77db3017bde3da80d340fae193655f5b89ed3`
Follow-up branch: `linchpin/prd-202-guard-closure`

This follow-up repairs only the runner duplication guard and its focused regression evidence. The
parent PRD and its browser/native-unverified platform evidence are unchanged; this record makes no
new platform-execution claim.

## Red-first control against the old guard

The new control used a synthetic `synthetic-runner.ts` containing both a `const` arrow duplicate
and a `let` arrow duplicate. The old selected-file, function-declaration-only guard saw only
`shared.ts`:

```text
$ pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts -t "runner helper guard detects an arrow duplicate in a new runner file"

❯ packages/playtest/__tests__/runner-lanes.spec.ts (13 tests | 1 failed | 12 skipped)
× runner helper guard detects an arrow duplicate in a new runner file
AssertionError: expected [ 'shared.ts' ] to deeply equal [ 'shared.ts', 'synthetic-runner.ts' ]
```

## Repair

The guard now discovers every direct `.ts` file under `packages/playtest/src/runner/`, parses
function declarations and `const`/`let` arrow-function assignments with the TypeScript AST, and
requires each intended shared helper to have exactly one implementation. Its failure text includes
the helper name and all implementation filenames. The synthetic control also includes an import,
ordinary call, and comment so those references are not counted.

## Green evidence

```text
$ pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts packages/playtest/__tests__/runner-orchestration.spec.ts
Test Files  2 passed (2)
Tests       19 passed (19)

$ pnpm --filter @threenative/playtest build
ESM Build success
DTS Build success
publint: All good!

$ pnpm --filter @threenative/playtest typecheck
exit 0

$ pnpm typecheck
Scope: 16 of 17 workspace projects
all workspace typechecks: Done

$ pnpm lint
exit 0; Found 295 existing warnings.

$ pnpm test
Test Files  199 passed (199)
Tests       1,896 passed (1,896)

$ pnpm exec vitest run packages/playtest/__tests__/runner-lanes.spec.ts -t "runner helper guard detects an arrow duplicate in a new runner file"
Test Files  1 passed (1)
Tests       1 passed (1)

$ git diff --check
exit 0
```

No native platform execution was performed for this guard-only follow-up.
