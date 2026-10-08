# PRD-508 — Native scene graph, transforms, cameras and geometry (N06)

**Status:** PROPOSED
**Complexity:** 4 — many classes with reference-pinned semantics, but no GPU work and no new dependency
**Owner:** João
**Work package:** N06 — [native-engine batch](../../native-engine/README.md)
**Depends on:** [N04 — Lifetime and numerical foundation](N04-lifetime-and-numerics/README.md) (handles, math, buffers); fixtures from [PRD-498 (N01)](../../native-engine/PRD-498-n01-baseline-and-differential-fixture-runner.md)

## Context

§6.1 moves the Three-shaped public object model into C++: `Object3D`, `Scene`, `Group`, cameras,
renderable objects, lights, transforms and geometry descriptors. §6.4 pins mutation and query
semantics to `three@0.185.1` (the `catalog:` pin in `pnpm-workspace.yaml`, with
`packages/core/patches/three@0.185.1.patch`): `matrixAutoUpdate`, `matrixWorldAutoUpdate`, explicit
`updateMatrix`/`updateMatrixWorld`/`updateWorldMatrix`, manual matrices, stale reads where the
reference leaves them stale. Today the scene lives in JS inside the host (§3, R1); nothing in
`packages/runtime-native/src/` owns scene state. Materials, textures and shader nodes are
[N08](../../native-engine/N08-native-tsl-and-shader-packages/README.md)/[N09](PRD-514-n09-native-renderer-and-standard-materials.md); animation objects are [N11](../../native-engine/N11-native-animation/README.md).

## Solution

1. **Classes** (proposed: `packages/runtime-native/src/engine/scene/`,
   `packages/runtime-native/include/threenative/engine/scene.h`): `Object3D`, `Scene`, `Group`,
   `Mesh`, `InstancedMesh`, `Points`, `Line`, `Sprite`, `PerspectiveCamera`,
   `OrthographicCamera`, `ArrayCamera`, the light classes as parameter carriers, `Layers`,
   `BufferGeometry` + the built-in geometry generators (`BoxGeometry`, `SphereGeometry`,
   `PlaneGeometry`, … per the N03 catalog).
2. **Ownership:** stable public records for identity (N04b handles) plus packed transform/bounds
   arrays (§6.2). `mesh.position` is the same logical vector on every access and stays valid when
   storage grows.
3. **Hierarchy semantics:** `add` re-parents (removing from the old parent), `remove` detaches
   without destroying (§7.1), `attach` preserves world transform, `traverse*` order, `getObjectBy*`,
   `added`/`removed`/`childadded`/`childremoved` events in reference order.
4. **Transforms and queries:** dirty-on-write, resolved at the public call or render boundary that
   requires it (§6.4); synchronous `getWorldPosition`, `localToWorld`, `lookAt`, camera
   `updateProjectionMatrix` match the reference bit-for-bit in binary64 or within the documented
   N04a tolerance.
5. **Geometry:** `BufferGeometry` attributes, groups, draw range, `computeBoundingBox/Sphere`,
   `computeVertexNormals`, generator outputs identical to the reference vertex-for-vertex.
6. **Unsupported:** any catalogued member without a native implementation throws
   `TN_NATIVE_UNSUPPORTED <Class>.<member>` at call time and is marked so in the capability manifest.
7. **Rollback:** the legacy JS scene path remains the selected backend; nothing here is reachable
   from a shipped game until [N17](../../native-engine/PRD-530-n17-strict-native-typescript-game-packaging.md).

## Out of scope

- Raw `.elements`/attribute array view semantics — [PRD-504 (N04d)](N04-lifetime-and-numerics/PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md).
- Rendering any of it — [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md).
- glTF scene construction — [PRD-515 (N10)](PRD-515-n10-native-gltf-cooked-assets-and-decoders.md).

## Execution Phases

#### Phase 1: Object3D, hierarchy and events
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/scene/object3d.cpp`, `tests/native-engine/scene_hierarchy_test.cpp`
- [x] Upstream-derived `Object3D` hierarchy tests (add/remove/attach/clear, traversal order, lookup, events) pass against the native implementation. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_hierarchy` — 2026-10-05: green on Dawn, ASan and Wasm. `native_engine_scene_hierarchy_upstream` ports three r185 `test/unit/src/core/Object3D.tests.js` block by block (31 of 37 QUnit tests, each assert with its upstream inputs, expected values and tolerance; upstream line cited per block); 6 are skipped for a named missing native API (`toJSON`, `clone`, recursive `copy`, `getObjectsByProperty`, and the JS-only `Extending`/`isObject3D`), plus one non-string `getObjectByProperty` assert. Events stay covered by `native_engine_scene_hierarchy`'s 58 fresh checks
- [x] Repeated `mesh.position` access yields one logical vector that survives 10,000 sibling insertions. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_alias` — 2026-10-04: green on Dawn, ASan and Wasm: `&mesh.position` is one address across 10,000 sibling insertions, and both binding Stores (fixture driver, C ABI) hand back the same Ref for it every time (`adoptAlias`)

#### Phase 2: Transforms, cameras, synchronous queries
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/scene/transform.cpp`, `camera.cpp`
- [x] `matrixAutoUpdate`/`matrixWorldAutoUpdate` on/off, manual matrices and stale-read cases match reference fixtures from N01. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_transforms` — 2026-10-04: 4 `scene-transforms-*` fixtures, 52 observations, bit-exact (abs 0) on host and Wasm. `differential.mjs` was never built; the ctest runs the same differential runner over the suite
- [x] Perspective/orthographic projection, `lookAt`, `getWorld*` and `localToWorld` match the reference within the N04a tolerance. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_cameras` — 2026-10-04: 3 `scene-cameras-*` fixtures, 42 observations, bit-exact (abs 0) on host and Wasm; `tan`/`atan` are now V8's fdlibm (glibc `tan` differs from V8 on ~4% of arguments)

#### Phase 3: Geometry
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/scene/geometry.cpp`, `geometry_generators.cpp`
- [x] Every catalogued geometry generator emits the reference positions, normals, uvs, index and groups for the fixture parameter sets. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_geometry$` — 2026-10-04: 10 `geometry-*` fixtures (Plane, Box, Sphere, Cylinder, Cone, Circle, Torus, Ring; non-default segments and partial sweeps), 128 observations bit-exact at abs 0 on host and Wasm; the BufferAttribute data is a BufferStore the renderer uploads by version
- [x] Bounding box/sphere and `computeVertexNormals` match the reference. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_geometry_derived` — 2026-10-04: 2 `geometry-derived-*` fixtures (normals on indexed and non-indexed geometry, bounds after translate/rotate), 20 observations bit-exact
- [x] Calling an uncatalogued member raises `TN_NATIVE_UNSUPPORTED` and the manifest lists it as unsupported. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_unsupported_member` — 2026-10-04: green: `tn_invoke` of a name the registry lacks on a BufferGeometry returns TN_ERROR_UNSUPPORTED with `TN_NATIVE_UNSUPPORTED BufferGeometry.<name>`; uncatalogued classes report `partial(native-not-implemented)` in the catalog

## Decisions

- **binary64 public math, float32 only on packed GPU paths (§6.3).**
- **No ECS dependency or global template redesign (§6.2).** Scalar, correct, change-tracked first; SIMD after conformance.
