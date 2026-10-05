# PRD-519 — Native batching, visibility, LOD and GPU scene (N12)

**Status:** IN PROGRESS
**Complexity:** 5 — ports the framework's render projection, culling and LOD rules, each with an eligibility test and a correct unbatched fallback
**Owner:** João
**Work package:** N12 — [native-engine batch](README.md)
**Depends on:** [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md), [N11 animation](N11-native-animation/README.md); starts only after [PRD-534 (CP1)](PRD-534-cp1-the-native-engine-earns-the-port.md) passes

## Context

§10 asks for ThreeNative's existing rules for static, instanced and skinned batching to be ported: uniform differences, culling, LOD, negative scale, custom vertex deformation, callbacks and transparency. Each rule needs an explicit eligibility test, and the fallback stays a compatible unbatched draw **inside the native renderer**. §15.4 asks for a measured cost reduction. Today's TypeScript: the render projection scan and plan (`packages/core/src/projection-plan.ts`, `projection-apply.ts`, `projection-uniform.ts`, `projection-stability.ts`, `renderProjection.ts`), `packages/core/src/instanced-batch.ts`, `packages/core/src/static-transform.ts`, `packages/core/src/render-camera-cull.ts`, `packages/core/src/model-lod.ts`, `packages/core/src/clustered-batch.ts`, `packages/core/src/gpu-scene-bvh.ts`, and the GPU-driven main pass in `packages/core/src/world-gpu-scene.ts`. Their specs are under `packages/core/__tests__/` (`projection-*.spec.ts`, `render-camera-cull.spec.ts`, `model-lod*.spec.ts`, `world-gpu-scene.spec.ts`).

## Solution

1. **Projection plan in native.** Proposed `packages/runtime-native/src/engine/renderer/batching/`. Scan-and-plan reads N09 render records and groups by geometry plus material key, keeping today's minimum group size and uniform-difference fingerprint (`projection-uniform.ts`). Each refusal carries a named reason: negative scale, custom deformation, `onBeforeRender` callback, transparency, a differing uniform, or a skinned rule from PRD-518.
2. **Static subtrees.** `static-transform.ts`'s frozen-root rule becomes a native flag that skips recomposition. Public matrix semantics are unchanged (§6.4).
3. **Visibility.** Frustum and projected-pixel culling (`DEFAULT_MINIMUM_PROJECTED_PIXELS`, `alwaysRender`) runs on native bounds, with the same report fields.
4. **LOD.** Discrete LOD selection with `TN_discrete_lod` chains, error-pixel thresholds, hysteresis and `lodBias`, plus clustered LOD bands. History is invalidated on LOD transitions (§10).
5. **GPU scene.** The compute cull and LOD kernel moves to an N08 shader package. Its CPU reference (`cullAndSelect`) is ported as the native test oracle.
6. **Fallback.** Every refused object draws through the unbatched N09 path, and the output must match. "Fallback" never means the JS renderer (§10).

## Out of scope

- World streaming and residency: [N13](N13-native-streaming-and-world/README.md)
- Virtual-shadow caster culling: [PRD-524 (N14b)](N14-native-render-chain-and-advanced-visuals/PRD-524-n14b-virtual-shadows-run-native.md)

## Execution Phases

#### Phase 1: Eligibility parity and the unbatched path
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/engine/renderer/batching/plan.cpp`, `packages/runtime-native/tests/native-engine/batching/`
- [ ] Every eligibility case from `projection-*.spec.ts` and `instanced-batch.spec.ts` gives the same verdict and reason code natively. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_batching_eligibility`
- [x] A mixed scene renders the same batched and fully unbatched, within the documented tolerance. proof: `pnpm parity` case `native-engine-batched-vs-unbatched` — 2026-10-05: green on Dawn, ASan and wgpu, as a ctest (`native_engine_batched_vs_unbatched`): the claim compares the native renderer with itself, so no browser capture is involved. The native renderer now draws instancing (an `InstancedMesh` with three's instance(): a per-instance mat4 as four instanced vertex attributes, normals by its inverse transpose, `instanceColor` times the material colour) and `RenderDatabase` batches automatically: opaque plain meshes sharing a geometry and a material, at least `MIN_BATCH_MEMBERS` (4) of them and none with a render callback, become one instanced draw of their world matrices. A mixed scene (a batch of six spheres, five Lambert boxes, four boxes on another render order, three spheres below the minimum, four transparent spheres, one mesh with `onBeforeRender`) renders 12 draws batched against 24 unbatched, equal triangles, and the same 200 x 150 frame to the pixel (worst channel difference 0); the callback runs in both. `native_engine_renderer_instanced` shows one 9-instance draw equals nine meshes, also exactly. Red controls: every member given the first matrix (1,211 pixels differ), normals by the instance matrix instead of its inverse transpose on rotated, non-uniformly scaled spheres (1,085 differ). The catalog now marks `InstancedMesh` and `InstancedBufferAttribute` supported

#### Phase 2: Culling, static subtrees and LOD
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/engine/renderer/visibility/`, `packages/runtime-native/src/engine/renderer/lod/`
- [x] Culling reports (culled, kept, `alwaysRender`) match `render-camera-cull.spec.ts` fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_camera_cull` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact. `CameraCull` (`src/engine/renderer/visibility/camera_cull.{h,cpp}`) ports `RenderCameraCull`: the projected-pixel minimum on world bounding spheres, every exemption it counts (camera-attached, marked, shadow casters, no bounds, dynamic bounds, frustum-culling opt-outs), invisible subtrees and its report; `alwaysRender` is a side table because the native object has no `userData`. 17 scenes recorded from the real `RenderCameraCull` match every report field. Red controls: no pixel minimum (8 differ), `alwaysRender` ignored (1 differs). Port by the save-tokens arm; reviewed
- [x] Discrete LOD selection, hysteresis and bias match `model-lod.spec.ts` fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_model_lod` — 2026-10-05: green on Dawn, ASan and wgpu, exact. `src/engine/renderer/lod/model_lod.{h,cpp}` ports `lodPixelScale`, `projectedLodError`, the LOD bias, `conservativeViewDepth`, `worldSphere`, `selectLodLevel` with its hysteresis and the discrete per-object decision with its history: 372 values and 487 chosen levels over scripted approach-and-recede camera paths match model-lod.ts. Red controls: hysteresis ignored (fails), bias ignored (53 differ). Port by the save-tokens arm; reviewed
- [ ] Frozen static subtrees skip recomposition, and an explicit `updateMatrixWorld` still produces reference matrices. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_static_transform`

#### Phase 3: GPU scene and the measured cost
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/renderer/gpu_scene/`
- [ ] The GPU cull and LOD kernel selects the same instances as the ported `cullAndSelect` reference. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_gpu_scene_select`
- [ ] On the native desktop host, the batching CPU stage of the heterogeneous-renderables fixture costs less than today's legacy-backend projection on the same scene. proof: `node packages/playtest/dist/runner/cli.js perf --executable <native player> --target desktop` (`render.p50`, A/B against the legacy backend)

## Blocked on

- The §15.4 investment-gate measurement (about 2× lower hot-path CPU) needs a physical Android device run (owner attaches the device; gated in [PRD-533](PRD-533-n20-platform-qualification-performance-default-promotion.md)).
