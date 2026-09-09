# PRD-078 phase 1 — exact candidate release prerequisite

**Evidence date:** 2026-09-08

**Base:** `27c0ce773855085ba879289d3f4f3e8f62851228` (`main`, PRD-196 squash merge)

**Implementation source under test:** the PRD-078 lane tip after the phase-1 change; the
workflow caller is [`.github/workflows/native-release.yml`](../../.github/workflows/native-release.yml)
lines 48–72.

**Host:** Linux x86_64, Node `v20.19.6`, pnpm `10.25.0`.

**Status:** IMPLEMENTED LOCALLY / HOSTED CANDIDATE PENDING. The release gate now refuses stale or
missing CI evidence, but this phase has not published a runtime release or claimed a green
`native-release.yml` run.

## Change and caller

The `gates` job still uses the existing `gh run list` entry point. It now requests the run's
`databaseId` and `headSha`, requires a completed successful push run on `main` whose `headSha`
equals `GITHUB_SHA`, and prints the exact run ID used. A GitHub CLI result that is stale, empty,
malformed, or missing its identity fails closed before any native build starts.

The packed Android physics subject and its four controls remain in the existing release workflow:
`physics.playtest.json`, `physics-wrong-height.playtest.json`, `physics-mask.playtest.json`, and
the wrong-gravity control. No release, tag, or public artifact was created by this phase.

## Red then green

The red test was added before the workflow edit. Against the previous gate, it failed because the
workflow did not request the exact run identity:

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t "release gate rejects stale or missing exact candidate CI evidence"

FAIL tests/native-platform-workflow.test.mjs > release gate rejects stale or missing exact candidate CI evidence
AssertionError: expected ... to contain '--json databaseId,status,conclusion,event,headBranch,headSha'

Test Files  1 failed (1)
Tests  1 failed | 14 skipped (15)
EXIT_CODE=1
```

The restored workflow was then executed by the same test with three fake GitHub CLI responses:
one exact successful run, one successful run with a different `headSha`, and an empty result. The
exact run passed; both stale and missing cases exited nonzero and named the candidate SHA.

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t "release gate rejects stale or missing exact candidate CI evidence"

Test Files  1 passed (1)
Tests  1 passed | 14 skipped (15)
EXIT_CODE=0
```

The full affected workflow contract is also green:

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs

Test Files  1 passed (1)
Tests  15 passed (15)
EXIT_CODE=0
```

The workflow edit also replaced an older structural assertion that still expected the previous
`jq` expression. That stale assertion was the red control after the workflow change:

```text
pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts -t "requires native release CI to be a successful push on main"

FAIL ... > requires native release CI to be a successful push on main
AssertionError: expected ... to match /\.event == "push"/
Test Files 1 failed (1)
Tests 1 failed | 82 skipped (83)
EXIT_CODE=1
```

Updating the structural check to assert the JSON fields and exact `headSha`/`databaseId` guard made
the red control green, and the complete strict local lane passed:

```text
pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts scripts/__tests__/evidence-budget.spec.ts scripts/__tests__/evidence-citations.spec.ts scripts/__tests__/sync-agent-docs.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts

Test Files 6 passed (6)
Tests 137 passed (137)
EXIT_CODE=0
```

The repository-wide local gates passed after refreshing the generated native coverage and census:
`pnpm check:docs` (1,737 links / 1,018 Markdown files), `pnpm budgets`, `pnpm typecheck` (28 of
29 workspace projects), `pnpm lint` (658 existing warnings), and `pnpm quality` (139 report-only
findings). `pnpm test` was also run; it reached 101 passing runtime-native test files and 844
passing tests, but its four native contract files reported eight missing opt-in test executables
(`threenative-crash-handler-policy-test`, `threenative-rg11b10-renderable-test`,
`threenative-timestamp-query-test`, and the QuickJS scheduler host). That local result does not
award a full-suite pass or a hosted release claim.

## Review repair

The independent review found that tracking this evidence file made the retention index stale, and
that a malformed `databaseId` could pass the shell gate. The red executable control was:

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs -t "release gate rejects stale or missing exact candidate CI evidence"

FAIL ... > release gate rejects stale or missing exact candidate CI evidence
AssertionError: expected +0 not to be +0
Test Files 1 failed (1)
Tests 1 failed | 14 skipped (15)
EXIT_CODE=1
```

The gate now requires `Number.isSafeInteger(databaseId)` and `databaseId > 0`; the test exercises
null, missing, string, zero, negative, and fractional IDs, alongside the exact, stale, and empty
responses. The same red command is green after the fix:

```text
Test Files 1 passed (1)
Tests 1 passed | 14 skipped (15)
EXIT_CODE=0
```

The retention index was regenerated after the evidence file became tracked. The final local
`pnpm budgets` run and the strict workflow/docs lane were rerun against this state.

## CI repair

The first PR run exposed one branch-owned unit-shard failure. The repository leak guard found the
workflow test's direct temporary-directory creator:

```text
scripts/__tests__/temp-dir-guard.spec.ts > temporary directory guard > requires every test-owned temporary directory to register cleanup
AssertionError: unregistered temporary directory creators: [
  "packages/runtime-native/tests/native-platform-workflow.test.mjs"
]
Test Files 1 failed | 136 passed (137)
Tests 1 failed | 1720 passed | 8 skipped (1729)
Process completed with exit code 1
```

The test now uses the repository's `makeTempDirSync` helper, which registers the directory with
the Vitest cleanup guard. The focused controls are green after the repair:

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs
Test Files 1 passed (1)
Tests 15 passed (15)

pnpm exec vitest run scripts/__tests__/temp-dir-guard.spec.ts
Test Files 1 passed (1)
Tests 1 passed (1)
```

## Candidate identity boundary

The first current-main CI push run completed with a failure and is not a release prerequisite:

```text
gh run view 34319158297 --repo ThreeNativeHQ/threenative --json databaseId,status,conclusion,event,headBranch,headSha,createdAt,updatedAt,workflowName,url

{"conclusion":"failure","createdAt":"2026-09-09T06:27:42Z","databaseId":34319158297,"event":"push","headBranch":"main","headSha":"27c0ce773855085ba879289d3f4f3e8f62851228","status":"completed","updatedAt":"2026-09-09T06:36:11Z","url":"https://github.com/ThreeNativeHQ/threenative/actions/runs/34319158297","workflowName":"CI"}
```

The failed jobs were `test-playtest` and `test-unit (3/3)`; the latter's recorded failure was the
pre-existing timing assertion in `packages/assets/__tests__/watch.spec.ts` (`the burst took 814ms
... expected ... less than 500`). It is not evidence for this branch's exact-candidate gate. The
native release workflow therefore remains unrun on this candidate, and no build, package, release,
or Android control result is awarded here.

## Review checkpoint

The independent review and the current successful hosted candidate run are pending. The next
bounded action is to merge this reviewed workflow repair, wait for the exact `main` push CI run to
finish successfully, and then hand its run identity to PRD-262. A failed native release run must
be recorded with its individual job result before any further repair.
