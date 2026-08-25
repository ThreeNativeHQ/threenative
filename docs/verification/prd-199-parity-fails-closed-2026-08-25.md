# PRD-199 verification — 2026-08-25

The parity and viewport scenario loaders now fail closed. Malformed parity
animation entries, resource ids, and targets throw with their field/index;
viewport defaults apply only when the key is absent.

## Red-first evidence

The regression tests were added before the production change. Against the
original loader:

```text
RUN v4.1.10
packages/playtest/__tests__/silent-drop.spec.ts (33 tests | 8 failed)
Tests 8 failed | 25 passed (33)
```

The eight failures were the malformed parity animation fixture, resource id,
parity target, animation clip, animation target, compare resource id, compare
animation, and wrong-typed viewport cases. The original loader returned
`parity.animation: []` for the fixture and defaulted the wrong-typed viewport to
`1280x720`.

## Required mutation controls

Both declared mutations were applied temporarily, observed red, and restored.

### Parity filter mutation

Mutation: restore the malformed animation validator's `undefined` return and
the `.filter((item) => item !== undefined)` drop sites.

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/silent-drop.spec.ts -t "malformed parity animation fixture"
```

Observed red:

```text
Test Files 1 failed (1)
Tests 1 failed | 32 skipped (33)
AssertionError: promise resolved ... instead of rejecting
parity: { animation: [] }
```

### Viewport coercion mutation

Mutation: restore the old viewport branch that coerces a present wrong-typed
value to the `1280x720` defaults.

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/silent-drop.spec.ts -t "wrong-typed present viewport"
```

Observed red:

```text
Test Files 1 failed (1)
Tests 1 failed | 32 skipped (33)
AssertionError: expected undefined to be an instance of PlaytestScenarioError
```

## Green evidence

Focused scenario coverage passed:

```sh
pnpm exec vitest run --config vitest.config.ts \
  packages/playtest/__tests__/silent-drop.spec.ts \
  packages/playtest/__tests__/scenario-load.spec.ts \
  packages/playtest/__tests__/schema-camera-binding.spec.ts
```

```text
Test Files 3 passed (3)
Tests 46 passed (46)
```

The full playtest unit suite passed after building the fresh worktree:

```sh
pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__
```

```text
Test Files 55 passed (55)
Tests 594 passed (594)
```

The package gates passed:

```sh
pnpm --filter @threenative/playtest build
pnpm --filter @threenative/playtest typecheck
pnpm --filter @threenative/playtest test
```

`@threenative/playtest test` reported `no orphans` and publint `All good!`.
The first typecheck/full-suite attempt was blocked only by missing fresh
workspace build outputs; `pnpm build` completed successfully, and the reruns
above passed.

Root verification also passed:

```sh
pnpm build
pnpm typecheck
pnpm lint
```

Lint exited 0 with pre-existing warnings and no errors.

## End-to-end example

One valid in-repo example scenario executed end to end:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtest/moves.json \
  --url http://127.0.0.1:5181 \
  --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5181 --strictPort' \
  --browser-recipe webgpu --headed
```

Result: exit 0, `pass: true`; diagnostics and movement assertions passed with
movement distance `51.57022114931329`, NVIDIA WebGPU adapter identity, and the
declared `1280x720` viewport.

## Changed paths

- `packages/playtest/src/scenario/schema-validate.ts`
- `packages/playtest/src/scenario/schema-accessors.ts`
- `packages/playtest/__tests__/silent-drop.spec.ts`
- `packages/playtest/__tests__/fixtures/parity-mistyped.playtest.json`
- `docs/verification/prd-199-parity-fails-closed-2026-08-25.md`
