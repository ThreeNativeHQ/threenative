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

## Fresh review repair — red evidence before implementation

The two new controls were added before changing the registry or validator generator:

- `packages/playtest/__tests__/vacuous-assertion.spec.ts` rejects a negative
  `movement.pathLength` at scenario load.
- `packages/playtest/__tests__/assertion-registry.spec.ts` rejects a `requireWhen`
  rule whose trigger field uses a string constraint instead of a boolean constraint.

They were run against handoff commit `921d8831f13e2a6459e9726f4606c490846ef629`:

```text
exit_code=1
(node:1591851) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1591901) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-204-assertion-validators-are-generated-from-the-registry

 ❯ packages/playtest/__tests__/assertion-registry.spec.ts (12 tests | 1 failed) 42ms
     ✓ declares a machine-readable constraint for every assertion field 2ms
     ✓ keeps the committed validator artifact generated from the registry 2ms
     ✓ includes a resource field added to the registry in generated validation 1ms
     ✓ rejects a typo in an entry-level rule field reference 1ms
     ✓ rejects a typo in a nested record-rule field reference 0ms
     ✓ rejects an unknown required field on an excludeFields variant 0ms
     ✓ rejects an unknown discriminator field 0ms
     ✓ rejects a discriminator field declared only by another variant 0ms
     ✓ rejects an out-of-range discriminator variant 0ms
     ✓ rejects a no-consecutive-duplicates rule on a non-array field 1ms
     × rejects a require-when rule on a non-boolean field 4ms
     ✓ keeps public assertion field contracts in generated source 28ms
 ❯ packages/playtest/__tests__/vacuous-assertion.spec.ts (20 tests | 1 failed) 76ms
   ✓ a stringified movement threshold is rejected, not dropped into a green run 5ms
   ✓ a null movement threshold is rejected rather than treated as absent 1ms
   × a negative movement path length is rejected by the registry constraint 4ms
   ✓ a stringified camera bound is rejected 1ms
   ✓ a stringified diagnostics flag is rejected 1ms
   ✓ an empty entity id is rejected instead of silently matching nothing 1ms
   ✓ a console opt-out without a reason is rejected at load 1ms
   ✓ a network opt-out without a reason is rejected at load 1ms
   ✓ a wrong-typed field inside an array assertion names its index 1ms
   ✓ every registry field declaring a scalar type is actually enforced 48ms
   ✓ valid scalar values still parse unchanged 1ms
   ✓ movement minTicks parses through the typed registry path 1ms
   ✓ the boolean triviality opt-out is rejected instead of coerced 1ms
   ✓ a triviality reason must contain prose, not only whitespace or one character 1ms
   ✓ a reason-string triviality opt-out parses unchanged 1ms
   ✓ the six held-value assertion kinds reject boolean and short triviality opt-outs 5ms
   ✓ every registry entry carries rationale and the audit reclassifies the six held-value kinds 1ms
   ✓ an empty signals array fails at load instead of asserting nothing 1ms
   ✓ an empty resource anyOf array fails at load instead of asserting nothing 1ms
   ✓ a resource anyOf alternative with only a path fails without a comparator 1ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/playtest/__tests__/assertion-registry.spec.ts > assertion registry completeness > rejects a require-when rule on a non-boolean field
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined

 ❯ packages/playtest/__tests__/assertion-registry.spec.ts:189:69
    187|     ) as readonly IPlaytestAssertionSchemaEntry[];
    188|
    189|     expect(() => assertPlaytestAssertionRegistryComplete(registry)).to…
       |                                                                     ^
    190|       "Assertion registry is incomplete: diagnostics.requireWhen field…
    191|     );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  packages/playtest/__tests__/vacuous-assertion.spec.ts > a negative movement path length is rejected by the registry constraint
AssertionError: expected undefined to be an instance of PlaytestScenarioError
 ❯ loadError packages/playtest/__tests__/vacuous-assertion.spec.ts:40:18
     38|   } catch (error) {
     39|     caught = error;
     40|   }
     41|   expect(caught).toBeInstanceOf(PlaytestScenarioError);
       |                  ^
     42|   return caught as PlaytestScenarioError;
     43| }
 ❯ packages/playtest/__tests__/vacuous-assertion.spec.ts:58:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed (2)
      Tests  2 failed | 30 passed (32)
   Start at  00:37:17
   Duration  724ms (transform 720ms, setup 0ms, import 802ms, tests 118ms, environment 0ms)
```

The red confirms that the current registry accepts the negative finite threshold and that
registry completeness checks only `requireWhen` field existence, not its boolean contract.

## Fresh review repair — green evidence

After changing the registry and completeness checks and regenerating the committed validator,
the same two focused files passed:

```text
exit_code=0
(node:1624702) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1624765) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-204-assertion-validators-are-generated-from-the-registry

 ✓ packages/playtest/__tests__/assertion-registry.spec.ts (12 tests) 10ms
 ✓ packages/playtest/__tests__/vacuous-assertion.spec.ts (20 tests) 76ms

 Test Files  2 passed (2)
      Tests  32 passed (32)
   Start at  00:40:23
   Duration  431ms (transform 335ms, setup 0ms, import 419ms, tests 86ms, environment 0ms)
```

## Fresh review repair — gate evidence

The implementation is registry-derived: `movement.pathLength` now uses the existing
`non-negative number` type expression; registry completeness checks `requireWhen` trigger
types against `equals`, boolean predicates in `requireOneOfOrTrue`, and the existing
array-only rules; and the committed validator plus assertion reference were regenerated.

```text
pnpm tsx scripts/generate-assertion-validators.ts --check
assertion validators are current: 21 kinds

pnpm tsx scripts/generate-assertion-reference.ts --check
assertion reference is current: 21 kinds

pnpm --filter @threenative/playtest build
ESM Build success
DTS Build success
All good!

pnpm --filter @threenative/playtest typecheck
exit status 0

focused playtest/schema suite
Test Files  6 passed (6)
      Tests  101 passed (101)

pnpm exec biome check packages/playtest/src/assertion-schema.ts packages/playtest/src/scenario/generated-assertion-validators.ts packages/playtest/__tests__/assertion-registry.spec.ts packages/playtest/__tests__/vacuous-assertion.spec.ts
exit status 0
Found 29 warnings.

pnpm typecheck
exit status 0
Scope: 16 of 17 workspace projects

pnpm test
Test Files  199 passed (199)
      Tests  1901 passed (1901)
suite temporary directory count unchanged: 0

pnpm test:playtest
exit status 0
Scenarios completed: framework movement, framework camera, abyss-framework movement-axis,
and navigation-routes-around-blocker; each report ended with `"pass": true`.
WebGPU adapter evidence reported NVIDIA/Turing with `rendererKind: "webgpu"`.
```

The repository-wide lint command was attempted and is not green:

```text
pnpm lint
exit status 1
Found 312 warnings.
```

It reported warnings only, including the existing complexity/noForEach diagnostics; the
changed-file Biome check above exited 0 with warnings and no errors.

One standalone package-test attempt also hit the environment guard:

```text
pnpm --filter @threenative/playtest test
exit status 1
orphan processes remain: Chromium processes
```

This was recorded as an environment failure, not a pass. The later full `pnpm test` run
executed the same package test after its build and reported `no orphans`; the full suite
then completed with the green result above.

## Final review repair 2 — red evidence before implementation

The two new controls were added before changing production registry code or generated
artifacts, then run against handoff commit `34d8e4693791ef9c8ddb49261d7e2e9384317d2d`:

- `packages/playtest/__tests__/vacuous-assertion.spec.ts` rejects a negative
  `movement.maxDistance` at scenario load.
- `packages/playtest/__tests__/assertion-registry.spec.ts` rejects a `requireWhen` rule
  whose `required` field points at the boolean `runtimeReady` field.

```text
(node:1924870) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1924987) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-204-assertion-validators-are-generated-from-the-registry

 ❯ packages/playtest/__tests__/assertion-registry.spec.ts (13 tests | 1 failed) 57ms
     ✓ declares a machine-readable constraint for every assertion field 2ms
     ✓ keeps the committed validator artifact generated from the registry 25ms
     ✓ includes a resource field added to the registry in generated validation 2ms
     ✓ rejects a typo in an entry-level rule field reference 1ms
     ✓ rejects a typo in a nested record-rule field reference 0ms
     ✓ rejects an unknown required field on an excludeFields variant 0ms
     ✓ rejects an unknown discriminator field 0ms
     ✓ rejects a discriminator field declared only by another variant 0ms
     ✓ rejects an out-of-range discriminator variant 0ms
     ✓ rejects a no-consecutive-duplicates rule on a non-array field 0ms
     ✓ rejects a require-when rule on a non-boolean field 0ms
     × rejects a require-when rule whose required field is not a non-empty string 5ms
     ✓ keeps public assertion field contracts in generated source 19ms
 ❯ packages/playtest/__tests__/vacuous-assertion.spec.ts (21 tests | 1 failed) 101ms
   ✓ a stringified movement threshold is rejected, not dropped into a green run 6ms
   ✓ a null movement threshold is rejected rather than treated as absent 1ms
   ✓ a negative movement path length is rejected by the registry constraint 1ms
   × a negative movement maximum distance is rejected by the registry constraint 4ms
   ✓ a stringified camera bound is rejected 1ms
   ✓ a stringified diagnostics flag is rejected 1ms
   ✓ an empty entity id is rejected instead of silently matching nothing 1ms
   ✓ a console opt-out without a reason is rejected at load 1ms
   ✓ a network opt-out without a reason is rejected at load 1ms
   ✓ a wrong-typed field inside an array assertion names its index 1ms
   ✓ every registry field declaring a scalar type is actually enforced 62ms
   ✓ valid scalar values still parse unchanged 2ms
   ✓ movement minTicks parses through the typed registry path 1ms
   ✓ the boolean triviality opt-out is rejected instead of coerced 1ms
   ✓ a triviality reason must contain prose, not only whitespace or one character 3ms
   ✓ a reason-string triviality opt-out parses unchanged 1ms
   ✓ the six held-value assertion kinds reject boolean and short triviality opt-outs 9ms
   ✓ every registry entry carries rationale and the audit reclassifies the six held-value kinds 1ms
   ✓ an empty signals array fails at load instead of asserting nothing 1ms
   ✓ an empty resource anyOf array fails at load instead of asserting nothing 1ms
   ✓ a resource anyOf alternative with only a path fails without a comparator 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/playtest/__tests__/assertion-registry.spec.ts > assertion registry completeness > rejects a require-when rule whose required field is not a non-empty string
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined

 ❯ packages/playtest/__tests__/assertion-registry.spec.ts:206:69
    204|     ) as readonly IPlaytestAssertionSchemaEntry[];
    205|
    206|     expect(() => assertPlaytestAssertionRegistryComplete(registry)).to…
       |                                                                     ^
    207|       "Assertion registry is incomplete: diagnostics.requireWhen requi…
    208|       );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  packages/playtest/__tests__/vacuous-assertion.spec.ts > a negative movement maximum distance is rejected by the registry constraint
AssertionError: expected undefined to be an instance of PlaytestScenarioError
 ❯ loadError packages/playtest/__tests__/vacuous-assertion.spec.ts:40:18
     38|     caught = error;
     39|   }
     40|   expect(caught).toBeInstanceOf(PlaytestScenarioError);
       |                  ^
     41|   return caught as PlaytestScenarioError;
 ❯ packages/playtest/__tests__/vacuous-assertion.spec.ts:64:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed (2)
      Tests  2 failed | 32 passed (34)
   Start at  01:02:10
   Duration  720ms (transform 553ms, setup 0ms, import 693ms, tests 158ms, environment 0ms)

```

The red is specific: the current validator accepts a negative finite `maxDistance`, and
registry completeness checks only that `requireWhen.required` names an existing field.

## Final review repair 2 — implementation and green evidence

The smallest fix keeps the generator registry-derived:

- `movement.maxDistance` now uses the existing `non-negative number` type expression.
- `requireWhen.required` now must reference a string constraint with `nonEmpty: true`,
  matching the generated validator's trimmed non-empty string check.
- The generated validator and assertion reference were regenerated from the registry.

The same focused command passed after the fix:

```text
(node:1940176) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:1940222) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-204-assertion-validators-are-generated-from-the-registry

 ✓ packages/playtest/__tests__/assertion-registry.spec.ts (13 tests) 12ms
 ✓ packages/playtest/__tests__/vacuous-assertion.spec.ts (21 tests) 82ms

 Test Files  2 passed (2)
      Tests  34 passed (34)
   Start at  01:03:34
   Duration  440ms (transform 325ms, setup 0ms, import 414ms, tests 94ms, environment 0ms)

```

## Final review repair 2 — gate evidence

```text
pnpm tsx scripts/generate-assertion-validators.ts --check
assertion validators are current: 21 kinds

pnpm tsx scripts/generate-assertion-reference.ts --check
assertion reference is current: 21 kinds

pnpm --filter @threenative/playtest build
ESM Build success
DTS Build success
All good!

pnpm --filter @threenative/playtest typecheck
exit status 0

pnpm exec biome check packages/playtest/src/assertion-schema.ts packages/playtest/src/scenario/generated-assertion-validators.ts packages/playtest/__tests__/assertion-registry.spec.ts packages/playtest/__tests__/vacuous-assertion.spec.ts
exit status 0; Found 29 warnings.

pnpm typecheck
exit status 0; Scope: 16 of 17 workspace projects

pnpm lint
exit status 0; Found 312 warnings.

pnpm budgets
budgets ok: 8 framework packages, 8 example workspaces, 18376/15000 framework LOC,
81491/100000 native runtime LOC, 12 PRD files, largest template 2404 LOC,
no compiled texture manifests found

pnpm quality
quality report: 92 findings (35 new, 10 grew, 47 inherited, 0 waived); exit 0

TN_TEST_TEMP_TAG=prd204-repair1 pnpm test
Test Files  199 passed (199)
Tests  1903 passed (1903)
37 skipped
suite temporary directory count unchanged: 0

runtime-native parity
Test Files  53 passed (53)
Tests  350 passed | 37 skipped (387)
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out

pnpm test:playtest
Scenarios completed: framework movement, framework camera, abyss-framework movement-axis,
and navigation-routes-around-blocker; each report ended with `"pass": true`.
WebGPU adapter evidence reported NVIDIA/Turing with `rendererKind: "webgpu"`.
```

The budget LOC trigger, native census drift notices, Biome warnings, lint warnings, and
browser/X11 warnings were non-fatal existing diagnostics; no gate was treated as green
from a skipped or missing observation.
