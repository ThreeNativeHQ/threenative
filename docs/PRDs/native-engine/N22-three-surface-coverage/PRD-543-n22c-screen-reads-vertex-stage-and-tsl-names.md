# PRD-543 — Corpus TSL reaches the screen, the vertex stage and the shared name table (N22c)

**Status:** NOT STARTED
**Priority:** P1 — Midway's ocean and water, starter, rain and four more corpus games build TSL graphs that the engine refuses or lowers to invalid WGSL, so their journeys cannot pass on the native engine
**Complexity:** 5 (MEDIUM) — 6–10 engine files across the shader IR, WGSL emission and the render graph; no new module
**Owner:** João
**Work package:** N22c — [three.js surface coverage](README.md)
**Depends on:** [PRD-510 (N08a)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md), [PRD-511 (N08b)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-511-n08b-shader-packages-not-wgsl-text.md) and [PRD-523 (N14a)](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

The corpus scan in the [N22 README](README.md#ranked-gaps) found these TSL names and stages in
real games. Ranks 8, 10, 17, the Midway-only WGSL and vertex-stage items, and the `varying` fault.
The screen reads come from core's `WaterSurface` (`packages/core/src/water-surface.ts`), which
Midway's ocean uses; starter and rain also import them directly. Part of this work started in
PRD-540 phase 3 ("Midway's TSL nodes are complete in the shared table"): `cameraPosition`,
`cameraProjectionMatrix`, `cameraWorldMatrix`, `positionGeometry`, `normalWorld` and `varying`
landed on `lane/ne-tsl-a` (52b7950c0, 5c2af603c, 1d55dd1d6, 43fcde0f3), with the tsl-ir corpus at
"32 graphs, 0 differ" and V8 `tsl_api` passing. The open parts of that box are here now.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`): a TSL
name goes into the one table (`abi/tsl_call.cpp`) that V8 and Wasm both call through
`tn_tsl_call`; a stage or WGSL fix goes into the shader IR and its lowering. Port the behaviour
from the pinned three r185 source. Each name box proves the graph against r185 with the tsl-ir
differential, and each stage box proves the frame against an r185 golden.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Screen reads | core `WaterSurface` and a game's `viewportLinearDepth` through the back-end entry | the catalog refusal | Phase 1 |
| Vertex-stage reads | a `positionNode` that samples a texture or reads the camera, in colour and shadow passes | wrong shadow or refused pipeline | Phase 2 |
| TSL names | a game's `three/tsl` import | the catalog refusal | Phase 3 |

## Execution Phases

#### Phase 1: Screen reads
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/abi/tsl_call.cpp`, `packages/runtime-native/src/engine/shader/`, `packages/runtime-native/src/engine/renderer/` (render graph depth and scene-colour targets)
- [ ] `viewportLinearDepth`, `linearDepth`, `cameraNear` and `cameraFar` read the scene depth as r185 does. Users: starter, rain, Midway (core `water-surface.ts`). Extends PRD-523. proof: fixture `tsl-viewport-linear-depth` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_viewport`
- [ ] `viewportSharedTexture` and `viewportDepthTexture` sample the scene colour and depth drawn before the material. Users: Midway (core `water-surface.ts`, `world-cells.ts`). Extends PRD-523. proof: fixture `tsl-viewport-shared-texture` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_viewport`
- [ ] Midway's ocean `colorNode` lowers to WGSL that the device accepts and draws as r185 does. Users: Midway (core ocean). Extends PRD-511. proof: a fixture with the same graph shape, `tsl-viewport-ocean-color`, through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_viewport`; the WGSL validation error is the red

#### Phase 2: The vertex stage
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/shader/`, `packages/runtime-native/src/engine/renderer/renderer.cpp` (shadow caster loop)
- [ ] `texture(object)` and `texture(object).level(n)` sample in the vertex stage when a `positionNode` reads them. Users: Midway; core. Extends [PRD-512](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md) and 25de2566a. proof: fixture `tsl-vertex-texture-level` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_vertex_stage`
- [ ] The shadow-depth pass fills the camera slots, so a `positionNode` that reads them (a billboard) casts the shadow r185 casts. Plan from PRD-540: in the shadow caster block, set `kCameraWorldMatrix` to the inverse of the shadow `view`, `kCameraPosition` to that inverse's translation, and `kCameraProjectionMatrix` to `page->projection` or `shadow.projection`. The TRAA velocity pass needs nothing: it refuses every `positionNode` draw (`TN_TRAA_VELOCITY_UNSUPPORTED`). Users: Midway. Extends PRD-512 and [PRD-524](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-524-n14b-virtual-shadows-run-native.md). proof: fixture `shadows-billboard-position-node` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_shadows`
- [ ] A carried `varying(node)` whose graph type is unknown is typed by a scratch vertex lowering that gets the inputs `linkNodes` gives, so a node that reads `positionLocal` or another linked input does not refuse. Users: action-rpg, rain, runner, Midway use `varying`. Extends PRD-510. Not reproduced yet: the first step is a failing graph. proof: `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>` with a `varying(positionLocal…)` corpus graph

#### Phase 3: TSL names
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/abi/tsl_call.cpp`, `packages/runtime-native/src/engine/shader/ir.cpp`
- [ ] The TSL names that corpus games import and the shared table lacks lower as r185 does: `atan`, `hash`, `mod`, `time`, `mx_fractal_noise_float`, `normalMap`, `normalWorldGeometry`, `saturation` and `triplanarTexture`. Users: action-rpg, rain, runner, snow, Bayview. Extends PRD-510. proof: one tsl-ir corpus graph per name through `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_tsl_js`

New render groups need a line in the render-case list in `packages/runtime-native/cmake/NativeEngine.cmake`:
`render_viewport:tsl-viewport-*` and `render_vertex_stage:tsl-vertex-*` (shared with PRD-541). The
`shadows-*` glob already exists.
