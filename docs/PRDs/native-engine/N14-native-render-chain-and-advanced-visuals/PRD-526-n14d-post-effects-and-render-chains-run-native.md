# PRD-526 — Post effects and render chains run native (N14d)

**Status:** IN PROGRESS
**Complexity:** 4 — every template's post graph must compile and order natively
**Owner:** João
**Work package:** N14 — [native-engine batch](../README.md)
**Depends on:** [PRD-523 (N14a)](PRD-523-n14a-the-render-graph-owns-passes-and-history.md), [N08 — native TSL](../N08-native-tsl-and-shader-packages/README.md)

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

## Out of scope

- Choosing or changing any template's look; parity is against today's output (§9.3).

## Execution Phases

#### Phase 1: Chain mechanism
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/engine/renderer/chain/`, `packages/runtime-native/tests/native-engine/chain_*.cpp`
- [x] A chain built in the same order as `chain.ts` produces the same pass order and target usage. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_chain_order` — 2026-10-05: green on Dawn, ASan and wgpu, exact. `planRenderChain` (`src/engine/renderer/chain/plan.{h,cpp}`) ports `RenderChain`'s decisions as a CPU plan: `resolveStageOrder` (built-in ranks, anchored authored stages, siblings in supply order, cycle and missing-definition refusals as `TN_RENDER_CHAIN_ORDER`), every drop reason in `apply()`, the contributions and `resolveVelocity`'s source (mrt or per-object). 34 configurations recorded from the real `RenderChain` (`tests/native-engine/chain/chain-reference.ts`), including every tier against every minimum tier, match stage for stage. Red controls: swapped before/after (6 differ), medium and low swapped (2 differ). Port by the save-tokens arm; reviewed, its internal exceptions replaced by error returns (engine code never throws) and the tier matrix added
- [ ] A pass needing an unsupported feature fails with a named diagnostic rather than vanishing. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_chain_unsupported`

#### Phase 2: Template post graphs
**Status:** NOT STARTED
**Files:** `packages/runtime-native/conformance/registry.json`
- [ ] Every template's `src/render/postprocessing.ts` graph compiles to a validated shader package. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_template_post_packages`
- [ ] The starter template's post chain matches the legacy backend within the visual-gate tolerance. proof: `pnpm visuals` on the native-engine arm
- [ ] A TRAA fixture holds history through motion and resets it on a camera cut. proof: `pnpm parity` (new case `native-engine-traa-history`)
