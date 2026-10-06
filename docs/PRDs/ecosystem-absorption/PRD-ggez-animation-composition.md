---
prd_contract: v1
---

# PRD-ggez-animation-composition — Selectively absorb GGEZ animation mechanics

**Status:** PARTIAL
**Priority:** P2 — Add synchronized locomotion blending and collision-safe root-motion composition without replacing the existing player.
**Adoption order:** 1 of 3 in this batch; ordering is preference, not a dependency on the other two PRDs.
**Complexity:** 6 (MEDIUM); estimated 6–10 implementation files (+2), new composition mechanism (+2), coupled animation/physics state (+2); risk override: none.
**Owner:** ThreeNative maintainers; implementation agent executes the plan.
**Depends on:** The masked-layer behavior specified by [PRD-VQ-05](../animation/PRD-VQ-05-masked-additive-animation.md). That behavior may land in the same implementation; completion of the entire VQ-05 document is not a prerequisite.
**Progress:** 75%
**Planning baseline:** `develop` at `ba72eed258b1aefabb9744dc86fd8282c3ab39a5`; 2026-10-05. This document authorizes no implementation, release or merge.

## Context

ThreeNative already owns clip validation, skeleton-safe preparation and stride synchronization through [AnimationPlayer](https://github.com/ThreeNativeHQ/threenative/blob/ba72eed258b1aefabb9744dc86fd8282c3ab39a5/packages/core/src/animation.ts), with public character integration in [core exports](https://github.com/ThreeNativeHQ/threenative/blob/ba72eed258b1aefabb9744dc86fd8282c3ab39a5/packages/core/src/index.ts). VQ-05 already specifies masked override/additive layers. Do not build a parallel layer owner or treat additive animation as missing Three.js mathematics.

[GGEZ at `45ed541cb163ef98694467758f60d5533373ac60`](https://github.com/vibe-stack/ggez/tree/45ed541cb163ef98694467758f60d5533373ac60) separates its animation runtime from its editors. The inspected donor [runtime](https://github.com/vibe-stack/ggez/blob/45ed541cb163ef98694467758f60d5533373ac60/packages/anim-runtime/src/runtime/index.ts) and [evaluator](https://github.com/vibe-stack/ggez/blob/45ed541cb163ef98694467758f60d5533373ac60/packages/anim-runtime/src/runtime/evaluation.ts) implement layered poses, blend nodes, synchronization and root-motion output. Its compiled graph/pose schema is not a drop-in ThreeNative API.

The useful outcome is a normal ThreeNative character that blends walking/running/strafing, reloads or aims with its upper body, and moves against a wall without animation moving it through the wall.

## Solution

Use Three.js `AnimationMixer`/`AnimationAction` as the pose owner. Extract only donor algorithms that reduce implementation risk: blend-weight selection, normalized-phase synchronization and root-motion interval handling. Prefer existing Three.js operations for additive preparation and action blending. Keep source attribution and the inspected [MIT license](https://github.com/vibe-stack/ggez/blob/45ed541cb163ef98694467758f60d5533373ac60/LICENSE) beside every copied implementation; record changed donor paths and the exact revision in the eventual patch. No source is vendored by this planning PR.

Game-authored TypeScript chooses states, clips, masks and weights. The framework supplies bounded mechanical composition, not a serialized animation graph, editor, new scene format or mandatory `@ggez/*` runtime dependency. No new package is justified for these dependency-free mechanics.

### Contracts

- Blend 1D samples by sorted thresholds. For 2D, use a fixed, validated sample triangulation and barycentric weights; project outside-hull queries to the nearest hull edge. Define exact-sample, duplicate/collinear-sample and zero-weight behavior explicitly. Weights are finite, nonnegative and normalized; invalid inputs fail by name, not by NaN propagation.
- A synchronization group has one normalized-phase clock. Speed changes and crossfades preserve phase; loops wrap deliberately, one-shot clips finish once, and pause/resume does not re-fire events. No second wall clock or per-rig render loop.
- Reuse the VQ-05 layer owner and its proof fixture. One base locomotion layer, one masked override and at most two additive layers suffice. Masks resolve on the cloned rig, never mutate shared clips, and exclude the root unless that ownership is explicitly selected. An explicit additive reference pose is mandatory.
- Evaluate root translation/yaw from a named root track over the fixed-step interval, including loop seams. Strip that contribution from the rendered pose exactly once. Convert the delta into the character body's coordinate convention and pass it through existing Rapier movement; accepted displacement, not requested displacement, updates the actor.
- Root-motion authority and velocity-driven stride synchronization are mutually exclusive for a given step. Ordinary velocity-driven characters keep current behavior. Root-motion mode reports requested/accepted delta and blockage without silently retiming or moving the body twice.
- Order is animation intent/root delta, Rapier movement, final composed pose, existing IK, rendering. Unsupported nonuniform parent transforms fail explicitly in the first slice rather than applying a plausible wrong delta.
- Bound action/scratch capacity at initialization; no per-frame pose-buffer or action creation. Scene exit releases only owned actions/buffers, never another character's shared source data.

```mermaid
flowchart LR
  Intent[Game-owned movement and action intent] --> Compose[One Three.js animation owner]
  Compose --> Delta[Root-motion proposal]
  Delta --> Rapier[Existing Rapier movement]
  Rapier --> Accepted[Accepted body displacement]
  Accepted --> Pose[Final pose then existing IK]
  Compose --> Pose
  Pose --> Render[WebGPU web or native]
```

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Synchronized blending | `examples/animation-composition/src/game.ts` → `CompositionCourse.enter` frame → public `AnimationComposer` → incumbent player's mixer | Replaces per-example weight/phase plumbing; existing player remains the default | Public package build, packed tests and AC-5 hardware browser pass; AC-6 open |
| Masked actions | Same character → VQ-05 layer owner → final pose | One implementation and shared tests with VQ-05; no second layer stack | AC-2 |
| Root motion | Fixed-step animation intent → existing character movement → accepted transform | Opt-in alternative to velocity-driven stride authority, never concurrent body writers | AC-3 |
| Consumer discovery | Exported capability → generated agent guidance → installed example | Document only after the export ships; no editor workflow | AC-8 |

The source caller is `examples/animation-composition/src/character.ts`: `update` queues intent, `afterPhysics` observes accepted Rapier movement and finishes the pose, then `CompositionPose.apply` runs existing Three CCD. Shared VQ-05 assertions produce one evidence record reused by both documents; this PRD does not close or rewrite VQ-05.

## Execution Phases

### Phase 1 — A character blends and composes actions

**Status:** COMPLETE (public package and installed CPU behavior; rendered runtime gates remain in Phase 3)
**ACs:** AC-1, AC-2
**Files:** Proposed `packages/core/src/animation-composition.ts`; existing `animation.ts`, `index.ts`; VQ-05's canonical layer implementation/tests; new example game entry.
**Implementation:** Audit donor files/transitive licenses; adapt the smallest useful algorithms to existing Three objects; resolve blend and synchronization data at load; extend the existing layered fixture rather than cloning it. The example must call the public export.

- [x] AC-1 [local; actor: implementation agent]: Public composition updates produce the independently calculated blend weights and synchronized sample times for the locomotion fixture. proof: `pnpm exec vitest run packages/core/__tests__/animation-composition.spec.ts --maxWorkers=1`, plus the same tests in the standalone tarball consumer. Evidence: 2026-10-06, CPU 10, exit 0; eight independently calculated public-import controls pass without source aliases, including invalid layouts and loop/interruption traces. Seven-package JS/DTS builds and strict installed-consumer typechecking pass; the installed suite passes 14/14 composition and canonical masked-layer controls.
- [x] AC-2 [local; actor: implementation agent]: The shared VQ-05 consumer preserves the lower-body pose while applying an upper-body action; weight zero restores the base pose within 1e-5 local-transform tolerance. proof: `pnpm exec vitest run packages/core/__tests__/vq-masked-additive-animation.spec.ts --maxWorkers=1`. Evidence: 2026-10-06, CPU 10, exit 0, 6 tests; exact override/lower-body/zero tolerance, additive reference, distinct cloned masks, once pause/replay/cancellation and 50 shared-source disposal cycles. The canonical VQ-05 PRD is unchanged.

**Verification:** Compare against hand-calculated weight/phase cases and independent base-only samples, not a second call to the same helper.
**Checkpoint:** Independent reviewer reproduced five initial defects; red/green controls now pass for turning subdivision/seams, collinear boundary projection, body/ancestor ownership, root interpolation and quaternion track types. A second pass verified mixed-root interval math and found one additional body-hierarchy defect; its red/green control now passes. Public build/package qualification passes; rendered runtime qualification remains open.

### Phase 2 — Movement has one authority

**Status:** COMPLETE (local source behavior; packaged runtime gates remain in Phase 3)
**ACs:** AC-3, AC-4
**Files:** Proposed `packages/core/src/animation-root-motion.ts`; existing character/physics integration identified before editing; example collision course and focused regression fixture.
**Implementation:** Handle loop-seam deltas and reference transforms; route movement through Rapier; exclude the consumed root contribution from skin pose; retain velocity-driven defaults and IK ordering. No new native ABI is assumed.

- [x] AC-3 [local; actor: implementation agent]: Through the actual game fixed-step path, a root-motion character stops at a collider and its transform follows accepted Rapier displacement with no duplicate root translation. proof: focused Vitest lane on CPU 10, one worker, `animation-root-motion.spec.ts` (12 tests, exit 0). Evidence: 2026-10-06; actual `CompositionCharacter` caller with real Rapier/FixedStepLoop stops at the wall over 240 ticks; turning seams run 180 ticks; authored nine-bone skin with eight actions runs 120 ticks and existing Three CCD after final pose. Lower/zero local-transform tolerance remains 1e-5. Both 100-clone benchmark arms now use built public imports without source aliases; these CPU controls verify counting/animation updates, not the performance target.
- [x] AC-4 [local; actor: implementation agent]: A character using only the incumbent player retains its previous sampled pose/stride trace when composition is unused. proof: `pnpm exec vitest run packages/core/__tests__/animation-composition.spec.ts packages/core/__tests__/animation.spec.ts --maxWorkers=1`. Evidence: 2026-10-06, CPU 10, exit 0; independent four-tick incumbent pose/stride trace and action/binding baseline pass, plus 51 incumbent-player regression tests. Composition creates no unused-path owner or update registration.

**Verification:** Exercise paused/interrupted/root-loop movement and IK-after-animation ordering; reject unsupported transforms with actionable diagnostics.
**Checkpoint:** Independent review exposed NaN observed coordinates, an unmatched callback on synchronous scene reset, frozen benchmark frame counting and incomplete removal observations. Reproduced failures and corresponding fixes pass: finite body-coordinate validation; pending-intent guard in the example; only rendered frames with actual animation updates count; Spine/Arm/RightHand authored local transforms are observed before IK. The normal example typecheck and public baseline arm then reproduced a wrong `playWeighted` field (`name` instead of `clip`); both pass after the three-field correction. Full focused built-package lane: 86/86 tests, seven files, CPU 10, one worker, no source aliases. Core and example strict typechecks pass.

### Phase 3 — The installed consumer works on two runtimes

**Status:** PARTIAL (installed hardware browser verified; Linux native pending)
**ACs:** AC-5, AC-6
**Files:** Proposed `examples/animation-composition/playtests/composition.playtest.json`, example packaging, capability comments and generated agent guidance; reuse existing playtest runner.
**Implementation:** Package the same game entry for browser and Linux desktop. Scenario drives locomotion, strafe, reload, blocked movement and reset, observing bones/body state and actual rendered output. Test an installed/tarball consumer, not only workspace aliases.

- [x] AC-5 [shared; actor: implementation agent on a WebGPU runner]: The browser consumer passes the full composition scenario with a nonblank animated character. proof: the installed CLI runs the original course with five screenshot fields added, its managed preview server and all seven supported WebGPU/performance arguments. Evidence: 2026-10-06, CPU 10/22, RTX 2080, driver 615.71.09, actual `webgpu` adapter `nvidia/turing`; third attempt exit 0, 26.13 s, 35/35 assertions. Observed ticks 60→926 preserve 804 authored ticks plus 62 release-settle ticks; 50 real scene transitions return actions/buffer bytes to zero and leave clips unchanged. Inspected [walk](../../verification/visuals/ggez-animation-composition/walk.png), [run](../../verification/visuals/ggez-animation-composition/run.png), [reload](../../verification/visuals/ggez-animation-composition/reload-finish.png), [recoil](../../verification/visuals/ggez-animation-composition/recoil.png) and [blocked](../../verification/visuals/ggez-animation-composition/blocked.png) captures contain the animated character. The original root negative exits 1 in 5.30 s: actual body movement 1.033 m while `skinRootZ` remains 0, failing the forbidden `>= 0.5` assertion with its expected stagnation diagnostic. Both runs reach ready startup with no runtime errors; all 14 recorded owned PIDs per run are gone and the capture lease is free. The first two failed attempts remain recorded below.
- [ ] AC-6 [shared; actor: implementation agent on the Linux native runner]: The same packaged entry passes the composition scenario on Linux native. proof: `node packages/playtest/dist/runner/cli.js examples/animation-composition/playtests/composition.playtest.json --target desktop --executable ${TN_NATIVE_EXECUTABLE:?}`. Evidence: pending.

**Verification:** Record revision, package hashes, adapter/driver, collected assertions and actual result. These are future implementation gates; none ran during planning.
**Checkpoint:** Authored example and four scenarios are present. Actual scenario loader accepts all four (4/4, exit 0); the positive course includes 50 separate scene transitions and the negative control requires forbidden residual skin-root translation. A standalone tarball consumer passes strict typechecking, 14/14 public composition/masked-layer tests and its normal web build. Its first authored entry SHA-256 was `87343d9ca3aa4c3417427572a147286b3922710e1fef1453c32a2fffb66fef06`; the verified startup repair below changes it to `cc07f0d8184b3431991dc0927fa865232a65a1d4f9ededa200facb7695250ae1`. The paired crowd preserves 100 rigs, nine bones, at most eight actions, 300 warm-up/1,800 measured frames and the original 2 ms incremental p95 target. Native qualification remains unrun; the first nonqualifying benchmark attempt is retained below. No Windows, macOS, Android or iOS qualification is implied by Linux evidence.

2026-10-06 hardware browser attempts: the parent allocated a serial browser window after Strata released the GPU. Preflight recorded an RTX 2080, driver 615.71.09, 6,685 MiB free VRAM and a free capture lease. Attempt 1 exited 2 after 33.16 s: the authored game omitted `initialState`, so the existing constructor rejected scene `course` before bridge installation. A focused public-entry construction test reproduced that exact error (one failure, exit 1), then passed after adding `initialState: {}` (one pass, exit 0, CPU 10). The normal installed web rebuild passed in 12.31 s; the final public-entry/root-motion focused lane passes 13/13. The failure, console, actual launch arguments and teardown are retained; it is not qualifying proof.

Attempt 2 exited 1 after 79.29 s on `TN_CAPTURE_BLANK`. It reached actual `webgpu` with adapter vendor `nvidia`, architecture `turing`, and the seven supported WebGPU/performance arguments. All 35 collected semantic assertions passed, including 50 actual scene transitions, zero exit actions/buffer bytes and unchanged source clips. Observed ticks advanced from 60 to 926: 804 authored ticks plus 62 release-settle ticks. The initial PNG visibly contains the character; later captures fail because the drawing buffer changed from 1,280×720 at automatic scale 1 to 3×3 at scale 0.85. The authored HTML had removed the generated minimal template's full-size canvas layout. Restoring its `width: 100%; height: 100%` keeps the CSS box independent of the backing buffer, preserving automatic resolution scaling without a renderer override or package change. Independent read-only review accepted this game-layer repair; its normal installed web rebuild passed in 12.99 s. All 14 recorded owned process IDs are gone and the capture lease is free. Neither failed attempt closes AC-5.

Attempt 3 and the original negative now qualify the browser course as recorded in AC-5. The current installed source also passes its normal strict typecheck, exit 0. B1 was rejected before launch when a fresh read-only check found foreign GPU utilization at 37% with 4,316 MiB free VRAM. The first B1 attempt then ran and is recorded below; no native executable has launched. The original three-pair performance contract is unchanged.

The first B1 hardware attempt exited 1 after 80.84 s. It reached all 300 warm-up and 1,800 measured renders with 100 rigs, nine bones and three actions, but the scene-node observer's default 50-node sample reported only 4,800 triangles against the required 9,600 despite matching all 100 rigs. Its only failed assertion is `sceneNodes[0].minTriangles`, with `TN_PLAYTEST_SCENE_NODE_GEOMETRY` explaining the sample limit. Adding the shipped `select.limit: 100` to both benchmark scenarios changes only observation capacity; removing that field restores the prior scenario objects exactly. All rig/action/frame counts, 120,000 ms deadlines and original thresholds remain intact. The failed run and prior scenarios are retained, including its 2,724 measured fixed updates over 45.4 simulation seconds and 10.6 ms animation CPU p95; this is not a performance pass. Teardown released all 12 recorded owned PIDs and the capture lease; postrun foreign GPU utilization was 30%. Restart the entire six-arm set rather than use this arm in a pair.

Resource polling unnecessarily called bridge advance under `--live-clock`. The production core plugin already selects `wallClockAdvance`, preserving the frame pump; the initial lower-level test did not establish a production freeze. The corrected control calls actual `playtest().setup`, its bridge and `FixedStepLoop`: a resource ready at 10 ms is observed at 16 ms after the fix, but the old runner adds a 10 ms wait and rejects it at 26 ms against a 20 ms deadline. A held live pump also respects the resource deadline without entering the separate pump timeout. The scoped fix forwards the selected live-clock flag and omits advance only for live-clock resource waits; deterministic waits still deliver explicit ticks. Production-adapter RED: one live failure and one deterministic pass, exit 1. GREEN: clock/wait/CLI 9/9, CPU 10, one worker, exit 0; prior wait/aim/click controls 29/29. Independent review found no remaining source blocker. The context/renderer and in-process transport are stubbed; this result does not qualify browser execution or performance. Current active PR inventory has no owner editing these playtest paths; PRs 437/438 were only read.

## Acceptance Criteria

- [ ] AC-7 [shared; actor: implementation agent on the Phase 3 reference runner]: Composition meets the bounded animation CPU budget below. proof: Phase 3 scenario's benchmark mode using the existing playtest performance instrument and isolated baseline/candidate artifacts. Evidence: 2026-10-06, CPU 10/22, actual RTX 2080 / `nvidia/turing` WebGPU, driver 615.71.09. The first completed pair fails: baseline p95 4.20 ms, candidate 7.30 ms, incremental 3.10 ms against the unchanged 2 ms ceiling. Both arms exit 0 with 16/16 assertions, all 100 distinct skins / 9,600 triangles, nine bones, baseline three / candidate eight actions, 300 warm-up and exactly 1,800 measured renders. Baseline observes 2,172 measured fixed updates / 36.2 simulation seconds; candidate 2,153 / 35.883 s. One pair completed; the other two are unqualified. C2 was launched before the comparison was assessed, then deliberately interrupted through only its verified owned timeout supervisor: exit 2, not a qualifying or substitute arm. All 14 owned PIDs are gone on recheck and the lease is free. The external serial orchestrator now rejects B2 before any GPU query or renderer launch after the failed prior pair (exit 4). Preserve the failed pair and interrupted attempt; no source, frame count, threshold or package change masks this result.
- [x] AC-8 [local; actor: implementation agent]: The packed consumer reaches the documented public capability without any GGEZ editor/compiler/schema package. proof: existing tarball/scaffolder path, standalone strict typecheck and 14/14 public tests, normal `pnpm build:web`, and actual installed engine MCP stdio capability search/detail. Evidence: 2026-10-06, CPU 10, all exit 0; eight stamped package archives have resolved manifests and shipped declarations. Core, physics, playtest and scaffolder resolve inside the consumer's `.pnpm` tree; no workspace-linked runtime or `@ggez/*` runtime package is present. Donor MIT notices survive emitted JS and declarations. Package/source hashes and commands are in the requested run receipts outside the repository.

## Performance and lifecycle contract

Proposed targets, not measurements: 100 cloned rigs of at most 80 bones, at most eight active actions per rig; 300 warm-up and 1,800 measured frames, three paired runs on the same machine. Composition's incremental p95 CPU cost is at most 2 ms/frame. The unused path adds no actions, buffers or update registrations. Fifty scene enter/exit cycles return owned action and buffer counts to baseline; source-clip hashes stay unchanged. Include those lifecycle assertions in the Phase 3 scenario, not another harness. Report individual paired results and noise; a skipped benchmark or software adapter does not establish the target. Do not loosen a failed target without a recorded scope decision.

## Scope, risks and rollback

Includes bounded blending, synchronization, shared masks/additive behavior and explicit root-motion routing. Excludes generalized graphs/state-machine editors, motion matching, networking, retargeting, new IK solvers and automatic replacement of existing games. The fixture owns visual assets, shaders and motion choices. Primary risks are cloned-rig cross-talk, sync discontinuities, root-motion double application and new work on the unused path.

If selective extraction becomes a dependency on GGEZ's graph compiler, keep upstream Three operations and re-scope the extraction; do not import the framework to save the prototype. Removing the opt-in composition entry must restore the incumbent consumer unchanged.

## Blocked on

The parent granted the serial CPU 10/22 package/installed-consumer/push slot after the animals lane released it. Normal dependency installation, seven-package JS/DTS builds, focused typechecks and packed public proof now pass; the original missing-dist pre-push prerequisite is resolved. The hardware browser correctness/lifecycle window is complete and released, with all recorded owned processes gone and a free capture lease. AC-5 passes; AC-7 remains failed/open after the first 3.10 ms pair, and the two remaining pairs are unqualified. The parent authorized CPU/source profiling before a later new-source qualification window. Bounded installed-public CPU profiles bind the actual tarball core and one Three module, but do not qualify the original rendered budget. They do not yet establish a source optimization: most samples are incumbent Three action/quaternion evaluation, while immutable layer/action metadata lookups remain a candidate for investigation. Linux native remains held: the published 0.3.4 host differs across 28 compiled-input paths, while the parent's matching-tree CI artifact contains reports/PNGs but no executable or producer receipt. AVBD is preparing one shared exact-source host build plan for all three ecosystem PRDs; this lane does not start a duplicate native build. The installed released host has not been executed or qualified against this packaged entry. Additional platform qualification is outside this bounded first slice. No npm release, merge or credential change is authorized.

## Decisions

2026-10-06 — User authorized this dedicated implementation lane after planning PR 446 merged. Isolated branch `feat/ggez-animation-composition` starts at fetched `origin/develop` `29fdae8bf9141b4a82dac91b276dbb574a7d06a3`. Existing VQ-05 has no landed layer owner or active animation-editing PR; this lane supplies its one shared layer-preparation fixture. PRs 437/438 remain read-only. No GGEZ runtime dependency is introduced: inspected `anim-runtime`, `anim-core`, `anim-schema` and `anim-utils` are MIT; schema's Zod dependency is not imported. Adapted helper/yaw paths retain the pinned donor MIT notice in source. Donor `anim-core/src/clip.ts` was also inspected; its per-call full-pose allocations and loop iteration were not adopted. Packed public proof and hardware browser correctness pass. Linux native and the original three-pair hardware performance target remain unverified and unticked.

The transitive license audit also inspected the upstream [Zod 3.25.76 MIT license](https://github.com/colinhacks/zod/blob/v3.25.76/LICENSE), the dependency version named by the pinned donor schema manifest. Neither Zod nor the GGEZ graph/schema runtime enters this implementation's import closure.

2026-10-05 — User selected GGEZ for selective absorption. Preserve existing animation/physics ownership and share VQ-05's masked-layer implementation. The user requested one documentation-only draft PR containing all three plans; this planning-only batch does not authorize implementing three PRDs in one feature PR. All implementation progress remains zero.
