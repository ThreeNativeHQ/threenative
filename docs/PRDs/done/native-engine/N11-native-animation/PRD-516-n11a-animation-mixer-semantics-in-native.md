# PRD-516 — AnimationMixer semantics in native (N11a)

**Status:** DONE
**Complexity:** 4 — the mixer has a lot of observable state (weights, fades, warps, loops, events), and all of it is compared against the reference
**Owner:** João
**Work package:** N11 — [native-engine batch](../../../native-engine/README.md) · [N11 umbrella](../../../native-engine/N11-native-animation/README.md)
**Depends on:** [PRD-508 (N06)](../PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md); starts only after [PRD-534 (CP1)](../../../native-engine/PRD-534-cp1-the-native-engine-earns-the-port.md) passes

## Context

§11.2 asks for the supported `AnimationMixer`/`AnimationAction` behaviour in native code: track binding, interpolation (discrete, linear, cubic, quaternion slerp), looping (`LoopOnce`, `LoopRepeat`, `LoopPingPong`, `clampWhenFinished`), weighting, additive blending, fades, warps and `finished`/`loop` events. Evaluation starts exact and compatible. §6.4 requires `mixer.update()` to stay observably synchronous, with no second evaluation by the engine schedule. Today the framework layer over three's mixer is `packages/core/src/animation.ts` (`AnimationPlayer`), with specs in `packages/core/__tests__/animation.spec.ts`. Clip validation is in `packages/core/src/clip-audit.ts`.

## Solution

1. **Native mixer state.** Proposed `packages/runtime-native/src/engine/animation/`. Clips, tracks, actions and mixers are N04 handles. Track bindings resolve property paths against the N06 graph once per bind, and rebind when the hierarchy changes, following the reference's `PropertyBinding` rules.
2. **Exact evaluator first.** Scalar binary64 evaluation of the reference interpolants, then a write into public properties (§6.3). SIMD or packed kernels come only after conformance exists (§6.2).
3. **Synchronous contract.** `mixer.update(dt)` evaluates and applies right away. Engine-managed mixers run once per simulation tick. A mixer the game updated explicitly in that tick is skipped by the schedule (§6.4).
4. **Events.** `finished` and `loop` dispatch on the game thread in the reference order, after the pose is applied (§7.3).
5. **Port `AnimationPlayer`.** Its TS stays as binding glue over the native mixer. Unsupported track kinds fail with `TN_NATIVE_ANIMATION_TRACK_UNSUPPORTED`.
6. **Rollback.** The legacy backend keeps three's JS mixer.

## Out of scope

- Morph and non-skeletal property tracks on the GPU path: [PRD-517 (N11b)](PRD-517-n11b-morph-targets-and-property-tracks.md)
- Bone palettes and skinned batching: [PRD-518 (N11c)](PRD-518-n11c-skinning-palettes-and-pose-history.md)

## Execution Phases

#### Phase 1: Tracks and interpolation
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/animation/`, `packages/runtime-native/tests/native-engine/animation/`
- [x] Every interpolant (discrete, linear, cubic, quaternion) reproduces the pinned reference fixtures within the documented tolerance. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_interpolants` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, tolerance zero: 25 cases, 3,763 float32 results, every one with three's bits. `Interpolant` (`src/engine/animation/interpolant.{h,cpp}`) ports three's interval search label for label (cached index, linear scan, binary search, both ends) and the discrete, linear, cubic and quaternion-slerp arithmetic in binary64 with V8's `acos` and `sin`, storing into a float32 result like the track's Float32Array. The table comes from three@0.185.1's own keyframe tracks (`packages/three-native/tests/animation/interpolants-reference.ts`): scalar, vec3, single-key and quaternion tracks, all nine cubic ending pairs, and 71 samples that seek both ways and pass NaN and both infinities; `native_engine_animation_reference_current` fails when the committed table is stale. Red control: a wrong ZeroSlope start ending makes 96 values differ. Using libm `acos`/`sin` instead still matches here, because the float32 store absorbs their one-bit differences on these arguments
- [x] Property-path binding resolves and rebinds after reparenting, as the reference does. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_binding` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact. `parseTrackName` (three's own regular expression, run as ECMAScript `std::regex`, and its object-name allowlist) gives three's answer for all 25 names: the 11 in three's `PropertyBinding` tests plus dotted node names, directories, Unicode, object indices and 7 that three refuses. `PropertyBinding` (`src/engine/animation/property_binding.{h,cpp}`) looks the node up at construction and again only after `unbind()`, as three does, and binds `position`, `quaternion`, `scale`, one component (`scale[y]`) and `visible`, flagging `matrixWorldNeedsUpdate` on every write. The scenario from three@0.185.1, replayed step for step (bind; reparent inside the root; leave the root and stay bound; rebind outside and lose the node; return; a shadowing name found first in depth order; a removed node that stays bound) matches three's node transforms and every binding read in all 7 steps. Paths the engine does not carry yet (`material.opacity`, unknown properties) are unavailable with `TN_NATIVE_ANIMATION_TRACK_UNSUPPORTED`; the native object has no `uuid` or skeleton, so names match `name` only. Red controls: `unbind()` that keeps the node fails 3 steps; reversed child order fails 2

#### Phase 2: Actions and the mixer
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/animation/mixer.cpp`
- [x] Loop modes, `clampWhenFinished`, weights, additive blending, fades and warps match reference pose dumps over a 10 s timeline. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_mixer` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact. `mixer.{h,cpp}` ports three@0.185.1's keyframe tracks (float32 storage), `AnimationClip`, `PropertyMixer` (lerp, slerp, additive multiply-then-slerp, original state), `AnimationAction` and `AnimationMixer` cache for cache: the active lists move by three's swaps and clips and roots keep insertion order, so actions accumulate in three's order. Six clips on a five-node rig (linear, cubic and discrete tracks, quaternions, an additive clip) run a 40-operation timeline from three (`animation-reference.ts`): Once with `clampWhenFinished`, Repeat with 2 repetitions, PingPong; weights 0.4 and 0.7; fadeIn, fadeOut, crossFadeFrom with warp, crossFadeTo; halt and warp; a negative mixer timeScale; `startAt`, `setTime`, `setDuration`, `syncWith`, `uncacheAction`, `stopAllAction`, over 600 irregular steps (about 12.6 s). Every fifth frame, every node transform, every action's time, effective weight and time scale, its flags and the mixer stats match three's bits: 120 samples, 0 differ. Red controls: a wrong lerp weight (6 samples differ), no ping-pong reflection (37), reversed action order (4). three throws when an uncached action plays again (`_removeInactiveBinding` keeps `_cacheIndex`), so the scenario does not do that; the engine clears the index and rebinds instead
- [x] `finished` and `loop` events fire in the reference order and on the reference tick. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_events` — 2026-10-05: green on the same lanes and replay: all 26 `loop` and `finished` events (walk, wave, lean, idle, jump, spin) fire on three's frame, in three's order, with its direction or loop delta, including a backwards loop (delta -1) under the negative time scale and three loops in one `setTime`. Red controls: a flipped `finished` direction (1 differs), reversed action order (4)

#### Phase 3: The scheduling contract
**Status:** DONE
**Files:** `packages/core/src/animation.ts` (binding glue); proposed `packages/runtime-native/src/engine/animation/schedule.cpp`
- [x] An explicit `mixer.update()` is observable straight away, and the engine schedule does not evaluate that mixer again in the same tick. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_explicit_update` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm. `AnimationSchedule` (`src/engine/animation/schedule.{h,cpp}`) manages mixers per simulation tick: `openTick` notes each mixer's update count, and `closeTick(dt)` advances only the mixers nobody updated in between. In the test, a game-updated mixer shows its pose the moment `update(0.25)` returns (x = 0.25), the tick then evaluates only the untouched mixer (time and update count of the game's mixer unchanged), a zero-length explicit update still counts as the game's, and a released mixer is left alone. Red control: a schedule that ignores explicit updates fails the first tick's checks
- [x] The animation update count is independent of the render count: two renders in one tick evaluate once. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_animation_tick_vs_render` — 2026-10-05: green on Dawn, ASan and wgpu (it renders headless). The arm's `FixedStepClock` drives 10 frames carrying 0, 1 or 2 ticks and 0 to 3 real renders each (`RenderDatabase::render` of the animated mesh): 7 ticks, 18 renders, 7 evaluations, and no render changes the update count or the pose, including frames with two renders in one tick. Red control: evaluating per render fails both checks

## Decisions

- Native scheduling never replaces `AnimationMixer` semantics with an unrelated scheduler (§4).
- ozz is deferred; see the [N11 umbrella](../../../native-engine/N11-native-animation/README.md).
