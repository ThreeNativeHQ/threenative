# PRD-545 — Corpus gaps in math, the object model and geometry (N22a)

**Status:** IN PROGRESS — the `InstancedBufferGeometry` box has its native half proven; its Wasm proof is open
**Priority:** P1 — rain, Midway, Bayview, shooter, snow and five more corpus games construct a class here that the engine refuses, so their journeys cannot pass on Wasm or V8
**Complexity:** 5 (MEDIUM) — 6–10 engine files across foundation, scene and the bindings; no new module
**Owner:** João
**Work package:** N22a, layers 1–3 — [three.js surface coverage](README.md)
**Depends on:** [PRD-501 (N04a)](../../done/native-engine/N04-lifetime-and-numerics/PRD-501-n04a-math-matches-the-pinned-reference.md), [PRD-508 (N06)](../../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md), [PRD-504 (N04d)](../../done/native-engine/N04-lifetime-and-numerics/PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md) and [PRD-514 (N09)](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) (done); [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) and [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) carry the result to each game

## Context

These are the three lowest engine layers in the [N22 layer map](README.md#the-catalog-by-engine-layer):
math foundation (15 of 37 entries supported), object model and scene graph (25 of 37) and geometry
and buffers (20 of 42). The higher layers build on them, so this PRD runs first. The phases follow
the layers; inside a phase, the box with more corpus games comes first. Gaps in these layers that
no corpus game reaches, such as `Points` and `BatchedMesh` (core only), are in the README backlog, not here.

## Solution

Implement each gap once in the shared C++ engine (`packages/runtime-native/src/engine`) and
expose it through the shared binding registry, so V8 and Wasm both get it. Port the behaviour from
the pinned three r185 source. Each box proves the engine against a golden from headed-WebGPU three
r185 (fixtures in `packages/three-native/tests/compatibility/fixtures/`) and, where a binding
changes, the Wasm back end in the real ABI module (`packages/three-native/tests/browser-backend-smoke.ts`).
The registry snapshot and the catalog follow each new member (`native_engine_registry_snapshot`,
`sync-native-status`).

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Math arguments | Midway's update loop through the back-end entry | the "argument is not a Vector3" refusal | Phase 1 |
| Object classes | a game's `new Line()`, `mesh.instanceColor = …`, `mesh.getVertexPosition()` | the catalog refusal | Phase 2 |
| Geometry classes | a game's `new IcosahedronGeometry()`, `new InstancedBufferGeometry()` | the catalog refusal | Phase 3 |

## Execution Phases

#### Phase 1: Math foundation
**Status:** NOT STARTED
**Files:** found by the reproduction; likely `packages/runtime-native/src/engine/abi/bindings_math.cpp`
- [ ] Midway's update loop on the native engine reports no `TN_NATIVE_UNSUPPORTED` "argument is not a Vector3" error. The first step names the call that raises it and reproduces it in a native test against r185 behaviour; it is filed under math because the refusal is a math-argument check, and moves if the reproduction shows another layer. Users: Midway. proof: the reproduction's ctest in `ctest --test-dir packages/runtime-native/build/tn-linux -L native-engine`, then `node packages/playtest/dist/runner/cli.js <midway journey>.playtest.json --target desktop` with no such error in its log
  2026-10-08: named and fixed. The call is core `AudioBus.playAt` -> `voice.position.copy({ x, y, z })` from Midway's `Soundscape.syncEmitters` (a plain object, which r185 reads by field). `Store::in` now reads a plain object for Vector2/3/4 read-only arguments; fixture `math-core-plain-vector-arguments` passes in `native_engine_math_core` and `native_engine_v8_math_fixtures` (red: BLOCKED "argument is not a Vector3"). On the V8 player Midway's update loop no longer raises it (90 s run, 0 occurrences). Open: the journey proof cannot run yet, because the bundler refuses ten core TSL names (`viewportLinearDepth`, `linearDepth`, `cameraNear`, `cameraFar`, `viewportSharedTexture`, `viewportDepthTexture`, `normalLocal`, `tangentLocal`, `positionPrevious`, `storage`) and the player stops at `TN_NATIVE_ATTRIBUTE_MISSING: aColor` (custom instanced attributes, phase 3 box 2).

#### Phase 2: Object model and scene graph
**Status:** NOT STARTED
**Files:** `packages/runtime-native/src/engine/scene/`, `packages/runtime-native/src/engine/renderer/` (topology), `packages/runtime-native/src/engine/abi/bindings_scene.cpp`
- [x] `Line`, `LineSegments` and `LineBasicMaterial` draw line-strip and line-list topology. Users: Bayview, shooter, snow; core `projection-apply.ts`, `world-cells.ts`, `geometry-capture.ts`. Extends PRD-508 and PRD-514. proof: fixture `lines-basic` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_lines`
  Done 2026-10-08: fixture `lines-basic` (a Line strip, a LineSegments list and an indexed strip, golden from headed WebGPU Chromium) passes in `native_engine_render_lines` (red: BLOCKED "class Line"). Engine `Line`/`LineSegments` with r185's `Line.raycast` (`native_engine_raycaster` against the regenerated three oracle; red: `line-0 hit count` with the triangle raycast); `LineBasicMaterial` on the unlit program; pipeline topology and strip index format. V8 exports all three (`player_imports`), Wasm smoke passes. Not bound yet: `raycaster.params.Line.threshold` from JS (default 1 natively; no corpus user), and lines cast no shadow.
- [ ] Assigning a new `InstancedBufferAttribute` to `InstancedMesh.instanceColor` colours the instances on the next frame. Users: rts, tower-defense, Midway (world tracers); core. Extends PRD-508. proof: fixture `instanced-mesh-color-set` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_instanced`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend`
  2026-10-08: written on lane-midway-native, not committed.
- [x] `Mesh.getVertexPosition` on a `SkinnedMesh` applies the skin, as r185 does. Users: Bayview (enemy hit tests). Extends PRD-508 and [PRD-518](../../done/native-engine/N11-native-animation/PRD-518-n11c-skinning-palettes-and-pose-history.md). proof: fixture `scene-object-bounds-skinned-vertex` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_object_bounds`
  Moved from PRD-531 open items (2026-10-08).
  Done 2026-10-08: no engine change was needed (SkinnedMesh::getVertexPosition already applies applyBoneTransform through the shared binding). Fixture `scene-object-bounds-skinned-vertex` (three vertices of the posed rig; v0 reads (-0.304, -0.996, -0.237) against the raw (-1, -1, 0)) passes in `native_engine_scene_object_bounds` and `native_engine_v8_scene_fixtures`.

#### Phase 3: Geometry and buffers
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/src/engine/scene/geometries.cpp`, `packages/runtime-native/src/engine/scene/geometry.cpp`, `packages/runtime-native/src/engine/abi/bindings_geometry.cpp`
- [x] `IcosahedronGeometry`, `CapsuleGeometry`, `DodecahedronGeometry`, `OctahedronGeometry` and `TorusKnotGeometry` build the same vertex, normal, uv and index buffers as r185. Users: Bayview, platformer, racing, rts, shooter, snow, tower-defense. Extends PRD-508. proof: one `geometry-<class>` fixture per class through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_geometry`
  Done 2026-10-08: `native_engine_geometry` 17/17 pass, bit-exact at `abs: 0`, with fixtures `geometry-icosahedron`, `-capsule`, `-dodecahedron`, `-octahedron`, `-torus-knot` (red: all five BLOCKED, class unsupported). V8 exports them; registry, catalog and ABI digest regenerated; `player_imports`, `v8_catalog_coverage`, `v8_geometry_lifecycle` pass.
- [ ] `InstancedBufferGeometry` with `instanceCount` and per-instance `InstancedBufferAttribute`s draws `instanceCount` instances, and TSL `attribute()` reads an instance attribute per instance. Users: rain, Midway (water effects, particles); core `projection-skinned.ts`, `world-cells.ts`. Extends PRD-508 and PRD-504. proof: fixture `instanced-buffer-geometry` through `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_instanced`, and `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` — 2026-10-09 (lane/ne-midway): the native half is green: `native_engine_render_instanced_buffer_geometry` matches its new headed-WebGPU golden, and fails with the per-instance step mode forced off and with the instance count forced to 1. The Wasm half is not run: no emsdk on that host, so the box stays open.
  In progress on lane-wasm-templates (2026-10-08).

New render groups need a line in the render-case list in `packages/runtime-native/cmake/NativeEngine.cmake`:
`render_instanced:instanced-*` and `render_lines:lines-*`. The `geometry-*` and
`scene-object-bounds-*` globs already exist.
