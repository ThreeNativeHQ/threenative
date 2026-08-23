# PRD-193 template frame allocations — 2026-08-23

Lane: `lane-193`

## Scope

This repair carries the owning-layer `PathFollow3D` target contract into `packages/core`, removes
the fake target casts from the racing and defense generated callers, and replaces the old
source-only gate with a source-backed Vitest runtime probe.

The target API now:

- returns the supplied sample or projection target by identity;
- fills its Three.js vectors in place through `Curve.getPointAt` and `getTangentAt` targets;
- keeps no-target calls allocating and safe to retain; and
- preserves open-path clamping and loop wrapping.

The allocation probe warms each workload for 30 frames, measures exactly 600 ordinary frames, and
fails closed on missing exports or malformed scene/state fixtures. It observes Vector3
constructors/clones, collection calls, touch-input identity, HUD high-water state, and reused state
patch identities. It exercises minimal `Play`, starter `Player`, platformer `Character` and touch
controls, racing path/ranking/sector calls, shooter `Projectile` and `Play`, action-RPG `Enemy` and
`Play`, and defense `Attacker` and `Defense`.

## Red controls before implementation

These controls were run before the owning-layer implementation was applied:

```text
pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/path-follow.spec.ts
exit 1 — the new target test returned a fresh result instead of the supplied target

pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__/template-runtime-cost.spec.ts
exit 1 — the source-backed racing live call returned a fresh PathFollow result
```

The first command reported 1 failed and 5 passed tests. The second stopped at the racing target
identity sentinel before the fix; the old source-scanning loop could not observe this defect.

## Green evidence

```text
pnpm exec vitest run --config vitest.config.ts \
  packages/core/__tests__/path-follow.spec.ts \
  packages/create-threenative/__tests__/template-runtime-cost.spec.ts
exit 0 — 2 files, 9 tests passed

pnpm --filter @threenative/core build
exit 0

pnpm --dir packages/create-threenative typecheck
exit 0

pnpm test:templates
attempt 1: exit 1 — nested scaffold `pnpm test` exited 2
attempt 2: exit 0 — all seven scaffold loops completed

pnpm test:playtest
exit 0 — framework-movement, framework-camera, and abyss-framework-movement-axis passed
```

The playtest run selected the NVIDIA WebGPU adapter (`turing` architecture). It reported zero
console, network, and runtime diagnostics.

## Broader repository gates

```text
pnpm typecheck
exit 0

pnpm lint
exit 0 — 241 pre-existing complexity warnings, no lint errors

pnpm budgets
exit 0 — hard budgets passed; native-runtime LOC remained a review trigger

pnpm test
exit 1 — unrelated `packages/playtest/__tests__/e2e-runner.spec.ts` transport-only browser-error
assertion failed; 167 test files passed and 1 failed (1590 tests passed, 1 failed). The suite also
reported a temporary-directory count change from 62 to 63.
```

The template gate’s first nested failure was transient: its rerun passed without a code change.
The optional native-runtime install also printed an HTTP 404 for a prebuilt Linux manifest during
scaffold setup; the browser gates still completed successfully.

## Evidence limitation

No dedicated before/after image-diff or pixel-tolerance artifact was captured in this repair. The
visual claim is therefore limited to the successful WebGPU playtest assertion reports, adapter
diagnostics, and non-runtime-error checks; no image-diff result is claimed.

## Scope checks

```text
git diff --check
exit 0

No `WithTarget` or `as unknown as` target casts remain in the PathFollow3D callers, core contract,
or allocation probe.
```
