# PRD-199 verification — 2026-08-23

The parity and viewport scenario loaders now fail closed. The focused playtest
tests, playtest package checks, root typecheck, root lint, and a valid example
playtest passed. The root test command has one unrelated runtime-native timeout;
the aggregate example playtest command also reaches an existing missing semantic
bridge scenario.

## Baseline reproduction

Before the implementation, direct scenario-load probes showed the malformed
values being accepted, filtered, or coerced:

```text
animation LOADED {"animation":[]}
resource LOADED {"resources":["state"]}
target LOADED {"targets":["web"]}
compare-animation LOADED {"animation":[]}
viewport LOADED {"height":720,"width":1280}
```

## Red controls

Both required mutations were applied temporarily, observed red, and reverted.

### Parity filter mutation

Mutation: restore the parity animation validator to return `undefined` for a
malformed entry and restore `.filter((item) => item !== undefined)`.

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/silent-drop.spec.ts -t "malformed parity animation fixture"
```

Result: exit 1. The fixture test resolved with `parity.animation: []` instead
of rejecting; Vitest reported `1 failed | 32 skipped (33)`.

### Viewport coercion mutation

Mutation: restore the old viewport fallback that coerced wrong-typed values to
`1280x720`.

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/silent-drop.spec.ts -t "rejects a wrong-typed present viewport"
```

Result: exit 1. The test expected a `PlaytestScenarioError`, but the mutated
loader returned normally; Vitest reported `1 failed | 32 skipped (33)`.

## Green evidence

Focused scenario coverage:

```text
3 files, 46 tests passed
```

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/silent-drop.spec.ts packages/playtest/__tests__/scenario-load.spec.ts packages/playtest/__tests__/schema-camera-binding.spec.ts
```

The focused tests cover mistyped animation names, resource ids, targets,
compare entries, and wrong-typed versus absent viewports.

The package checks passed:

```sh
pnpm --filter @threenative/playtest build
pnpm --filter @threenative/playtest typecheck
pnpm --filter @threenative/playtest test
```

Root checks passed:

```sh
pnpm typecheck
pnpm lint
```

`pnpm lint` completed with pre-existing warnings and no errors.

## End-to-end example

The valid in-repo example scenario passed end to end:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtest/moves.json \
  --url http://127.0.0.1:5181 \
  --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5181 --strictPort' \
  --browser-recipe webgpu --headed
```

Result: exit 0, `pass: true`; movement and diagnostics assertions passed with
an NVIDIA WebGPU adapter and a `1280x720` viewport.

The broader `pnpm test:playtest` command passed its first three scenarios but
then stopped at the navigation scenario because the semantic bridge was not
installed (`TN_PLAYTEST_BRIDGE_MISSING`). That is an environment/example
fixture issue, not a scenario-loader failure.

## Full root test result

`pnpm test` reached the runtime-native package tests and failed one existing
conformance dry-run test after its 60-second timeout:

```text
tests/conformance-runner.test.mjs
dry run validates and bundles implemented rows without a browser or native runtime
Test Files 1 failed | 52 passed (53)
Tests 1 failed | 349 passed | 37 skipped (387)
```

No runtime-native files were changed in this lane.

## Changed paths

- `packages/playtest/src/scenario/schema-validate.ts`
- `packages/playtest/src/scenario/schema-accessors.ts`
- `packages/playtest/__tests__/silent-drop.spec.ts`
- `packages/playtest/__tests__/fixtures/parity-mistyped.playtest.json`
- `docs/verification/prd-199-parity-fails-closed-2026-08-23.md`
