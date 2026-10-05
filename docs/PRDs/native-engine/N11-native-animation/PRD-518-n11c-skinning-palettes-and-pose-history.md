# PRD-518 — Skinning palettes and pose history (N11c)

**Status:** PROPOSED
**Complexity:** 4 — ports tested compatibility rules and visual invariants from `projection-skinned.ts`, plus previous-pose data for temporal effects
**Owner:** João
**Work package:** N11 — [native-engine batch](../README.md) · [N11 umbrella](README.md)
**Depends on:** [PRD-516 (N11a)](PRD-516-n11a-animation-mixer-semantics-in-native.md), [PRD-515 (N10)](../PRD-515-n10-native-gltf-cooked-assets-and-decoders.md)

## Context

§11.2 moves palette generation, previous-pose data and compatible skinned batching into native code. §3 (R5) says to port the tested rules rather than discard them. Today `packages/core/src/projection-skinned.ts` makes every rig that shares a geometry and material one instanced draw per pass. Each rig is a slot in a storage palette of world-space bone matrices, with the world transform folded in. The authored `SkinnedMesh` stays in the scene untouched. Its rules: the fold is exact only for rotation plus positive uniform scale, so other rigs keep their own draw. A material that already moves its own vertices keeps stock skinning. Hidden rigs and freed slots carry zero matrices. Previous-pose buffers feed velocity (`packages/core/src/render/batched-velocity.ts`). Specs: `packages/core/__tests__/projection-skinned.spec.ts`. Playtest: `examples/skinned-crowd/playtests/crowd.playtest.json`.

## Solution

1. **Native skeleton and palette.** Proposed `packages/runtime-native/src/engine/animation/skinning/`. `Skeleton.update` computes bone matrices natively from the N06 transforms. Each compatible rig writes its world-folded matrices into a shared palette slot. The authored `SkinnedMesh` stays the public object for raycasts, bounds and animation (§6.1).
2. **Ported eligibility rules**, each a named reason. Non-uniform scale or shear, a material with its own vertex deformation, an incompatible material class, or negative scale each keep the rig on an unbatched native skinned draw. That fallback stays inside the native renderer (§10).
3. **Pose history.** The previous palette is kept per slot and seeded on spawn, slot reuse, skeleton reuse and camera cut (§10), so velocity is never computed against a stale or foreign pose.
4. **Frequency contract.** The palette updates once per animation evaluation, not once per render pass. Shadow passes reuse the main-pass palette (§11.2).
5. **Rollback.** The legacy backend keeps `projection-skinned.ts`. Its TS becomes binding glue in the native profile.

## Out of scope

- Static and instanced batching, culling and LOD: [PRD-519 (N12)](../PRD-519-n12-native-batching-visibility-lod-gpu-scene.md)
- Temporal consumers of velocity (TRAA and similar): [N14](../N14-native-render-chain-and-advanced-visuals/README.md)

## Execution Phases

#### Phase 1: Native skeleton and unbatched skinning
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/animation/skinning/skeleton.cpp`, `packages/runtime-native/tests/native-engine/skinning/`
- [x] Native bone matrices match reference `Skeleton.update` output for the glTF rig corpus. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skeleton_pose` — 2026-10-05: 9 rigs, 36 poses, 0 differ (boneMatrices float32 bits and every matrixWorld float64 bit) on Dawn, ASan, wgpu and Wasm. Rigs: the repository's skinned glTF files (skinned-character, the templates' mannequin with 65 joints and player-viewmodel with 81, parsed without GLTFLoader) plus six seeded synthetic rigs. Red controls: pose() ignoring a bone parent, 93 differ; product order reversed, 8453 differ.
- [x] A single skinned rig renders and matches the upstream capture at three sampled times. proof: `pnpm parity` case `native-engine-skinned-single` — 2026-10-05: run as `pnpm parity -- --suite native-engine-skinned --renders` (ctest `native_engine_render_skinned`), 3/3 pass: three's SkinnedMesh example (a 4-segment cylinder on a 5-bone chain) at three sampled poses, `skeleton.boneMatrices` bit-exact, 0.014-0.018% of pixels differ (limit 1%), deltaE about 0.0001, on Dawn and wgpu. Red controls: normals not skinned, 5.0-5.2%; first two weights swapped, 4.7-5.7%; drawn unskinned, 5.3-8.6%. The rig is built by fixture ops (typed arrays and object lists are new fixture arguments); a glTF-loaded rig waits on PRD-515.

#### Phase 2: Palette batching with the ported rules
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/animation/skinning/palette.cpp`
- [ ] Every eligibility case in `projection-skinned.spec.ts` gives the same batched-or-own-draw verdict and reason code natively. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skinned_eligibility`
- [ ] The skinned-crowd scene draws compatible rigs as one instanced draw per pass, and refused rigs as correct unbatched draws. proof: `node packages/playtest/dist/runner/cli.js examples/skinned-crowd/playtests/crowd.playtest.json --target desktop`
- [ ] Hidden rigs and freed slots produce no visible triangles, and a reused slot shows no previous occupant. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skinned_slot_reuse`

#### Phase 3: Pose history and update frequency
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/animation/skinning/history.cpp`
- [ ] The previous palette is seeded on spawn, slot reuse, skeleton reuse and camera cut, so the first-frame velocity is zero. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skinned_pose_history`
- [ ] Palette writes per tick equal animation evaluations, not render passes, with shadows enabled. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_skinned_update_frequency`

## Blocked on

- Crowd CPU-cost comparison against current ThreeNative needs a physical Android device run (owner attaches the device; tracked as a performance gate in [PRD-533](../PRD-533-n20-platform-qualification-performance-default-promotion.md)).
