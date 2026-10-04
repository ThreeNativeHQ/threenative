# PRD-532 — WebAssembly native-core browser port (N19)

**Status:** PROPOSED
**Complexity:** 4 — new platform build with its own async, memory and threading rules
**Owner:** João
**Work package:** N19 — [native-engine batch](README.md)
**Depends on:** [PRD-500 (N03)](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [PRD-509 (N07)](PRD-509-n07-gpu-resources-presentation-and-device-loss.md), [N08 — native TSL](N08-native-tsl-and-shader-packages/README.md), [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md)

## Context

§14: during migration the web keeps pinned upstream Three.js and differential tests run against it
(N01). That proves nothing about the native core in a browser. This PRD compiles the C++ engine to
WebAssembly with Emscripten and Emdawnwebgpu over the browser's WebGPU API. Bootstrapping and binding
glue may be JavaScript; engine algorithms stay in Wasm. It is not native Dawn in the browser. There is
no WebGL2 promise for the replacement.

## Solution

1. Proposed `packages/runtime-native/src/adapters/webgpu/emdawn/` implements the N07 GPU interface on
   Emdawnwebgpu; a proposed CMake preset builds the engine targets with Emscripten.
2. Qualify, each with its own test: async initialization, memory growth with retained views (a view
   must survive or be refreshed across growth, never read detached memory), WebGPU callback delivery
   at engine boundaries, SIMD availability with a scalar fallback, threading with a cooperative
   single-thread fallback, cooked-asset loading over fetch, and browser restrictions.
3. Platform dependencies stay behind the N02 interfaces, so nothing here forks engine code.
4. Rollback: the upstream web path remains the shipped web product until this passes N20.

## Out of scope

- WebGL2 (§14). Shipping this as the web default (N20).

## Execution Phases

#### Phase 1: It builds and initializes
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/adapters/webgpu/emdawn/`, proposed CMake preset `wasm`
- [ ] The engine targets compile to Wasm with no native-driver assumptions. proof: `cmake --preset wasm && cmake --build --preset wasm`
- [ ] Async initialization completes and reports the adapter. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-boot.playtest.json --browser-recipe webgpu`

#### Phase 2: Platform rules
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/tests/native-engine/wasm/`
- [ ] A retained buffer view stays valid or is refreshed across memory growth. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-memory.playtest.json --browser-recipe webgpu`
- [ ] WebGPU callbacks are delivered at engine boundaries, never re-entrantly. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-callbacks.playtest.json --browser-recipe webgpu`
- [ ] The build runs with threads disabled through the cooperative fallback. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-nothreads.playtest.json --browser-recipe webgpu`

#### Phase 3: Browser parity
**Status:** NOT STARTED
**Files:** `packages/runtime-native/conformance/registry.json`
- [ ] The N09 matched lit scene renders in the browser within tolerance of the native desktop output. proof: `pnpm parity` (new case `native-core-wasm-lit`)
- [ ] A cooked asset package loads and renders in the browser build. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-assets.playtest.json --browser-recipe webgpu`
