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

The two rejected scenarios were rejected identically: the camera binding negative scenario
and the misspelled native-smoke assertion scenario.

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

## Gates

- `pnpm tsx scripts/generate-assertion-validators.ts --check`: passed; `21 kinds` current.
- `pnpm tsx scripts/generate-assertion-reference.ts --check`: passed; `21 kinds` current.
- `pnpm typecheck`: passed for all workspace projects.
- `pnpm build`: passed, including both generator checks; package builds and `publint` passed.
- `TN_TEST_TEMP_TAG=prd204 pnpm --filter @threenative/playtest test`: passed with `no orphans`
  and `publint --strict` green.
- Changed-file Biome check: exit 0 with 29 existing complexity/style warnings and no errors.
- `pnpm lint`: repository-wide exit 1 from existing cognitive-complexity diagnostics in unrelated
  files (310 warnings; the changed-file check is separate and is recorded below).

## Real playtest

Ran `examples/abyss-framework/playtest/moves.json` through the real runner with the WebGPU
recipe. The scenario loaded, reached assertions, and `movement.distance` passed at 24.04 units.
The run exited 1 because this headless machine exposed the `swiftshader` adapter and produced
29 existing WebGPU console/runtime errors; this is environment evidence, not a validator
failure.

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
