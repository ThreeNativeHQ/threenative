# PRD-541 — Corpus games construct the instancing and primitive classes they import (N22a)

**Status:** IN PROGRESS — box 1 is in progress on lane-wasm-templates
**Priority:** P1 — rain, Midway, Bayview, shooter, snow and five more corpus games construct a class or slot here that the engine refuses, so their journeys cannot pass on Wasm or V8
**Complexity:** 5 (MEDIUM) — 6–10 engine files across scene, renderer and shader; no new module
**Owner:** João
**Work package:** N22a — [three.js surface coverage](README.md)
**Depends on:** [PRD-508 (N06)](../../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md) and [PRD-514 (N09)](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

The corpus scan in the [N22 README](README.md#ranked-gaps) found these classes and slots in real
games, and the catalog marks each one unsupported or absent. A game that constructs one throws its
`TN_NATIVE_UNSUPPORTED_<NAME>` refusal at boot. Ranks 7, 11, 12, 13, 15 and 21 of the README
table.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry, so V8 and Wasm both get it. Port the behaviour from
the pinned three r185 source. Each box proves the engine against a golden from headed-WebGPU three
r185 (fixtures in `packages/three-native/tests/compatibility/fixtures/`) and proves the Wasm
binding in the real ABI module (`packages/three-native/tests/browser-backend-smoke.ts`). The
registry snapshot and the catalog follow each new member (`native_engine_registry_snapshot`).

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Instanced geometry and vertex slot | a game's `new InstancedBufferGeometry()` or `material.vertexNode = …` through the back-end entry | the catalog refusal | Phase 1 |
| Geometry classes and line/point topology | a game's `new IcosahedronGeometry()`, `new Line()`, `new Points()` | the catalog refusal | Phase 2 |

## Execution Phases

#### Phase 1: Instancing
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/src/engine/scene/`, `packages/runtime-native/src/engine/renderer/`, `packages/runtime-native/src/engine/shader/`
- [ ] `InstancedBufferGeometry` with `instanceCount` and per-instance `InstancedBufferAttribute`s draws `instanceCount` instances. Users: rain, Midway; core `projection-skinned.ts`, `world-cells.ts`. Extends PRD-508. proof: fixture `instanced-buffer-geometry` against its r185 golden through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_instanced`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`
  In progress on lane-wasm-templates (2026-10-08).
- [ ] `material.vertexNode` replaces the clip-space position, as r185's `NodeMaterial.vertexNode` does. Users: rain, shooter, Midway (particles and water: `cameraProjectionMatrix.mul(...)`); core `world-cells.ts`. Extends [PRD-512](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md). proof: fixture `tsl-vertex-node` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_vertex_stage`
- [ ] Assigning a new `InstancedBufferAttribute` to `InstancedMesh.instanceColor` colours the instances on the next frame. Users: rts, tower-defense, Midway; core. Extends PRD-508. proof: fixture `instanced-mesh-color-set` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_instanced`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`

#### Phase 2: Geometry classes and primitive topologies
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/scene/` (geometry generators), `packages/runtime-native/src/engine/renderer/` (topology), the binding registry
- [ ] `IcosahedronGeometry`, `CapsuleGeometry`, `DodecahedronGeometry`, `OctahedronGeometry` and `TorusKnotGeometry` build the same vertex, normal, uv and index buffers as r185. Users: Bayview, platformer, racing, rts, shooter, snow, tower-defense. Extends PRD-508. proof: one `geometry-<class>` fixture per class through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_geometry`
- [ ] `Line`, `LineSegments` and `LineBasicMaterial` draw line-strip and line-list topology. Users: Bayview, shooter, snow; core `projection-apply.ts`, `world-cells.ts`, `geometry-capture.ts`. Extends PRD-514. proof: fixture `lines-basic` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_lines`
- [ ] `Points` draws point-list topology with `PointsNodeMaterial` sizing as in r185. Users: core `clustered-mesh.ts`, `projection-apply.ts`, `world-cells.ts`. Extends PRD-514 and [PRD-527](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-527-n14e-particles-and-fluids-run-native.md). proof: fixture `points-basic` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_lines`

New render groups need a line in the render-case list in `packages/runtime-native/cmake/NativeEngine.cmake`:
`render_instanced:instanced-*`, `render_vertex_stage:tsl-vertex-*` (shared with PRD-543) and
`render_lines:lines-*,points-*`. The `geometry-*` glob already exists.
