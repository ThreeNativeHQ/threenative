# PRD-552 — BatchedMesh on the native engine

**Status:** DONE (2026-10-09)
**Priority:** P1 — the V8 bundler refuses every `@threenative/core` game, because core's projection retains `BatchedMesh`, so PRD-531's last box (the `minimal` journey on desktop) cannot start
**Complexity:** 5 (MEDIUM) — one scene class, one render-database path over the existing instanced draw, one binding; no new module
**Owner:** João
**Work package:** N22a object model ([README](../../native-engine/N22-three-surface-coverage/README.md) backlog item 1), for PRD-531
**Depends on:** [PRD-514](PRD-514-n09-native-renderer-and-standard-materials.md) (done), [PRD-531](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md)

## Context

`bundleNativeEngine` refuses a core game with `TN_NATIVE_ENGINE_UNBOUND: the game retains an
unsupported core import`. Core's projection (`projection-apply.ts`, `render/batched-velocity.ts`,
`picking.ts`) imports `BatchedMesh`, and the V8 facade binds it to the `unsupported` placeholder
(`core-three.mjs`). The facade modules are wrapped by the bundler, so the placeholder survives in every
core game, whether or not the game projects. The Wasm back end refuses the same name at use, through
the catalog (`TN_NATIVE_UNSUPPORTED_BATCHEDMESH`). Neither runs three's `BatchedMesh`.

Core uses eight members: `addGeometry`, `addInstance`, `setMatrixAt`, `getMatrixAt`, `setColorAt`,
`setVisibleAt`, `sortObjects` and `perObjectFrustumCulled`. The engine already draws an
`InstancedMesh` (per-instance matrices and colours) in one draw.

## Solution

`BatchedMesh` is an engine `Mesh` that holds its geometries and its instances (geometry id, matrix,
colour, visibility). The render database draws each geometry's visible instances as one instanced
draw, over the `InstancedMesh` path. One binding serves V8 and Wasm; the catalog marks it
`supported`, and the V8 facade drops the placeholder.

## Decisions

- 2026-10-09, owner: on V8, a three export the engine does not provide is refused **at use**, by name,
  as on Wasm (`three-native/src/refused.ts`, `TN_NATIVE_UNSUPPORTED_<NAME>`), not at build. The
  bundler's "the game retains an unsupported core import" check is removed. Why: core's WebGL2
  fallback is `await import("three")`, so the bundler keeps the whole facade namespace and every
  placeholder in it, and the build-time check refused every core game whether or not it used one.

## Execution Phases

#### Phase 1: The engine draws a BatchedMesh as r185 does
**Status:** DONE

- [x] A `BatchedMesh` with two geometries and several instances (moved, recoloured, one hidden) draws as r185 draws it. proof: fixture `batched-mesh` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_batched` — 2026-10-09: `batched-mesh` (a box and a sphere, five drawn instances with matrices and colours, a sixth hidden) matches the r185 golden, 2/2 observations. The geometries are non-indexed: r185's WebGPU path draws a second indexed geometry from index 0 (its golden showed the box inside each sphere), so that path is not compared.
- [x] `getMatrixAt`, `getColorAt` and `getVisibleAt` read back what was set, and `addInstance` past `maxInstanceCount` refuses as three does. proof: a scene test case in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene` — 2026-10-09: `native_engine_scene_batched_mesh` passes: read-back, a freed id reused first, and three's messages for the instance cap, the reserved space and a deleted id.

#### Phase 2: Both back ends bind it, and a core game bundles on V8
**Status:** DONE

- [x] The V8 player and the Wasm module construct and draw a `BatchedMesh`. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` and a V8 player test — 2026-10-09: the Wasm renderer playtest reads `batchedStrip` (red, green, then the clear colour for the hidden instance and the empty column), exit 0; the new `native_engine_player_batched_mesh` reads the same strip back from a V8 render target, pass. That test found the V8 facade had no `setClearColor` and the player cleared V8 frames to the demos' dark blue: the facade now has three's clear-colour methods, and V8 frames and targets clear to them (black, opaque, by default).
- [x] A `@threenative/core` game bundles for the V8 player. proof: `native_engine_player_imports` asserts that the core game bundles, where it now asserts the refusal — 2026-10-09: `native_engine_player_imports` bundles the core game (it asserted the refusal before), and checks that a game constructing `Points` fails at that call with `TN_NATIVE_UNSUPPORTED_POINTS`, pass. See Decisions.

## Acceptance criteria

- [x] The `minimal` template bundles for the V8 player, so PRD-531's journey box can run. proof: `bundleNativeEngine` on a fresh `minimal` scaffold's `src/game.ts` exits without a refusal — 2026-10-09: `bundleNativeEngine` on the fresh scaffold's `src/game.ts` (`/tmp/threenative-template-playtests-pJgRLS/minimal`) exits without a refusal. Its `--check-game` run then stops at `TN_NATIVE_ASSET_PACKAGE_MISSING` (no cooked `assets.tnpk` beside a bare bundle), which is PRD-531's desktop build and journey.
