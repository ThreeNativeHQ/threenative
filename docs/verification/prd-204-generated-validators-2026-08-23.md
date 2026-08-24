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

## Friction proof

Temporary field `movement.minTicks` was added to the registry and one registry test. The
generator, playtest build, reference generator, and 3-test registry spec passed. Manual touch
list:

```text
packages/playtest/src/assertion-schema.ts
packages/playtest/__tests__/assertion-registry.spec.ts
```

The generated validator and assertion reference changed automatically; no validator body or
documentation row was hand-edited. The temporary field, generated output, and docs were then
restored and both `--check` commands passed.

## Gates

- Focused assertion/schema/doc suite: 6 files, 94 tests passed.
- `pnpm typecheck`: passed for all workspace projects.
- `pnpm lint`: exit 0; repository reports 309 warnings, and the changed-file check is also
  exit 0 with warnings only.
- `pnpm build`: passed, including `assertion validators are current: 21 kinds` and
  `assertion reference is current: 21 kinds`.
- `TN_TEST_TEMP_TAG=prd204 pnpm test`: 199 test files and 1,886 tests passed; temporary
  directory baseline unchanged. The untagged package command was blocked by shared `/tmp`
  churn (`before 125, after 126`); the documented tag override passed
  `TN_TEST_TEMP_TAG=prd204 pnpm --filter @threenative/playtest test` with `no orphans` and
  `publint --strict` green.

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
