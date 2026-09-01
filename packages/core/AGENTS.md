# AGENTS.md — @threenative/core

Read `/AGENTS.md` first. This file covers only what is different here.

## What belongs in this package

The wiring every game repeats and no game should write: renderer bootstrap and WebGPU
fallback, the fixed-step loop, scene lifecycle, plugin wiring, input mapping, asset loading,
animation playback, hot-reload state preservation, the throttled state store, accelerated
scene ray queries, queryable heightfield storage shared by rendering and physics, and the entity
registry that makes a running game inspectable.

That list is closed. Adding to it needs a PRD and a line in `CHARTER.md`. Pooled tracer streaks
(`TracerPool3D`) and sprite pixel-data generation (`softCircleDataTexture`) are admitted under
that rule — see `docs/architecture/CHARTER.md`'s "Tracer streaks and sprite pixel data are
mechanism" and `docs/PRDs/done/PRD-162-tracer-streaks-and-sprite-pixel-data-are-mechanism.md`.

### World subpath

The optional `@threenative/core/world` subpath owns numeric heightfield storage, ordered world
passes, bounded terrain-tile residency, LOD composition, skirts, collider lifetime and capability
reporting. `Heightfield` and `TerrainTiles` require the game's sampler and surface input; the
subpath never selects a terrain shape, material, biome, species, lighting or platform path.
`residentTileBudget` and `residentByteBudget` are hard limits, and `getWorldCapabilities` must
report `gpu`, `cpu-fallback` with its reduced iteration count, or `unsupported` with the reason.
Use `heightAt`, `normalAt` and `sample` on the resident field so queries stay tied to the same
stored values that produce geometry and collision. `follow` is the only residency update entry
point; a tile is evicted as one unit with its collider, geometry and asset release.

`picking.ts` is the one place a third-party dependency other than `three` and `zustand`
reaches core. It is contained deliberately: `ScenePicker` builds a hierarchy on first use,
patches no `three` prototype, and a game that never calls `ctx.raycast` never builds one.
Changing that containment is a `CHARTER.md` question, not an implementation detail. See
`docs/PRDs/done/PRD-056-scene-picking-abstraction.md`.

## What must never enter this package

- **Anything a screenshot shows** — materials, shaders, TSL, lights, tonemapping, exposure,
  post-processing, camera framing. Not as code, and not as a `defineGame` option.
  `postprocessing: ['bloom']` was a real v1 mistake and is deliberately absent from the API.
  Those defaults ship as generated source in `create-threenative/templates/*/src/render/`.
- **React from the main entry or scene graph.** The optional `@threenative/core/react` subpath is
  UI plumbing: its peer dependencies are optional, the main entry cannot reach it, and it renders
  generated game appearance into `CanvasLayer`. Core stays consumable from R3F; React never owns
  the game loop or world scene.

## This package runs on the native host unmodified

Core has no export condition and must never need one — it is the same build on web and
native. Concretely:

- Use only globals the host shims (`fetch`, `localStorage`, `Worker`, `OffscreenCanvas`,
  `createImageBitmap`, WebGPU, streams). `document` and `window` exist on native as a
  **Three.js compatibility stub** — `document.body.appendChild` is a no-op and
  `createElement('canvas')` returns a fake. Treat any DOM reach beyond canvas acquisition as
  a native break.
- No dynamic `import()` and nothing that forces code splitting; the native bundle is a
  single import-free ESM file, asserted by `examples/native-smoke`.
- No WASM. If a capability needs it, it belongs behind a plugin (like physics), not here.

## The API is one page

`src/index.ts` is the whole public surface and is meant to fit on one page. Adding an export
is a design decision, not an implementation detail. Subpath exports (`./*`) provide
modularity — a new package does not.

Public and module-local interfaces use an `I` prefix. Classes and type aliases do not; in
particular, Godot-borrowed node names stay unchanged.

## Shape of the runtime

- `defineGame(config)` returns an `IGame` with `start()` / `stop()`. `stop()` must fully
  reverse `start()`: loop stopped, scene exited, registry cleared, plugin `dispose` called,
  cleanups drained, input disposed, store stopped, renderer disposed.
- A `Scene` is a class with five optional methods — `load`, `enter`, `update`, `exit`,
  `render`. Do not add a sixth.
- `ICtx` hands out the real objects: `ctx.scene` is a `THREE.Scene`, `ctx.camera` is a real
  camera, `ctx.physics` is whatever the plugin installed. There is no wrapper to unwrap, and
  none may be introduced.
- `ctx.state.set()` is called at loop rate and coalesces; the store flushes on an interval
  (100ms default) so React never re-renders at 60Hz. Never flush per frame.
- `Registry.snapshot()` prefers an entity's own `debug()` and falls back to `autoFields`. It
  is exposed as `window.__THREENATIVE__` in dev builds only, and playtest reads it.
- Scene-owned time lives behind `ctx.after`, `ctx.every`, `ctx.tween`; `Scheduler` and
  `ScheduleHandle` are the public supporting types, and transitions cancel it.
- `AudioBus` is the audio sink; `IAudioBusOptions` and `IAudioPlayOptions` configure listener
  and voice cleanup.
- `ctx.random` is the seeded randomness surface playtest reports; `createRandom` and `IRandom`
  are its public types.

## Tests

`__tests__/*.spec.ts`, vitest, node environment — anything touching the DOM or a GPU needs a
stub. `constraints.spec.ts` and `build.spec.ts` guard the rules above; if one fails, the
change is the problem, not the test.
