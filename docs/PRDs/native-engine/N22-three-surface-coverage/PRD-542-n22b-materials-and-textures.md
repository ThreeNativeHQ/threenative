# PRD-542 — Corpus materials and textures match three r185 (N22b)

**Status:** IN PROGRESS — box 2 is in progress on lane-midway-native
**Priority:** P1 — every corpus game passes texture constants the engine does not implement, and 12 templates read `Material` members it refuses, so PRD-533's visual baselines cannot pass on the native engine
**Complexity:** 5 (MEDIUM) — 6–10 engine files across renderer, shader and GPU resources; no new module
**Owner:** João
**Work package:** N22b — [three.js surface coverage](README.md)
**Depends on:** [PRD-514 (N09)](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) and [PRD-509 (N07)](../../done/native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

The corpus scan in the [N22 README](README.md#ranked-gaps) found these material members and
texture classes in real games. Ranks 1, 3, 5, 6, 9, 14, 18 and the Midway-only `forceSinglePass`.
The catalog marks the constants `partial` (`native-not-implemented`): the back end binds their
values, but the engine does not act on every one. `CanvasTexture` exists on the browser back end
only as a one-mip `DataTexture` (`packages/three-native/src/texture-sources.ts`), and V8 refuses it.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry, so V8 and Wasm both get it. Port the behaviour from
the pinned three r185 source. Each box proves the engine against a golden from headed-WebGPU three
r185 (fixtures in `packages/three-native/tests/compatibility/fixtures/`). When a member becomes
real, the catalog marks it `supported` through `sync-native-status`.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Material members | template `src/render/` and game materials through the back-end entry | refusal or silent no-op | Phase 1 |
| Texture classes and constants | `new CanvasTexture()`, `new Data3DTexture()`, sampler and format constants | the one-mip browser fallback; the V8 refusal | Phase 2 |

## Execution Phases

#### Phase 1: Material members
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/src/engine/renderer/`, `packages/runtime-native/src/engine/shader/standard.cpp`, the binding registry
- [ ] `Material.prototype.onBeforeCompile` and `Material.prototype.customProgramCacheKey` read as r185's defaults, so the template check `material.onBeforeCompile !== Material.prototype.onBeforeCompile` runs without a refusal. Users: 12 templates (`src/render/materialAssignments.ts`, `backlightMaterial.ts`); core. Extends PRD-514. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` with a case that reads both members, and `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_catalog_coverage`
- [ ] `polygonOffset`, `polygonOffsetFactor` and `polygonOffsetUnits` set the pipeline depth bias. Users: shooter, Midway, Bayview. Extends PRD-514. proof: fixture `materials-polygon-offset` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  In progress on lane-midway-native (2026-10-08).
- [ ] `vertexColors` multiplies the diffuse colour by the `color` attribute. Users: platformer, shooter, snow, Midway, Bayview; core `render/material-key.ts`, `render/world-impostor-surface.ts`. Extends PRD-514. proof: fixture `materials-vertex-colors` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
- [ ] `forceSinglePass` draws a transparent `DoubleSide` material in one pass, as r185 does. Users: Midway. Extends PRD-514 and the two-pass draw in 510d3fbe5. proof: fixture `materials-force-single-pass` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
- [ ] `normalWorld` on a `DoubleSide` material flips on back faces (r185 `negateOnBackSide`), and reads `normalNode` and a normal map when set. Users: Midway, rts, sailing, snow read `normalWorld`; 9 games use `DoubleSide`. Extends [PRD-512](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md). proof: fixture `materials-normal-world-doubleside` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_standard_materials_fixtures`
  Moved from PRD-540 phase 3 (2026-10-08). `BackSide` is already handled.

#### Phase 2: Textures
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/gpu/` (texture and sampler state), the binding registry, `packages/three-native/src/texture-sources.ts`
- [ ] `CanvasTexture` is an engine texture class with a full mip chain on V8 and Wasm; the browser one-mip fallback goes. Users: 11 templates, Midway, Bayview. Extends PRD-509. proof: fixture `textures-data-canvas-mips` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`
- [ ] The texture constants the corpus passes take effect: the filters (`NearestFilter`, `LinearFilter`, `LinearMipmapLinearFilter`), the wraps (`ClampToEdgeWrapping`, `RepeatWrapping`), the formats and types (`RGBAFormat`, `UnsignedByteType`, `FloatType`, `HalfFloatType`), `SRGBColorSpace`, `EquirectangularReflectionMapping` and `NoToneMapping`. The catalog status of each one moves from `partial` to `supported`. Users: all 15 games; core. Extends PRD-509. proof: one `textures-data-<family>` fixture per family through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`, and `pnpm exec vitest run packages/three-native/__tests__/catalog-registry.spec.ts`
- [ ] `Data3DTexture` uploads a 3D texture and `texture3D` samples it. Users: rain; core `fluid-particles.ts`, `render/probe-volume.ts`. Extends PRD-509 and [PRD-510](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md). proof: fixture `textures-data-3d` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_data_textures`

The fixture names above match the existing `materials-*` and `textures-data-*` globs in
`packages/runtime-native/cmake/NativeEngine.cmake`, so no new render group is needed.
