# PRD: Constrained skeletal animation admission

**Status:** DONE — closed-chain-ik admitted as an opt-in example: it holds a rigid two-handed grip that CCD and attachment cannot, and runs on web, desktop native and the Android emulator.
**Priority:** P1. **PR:** #332. **Base:** develop.

## Goal and ownership

Compare the existing attachment/grounding and Three CCD paths against closed-chain-ik/core for two-handed grips and coupled mechanical constraints. Keep Three bones, the engine animation lifecycle and game-owned targets authoritative. Never introduce mandatory URDF, Worker infrastructure, a second skeleton API or root-motion controller. Reject the donor if a simpler existing solution meets the same constraints and cost.

**Ruling, 2026-09-25:** prototype source is in `examples/integrations/ik`, a nested opt-in example, not a new core package or addition to the benchmark arm. Donor source is pinned to `38a7e273082311e69c84c35a7c8f64e510e188a5`; its core subpath avoids the Three/URDF helper exports.

`ConstrainedIK` builds internal joint/link frames for direct Three Bone hierarchies, folds positive uniform scale into link offsets, configures bounded solve iterations, preserves animation-relative joint limits, applies quaternion corrections and reports actual post-blend residuals. Targets are validated before mutation; solver errors restore the input pose. `pose.ts` provides affine/scale checks and metre/radian measurements. The adapter takes no animation-loop ownership. `examples/constrained-ik` is the game that runs it: `AnimationMixer` plays the authored hold, then the adapter solves both hands once per fixed tick, then the frame renders.

## Implementation order

### Phase 1 — baseline and donor admission
- [x] Search capabilities and map the update order against existing animation and grounding. proof: `engine_search_capabilities` for "two-handed rifle grip", "IK hand or foot on a target" and "plant feet on uneven ground" returns `AnimationPlayer`, `attachToBone`, `SkeletalMesh3D` and `GroundSnap` and no solver. `GroundSnap` moves the whole model and `attachToBone` parents an object, so nothing re-poses bones. Order: the mixer or `AnimationPlayer` in `Scene.update`, then `ConstrainedIK.update`, then render. The adapter never moves the root, so `GroundSnap` still composes with it.
- [x] Build the reachable and closed-linkage fixtures with a CCD baseline. proof: `tests/admission.test.mjs`, a closed loop (chest → right arm → rifle → left arm → chest) with spine and chest shared by both chains, swept over 20 aim frames (yaw ±0.5 rad, pitch −0.2..0.3 rad). The reachable single-limb case with CCD is `tests/integration.test.mjs`.
- [x] Record a coupled constraint the baseline cannot meet at the same quality and budget. proof: 32 iterations for every arm, tolerances 5 mm / 0.01 rad. The candidate is worst 1.6 mm / 0.0094 rad, converged on every frame. Three CCD is worst 15 mm / 1.05 rad. Attachment plus CCD is worst 209 mm / 0.56 rad. CCD has no orientation goal, so no iteration budget closes that gap. The test fails if a baseline ever meets every tolerance.
- [x] Pin and audit the core-only donor dependency and its packaging requirements. proof: the git SHA is pinned and `package-lock.json` is committed. The donor is Apache-2.0. `closed-chain-ik/core` imports only gl-matrix 3.4.4, linear-solve 1.2.1 and svd-js 1.1.1, all MIT. npm also installs the peer `urdf-loader` 0.13.1, which core never imports; the web and Android bundles contain 0 `urdf` references.
- [x] Execute nine numerical contract tests after observing the stub fail. proof: `npm test` in `examples/integrations/ik`, `tests/contracts.test.mjs` 9 passed, 0 failed on Node 22.

### Phase 2 — constrained pose adapter
- [x] Add failing contact, length, orientation and coordinate-space regression tests. proof: `admission.test.mjs` A–D (contact, orientation, bone-length drift ≤ 1e-6) and E1 (identity vs translated/rotated/scale-2 body). E1 goes red when the `* scale` folding in `row.joint.setPosition` is removed.
- [x] Implement bounded pose solving and explicit residual/status reporting. proof: `tests/integration.test.mjs`.
  Five pinned donor/Three integration tests pass, including reachable/unreachable residuals, invalid input, disposal, zero blend and the CCD baseline.
- [x] Pass invalid-input, cloning, blending and idempotent-disposal tests. proof: E2 (seven malformed target shapes throw, pose bit-identical), E3 (two rigs independent, caller arrays copied), E4 (blend 0 bit-identical, 0.5 strictly between), E5 (double dispose, then update refuses), E6 (a non-finite pose found mid-write restores every bone). E6 goes red when the catch-block rollback is removed. `npm test` gives 9 + 5 + 7 = 21 passed, 0 failed.
- [x] Strict-check `src/pose.ts` with locally available TypeScript 5.8.3. proof: exit 0; the package build (`npm run build`) is strict TypeScript 5.9.3, exit 0.

### Phase 3 — runtime proof
- [x] Pass the constrained-animation browser WebGPU playtest. proof: `examples/constrained-ik/playtests/grip.playtest.json`, `--browser-recipe webgpu --headed` on the session display, adapter `nvidia`/`turing`, 0 diagnostics. Result: 1110 ticks, all converged, worst 3.38 mm / 0.00997 rad, length drift 6.1e-16 m. The private-Xvfb run got SwiftShader, whose GPU process dropped the instance (`Instance dropped in popErrorScope`), so its verdict is environmental.
- [x] Pass the same target trace on desktop native, recording the actual OS and adapter. proof: `grip.desktop.playtest.json --target desktop` on the Dawn host `mystral` (tn-linux, built 2026-09-26), Linux 7.2.6, Vulkan, NVIDIA GeForce RTX 2080. Result: 1141 ticks, all converged, and the worst values match the web run to 15 digits. Negative control: `blend` 0 fails `allConverged`, `worstMetres` and `worstRadians`.
- [x] Pass the same target trace on Android, naming the executed lane. proof: the same scenario with `--target android --device emulator-5554`. Lane: AVD `threenative_api35`, API 35, x86_64, SwiftShader Vulkan, QuickJS runtime, APK `com.threenative.constrainedik` source-built from this branch. Result: 1142 ticks, all converged, and the worst values match desktop. This is an emulator, not a phone.
- [x] Compare candidate residuals and CPU cost against both fixed baselines. proof: median solve is about 250 µs for the candidate, 14 µs for CCD and 3 µs for attachment in node. In the game it is 0.07–0.10 ms per tick on desktop and web, and 2.4 ms on the QuickJS emulator. Residuals are in the Phase 1 box. No mobile performance claim.

### Phase 4 — ownership and adoption
- [x] Keep grips, gait, aiming and visual decisions in editable game source. proof: the rig, authored hold, rifle sweep, targets and tolerances live in `examples/constrained-ik/src/scenes/Grip.ts`; materials and lights live in `src/render/look.ts`. The adapter takes bones and targets and creates no geometry, material or target.
- [x] Prove ordinary games load no new solver unless the integration is imported. proof: `rg "closed-chain-ik|constrained-ik" packages templates pnpm-lock.yaml` has 0 hits. The donor is resolved only from the nested npm lockfile. The new workspace game has no `build`/`typecheck` script, so the root recursive runs never need it.
- [x] Run repository checks and document supported transforms and solver limits. proof: `pnpm typecheck` exit 0 (after `pnpm build`), `pnpm lint` exit 0, `pnpm test` with `TN_SUITE_EXCLUDE_PACKAGES=@threenative/runtime-native` gave 6121 passed and 2 failed of 6128. The two, `verify-golden-path` and `engine-mcp search`, pass alone (74/74), so they are load flakes. runtime-native was excluded because this worktree has no `build/tn-linux` contract binaries, and this diff touches no native code. The IK package suite passes 21/21 from `npm ci`. Limits are in `examples/integrations/ik/README.md` under "Supported transforms and limits".
- [x] Complete a separate code review and synchronize PRD, PR and progress label. proof: an independent reviewer subagent found no high-severity defects. It hand-checked scale folding, quaternion conversion, blend, rollback, dispose and state isolation, and confirmed E6 is not vacuous. Its low finding is fixed: CI now runs `npm ci`, and the lockfile records the donor over https. Its medium finding is below under "Not claimed". PR #332 body mirrors these boxes; label `prd:100`.

## Acceptance criteria
- [x] The closed-linkage fixture demonstrates value beyond the existing attachment/CCD paths. proof: Phase 1, box 3.
- [x] Reachable targets meet the recorded contact and orientation tolerances. proof: 5 mm / 0.01 rad on all 20 admission frames and on about 1100 ticks per platform.
- [x] Bone-length invariance holds throughout the test trace. proof: worst drift 6.2e-10 m in node and 6.1e-16 m in game.
- [x] Unreachable and malformed targets cannot silently corrupt the pose. proof: E2, E6 and `integration.test.mjs` "unreachable target stays finite".
- [x] The adapter does not own root movement or start another frame loop. proof: the game calls `update()` from its own `Scene.update`, and the adapter writes only joint quaternions.
- [x] Browser WebGPU evidence is recorded. proof: Phase 3, box 1.
- [x] Desktop-native evidence is recorded. proof: Phase 3, box 2.
- [x] Android evidence is recorded. proof: Phase 3, box 3.

## Not claimed

- **iOS, Windows, macOS:** not run.
- **Phone hardware and mobile performance:** the Android proof is an x86_64 emulator on SwiftShader and QuickJS.
- **Playtests in CI:** the game's scenarios run locally, as `examples/skinned-crowd`'s do; CI runs only the IK package suite.
- **Engine admission:** this stays an opt-in example. The donor is not a dependency of any package or template.

## References

- [Adapter, limits and commands](../../../examples/integrations/ik/README.md)
- [Running game](../../../examples/constrained-ik/README.md)
- [Donor](https://github.com/gkjohnson/closed-chain-ik-js)
- [Original detailed planning revision](https://github.com/ThreeNativeHQ/threenative/blob/74a6878dada95fef2afd38053295632c67defd18/docs/PRDs/threejs-integrations/PRD-threejs-constrained-ik.md)
- [Charter](../../architecture/CHARTER.md)
