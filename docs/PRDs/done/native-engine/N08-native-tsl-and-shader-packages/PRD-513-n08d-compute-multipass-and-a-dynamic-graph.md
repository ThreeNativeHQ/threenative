# PRD-513 — Compute, multipass and a dynamic graph (N08d)

**Status:** IN PROGRESS
**Complexity:** 4 — compute dispatch, render-target chaining, and the first TSL graph built by AOT-compiled game code
**Owner:** João
**Work package:** N08 — [native-engine batch](../../../native-engine/README.md) · [N08 index](../../../native-engine/N08-native-tsl-and-shader-packages/README.md)
**Depends on:** [PRD-511](PRD-511-n08b-shader-packages-not-wgsl-text.md), [PRD-506 (N05b)](../N05-native-typescript-qualification/PRD-506-n05b-three-imports-bind-natively-and-callbacks-are-reclaimed.md)

## Context

§9.4 proofs three and four: storage-buffer compute feeding a draw, and a multi-pass effect through
a render target — plus at least one graph constructed dynamically by compiled game code, all
without upstream `three` in the application. §9.1 requires native graph construction for supported
dynamic graphs and named diagnostics otherwise; baking arbitrary runtime-dependent user code while
claiming identical behaviour is not allowed. Today GPU compute in the engine runs through upstream
TSL `compute()` in JS (`packages/core/src/compute-driven.ts`).

## Solution

1. **Compute:** IR compute entry points with workgroup size, `storage` buffers and
   `instanceIndex`; a package declares which draw reads the buffer, and the native path inserts the
   dispatch before that draw (simple ordering here; full graph is N14a).
2. **Multipass:** a two-pass chain — scene into a render target, a TSL post graph sampling it into
   the surface — with the render target's size following resize.
3. **Dynamic graph from compiled code:** a TS fixture compiled by the N05 toolchain builds a TSL
   graph at runtime from a value only known after start (e.g. a config-chosen number of layered
   noise octaves) via the native builder API; the engine specializes and caches the package.
4. **Unsupported dynamic features** (e.g. a graph depending on a closure the compiler cannot lower)
   fail with `TN_TSL_DYNAMIC_UNSUPPORTED <reason>` at graph build time.

## Out of scope

- The general render graph, transients and temporal history — [PRD-523 (N14a)](../N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md).
- GPU particles and fluids — [PRD-527 (N14e)](../N14-native-render-chain-and-advanced-visuals/PRD-527-n14e-particles-and-fluids-run-native.md).

## Execution Phases

#### Phase 1: Compute feeds a draw
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/conformance/scenes/native-engine-compute-draw/`
- [x] A compute pass writes 10,000 instance positions into a storage buffer and the following draw renders them matching the browser reference. proof: `pnpm parity -- --case native-engine-compute-draw` — 2026-10-05: green, pixel-identical to the browser golden at a zero budget, run as `pnpm parity -- --suite native-engine-tsl --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders` (fixture `tsl-storage-instances`; the full native-engine suite stays 98 pass, 0 fail, 3 blocked array-shape cases as before). A fixture `tsl` op applies a named TSL program on both sides (`render/tsl-programs.js` in Chromium's WebGPU, `fixture/tsl_programs.h` with the native builder): a compute pass writes the 10,000 grid positions into a storage buffer, and an InstancedMesh's `positionNode` (now native: `engine/shader/position_node.h`, applied after morph, skinning and instancing as `setupPosition` does; storage bound by name via `Renderer::setStorage`) places each instance. The compute half alone is `native_engine_compute_instance_grid`, 10,000 positions bit-equal. Red control: the positionNode ignored, the fixture fails.
- [x] Readback of the storage buffer equals the CPU-computed expected positions. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_compute_readback` — 2026-10-05: green on Dawn, ASan and wgpu. `ComputePass` (`src/engine/renderer/compute.{h,cpp}`) compiles an IR compute program to a pipeline, binds its storage buffers in declaration order and its scalar uniforms by name, and dispatches 64-thread workgroups. The test program writes 10,000 instance positions on a 100 x 100 grid (exact u32 row and column, `spacing` uniform), with 37 invocations past the end writing nothing; the readback equals the CPU positions in all 40,000 components. A dispatch given the wrong storage buffers is refused, not recorded. The IR now converts one numeric part of the same shape (`u32(x)`, `vec3<f32>(v)`), as WGSL does

#### Phase 2: Multipass through a render target
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/conformance/scenes/native-engine-multipass/`
- [x] Scene → render target → TSL post pass → surface matches the reference, before and after a resize. proof: `pnpm parity -- --case native-engine-multipass` — 2026-10-05: green, run as `pnpm parity -- --suite native-engine-tsl --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders` (fixtures `tsl-post-chromatic` and `tsl-post-resized`): the scene renders into the HDR target, a TSL post graph (`PostNode`: a 2-texel chromatic split at texel centres and a radial vignette over `pass(scene, camera)`) runs before the output transform as RenderPipeline's `outputColorTransform` does, and the resized case draws once at 200x150 before the captured 320x240 frame. Both at 0.31% of pixels / deltaE 0.0019 (budget 1% / 0.02); the full suite 100 pass, 0 fail. Red controls: the post pass dropped, both fail; the output binding kept across a resize, the resized case fails.

#### Phase 3: A graph built by compiled game code
**Status:** NOT STARTED
**Files:** proposed `tools/native-typescript/corpus/dynamic-tsl/`
- [x] The AOT-compiled fixture builds its TSL graph at runtime and renders matching the same TS run under the upstream reference. proof: `node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl --render` — 2026-10-06: green: `TN_TSL_LAYERS=3 sh scripts/xvfb.sh node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl --render` runs the Perry-compiled case natively and the same TS under upstream three in Chromium, and compares the frames with the conformance comparator: pixelMismatchRatio 0, ΔE 0 (budget 1 level, 1%, ΔE 0.3). Red control: the native frame with one layer fewer (`TN_TSL_LAYERS=2`) fails with TN_NATIVE_TS_FRAME_MISMATCH (53.8% of pixels). The reference first hung on a missing import map and then a 404; a missing frame now fails closed.
- [x] A dynamic feature the builder cannot lower raises `TN_TSL_DYNAMIC_UNSUPPORTED`. proof: `node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl-unsupported` — 2026-10-06: green: `node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl-unsupported` passes: the Perry-compiled case raises `TN_TSL_DYNAMIC_UNSUPPORTED` with its expected stdout and exit. Red control (runner checks): a missing or different diagnostic fails the case.
- [x] The fixture's binary links no JS engine and no upstream `three`. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs <dynamic-tsl binary>` — 2026-10-06: green: the corpus runner inspects the produced `dynamic-tsl` binary with `inspect-js-free.mjs` before running it (`TN_NATIVE_TS_JS_FREE` otherwise) and the case proceeds, so the binary carries no VM symbol, no web view and no embedded script or upstream three. Red control: inspector tests with a planted V8 symbol and an embedded upstream three module exit 1.

## Blocked on

- Phase 3 waits on the [PRD-505](../N05-native-typescript-qualification/PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md) stop rule not firing; if it fires, the owner (João) decides the replacement language profile.
