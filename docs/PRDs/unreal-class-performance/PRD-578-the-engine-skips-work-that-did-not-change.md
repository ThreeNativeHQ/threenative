# PRD-578 — The engine skips work that did not change

**Status:** NOT STARTED
**Priority:** P1 — Phase 1 is three quick wins on the steady-state frame (lock, compose, off-screen evaluation), all open; Phases 2–3 are gated on measurement.
**Complexity:** 4 (MEDIUM) — 6–10 engine files (+2), evaluation-rate state carries across frames (+2); risk override: none
**Owner:** João
**Depends on:** None for Phase 1. Phases 2–3 read [PRD-573](./PRD-573-the-performance-bar-is-a-scorecard-on-named-scenes.md)'s scorecard.
**Estimate:** Phase 1 ≈ 10 h in three quick wins (2–3 h, 3–4 h, 4 h); Phase 2 ≈ 3 h measure, then 8–12 h if it continues; Phase 3 ≈ 16–24 h, gated.

## Context

Layer: engine (`packages/runtime-native/src/engine/` on `origin/feat/native-engine`). Every game pays
this cost, and no game code can remove it, so the fix belongs in the engine.

The Midway web profile that opened this epic puts animation at about 13% of the frame
(`AnimationMixer` 11.9%), cull and project at about 11% (`ProjectedCull::apply` 5.9%,
`RenderDatabase::project` 5.4%), transforms at about 8%, and `std::__shared_weak_count::lock()` at
2.9%. The code shows three causes of work that repeats without a change (read 2026-10-09 at
`76989167f`):

- **A lock per binding per frame.** `animation/property_binding.cpp:308` takes
  `node_.lock()` in `setValue` on every apply, and `:257` does the same in `getValue`. Other hot
  sites lock too: `scene/object3d.cpp:352,363,385,425`, `renderer/render_database.cpp:335,699` and
  `renderer/renderer.cpp:891,2742`. The Wasm build has no threads (`cmake/NativeEngineCore.cmake`
  has no `-pthread`), so no other thread can release the node between a check and its use.
- **A compose per object per frame.** `Object3D::updateMatrixWorldSelf` (`scene/object3d.cpp:541`)
  calls `Matrix4::compose(position, quaternion, scale)` for every auto-update object, then compares
  the bits with the old matrix. The comparison avoids a false change, but the compose still runs.
  Game code writes `position` and `quaternion` straight into Wasm memory (`Vector3.__address` in the
  enter census), so a setter cannot raise a dirty flag. Frozen static subtrees already skip this
  ([PRD-519](../native-engine/PRD-519-n12-native-batching-visibility-lod-gpu-scene.md) Phase 2,
  `scene/static_transform.{h,cpp}`); moving and unfrozen objects do not.
- **An evaluation per rig per frame.** `AnimationMixer::update` (`animation/mixer.h`) evaluates every
  action and applies every binding each frame, whether or not any pass draws the rig.

### What Unreal does (UE 5.8.3, design reference only)

- Transform updates propagate only from a component that moved
  (`UE 5.8.3: Engine/Source/Runtime/Engine/Private/Components/SceneComponent.cpp:760`
  `UpdateComponentToWorldWithParent`, `:968` `PropagateTransformUpdate`), and the GPU scene uploads
  only dirty primitives (`Renderer/Private/GPUScene.cpp:769` `UpdateInternal`).
- A skinned mesh that was not recently rendered evaluates at a reduced rate, and skipped time
  accumulates. PRD-570 (see "The core version" below) cites the update-rate optimization lines in
  `Engine/Private/Components/SkinnedMeshComponent.cpp`.
- Transforms use SIMD registers throughout (`Core/Public/Math/TransformVectorized.h`,
  `Core/Public/Math/VectorRegister.h`), and pose evaluation runs as parallel tasks
  (`Engine/Private/Components/SkeletalMeshComponent.cpp:3061` `DispatchParallelEvaluationTasks`,
  `Engine/Private/Animation/AnimationRuntime.cpp:351` `BlendPosesTogether`).

### The core version

PRD-570 (`docs/PRDs/unreal-source-borrowing/PRD-570-a-character-costs-what-the-camera-sees-of-it.md`,
commit `9d4b2a67f`) owns the rate policy for `packages/core/src/animation.ts`: screen-size rates,
stagger, and the `updateRate` override. This PRD ports only the not-rendered rate into the engine's
`AnimationMixer`, because PRD-535 deletes the core TypeScript path and the engine must carry the rule.

## Solution

1. **Bind once, check cheaply.** `PropertyBinding` keeps a raw node pointer from bind time and
   checks `node_.expired()` before use, in place of `lock()` on every apply. This is safe while the
   engine is single-threaded. `ponytail:` the check is single-thread safe only; PRD-574 replaces it
   with a frame-scoped strong reference if a second thread can release nodes.
2. **Compose only on a changed input.** Each auto-update object keeps the 10 doubles of its last
   composed position, quaternion and scale. Equal bits and an unchanged `matrix` (a game can write
   it directly) skip the compose. Pivot objects keep today's path.
3. **Evaluate a hidden rig less often.** When no pass (main or shadow) drew any object under a
   mixer's root in the last frame, the mixer accumulates `dt` and evaluates one frame in four, the
   default not-rendered rate in Unreal. A drawn rig evaluates every frame. Clip time, fades and
   `finished` events see the same total time. The named override is proposed as
   `AnimationMixer.updateRate` (`"auto"` or a number), the name PRD-570 uses; a non-auto value is
   reported. The registry and catalog regenerate with the binding.
4. **Phase 2 skips projection of unchanged records** only if the measurement earns it.
5. **Phase 3 moves world matrices to a SIMD layout** only if Phases 1–2 leave transforms, cull and
   project at 10% or more of the frame.

## Execution Phases

#### Phase 1: Three quick wins
**Status:** PARTIAL
**Files:** `src/engine/animation/property_binding.{h,cpp}`, `src/engine/scene/object3d.{h,cpp}`, `src/engine/animation/mixer.{h,cpp}`, `src/engine/renderer/render_database.cpp` (drawn-last-frame flag), `tests/native-engine/animation/property_binding_test.cpp`, `tests/native-engine/animation/mixer_test.cpp`, `packages/three-native/api/` (regenerated)
- [ ] **[QW ≤4 h]** `PropertyBinding` applies without a lock, and a binding to a released node stays a safe no-op. proof: red-green case in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_binding`, then `pnpm profile:wasm-page -- --url <native Midway, this build> --control <native Midway, base build> --cpu-work` with the lock's self share in the subject at most 1.0% (base 2.9%) and subject/control CPU busy below 1.0
  Open: lock removed from `PropertyBinding` and `GeometryCache::sweep` (red-green `native_engine_animation_binding_released`, `native_engine_renderer_geometry_cache`; `ctest -L native-engine` 290/292, only the known reds `render_vsm`, `update_scaling`). Same-window A/B at load 27, base measured first: base lock 3.9%, subject lock under the 0.7% list floor. The busy ratio is not valid: the page measured second is always perturbed at load 17-27 (subject second 5.79x, base second the reverse), so the busy clause waits for a quiet host.
- [ ] **[QW ≤4 h]** An unchanged object composes zero times after its first frame, while a direct `position` write and a direct `matrix` write each behave as in three. proof: red-green cases in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_scene_revision` (a compose counter over 1000 still objects and 100 frames), then the same `profile:wasm-page` A/B with subject/control CPU busy below 1.0
- [ ] **[QW ≤4 h]** A mixer whose rig no pass drew evaluates one frame in four with accumulated time, and a drawn rig evaluates every frame. proof: red-green cases in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_mixer` (clip time and `finished` event equal to rate 1 over 300 frames), and `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skinned_crowd_cpu` counting evaluations with half the crowd behind the camera
- [ ] The off-screen evaluation rate shows its gain on Midway and passes the visual judge. proof: the same `profile:wasm-page` A/B with the `AnimationMixer` self share below the base build's 11.9%, and a fresh judge subagent on headed `--browser-recipe webgpu` captures of a rig entering the view, verdict recorded here

#### Phase 2: Unchanged records skip projection, if measured
**Status:** NOT STARTED
**Files:** `src/engine/renderer/render_database.{h,cpp}`, `src/engine/scene/projected_cull.cpp`
- [ ] The share of records that `RenderDatabase::project` and `ProjectedCull::apply` visit with no revision change is measured on Midway, and the decision is recorded under `## Decisions`: continue only if at least half the records are unchanged and the two functions are at least 8% of the frame after Phase 1. proof: a record-revision counter printed by `pnpm profile:wasm-page -- --url <native Midway> --cpu-work --json`
- [ ] Projection reuses the last result for a record whose revision and camera inputs are unchanged, and the frame is pixel-identical. proof: red-green case in `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_batched_vs_unbatched`, and subject/control CPU busy below 1.0 in the `profile:wasm-page` A/B

#### Phase 3: World matrices in a SIMD layout, if earned
**Status:** NOT STARTED
**Files:** `src/engine/scene/object3d.{h,cpp}`, `src/engine/foundation/math/Matrix.{h,cpp}`, `cmake/NativeEngineCore.cmake`
- [ ] The decision is recorded under `## Decisions`: continue only if transforms, cull and project are still at least 10% of the frame after Phases 1–2. proof: `pnpm profile:wasm-page -- --url <native Midway> --control <three.js Midway> --cpu-work`
- [ ] World matrices compose and multiply through `-msimd128` (web) and SSE or NEON (native) in a structure-of-arrays store, bit-equal to the scalar path. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_static_transform` and the `profile:wasm-page` A/B with subject/control CPU busy below 1.0

## Blocked on

- The override name `AnimationMixer.updateRate` adds a non-three property to a three API object. João confirms the name, or picks another, before the Phase 1 mixer box merges.
- An Android frame-time claim needs the Pixel 8 attached. Unblocked when João attaches the device.
