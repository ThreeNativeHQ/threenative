# PRD-532 — WebAssembly native-core browser port (N19)

**Status:** PROPOSED — mandatory: the web runs this engine (owner decision 4, 2026-10-04)
**Complexity:** 4 — new platform build with its own async, memory and threading rules
**Owner:** João
**Work package:** N19 — [native-engine batch](README.md)
**Depends on:** [PRD-500 (N03)](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [PRD-509 (N07)](PRD-509-n07-gpu-resources-presentation-and-device-loss.md), [N08 — native TSL](N08-native-tsl-and-shader-packages/README.md), [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md), [PRD-531 (N18)](PRD-531-n18-v8-game-runtime-adapter.md) (the generator)

## Context

§14: during migration the web keeps pinned upstream Three.js and differential tests run against it
(N01). That proves nothing about the native core in a browser. This PRD compiles the C++ engine to
WebAssembly with Emscripten and Emdawnwebgpu over the browser's WebGPU API. Bootstrapping and binding
glue may be JavaScript; engine algorithms stay in Wasm. It is not native Dawn in the browser. There is
no WebGL2 promise for the replacement.

Owner decision 4 ([PRD-497](PRD-497-n00-architecture-decision-and-compatibility-inventory.md)) makes
this the web product, not an experiment: one engine everywhere. Game code on the web runs on the
browser's own JS engine and reaches the Wasm engine through the catalog's browser-JS binding back end
(decision 8), the counterpart of N18's V8 back end.

## Solution

1. Proposed `packages/runtime-native/src/adapters/webgpu/emdawn/` implements the N07 GPU interface on
   Emdawnwebgpu; a proposed CMake preset builds the engine targets with Emscripten.
2. Qualify, each with its own test: async initialization, memory growth with retained views (a view
   must survive or be refreshed across growth, never read detached memory), WebGPU callback delivery
   at engine boundaries, SIMD availability with a scalar fallback, threading with a cooperative
   single-thread fallback, cooked-asset loading over fetch, and browser restrictions.
3. Platform dependencies stay behind the N02 interfaces, so nothing here forks engine code. The
   Wasm-safe rules N02, N04 and N07 adopt from day one (single-thread fallback, growth-safe views,
   no blocking waits) are what make this a build rather than a port.
4. The generator from [PRD-531 (N18)](PRD-531-n18-v8-game-runtime-adapter.md) gets a browser-JS back
   end: `three*` imports in a web game resolve to stubs over the Wasm engine, with handles kept in
   wrapper objects and lifetimes registered with the N04c reachability layer.
5. Rollback: the upstream web path remains the shipped web product until this passes N20.

## Out of scope

- WebGL2 (§14). Making it the web default (N20). Deleting upstream Three.js from web bundles ([PRD-535 (N21)](PRD-535-n21-the-js-engine-is-deleted.md)).

## Execution Phases

#### Phase 1: It builds and initializes
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/adapters/webgpu/emdawn/`, proposed CMake preset `wasm`
- [x] The engine targets compile to Wasm with no native-driver assumptions. proof: `cmake --preset wasm && cmake --build --preset wasm` — 2026-10-05: green (emsdk 6.0.11). Every engine library, the renderer included, builds for Wasm; the renderer compiles the same sources as the native build over Dawn's `emdawnwebgpu` port and links no host services, and `tn-native-engine-wasm-renderer-link` (which pulls every renderer object and its `wgpu*` calls into the link) runs under node and prints `TN_WASM_RENDERER_LINKED`. The one native-driver assumption it found was `webgpu_compat.h` naming native window surfaces (Metal layer, HWND, Xlib, ANativeWindow), now outside Emscripten builds. The `wasm-check` lane stays 49/49
- [ ] The browser-JS binding back end covers every catalog entry marked supported, and nothing else. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-backend-coverage.spec.ts`
- [x] Async initialization completes and reports the adapter. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-boot.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing` (Chromium WebGPU, RTX 2080). `tests/native-engine/wasm/boot.cpp` requests the adapter and device by callback, polls and drains its event queue once per main-loop tick (no wait anywhere), renders a lit sphere through the renderer and reads it back (15.4% covered), and reports the adapter; the page's playtest bridge publishes that report. The loop keeps ticking (19 → 80 ticks over the scenario); no console or network errors. Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-boot.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)

#### Phase 2: Platform rules
**Status:** DONE
**Files:** proposed `packages/runtime-native/tests/native-engine/wasm/`
- [x] A retained buffer view stays valid or is refreshed across memory growth. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-memory.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: Wasm memory grows from 17.0 MB to 88.2 MB under a retained `BufferView`, which stays valid and reads its own bytes (growth moves no addresses); the store then reallocates, the view reports stale and its next read resolves the new storage with the contents intact. Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-memory.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)
- [x] WebGPU callbacks are delivered at engine boundaries, never re-entrantly. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-callbacks.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: every callback is registered with `AllowProcessEvents`, so it runs only inside the tick's poll and reaches the engine through the event-queue drain; a readback every 10 ticks delivered 10 → 55 callbacks over the scenario and none ran inside a renderer call (`reentrant` 0). Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-callbacks.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)
- [x] The build runs with threads disabled through the cooperative fallback. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-nothreads.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: the engine has no threads to disable (no `std::thread` or job system in `src/engine`), the build has no pthreads, the page is not cross-origin isolated, and all work runs cooperatively in the main-loop tick, which keeps advancing (22 → 113). Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-nothreads.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)

#### Phase 3: Browser parity
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/conformance/registry.json`
- [x] The N09 matched lit scene renders in the browser within tolerance of the native desktop output. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_renderer_scene_lit` (writes the desktop frame), then `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-lit.playtest.json --url "http://127.0.0.1:4317/wasm/native-core-boot.html?native=../tn-linux/native-lit-render.rgba" --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build" --browser-recipe webgpu --headed` (a playtest scenario, not a `pnpm parity` row: the browser build is a page, and the comparison is with the desktop frame rather than the upstream reference) — 2026-10-05: green on `nvidia turing`: the browser build renders the lit-render fixture scene (320x240, ACES, standard material, directional and hemisphere light) and matches the desktop frame bit for bit (worst channel 0, 0 channels over 1; tolerance: worst ≤ 8 and ≤ 0.1% over 1, the desktop's own tolerance against the browser reference); both cover 15.67% of the frame. Red: a 0.01 change in the material's green puts 3.2% of channels over 1 and fails
- [ ] A cooked asset package loads and renders in the browser build. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-assets.playtest.json --browser-recipe webgpu`
