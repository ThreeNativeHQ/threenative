# PRD-526 — Post effects and render chains run native (N14d)

**Status:** DONE
**Complexity:** 4 — every template's post graph must compile and order natively
**Owner:** João
**Work package:** N14 — [native-engine batch](../../../native-engine/README.md)
**Depends on:** [PRD-523 (N14a)](PRD-523-n14a-the-render-graph-owns-passes-and-history.md), [N08 — native TSL](../../../native-engine/N08-native-tsl-and-shader-packages/README.md)

## Context

§11.3 names render chains; §10 requires temporal effects to keep correct history. The chain mechanism
is `packages/core/src/render/chain.ts`. The look is not engine code: each template authors its post in
generated source such as `packages/create-threenative/templates/action-rpg/src/render/postprocessing.ts`
(the charter's "never own the look" rule). So the engine ports the mechanism; the templates' TSL post
graphs compile through N08 unchanged.

## Solution

1. Port the chain's ordering, enable/disable, MRT requests and output-graph wiring into proposed
   `packages/runtime-native/src/engine/renderer/chain/`, expressed as render-graph passes (N14a).
2. Template post graphs (tonemapping, bloom, SSGI, TRAA and the rest) compile to N08b shader packages;
   temporal ones declare history through N14a.
3. A pass whose graph needs an unsupported TSL feature fails at build with a named diagnostic. It is
   never dropped from the chain silently (the TSL silent no-op class this repo has already hit).
4. Rollback: the legacy backend keeps `chain.ts`.

## Decisions

2026-10-07, coordinator (owner delegated): the box claims parity with the legacy backend; it is judged by the paired delta and the red control. The visual gate's absolute floor of 4 also fails for the legacy frame, so it measures the starter template's look, not native parity; that is template work outside this PRD.

## Out of scope

- Choosing or changing any template's look; parity is against today's output (§9.3).

## Execution Phases

#### Phase 1: Chain mechanism
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/renderer/chain/`, `packages/runtime-native/tests/native-engine/chain_*.cpp`
- [x] A chain built in the same order as `chain.ts` produces the same pass order and target usage. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_chain_order` — 2026-10-05: green on Dawn, ASan and wgpu, exact. `planRenderChain` (`src/engine/renderer/chain/plan.{h,cpp}`) ports `RenderChain`'s decisions as a CPU plan: `resolveStageOrder` (built-in ranks, anchored authored stages, siblings in supply order, cycle and missing-definition refusals as `TN_RENDER_CHAIN_ORDER`), every drop reason in `apply()`, the contributions and `resolveVelocity`'s source (mrt or per-object). 34 configurations recorded from the real `RenderChain` (`tests/native-engine/chain/chain-reference.ts`), including every tier against every minimum tier, match stage for stage. Red controls: swapped before/after (6 differ), medium and low swapped (2 differ). Port by the save-tokens arm; reviewed, its internal exceptions replaced by error returns (engine code never throws) and the tier matrix added
- [x] A pass needing an unsupported feature fails with a named diagnostic rather than vanishing. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_chain_unsupported` — 2026-10-05: green on Dawn, ASan and wgpu. A stage declares the renderer `features` its pass needs; a request carrying the native renderer's `nativeFeatures` drops a stage needing one it lacks as `TN_NATIVE_RENDER_FEATURE_UNSUPPORTED: <feature>` (its first missing) in `dropped`, before it is built, so every requested stage is either in the chain or named. The web path (no native feature list) checks nothing and is unchanged (`native_engine_chain_order` and its reference stay green). Red control: the check disabled, the case fails.

#### Phase 2: Template post graphs
**Status:** DONE
**Files:** `packages/runtime-native/conformance/registry.json`
- [x] Every template's `src/render/postprocessing.ts` graph compiles to a validated shader package. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_template_post_packages` — 2026-10-06: green on Dawn, ASan and wgpu: `native_engine_template_post_packages` enumerates the templates from disk and exports each quality tier's real post graph (three r185 TSL), lowers it natively and validates the shader package: 36 graphs from 13 templates validate and the 3 snow tiers install no post chain (snow's WorldEnvironment applies direct tone mapping, worldEnvironment.ts:480-483; a guard fails if snow ever requests a stage). New native lowerings: TSL Fn, RTT, bloom, sharpen, GTAO, denoise, SMAA (exact SMAA lookup data), each with a unit check. Red control: a graph with an unlowered node fails naming the template and node; zero templates found fails.
- [x] The starter template's post chain matches the legacy backend within the visual-gate tolerance. proof: `pnpm visuals` on the native-engine arm — 2026-10-07, final engine (after the review fixes, `ctest -L native-engine` 264 tests green but the known `native_engine_update_scaling`), run `artifacts/visuals/starter-native-r6` (`pnpm visuals -- --native-engine --out artifacts/visuals/starter-native-r6`, then `--score-only` with six fresh blind verdicts): native against legacy mean absolute difference 0.543 of 255, perceptual deltaE 0.340, 31.3 percent of pixels differ at all. Positive arm, three fresh raters on one bundle (legacy twin, legacy, native shuffled): native 3, 3, 3 against legacy 3, 3, 3, delta 0, minimum detectable effect 0, INDETERMINATE (not a loss). Red control (legacy against the starter with its post graph dropped, three fresh raters): 3 against 2, delta -1, LOSS, so the control bites; its pixel delta against legacy is deltaE 14.7. Judged by the paired delta and the red control, as the Decisions entry below says; the gate's absolute floor of 4 is not met by the legacy frame either and is not this box's claim. What it took (each red-green, in the commits): the glTF loader decoded no images and ignored samplers; post and output passes used automatic layouts that drop an unread binding; GTAO's `normal` was never drawn; normalized int8 normals and unsigned-byte skin weights were bound as float32; material textures had one mip level and a zeroed sampler clamps the level of detail to 0; standard materials ignored `normalMap` and `dFdy` lacked three's sign; the harness rendered with tone mapping none while legacy applies ACES after the graph. Unmatched by design: the pennant's custom material and wave (glTF export only) and the HUD, shared by both arms.
- [x] A TRAA fixture holds history through motion and resets it on a camera cut. proof: `pnpm parity` (new case `native-engine-traa-history`) — 2026-10-06: green on Dawn: `pnpm parity -- --suite native-engine-traa --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders`, fixture `traa-history` (three r185 TRAANode in the browser; 24 frames with motion, a cut at frame 20). Root causes found with the TN_TRAA_DUMP per-frame dumps (beauty, velocity, jitter and projection identical on both sides): a history reset seeded from the current instead of the previous frame's beauty, and out-of-image beauty neighbours read as 0 instead of (0,0,0,1) as the browser does. Frames 20-23 now agree within 0.0005 per channel; the fixture states a one-level 8-bit budget (`metric.levels: 1` with its reason). Red controls: `currentWeight = 1.0` (no accumulation) and an empty `cameraCut()` both fail traa-history.
