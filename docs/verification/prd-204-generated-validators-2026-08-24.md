# PRD-204 — generated assertion validators repair — 2026-08-24

## Repair scope

This repair closes the two fresh review defects in registry completeness validation:

1. A discriminator must belong exclusively to its declared `presentVariant`.
2. Array-only rules must reference fields whose constraints are arrays.

## Red evidence before the repair

The two mutation tests were added to
`packages/playtest/__tests__/assertion-registry.spec.ts` and run against the handoff
commit before changing `packages/playtest/src/assertion-schema.ts`:

```text
❯ packages/playtest/__tests__/assertion-registry.spec.ts (11 tests | 2 failed) 17ms
     ✓ declares a machine-readable constraint for every assertion field 2ms
     ✓ keeps the committed validator artifact generated from the registry 2ms
     ✓ includes a resource field added to the registry in generated validation 2ms
     ✓ rejects a typo in an entry-level rule field reference 1ms
     ✓ rejects a typo in a nested record-rule field reference 0ms
     ✓ rejects an unknown required field on an excludeFields variant 0ms
     ✓ rejects an unknown discriminator field 0ms
     × rejects a discriminator field declared only by another variant 6ms
     ✓ rejects an out-of-range discriminator variant 1ms
     × rejects a no-consecutive-duplicates rule on a non-array field 1ms
     ✓ keeps public assertion field contracts in generated source 1ms

 Test Files  1 failed (1)
     Tests  2 failed | 9 passed (11)

RED_EXIT_CODE=1
```

The discriminator mutation changed `resources.discriminator.field` from `anyOf` to
the declared `path` field while leaving `presentVariant: 0`. The rule mutation changed
`reachability.noConsecutiveDuplicates.field` from `entities` to the string field
`artifact`. Both mutations incorrectly passed completeness before the repair.

## Green evidence

The repaired registry spec passed:

```text
✓ packages/playtest/__tests__/assertion-registry.spec.ts (11 tests) 13ms

 Test Files  1 passed (1)
     Tests  11 passed (11)
```

The wrong `resources` discriminator now fails with the named error
`resources.discriminator.path must be declared exclusively by presentVariant 0`.
The incompatible `reachability` rule now fails with the named error
`reachability.noConsecutiveDuplicates field 'artifact' must reference an array constraint`.

## Gates

The generator, focused tests, package build, and static gates produced these results:

```text
pnpm tsx scripts/generate-assertion-validators.ts --check
assertion validators are current: 21 kinds

pnpm tsx scripts/generate-assertion-reference.ts --check
assertion reference is current: 21 kinds

focused registry/evaluator suite
Test Files  8 passed (8)
    Tests  91 passed (91)

pnpm --filter @threenative/playtest build
ESM Build success; DTS Build success; publint: All good!

pnpm typecheck
all workspace typecheck commands passed

changed-file Biome check
Checked 2 files; exit 0; 9 warnings; no errors

pnpm budgets
budgets ok: 8 framework packages, 8 example workspaces, 18376/15000 framework LOC,
81491/100000 native runtime LOC, 12 PRD files, largest template 2404 LOC,
no compiled texture manifests found

pnpm quality
quality report: 92 findings (35 new, 10 grew, 47 inherited, 0 waived); exit 0

pnpm lint
exit 0; 312 warnings; no errors
```

The budget output also retained the existing framework LOC trigger (`18376`, trigger
`15000`) and native census drift notices. The changed-file lint warnings were non-fatal
complexity/`noForEach` diagnostics in the salvaged playtest package; no lint error was
reported.

The full wrapper and real playtest gates were attempted and recorded fail-closed:

```text
TN_TEST_TEMP_TAG=prd204 pnpm test
@threenative/playtest test: orphan processes remain
suite temporary directory count unchanged: 0
Exit status 1

pnpm vitest run
Test Files  1 failed | 198 passed (199)
Tests  1871 passed | 28 skipped (1899)
Failure: packages/physics/__tests__/parity.spec.ts beforeAll hook timed out at 10000ms

pnpm vitest run packages/physics/__tests__/parity.spec.ts
Test Files  1 passed (1)
Tests  28 passed (28)

pnpm test:playtest
Exit code 137 during the playtest package ESM build, before any scenario ran
```

The package orphan guard reproduced the same timeout-smoke Chromium leak in two full
wrapper attempts and one standalone package attempt; it never reported a temporary
directory leak. The full Vitest parity timeout was contention from concurrent lanes, as
the parity file passed alone. The playtest exit `137` occurred while other lane builds and
runner processes were active on the shared machine; no playtest result is claimed.
