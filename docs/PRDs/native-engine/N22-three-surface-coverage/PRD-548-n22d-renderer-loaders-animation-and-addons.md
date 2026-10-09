# PRD-548 — Corpus gaps in renderer passes, loaders, animation and addons (N22d)

**Status:** NOT STARTED
**Priority:** P1 — 13 templates write post-node parameters and uniforms that the engine reads only once at lowering, and Midway's water reads scene depth and colour the engine does not expose, so their journeys cannot pass on the native engine
**Complexity:** 5 (MEDIUM) — 6–10 engine files across post effects, the render graph, glTF and geometry utilities; no new module
**Owner:** João
**Work package:** N22d, layers 6–9 — [three.js surface coverage](README.md)
**Depends on:** [PRD-547](PRD-547-n22c-tsl-and-shader-nodes.md) for its layers; [PRD-523 (N14a)](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md), [PRD-524 (N14b)](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-524-n14b-virtual-shadows-run-native.md), [PRD-526 (N14d)](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-526-n14d-post-effects-and-render-chains-run-native.md), [PRD-515 (N10)](../../done/native-engine/PRD-515-n10-native-gltf-cooked-assets-and-decoders.md) and [PRD-518 (N11c)](../../done/native-engine/N11-native-animation/PRD-518-n11c-skinning-palettes-and-pose-history.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

These are the four highest engine layers in the [N22 layer map](README.md#the-catalog-by-engine-layer):
renderer passes, post and render targets (5 of 45 entries supported), loaders and assets (0 of 1),
animation (12 of 27) and addons (1 of 6). The post chain binding itself — `pass`, `mrt`,
`RenderPipeline`, `RenderTarget`, `QuadMesh`, `TempNode`, `RendererUtils`, `NodeUpdateType` and the
nine display nodes — is back-end work in PRD-540 phase 3 (Wasm) and PRD-531 (V8); this PRD holds
the engine faults those chains hit. Most items here were open items in PRD-540 phase 3 (QA on the
uniform work) and PRD-531 (QA review); they moved here on 2026-10-08. The animation layer has no
gap that a corpus game uses: its backlog is in the README.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry and `tn_tsl_call`, so V8 and Wasm both get it. Port
the behaviour from the pinned three r185 source. A post-graph fix reads its live source each frame,
as `putNodes` already does for material graphs. A screen read is a render-graph target that a
transparent material samples after the opaque pass, as in r185.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Live post parameters and uniforms | template `src/render/` post chain writes `resolutionScale`, bloom parameters, `uniform.value` | the copy taken at lowering | Phase 1 |
| Scene depth and colour reads | core `WaterSurface3D` (`reflectionAt`, `thicknessAt`, `refractionAt`) in Midway; starter and rain | the catalog refusal | Phase 1 |
| Loaders | Midway's glTF aircraft and HDR environment | refusal | Phase 2 |
| Geometry and skinning utilities | `mergeGeometries`, `mergeVertices`, `SkeletonUtils.clone` | the V8 refusal | Phase 3 |

## Execution Phases

#### Phase 1: Renderer passes, post and render targets
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/renderer/post_effects.cpp`, `packages/runtime-native/src/engine/renderer/render_texture_pass.h`, `packages/runtime-native/src/engine/renderer/effects.cpp`, `packages/runtime-native/src/engine/renderer/graph/`, `packages/runtime-native/src/engine/renderer/renderer.cpp`
- [x] Post-node parameters set after the first render take effect: `resolutionScale` on the AO pass (`rawPass` copies it at lowering, `post_effects.cpp:281`; resize must read `source.effect->resolutionScale`), and `bloom()` strength, radius and threshold as uniforms. Users: 13 templates and Midway set `resolutionScale`; 13 templates and Bayview call `bloom`. Extends PRD-526. proof: fixture `tsl-post-live-parameters` added to the `render_post_addons` list, through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_post_addons`
  Moved from PRD-531 open items (2026-10-08).
  Done 2026-10-08 (57e3d7afd): `tsl-post-live-parameters` passes in `render_post_addons` 7/7 (red: "not a live post effect"). `PostEffects::syncScales` resizes on a new `resolutionScale`; `bloom()` exposes `strength`, `radius`, `threshold`, `smoothWidth` through `tslEffectParameter` and the shared facade; `player_imports` checks `bloom(...).strength.value` on V8 (red: TypeError setting `value`).
- [x] Post and render-texture graphs read `uniforms(graph)` each frame, so a `uniform.value` write inside a `setPostGraph` chain or a `convertToTexture` pass changes the next frame. Today they keep the copy from lowering (`post_effects.cpp:484`, `render_texture_pass.h:30`, used by `effects.cpp:240`). Users: 13 templates (post chain). Extends PRD-526. proof: fixture `tsl-post-uniform-write` added to the `render_post_addons` list, through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_post_addons`
  Moved from PRD-540 phase 3 (QA, HIGH, 2026-10-08).
  Done 2026-10-08 (57e3d7afd): post, render-texture and output passes keep the uniform nodes and write their values each frame; `tsl-post-uniform-write` passes in `render_post_addons` 7/7 (red: 100% pixels mismatched).
- [x] `viewportLinearDepth`, `linearDepth`, `cameraNear` and `cameraFar` read the scene depth as r185 does. Users: starter, rain, Midway (core `WaterSurface3D`). Extends PRD-523. proof: fixture `tsl-viewport-linear-depth` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_viewport` — **done 2026-10-09** (`01942ef45`): `tsl-viewport-linear-depth` (a water plane coloured by all four) matches the r185 golden, 4/4 observations, in `native_engine_render_viewport`; negative control (the renderer writing twice `camera.far`) fails it at 20.5% pixel mismatch.
- [x] `viewportSharedTexture` and `viewportDepthTexture` sample a copy of the scene colour and depth drawn before the transparent material. Users: Midway (core `WaterSurface3D`, `world-cells.ts`). Extends PRD-523. proof: fixture `tsl-viewport-shared-texture` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_viewport` — **done 2026-10-09**: the existing fixture `viewport-textures` already proves the claim (the frame behind a transparent water plane through `viewportSharedTexture`, and a second depth read through `viewportDepthTexture`); it matches the r185 golden, 4/4 observations, in `native_engine_render_viewport`, and the same control fails it at 20.5%. The named `tsl-viewport-shared-texture` was not added as a duplicate.
- [ ] The shadow-depth pass fills the camera slots, so a `positionNode` that reads them (a billboard) casts the shadow r185 casts. Plan from PRD-540: in the shadow caster block, set `kCameraWorldMatrix` to the inverse of the shadow `view`, `kCameraPosition` to that inverse's translation, and `kCameraProjectionMatrix` to `page->projection` or `shadow.projection`. The TRAA velocity pass needs nothing: it refuses every `positionNode` draw (`TN_TRAA_VELOCITY_UNSUPPORTED`). Users: Midway. Extends PRD-524. proof: fixture `shadows-billboard-position-node` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_shadows`
  Moved from PRD-540 phase 3 (2026-10-08).

#### Phase 2: Loaders and assets
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/assets/gltf/`, `packages/runtime-native/src/engine/renderer/` (PMREM input)
- [ ] A glTF material with `KHR_materials_clearcoat` loads into the clearcoat layer (f6c846377) instead of being refused. Users: Midway (imported aircraft). Extends PRD-515. proof: fixture `gltf-model-clearcoat` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_gltf`
- [ ] `HDRLoader` loads Midway's equirectangular environment into a texture that PMREM filters as r185 does. Users: Midway (`src/render/environment.ts`). Extends PRD-515 and [PRD-525](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-525-n14c-probes-run-native.md). proof: fixture `pmrem-hdr-equirect` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_pmrem`

#### Phase 3: Animation and addons
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/scene/geometry.cpp`, `packages/runtime-native/src/engine/animation/skinning/`, the binding registry
- [ ] `mergeGeometries` and `mergeVertices` (`BufferGeometryUtils`) build the same buffers as r185 over engine geometry on V8 and Wasm. Users: action-rpg, puzzle, racing, sailing, shooter, snow, starter, Midway, Bayview; core. Extends PRD-508. proof: fixture `geometry-derived-merge` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_geometry_derived`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`
- [ ] `SkeletonUtils.clone` on an engine `SkinnedMesh` gives a clone whose bones drive its own skin. Users: shooter, Bayview; core. Extends PRD-518. proof: fixture `skinned-clone` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_skinned`

New render groups need a line in the render-case list in `packages/runtime-native/cmake/NativeEngine.cmake`:
`render_viewport:tsl-viewport-*`, and the two post fixtures in the `render_post_addons` list. The
`shadows-*`, `gltf-model-*`, `pmrem-*`, `skinned-*` and `geometry-derived-*` globs already exist.
