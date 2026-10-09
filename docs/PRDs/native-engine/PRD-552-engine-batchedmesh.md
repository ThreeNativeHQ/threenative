# PRD-552 — BatchedMesh on the native engine

**Status:** NOT STARTED
**Priority:** P1 — the V8 bundler refuses every `@threenative/core` game, because core's projection retains `BatchedMesh`, so PRD-531's last box (the `minimal` journey on desktop) cannot start
**Complexity:** 5 (MEDIUM) — one scene class, one render-database path over the existing instanced draw, one binding; no new module
**Owner:** João
**Work package:** N22a object model ([README](N22-three-surface-coverage/README.md) backlog item 1), for PRD-531
**Depends on:** [PRD-514](../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) (done), [PRD-531](PRD-531-n18-v8-game-runtime-adapter.md)

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

## Execution Phases

#### Phase 1: The engine draws a BatchedMesh as r185 does
**Status:** NOT STARTED

- [ ] A `BatchedMesh` with two geometries and several instances (moved, recoloured, one hidden) draws as r185 draws it. proof: fixture `batched-mesh` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_batched`
- [ ] `getMatrixAt`, `getColorAt` and `getVisibleAt` read back what was set, and `addInstance` past `maxInstanceCount` refuses as three does. proof: a scene test case in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene`

#### Phase 2: Both back ends bind it, and a core game bundles on V8
**Status:** NOT STARTED

- [ ] The V8 player and the Wasm module construct and draw a `BatchedMesh`. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` and a V8 player test
- [ ] A `@threenative/core` game bundles for the V8 player. proof: `native_engine_player_imports` asserts that the core game bundles, where it now asserts the refusal

## Acceptance criteria

- [ ] The `minimal` template bundles for the V8 player, so PRD-531's journey box can run. proof: `bundleNativeEngine` on a fresh `minimal` scaffold's `src/game.ts` exits without a refusal
