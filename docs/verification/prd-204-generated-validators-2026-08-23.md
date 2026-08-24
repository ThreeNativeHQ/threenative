# PRD-204 — generated assertion validators — 2026-08-23

## Result

The assertion registry is the single machine-readable source for load-time assertion
validation and the assertion reference page. `schema-validate.ts` consumes the generated
validator module; the former per-kind validator bodies are deleted from `schema-validate.ts`
and `schema-accessors.ts`.

## Phase 1 red evidence

The first completeness spec run was intentionally red before constraints were added:

```text
RED first: fields whose checks still live only in hand-written validators
119 gaps, including framebufferCoverage.backdrop, framebufferCoverage.grid,
framebufferCoverage.tolerance, framebufferCoverage.window, reachability.artifact,
reachability.entities, ... animation.allowTrivial
```

The final `assertion-registry.spec.ts` reports no gaps and checks that the committed
validator artifact equals the generator output.

## Golden accept/reject matrix

Compared the current validator with the pre-change validator from `HEAD` over all 105
in-repository scenario JSON files under `examples/`, `packages/create-threenative/templates/`,
and `packages/playtest/__tests__/fixtures/`. Assertion objects were recursively key-sorted
before comparison.

```json
{
  "total": 105,
  "baselineAccepted": 103,
  "currentAccepted": 103,
  "baselineRejected": 2,
  "currentRejected": 2,
  "semanticDifferences": []
}
```

The two rejected scenarios were rejected identically:
`examples/fps-friction/playtests/look.playtest.json` (camera binding negative) and
`examples/native-smoke/playtests/device-smoke-misspelled.playtest.json` (misspelled
native-smoke assertion).

## Negative controls

- Bogus field: temporarily added `movement.__bogus` to the registry without regenerating the
  artifact. Scenario loading rejected it with `Unknown key '__bogus' at assert.movement.__bogus`.
  The temporary registry edit was reverted.
- Stripped constraints: deleting `framebufferCoverage.backdrop.constraints` from a cloned
  registry and calling `assertPlaytestAssertionRegistryComplete` failed with:
  `Assertion registry is incomplete: framebufferCoverage.backdrop has no constraints.`
- Stale artifact: temporarily moving
  `packages/playtest/src/scenario/generated-assertion-validators.ts` away made
  `pnpm --filter @threenative/playtest build` red with esbuild `Could not resolve
  "./generated-assertion-validators.js"` and TypeScript `TS2307`. The artifact was restored.
- Docs mutation: mutating one constraint in an in-memory registry rendered a different
  reference (`docs_changed=true`). The committed reference check is exact.

## Review round 1 repair — red evidence

The read-only review's two defects were reproduced before the repair:

1. Registry-only resource field proof was red because the generator ignored the supplied registry
   and kept using the root `entry.validation` override:

   ```text
   FAIL assertion-registry.spec.ts > includes a resource field added to the registry in generated validation
   expected generated output to contain `"name": "registryOnlyField"`
   ```

2. `movement.minTicks` was red in both the load and evaluator paths. Before the repair, the
   generated validator rejected the field, and the unchecked evaluator cast produced no field
   result:

   ```text
   Playtest scenario 'scenario.json' is invalid: Unknown key 'minTicks' at assert.movement.minTicks.
   expected assertions to contain { id: "movement.ticks", pass: true }
   received { id: "assert.movement", pass: false, details: { reason: "registered-without-evaluator" } }
   ```

## Review round 1 repair — green evidence

Resource variants now select fields from the registry's one field list. The generator derives
variant constraints and requiredness from those fields; `entry.validation` and the duplicated
`resourceValidation()` source are gone. A synthetic field added only to a cloned registry now
appears in generated validation, while the existing `resources` acceptance behavior remains
unchanged.

`movement.minTicks` is now a typed `IPlaytestMovementAssertion` field, is declared as a registry
field, and evaluates `after.tick - before.tick` as `movement.ticks`. The test covers load,
generation, and a passing evaluator result, so the field changes an assertion result rather than
only being accepted by a cast.

The repaired focused suite passed exactly 94 tests across 7 files:

```text
Test Files  7 passed (7)
Tests  94 passed (94)
```

## Review round 2 repair — red evidence

The second-review defects were reproduced before editing with:

```sh
pnpm vitest run packages/playtest/__tests__/assertion-registry.spec.ts packages/playtest/__tests__/vacuous-assertion.spec.ts
```

The registry typo mutation did not throw, and both vacuous resource alternatives were
accepted. The exact result was:

```text
Test Files  2 failed (2)
Tests  3 failed | 20 passed (23)
```

The failures were the missing top-level `entry.rules` reference check, an empty
`resources.anyOf` array that did not produce `PlaytestScenarioError`, and a path-only
`resources.anyOf` alternative that did not produce `PlaytestScenarioError`.

## Review round 2 repair — green evidence

The resource registry now carries the machine-readable `anyOf` constraints for `minItems: 1`
and the per-alternative `requireOneOf` rule. Registry completeness validation now checks
`entry.rules`, variant rules, and nested record-rule field references. Red mutations cover
both a misspelled top-level rule field and a misspelled nested resource record-rule field.

The focused suite, including the registry, documentation drift, evaluator, fail-closed,
negative-fixture, reachability, scenario-load, camera-binding, silent-drop, and vacuous
assertion suites, passed:

```text
Test Files  11 passed (11)
Tests  124 passed (124)
```

The golden matrix remained unchanged: 105 scenarios, 103 accepted, 2 rejected, and
`semanticDifferences: []`.

## Review round 3 repair — red evidence

The latest review defects were reproduced before editing with the new registry tests:

```text
Test Files  1 failed (1)
Tests  4 failed | 5 passed (9)
```

The four red controls were an unknown `requiredFields` entry on an `excludeFields` variant,
a misspelled discriminator field, an out-of-range discriminator variant index, and the missing
generated public assertion-type artifact.

## Review round 3 repair — green evidence

Assertion public field contracts now come from the generated
`packages/playtest/src/scenario/generated-assertion-types.ts` artifact. `schema-base.ts` only
imports and re-exports those names, preserving the existing public type exports while removing
handwritten assertion-field ownership. The registry-only synthetic field test now checks both
generated type output and generated validator output; the existing `movement.minTicks` typed
load/evaluator proof remains green.

Registry completeness now rejects unknown `requiredFields` entries before variant generation and
validates discriminator field names and variant indexes with named registry errors. The focused
registry/fail-closed/evaluator/load suite passed:

```text
Test Files  8 passed (8)
Tests  117 passed (117)
```

The exact new red/green controls are in
`packages/playtest/__tests__/assertion-registry.spec.ts`.

## Review round 3 gates

- `pnpm --filter @threenative/playtest build`: passed; DTS and `publint` passed.
- `pnpm typecheck`: passed for all workspace projects.
- Changed-file Biome check: exit 0 with 30 existing complexity/style warnings and no errors.
- `TN_TEST_TEMP_TAG=prd204 pnpm --filter @threenative/playtest test`: passed; no orphans and strict `publint` passed.
- `TN_TEST_TEMP_TAG=prd204 pnpm test`: passed; `199` test files and `1,897` tests passed, with the suite temporary directory count unchanged at `0`.
- `pnpm budgets`: passed; framework LOC review trigger and existing census-drift notices were reported.
- Root `pnpm lint`: exit 1 from 4 existing complexity errors outside the changed files and 312 warnings; no changed-file lint errors.

## Review round 3 real playtest

`pnpm test:playtest` passed all four real WebGPU scenarios on the NVIDIA/Turing adapter:
`framework-movement`, `framework-camera`, `movement-axis`, and `navigation`. Navigation passed
`pathLength`, `reachesPosition`, and `visibility`.

## Review round 3 files changed

```text
docs/verification/prd-204-generated-validators-2026-08-23.md
packages/playtest/__tests__/assertion-registry.spec.ts
packages/playtest/src/assertion-schema.ts
packages/playtest/src/scenario/generated-assertion-types.ts
packages/playtest/src/scenario/generated-assertion-validators.ts
packages/playtest/src/scenario/schema-base.ts
scripts/generate-assertion-validators.ts
```

## Gates

- `pnpm tsx scripts/generate-assertion-validators.ts --check`: passed; `21 kinds` current.
- `pnpm tsx scripts/generate-assertion-reference.ts --check`: passed; `21 kinds` current.
- `pnpm typecheck`: passed for all workspace projects.
- `pnpm build`: passed, including both generator checks; package builds and `publint` passed.
- `pnpm lint`: exit 0 with 311 warnings and no errors.
- Changed-file Biome check: exit 0 with warnings and no errors.
- `TN_TEST_TEMP_TAG=prd204 pnpm --filter @threenative/playtest test`: two standalone attempts
  reached the package gate but exited during orphan cleanup because the real browser runner
  left a Chromium PID; each reported the exact PID and it disappeared before any cleanup action.
  A clean retry then passed with `no orphans`, `publint --strict`, and `All good!`; the same
  tagged package phase also passed inside the full tagged suite.
- `TN_TEST_TEMP_TAG=prd204 pnpm test`: passed; `199` test files and `1,893` tests passed,
  with the package gates and `suite temporary directory count unchanged: 0`.

## Real playtest

Ran `pnpm test:playtest` through the real runner with the WebGPU recipe. All four scenarios
passed on the NVIDIA/Turing adapter: framework movement, framework camera, movement-axis, and
navigation. The navigation scenario passed `pathLength`, `reachesPosition`, and `visibility`.

## Files changed

```text
package.json
packages/create-threenative/agent-docs/references/assertion-reference.md
packages/playtest/__tests__/assertion-registry.spec.ts
packages/playtest/__tests__/doc-drift.spec.ts
packages/playtest/__tests__/vacuous-assertion.spec.ts
packages/playtest/src/assertion-schema.ts
packages/playtest/src/assertions.ts
packages/playtest/src/scenario/generated-assertion-validators.ts
packages/playtest/src/scenario/schema-accessors.ts
packages/playtest/src/scenario/schema-validate.ts
scripts/generate-assertion-reference.ts
scripts/generate-assertion-validators.ts
docs/verification/prd-204-generated-validators-2026-08-23.md
```

## Review round 1 files changed

```text
docs/verification/prd-204-generated-validators-2026-08-23.md
packages/create-threenative/agent-docs/references/assertion-reference.md
packages/playtest/__tests__/assertion-registry.spec.ts
packages/playtest/__tests__/evaluator-semantics.spec.ts
packages/playtest/__tests__/vacuous-assertion.spec.ts
packages/playtest/src/assertion-schema.ts
packages/playtest/src/assertions.ts
packages/playtest/src/evaluators/movement-evidence.ts
packages/playtest/src/scenario/generated-assertion-validators.ts
packages/playtest/src/scenario/schema-base.ts
scripts/generate-assertion-validators.ts
```

## Review round 2 files changed

```text
docs/verification/prd-204-generated-validators-2026-08-23.md
packages/create-threenative/agent-docs/references/assertion-reference.md
packages/playtest/__tests__/assertion-registry.spec.ts
packages/playtest/__tests__/vacuous-assertion.spec.ts
packages/playtest/src/assertion-schema.ts
packages/playtest/src/scenario/generated-assertion-validators.ts
```
