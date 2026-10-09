# PRD-547 — Corpus gaps in TSL and shader nodes (N22c)

**Status:** NOT STARTED
**Priority:** P1 — 12 templates import `positionViewDirection` and 13 import `screenCoordinate`, which the shared TSL table lacks, and Midway's ocean lowers to WGSL the device refuses, so their journeys cannot pass on the native engine
**Complexity:** 5 (MEDIUM) — 6–10 engine files across the TSL table, the shader IR and WGSL emission; no new module
**Owner:** João
**Work package:** N22c, layer 5 — [three.js surface coverage](README.md)
**Depends on:** [PRD-546](PRD-546-n22b-materials-and-render-state.md) for its layers; [PRD-510 (N08a)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md), [PRD-511 (N08b)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-511-n08b-shader-packages-not-wgsl-text.md) and [PRD-512 (N08c)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

Layer 5 in the [N22 layer map](README.md#the-catalog-by-engine-layer) has 94 catalog entries and
the catalog marks none of them supported. That number is stale: the TSL names reach the engine
through one table (`abi/tsl_call.cpp`, called through `tn_tsl_call`), and the sync from the binding
registry does not read that table. 55 of the 86 `three/tsl` entries appear as names in the table.
The proposed catalog link in the README closes that drift.

Part of this work started in PRD-540 phase 3 ("Midway's TSL nodes are complete in the shared
table"): `cameraPosition`, `cameraProjectionMatrix`, `cameraWorldMatrix`, `positionGeometry`,
`normalWorld` and `varying` landed on `lane/ne-tsl-a` (52b7950c0, 5c2af603c, 1d55dd1d6, 43fcde0f3),
with the tsl-ir corpus at "32 graphs, 0 differ" and V8 `tsl_api` passing. Also done on feat:
swizzles (26ff3dd8d), the `addAssign` family, `dFdx`, `dFdy`, `sign`, `cbrt` (6a7662d90),
`texture(object, uv)` (25de2566a), `uniformArray` (fd29dcc32) and `clamp` defaults (20f1af053).
The screen reads (`viewportLinearDepth` and the others) are TSL names, but they read render-graph
targets, so they are in layer 6 ([PRD-548](PRD-548-n22d-renderer-loaders-animation-and-addons.md)).

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`): a TSL
name goes into the one table that V8 and Wasm both call; a lowering or stage fix goes into the
shader IR and its WGSL emission. Port the behaviour from the pinned three r185 source. A name box
proves the graph against r185 with the tsl-ir differential; a stage box proves the frame against an
r185 golden.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| TSL names | a game's or core's `three/tsl` import through the back-end entry or the native bundler | the catalog refusal | Phase 1 |
| Uniform semantics | `uniform(...)`, `.value`, `setName` in game and template graphs | silent wrong value or a mid-frame throw | Phase 2 |
| Lowering and the vertex stage | a `colorNode` or `positionNode` that the IR lowers to WGSL | an invalid program or a refusal | Phase 3 |

## Execution Phases

#### Phase 1: TSL names
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/abi/tsl_call.cpp`, `packages/runtime-native/src/engine/shader/ir.cpp`
- [ ] The TSL names that corpus games import and the shared table lacks lower as r185 does: `screenCoordinate` (13 templates), `positionViewDirection` (12 templates), `atan` (action-rpg, rain, snow), `hash` (action-rpg, runner, snow), `mod` (rain, snow), `time` (action-rpg, runner), `depth`, `frameGroup`, `mat2`, `screenSize` and `property` (rain), `fwidth` (snow), `getViewPosition`, `lightShadowMatrix` and `reference` (starter), `transformNormalToView` (sailing), and Bayview's `mx_fractal_noise_float`, `normalMap`, `normalWorldGeometry`, `saturation` and `triplanarTexture`. Extends PRD-510. proof: one tsl-ir corpus graph per name through `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_tsl_js`
- [ ] The TSL names that core reaches and the native bundler refuses lower as r185 does: `normalLocal`, `tangentLocal`, `positionPrevious` and `storage` (the four of the ten names that Midway's native bundler refused on 2026-10-08 that are not screen reads). Users: Midway, through core `projection-skinned.ts` (GPU skinning, on by default) and skinned history. Extends PRD-510 and [PRD-513](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-513-n08d-compute-multipass-and-a-dynamic-graph.md). proof: the same differential with one graph per name, and Midway's desktop build with the native bundler refusing none of these names

#### Phase 2: Uniform semantics
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/abi/tsl_call.cpp`, `packages/runtime-native/src/engine/shader/graph/`
- [ ] Uniform values keep r185's types: a value whose type does not match the uniform (a `Vector3` written to a `vec2`) is refused by name, the getter returns the JS value that was written, and a node that is not a uniform answers r185's `ConstNode.value`. The engine owns the type check; each back end picks lanes from the engine's type, not from `constructor.name`. Users: 14 games use `uniform`. Extends PRD-510. proof: a case per fault in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_uniform_value` and in `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_tsl_js`
  Moved from PRD-540 phase 3 (QA, 2026-10-08).
- [ ] Two uniforms with the same `setName` fail at graph build with `TN_TSL_UNIFORM_CONFLICT`, as three does, not mid-frame. Users: 14 games use `uniform`. Extends PRD-510. proof: a conflicting-names graph in `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>` that fails at build
  Moved from PRD-540 phase 3 (QA, 2026-10-08).

#### Phase 3: Lowering and the vertex stage
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/shader/`, `packages/runtime-native/src/engine/shader/standard.cpp`
- [ ] `normalWorld` on a `DoubleSide` material flips on back faces (r185 `negateOnBackSide`), and reads `normalNode` and a normal map when set. Users: Midway, rts, sailing, snow read `normalWorld`; 9 games use `DoubleSide`. Extends PRD-512. proof: fixture `tsl-normal-world-doubleside` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_tsl_stage`
  Moved from PRD-540 phase 3 (2026-10-08). `BackSide` is already handled.
- [ ] Midway's ocean `colorNode` lowers to WGSL that the device accepts and draws as r185 does. Today it fails with `TN_NATIVE_SHADER_INVALID` and aborts the windowed run. Users: Midway (core ocean). Extends PRD-511. proof: fixture `tsl-stage-ocean-color` with the same graph shape through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_tsl_stage`; the WGSL validation error is the red
- [ ] `texture(object)` and `texture(object).level(n)` sample in the vertex stage (`textureSampleLevel`) when a `positionNode` reads them; 25de2566a refuses the vertex stage by name. Users: Midway (the ripple height feeds the ocean `positionNode`); core. Extends PRD-512 and 25de2566a. proof: fixture `tsl-stage-vertex-texture-level` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_tsl_stage`
- [ ] A carried `varying(node)` whose graph type is unknown is typed by a scratch vertex lowering that gets the inputs `linkNodes` gives, so a node that reads `positionLocal` or another linked input does not refuse. Not reproduced yet: the first step is a failing graph. Users: action-rpg, rain, runner, Midway use `varying`. Extends PRD-510. proof: `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>` with a `varying` graph that reads `positionLocal`
  Moved from PRD-540 phase 3 (2026-10-08).

New render groups need a line in the render-case list in `packages/runtime-native/cmake/NativeEngine.cmake`:
`render_tsl_stage:tsl-normal-world-*,tsl-stage-*`.
