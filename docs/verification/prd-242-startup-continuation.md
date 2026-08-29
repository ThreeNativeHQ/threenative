# PRD-242 continuation verification — 2026-08-28

Status: implementation complete for the narrowed startup-gated render-cadence lane.

Source PRD: `.linchpin/lane-242-startup-continuation.prd.md` (read-only, outside this worktree).

## Contract

- Render-cadence compute is skipped while an opaque startup layer is waiting for readiness.
- Once `ctx.startup.whenReady()` settles, render-cadence compute dispatches once per rendered frame.
- Fixed-step compute remains the registry default and dispatches once per fixed step.
- `GPUParticles3D` remains the render-cadence consumer; its unit test asserts that declaration.

## Declared negative controls

Both controls were run against temporary defects and restored before delivery.

### `render-before-startup`

Mutation: removed the startup-readiness guard around `processRender()` in `packages/core/src/game.ts`.

Command:

```text
pnpm exec vitest run packages/core/__tests__/compute-driven.spec.ts -t 'defers render cadence until startup is ready'
```

Observed red:

```text
❯ packages/core/__tests__/compute-driven.spec.ts (7 tests | 1 failed | 6 skipped)
× defers render cadence until startup is ready
AssertionError: expected [ ComputeNode{ …(22) } ] to have a length of +0 but got 1
Test Files 1 failed (1)
Tests 1 failed | 6 skipped (6)
exit 1
```

Restored green:

```text
✓ packages/core/__tests__/compute-driven.spec.ts (8 tests | 7 skipped)
Test Files 1 passed (1)
Tests 1 passed | 7 skipped (8)
exit 0
```

### `stale-cadence-prose`

Mutation: restored the fixed-step-only cadence statement in `docs/verification/PRD-242.md`.

Command:

```text
pnpm exec vitest run packages/core/__tests__/compute-driven.spec.ts -t 'documents fixed and render cadence'
```

Observed red:

```text
❯ packages/core/__tests__/compute-driven.spec.ts (8 tests | 1 failed | 7 skipped)
× documents fixed and render cadence
AssertionError: expected '# PRD-242 verification — 2026-08-28 S…' to contain 'Fixed-step compute remains the regist…'
Test Files 1 failed (1)
Tests 1 failed | 7 skipped (7)
exit 1
```

Restored green:

```text
✓ packages/core/__tests__/compute-driven.spec.ts (8 tests | 7 skipped)
Test Files 1 passed (1)
Tests 1 passed | 7 skipped (8)
exit 0
```

## Focused consumer evidence

```text
pnpm exec vitest run packages/core/__tests__/compute-driven.spec.ts packages/core/__tests__/particles.spec.ts

Test Files  2 passed (2)
Tests       10 passed (10)
exit 0
```

The startup regression observes zero render-cadence dispatches in the first opaque frame and two
dispatches across two rendered frames after readiness. The existing fixed-step probe still observes
three ordered dispatches for three fixed steps.

## Repository gates

Recorded after the final source and evidence edits:

```text
pnpm typecheck
exit 0

pnpm budgets
budgets ok: 8 packages, 9 example workspaces, 24630/15000 framework LOC,
107202/100000 native runtime LOC, 11 PRD files
exit 0

pnpm exec biome check packages/core/src/game.ts packages/core/__tests__/compute-driven.spec.ts packages/core/__tests__/particles.spec.ts
Checked 3 files in 22ms. No fixes applied. Found 5 warnings.
exit 0
```

The five Biome diagnostics are pre-existing cognitive-complexity warnings in `game.ts`; no
changed-file errors were reported.

The full repository baselines were also run. They remain outside this narrowed lane:

```text
pnpm lint
Found 4 errors.
Found 448 warnings.
exit 1

pnpm test
Broken documentation links:
docs/PRDs/done/PRD-228-the-pixel-budget-is-the-engines.md -> ../verification/runtime-perf-state.md
docs/PRDs/refactor-2026-08-28/PRD-232-profiling-is-a-component-not-a-smear.md -> ../PRD-228-the-pixel-budget-is-the-engines.md
docs/PRDs/refactor-2026-08-28/README.md -> ../PRD-228-the-pixel-budget-is-the-engines.md
exit 1
```

The lint errors are in `packages/playtest/__tests__/perf.spec.ts:93`,
`packages/runtime-native/src/runtime-scripts/frame-op-stream.js:310,392`, and
`packages/runtime-native/tests/timestamp-query.test.mjs:38`. The test suite stops at the existing
documentation-link check before running Vitest.

## Real consumer proof

```text
pnpm test:playtest
exit 0
4 abyss-framework scenarios passed under WebGPU.
adapter: vendor=nvidia, architecture=turing
diagnostics: []
```

The captured frames under `artifacts/playtest/` were inspected and were non-blank particle scenes.

## Committed-diff check

The required `git diff HEAD^ HEAD --check` check is run after commit and reported with the delivery
commit. No native target was executed in this continuation; Android and iOS are unverified here.
