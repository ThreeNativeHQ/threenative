<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/core

Read `/AGENTS.md` first. This file only covers what is different here.

## What belongs in this package

The wiring every game repeats and no game should write: renderer bootstrap and WebGPU
fallback, the fixed-step loop, scene lifecycle, plugin wiring, input mapping, asset
loading, the throttled state store, and the entity registry that makes a running game
inspectable.

That list is closed. Adding to it needs a PRD and a line in `DESIGN.md`.

## What must never enter this package

Anything a screenshot shows. No materials, shaders, TSL, lights, tonemapping, exposure,
post-processing, or camera framing — not as code, and not as a `defineGame` option.
`postprocessing: ['bloom']` was a real v1 mistake and is explicitly removed from the API.
Those defaults ship as generated source in `packages/create-threenative/templates/*/src/render/`.

Zero React dependency, ever. `@threenative/core` must stay consumable from R3F; the reverse
is a one-way door.

## The API is one page

`src/index.ts` is the whole public surface and it is meant to fit on one page. Adding an
export is a design decision, not an implementation detail. Subpath exports (`./*`) provide
modularity — a new package does not.

## Shape of the runtime

- `defineGame(config)` returns a `Game` with `start()` / `stop()`. `stop()` must fully
  reverse `start()`: loop stopped, scene exited, registry cleared, plugin `dispose` called,
  cleanups drained, input disposed, store stopped, renderer disposed.
- A `Scene` is a class with five optional methods — `load`, `enter`, `update`, `exit`,
  `render`. Do not add a sixth.
- `Ctx` hands out the real objects: `ctx.scene` is a `THREE.Scene`, `ctx.camera` is a real
  camera, `ctx.physics` is whatever the plugin installed. There is no wrapper to unwrap,
  and none may be introduced.
- `ctx.state.set()` is called at loop rate and coalesces; the store flushes on an interval
  (100ms default) so React never re-renders at 60Hz. Never flush per frame.
- `Registry.snapshot()` prefers an entity's own `debug()` and falls back to `autoFields`.
  It is exposed as `window.__THREENATIVE__` in dev builds only, and playtest reads it.

## Tests

`__tests__/*.spec.ts`, vitest, node environment — so anything touching the DOM or a GPU
needs a stub. `constraints.spec.ts` and `build.spec.ts` guard the rules above; if one of
them fails, the change is the problem, not the test.
