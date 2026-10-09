# PRD-546 — Corpus gaps in materials, textures and render state (N22b)

**Status:** IN PROGRESS — the `polygonOffset` box is in progress on lane-midway-native
**Priority:** P1 — every corpus game passes texture constants the engine does not implement, and 12 templates read `Material` members it refuses, so PRD-533's visual baselines cannot pass on the native engine
**Complexity:** 5 (MEDIUM) — 6–10 engine files across scene materials, GPU resources and the standard shader; no new module
**Owner:** João
**Work package:** N22b, layer 4 — [three.js surface coverage](README.md)
**Depends on:** [PRD-545](PRD-545-n22a-math-object-model-and-geometry.md) for its layers; [PRD-514 (N09)](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) and [PRD-509 (N07)](../../done/native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

Layer 4 in the [N22 layer map](README.md#the-catalog-by-engine-layer) is the largest: 206 catalog
entries, 20 supported, 168 `partial` and 18 unsupported. Most of the partial entries are texture,
blend, depth and stencil constants marked `native-not-implemented`: the back end binds the value,
but the engine does not act on every one. `CanvasTexture` exists on the browser back end only as
a one-mip `DataTexture` (`packages/three-native/src/texture-sources.ts`), and V8 refuses it.
Constants that no corpus game uses (compressed formats, stencil, blend factors) are in the README
backlog.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry, so V8 and Wasm both get it. Port the behaviour from
the pinned three r185 source. Each box proves the engine against a golden from headed-WebGPU three
r185 (fixtures in `packages/three-native/tests/compatibility/fixtures/`). When a member becomes
real, the catalog marks it `supported` through `sync-native-status`.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Material members and render state | template `src/render/` and game materials through the back-end entry | refusal or silent no-op | Phase 1 |
| Texture classes and constants | `new CanvasTexture()`, `new Data3DTexture()`, sampler and format constants | the one-mip browser fallback; the V8 refusal | Phase 2 |

## Execution Phases

#### Phase 1: Material members and render state
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/src/engine/scene/material.cpp`, `packages/runtime-native/src/engine/renderer/`, `packages/runtime-native/src/engine/shader/standard.cpp`, `packages/runtime-native/src/engine/abi/bindings_material.cpp`
- [x] `Material.prototype.onBeforeCompile` and `Material.prototype.customProgramCacheKey` read as r185's defaults, so the template check `material.onBeforeCompile !== Material.prototype.onBeforeCompile` runs without a refusal. Users: 12 templates (`src/render/materialAssignments.ts`, `backlightMaterial.ts`); core. Extends PRD-514. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` with a case that reads both members, and `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_catalog_coverage`
  Done 2026-10-08: already served by the shared `object-surface.ts` Material on both back ends; `browser-backend-smoke.ts` gains the case (both hooks read `Material.prototype`, a game hook is told apart): `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` passes, and `native_engine_v8_catalog_coverage` passes.
- [x] `vertexColors` multiplies the diffuse colour by the `color` attribute (a shader variant). Users: platformer, shooter, snow, Midway, Bayview; core `render/material-key.ts`, `render/world-impostor-surface.ts`. Extends PRD-514. proof: fixture `materials-vertex-colors` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  Done 2026-10-08: fixture `materials-vertex-colors` (rgb on a basic plane and a lit box, rgba on a transparent plane, a control with vertexColors off) passes in `native_engine_standard_materials_fixtures` (red: BLOCKED "vertexColors is not settable"; control with the shader tint off: 11.8% pixels mismatched). The colour rides the instanceColor varying as r185's vec4 product; vertex-coloured meshes leave the batched lane.
- [ ] `material.vertexNode` replaces the clip-space position, as r185's `NodeMaterial.vertexNode` does. Users: rain, shooter, Midway (water effects, particles: `cameraProjectionMatrix.mul(...)`); core `world-cells.ts`. Extends [PRD-512](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md). proof: fixture `materials-vertex-node` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  Moved from PRD-540 phase 3 (2026-10-08).
- [ ] `polygonOffset`, `polygonOffsetFactor` and `polygonOffsetUnits` set the pipeline depth bias. Users: shooter, Midway (model damage, rear station), Bayview. Extends PRD-514. proof: fixture `materials-polygon-offset` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  In progress on lane-midway-native (2026-10-08).
- [x] `forceSinglePass` draws a transparent `DoubleSide` material in one pass, as r185 does; without it the two-pass draw of 510d3fbe5 applies. Users: Midway (ocean, Devastator, imported aircraft). Extends PRD-514. proof: fixture `materials-force-single-pass` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  Done 2026-10-08: fixture `materials-force-single-pass` (two transparent DoubleSide torus knots, one with forceSinglePass) passes in `native_engine_standard_materials_fixtures` (red: BLOCKED "forceSinglePass is not settable"; control drawing it in two passes anyway: 3.05% pixels mismatched); the DoubleSide fixtures still pass.

#### Phase 2: Textures and texture constants
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/renderer/gpu_resources.cpp` (texture and sampler state), the binding registry, `packages/three-native/src/texture-sources.ts`
- [x] The texture constants the corpus passes take effect: the filters (`NearestFilter`, `LinearFilter`, `LinearMipmapLinearFilter`), the wraps (`ClampToEdgeWrapping`, `RepeatWrapping`), the formats and types (`RGBAFormat`, `UnsignedByteType`, `FloatType`, `HalfFloatType`), `SRGBColorSpace` and `EquirectangularReflectionMapping`. The catalog status of each one moves from `partial` to `supported`. Users: all 15 games; core. Extends PRD-509. proof: one `textures-data-<family>` fixture per family through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`, and `pnpm exec vitest run packages/three-native/__tests__/catalog-registry.spec.ts`
  Done 2026-10-08: `render_data_textures` 6/6 pass with new fixtures `textures-data-filters`, `-wraps` and `-equirect` beside `-rgba8`, `-float` and `-half` (red: `-wraps` 14.2% mismatched, texture `offset` and `rotation` were dropped; fixed in 4ca7a8c4c). One engine table `kThreeConstants` feeds the V8 globals and the registry dump; `sync-native-status` marks exactly those 31 constants `supported` (13 moved from `partial`); `catalog-registry.spec.ts` 5/5 (red on the previous catalog: 13 missing).
- [ ] `CanvasTexture` is an engine texture class with a full mip chain on V8 and Wasm; the browser one-mip fallback goes. Users: 11 templates, Midway, Bayview. Extends PRD-509. proof: fixture `textures-data-canvas-mips` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`
- [ ] `Data3DTexture` uploads a 3D texture and TSL `texture3D` samples it. Users: rain; core `fluid-particles.ts`, `render/probe-volume.ts`. Extends PRD-509 and [PRD-510](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md). proof: fixture `textures-data-3d` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`

The fixture names above match the existing `materials-*` and `textures-data-*` globs in
`packages/runtime-native/cmake/NativeEngine.cmake`, so no new render group is needed.
