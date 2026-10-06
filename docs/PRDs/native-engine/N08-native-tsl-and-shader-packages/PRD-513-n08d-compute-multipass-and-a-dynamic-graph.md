# PRD-513 — Compute, multipass and a dynamic graph (N08d)

**Status:** IN PROGRESS
**Complexity:** 4 — compute dispatch, render-target chaining, and the first TSL graph built by AOT-compiled game code
**Owner:** João
**Work package:** N08 — [native-engine batch](../README.md) · [N08 index](README.md)
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
- [ ] A compute pass writes 10,000 instance positions into a storage buffer and the following draw renders them matching the browser reference. proof: `pnpm parity -- --case native-engine-compute-draw` — open, half proven 2026-10-05: the compute half is green (`native_engine_compute_instance_grid`, the same grid kernel authored in TSL and run in Chromium's WebGPU against the native builder's kernel, 10,000 positions bit-equal on Dawn, ASan and wgpu; red control: time 0.5, all 10,000 differ). The draw that renders them needs a native material whose position reads that storage buffer, which is not built yet.
- [x] Readback of the storage buffer equals the CPU-computed expected positions. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_compute_readback` — 2026-10-05: green on Dawn, ASan and wgpu. `ComputePass` (`src/engine/renderer/compute.{h,cpp}`) compiles an IR compute program to a pipeline, binds its storage buffers in declaration order and its scalar uniforms by name, and dispatches 64-thread workgroups. The test program writes 10,000 instance positions on a 100 x 100 grid (exact u32 row and column, `spacing` uniform), with 37 invocations past the end writing nothing; the readback equals the CPU positions in all 40,000 components. A dispatch given the wrong storage buffers is refused, not recorded. The IR now converts one numeric part of the same shape (`u32(x)`, `vec3<f32>(v)`), as WGSL does

#### Phase 2: Multipass through a render target
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/conformance/scenes/native-engine-multipass/`
- [ ] Scene → render target → TSL post pass → surface matches the reference, before and after a resize. proof: `pnpm parity -- --case native-engine-multipass`

#### Phase 3: A graph built by compiled game code
**Status:** NOT STARTED
**Files:** proposed `tools/native-typescript/corpus/dynamic-tsl/`
- [ ] The AOT-compiled fixture builds its TSL graph at runtime and renders matching the same TS run under the upstream reference. proof: `node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl --render`
- [ ] A dynamic feature the builder cannot lower raises `TN_TSL_DYNAMIC_UNSUPPORTED`. proof: `node tools/native-typescript/run-corpus.mjs --native --case dynamic-tsl-unsupported`
- [ ] The fixture's binary links no JS engine and no upstream `three`. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs <dynamic-tsl binary>`

## Blocked on

- Phase 3 waits on the [PRD-505](../N05-native-typescript-qualification/PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md) stop rule not firing; if it fires, the owner (João) decides the replacement language profile.
