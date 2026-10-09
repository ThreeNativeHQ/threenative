# PRD-544 — Corpus uniforms, post parameters and loaders behave as three r185 (N22d)

**Status:** NOT STARTED
**Priority:** P1 — 13 templates write post-node parameters and uniforms that the engine reads only once at lowering, so their post chains stop answering the game after the first frame
**Complexity:** 5 (MEDIUM) — 6–10 engine files across post effects, the TSL table, glTF and skinning; no new module
**Owner:** João
**Work package:** N22d — [three.js surface coverage](README.md)
**Depends on:** [PRD-510 (N08a)](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md), [PRD-526 (N14d)](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-526-n14d-post-effects-and-render-chains-run-native.md), [PRD-515 (N10)](../../done/native-engine/PRD-515-n10-native-gltf-cooked-assets-and-decoders.md) and [PRD-518 (N11c)](../../done/native-engine/N11-native-animation/PRD-518-n11c-skinning-palettes-and-pose-history.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

The corpus scan in the [N22 README](README.md#ranked-gaps) ranks these items 2, 4, 16, the
Midway-only loader and update items, the Bayview-only skinned read, and the two uniform faults.
Most were open items in PRD-540 phase 3 (QA on the uniform work, 2026-10-08) and PRD-531
(`## Open items`, QA review 2026-10-08); they moved here on 2026-10-08 so that each gap has one
box. The Midway items come from the lane-midway-native runs on 2026-10-08.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry and `tn_tsl_call`, so V8 and Wasm both get it. Port
the behaviour from the pinned three r185 source. A post-graph fix reads its live source each frame,
as `putNodes` already does for material graphs.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Live post uniforms and parameters | template `src/render/` post chain writes `uniform.value`, `resolutionScale`, bloom parameters | the copy taken at lowering | Phase 1 |
| Loaders and skinned helpers | Midway's glTF and HDR environment; `SkeletonUtils.clone` in shooter, Bayview and core | refusal or wrong pose | Phase 2 |
| Midway's update loop | Midway on the native engine | the "argument is not a Vector3" error | Phase 3 |

## Execution Phases

#### Phase 1: Uniforms and post parameters
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/renderer/post_effects.cpp`, `packages/runtime-native/src/engine/renderer/render_texture_pass.h`, `packages/runtime-native/src/engine/renderer/effects.cpp`, `packages/runtime-native/src/engine/abi/tsl_call.cpp`
- [ ] Post and render-texture graphs read `uniforms(graph)` each frame, so a `uniform.value` write inside a `setPostGraph` chain or a `convertToTexture` pass changes the next frame. Today they keep the copy from lowering (`post_effects.cpp:484`, `render_texture_pass.h:30`, used by `effects.cpp:240`). Users: 13 templates (post chain). Extends PRD-526. proof: fixture `tsl-post-uniform-write` added to the `render_post_addons` list, through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_post_addons`
  Moved from PRD-540 phase 3 (QA, HIGH).
- [ ] Post-node parameters set after the first render take effect: `resolutionScale` on the AO pass (`rawPass` copies it at lowering, `post_effects.cpp:281`; resize must read `source.effect->resolutionScale`), and `bloom()` strength, radius and threshold as uniforms. Users: 13 templates and Midway set `resolutionScale`; 13 templates and Bayview call `bloom`. Extends PRD-526. proof: fixture `tsl-post-live-parameters` added to the `render_post_addons` list, through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_post_addons`
  Moved from PRD-531 open items.
- [ ] Uniform values keep r185's types: a value whose type does not match the uniform (a `Vector3` written to a `vec2`) is refused by name, the getter returns the JS value that was written, and a node that is not a uniform answers r185's `ConstNode.value`. The engine owns the type check; each back end picks lanes from the engine's type, not from `constructor.name`. Users: 14 games use `uniform`. Extends PRD-510. proof: a case per fault in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_uniform_value` and in `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_tsl_js`
  Moved from PRD-540 phase 3 (QA).
- [ ] Two uniforms with the same `setName` fail at graph build with `TN_TSL_UNIFORM_CONFLICT`, as three does, not mid-frame. Users: 14 games use `uniform`. Extends PRD-510. proof: a conflicting-names graph in `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>` that fails at build
  Moved from PRD-540 phase 3 (QA).

#### Phase 2: Loaders and skinned helpers
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/assets/` (glTF), `packages/runtime-native/src/engine/scene/` (skinning), the binding registry
- [ ] A glTF material with `KHR_materials_clearcoat` loads into the clearcoat layer (f6c846377) instead of being refused. Users: Midway. Extends PRD-515. proof: fixture `gltf-model-clearcoat` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_gltf`
- [ ] `HDRLoader` loads Midway's equirectangular environment into a texture that PMREM filters as r185 does. Users: Midway (`src/render/environment.ts`). Extends PRD-515 and [PRD-509](../../done/native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md). proof: fixture `pmrem-hdr-equirect` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_pmrem`
- [ ] `SkeletonUtils.clone` on an engine `SkinnedMesh` gives a clone whose bones drive its own skin. Users: shooter, Bayview; core. Extends PRD-518. proof: fixture `skinned-clone` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_skinned`
- [ ] `Mesh.getVertexPosition` on a `SkinnedMesh` applies the skin, as r185 does. Users: Bayview (enemy hit tests). Extends PRD-518. proof: fixture `scene-object-bounds-skinned-vertex` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_object_bounds`
  Moved from PRD-531 open items.

#### Phase 3: Midway's update loop
**Status:** NOT STARTED
**Files:** found by the reproduction
- [ ] Midway's update loop on the native engine reports no "argument is not a Vector3" error. The first step names the call that raises it and reproduces it in a native test against r185 behaviour. Users: Midway. proof: the reproduction's ctest, then Midway's journey with `node packages/playtest/dist/runner/cli.js <midway journey>.playtest.json --target desktop` and no such error in its log
