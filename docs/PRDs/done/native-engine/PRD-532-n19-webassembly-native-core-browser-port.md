# PRD-532 — WebAssembly native-core browser port (N19)

**Status:** PARTIAL — browser cooked-asset GPU proof pending
**Priority:** P1 — qualify cooked-asset rendering on the mandatory browser engine
**Complexity:** 4 — new platform build with its own async, memory and threading rules
**Owner:** João
**Work package:** N19 — [native-engine batch](../../native-engine/README.md)
**Depends on:** [PRD-500 (N03)](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [PRD-509 (N07)](PRD-509-n07-gpu-resources-presentation-and-device-loss.md), [N08 — native TSL](../../native-engine/N08-native-tsl-and-shader-packages/README.md), [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md), [PRD-531 (N18)](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md) (the generator)

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
4. The generator from [PRD-531 (N18)](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md) gets a browser-JS back
   end: `three*` imports in a web game resolve to stubs over the Wasm engine, with handles kept in
   wrapper objects and lifetimes registered with the N04c reachability layer.
5. Rollback: the upstream web path remains the shipped web product until this passes N20.

Decision 12 fixes the web shape: JavaScript game code over the Wasm engine first, with render
bundles, indirect draws, worker rendering and a bulk game-to-engine API; Perry-to-Wasm game code is
option A, adopted only on [PRD-533 (N20)](../../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md)'s
measurement.

## Out of scope

- WebGL2 (§14). Making it the web default (N20). Deleting upstream Three.js from web bundles ([PRD-535 (N21)](../../native-engine/PRD-535-n21-the-js-engine-is-deleted.md)).

## Execution Phases

#### Phase 1: It builds and initializes
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/adapters/webgpu/emdawn/`, proposed CMake preset `wasm`
- [x] The engine targets compile to Wasm with no native-driver assumptions. proof: `cmake --preset wasm && cmake --build --preset wasm` — 2026-10-05: green (emsdk 6.0.11). Every engine library, the renderer included, builds for Wasm; the renderer compiles the same sources as the native build over Dawn's `emdawnwebgpu` port and links no host services, and `tn-native-engine-wasm-renderer-link` (which pulls every renderer object and its `wgpu*` calls into the link) runs under node and prints `TN_WASM_RENDERER_LINKED`. The one native-driver assumption it found was `webgpu_compat.h` naming native window surfaces (Metal layer, HWND, Xlib, ANativeWindow), now outside Emscripten builds. The `wasm-check` lane stays 49/49
- [x] The browser-JS binding back end covers every catalog entry marked supported, and nothing else. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-backend-coverage.spec.ts` — 2026-10-05: green (3/3). `packages/three-native/src/browser-backend.ts` builds three's classes from the registry snapshot over an `IBrowserRuntime`; the spec proves the classes are exactly the catalog's supported set, each prototype carries exactly its registry members (setters where the registry has them), and a class with no registry constructor refuses `new`. The Wasm runtime marshals the C ABI by its measured wasm32 layouts; `native_engine_wasm_browser_backend` (wasm-check lane, node) drives the classes over `tn-native-engine-abi-module`: chaining identity, setters, member identity, `matrixWorld.elements`, a member chain writing through to the material, and an engine refusal surfacing as `TN_ABI_*`
- [x] Async initialization completes and reports the adapter. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-boot.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing` (Chromium WebGPU, RTX 2080). `tests/native-engine/wasm/boot.cpp` requests the adapter and device by callback, polls and drains its event queue once per main-loop tick (no wait anywhere), renders a lit sphere through the renderer and reads it back (15.4% covered), and reports the adapter; the page's playtest bridge publishes that report. The loop keeps ticking (19 → 80 ticks over the scenario); no console or network errors. Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-boot.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)

#### Phase 2: Platform rules
**Status:** DONE
**Files:** proposed `packages/runtime-native/tests/native-engine/wasm/`
- [x] A retained buffer view stays valid or is refreshed across memory growth. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-memory.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: Wasm memory grows from 17.0 MB to 88.2 MB under a retained `BufferView`, which stays valid and reads its own bytes (growth moves no addresses); the store then reallocates, the view reports stale and its next read resolves the new storage with the contents intact. Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-memory.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)
- [x] WebGPU callbacks are delivered at engine boundaries, never re-entrantly. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-callbacks.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: every callback is registered with `AllowProcessEvents`, so it runs only inside the tick's poll and reaches the engine through the event-queue drain; a readback every 10 ticks delivered 10 → 55 callbacks over the scenario and none ran inside a renderer call (`reentrant` 0). Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-callbacks.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)
- [x] The build runs with threads disabled through the cooperative fallback. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-nothreads.playtest.json --browser-recipe webgpu` — 2026-10-05: green on `nvidia turing`: the engine has no threads to disable (no `std::thread` or job system in `src/engine`), the build has no pthreads, the page is not cross-origin isolated, and all work runs cooperatively in the main-loop tick, which keeps advancing (22 → 113). Run: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-nothreads.playtest.json --url http://127.0.0.1:4317/native-core-boot.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm" --browser-recipe webgpu --headed` (`--headed` in the runner's private Xvfb: headless Chromium serves WebGPU from SwiftShader on this host)

#### Phase 3: Browser parity
**Status:** IN PROGRESS
**Files:** `packages/runtime-native/tests/native-engine/wasm/`, `packages/runtime-native/scenarios/native-core-wasm-assets.playtest.json`, `packages/runtime-native/cmake/NativeEngineCore.cmake`, `packages/runtime-native/CMakePresets.json`
- [x] The N09 matched lit scene renders in the browser within tolerance of the native desktop output. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_renderer_scene_lit` (writes the desktop frame), then `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-lit.playtest.json --url "http://127.0.0.1:4317/wasm/native-core-boot.html?native=../tn-linux/native-lit-render.rgba" --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build" --browser-recipe webgpu --headed` (a playtest scenario, not a `pnpm parity` row: the browser build is a page, and the comparison is with the desktop frame rather than the upstream reference) — 2026-10-05: green on `nvidia turing`: the browser build renders the lit-render fixture scene (320x240, ACES, standard material, directional and hemisphere light) and matches the desktop frame bit for bit (worst channel 0, 0 channels over 1; tolerance: worst ≤ 8 and ≤ 0.1% over 1, the desktop's own tolerance against the browser reference); both cover 15.67% of the frame. Red: a 0.01 change in the material's green puts 3.2% of channels over 1 and fails
- [x] A cooked asset package loads and renders in the browser build. proof: `node packages/playtest/dist/runner/cli.js native-core-wasm-assets.playtest.json --browser-recipe webgpu` — open: 2026-10-05 the renderer and package loader build for Wasm (box 1), but nothing a package carries can render yet: `packages/assets` writes RGBA8 textures and raw buffers and leaves models out until the native mesh and material loaders land ([PRD-515](PRD-515-n10-native-gltf-cooked-assets-and-decoders.md)), and the native materials have no texture maps. This box follows those — 2026-10-06: green, run as `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-assets.playtest.json --url http://127.0.0.1:4317/native-core-assets.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm-browser" --browser-recipe webgpu --headed` (pass) and the harness `sh scripts/xvfb.sh node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts` (`TN_WASM_ASSETS_GPU_OK`): the C++ engine compiled to Wasm boots in headed Chromium on a real NVIDIA adapter, loads the cooked package (`packageLoaded: true`) and renders it; the bundle carries no upstream three.

2026-10-06 implementation (complexity 6 → MEDIUM; no risk override): the `wasm-browser` preset
builds `tn-native-engine-wasm-assets`, a modularized C ABI plus the existing C++ scene, animation,
shader IR/WGSL, renderer and render database. Emscripten 6.0.11 supplies Dawn's Emdawn port
(`--use-port=emdawnwebgpu`, v20260423.175430); `USE_WEBGPU` is no longer supported. Its header
matches the engine's `WGPUStringView`/future callback API, with an Emscripten canvas surface and
automatic browser presentation. Only build wiring and test-host code change; engine algorithms do
not fork. The preset selects the renderer/ABI slice without changing the full `wasm` CPU lane.

The page uses the same native registry and `defineBrowserClasses`/`createWasmRuntime` surface as
the catalog back end, with the generated catalog declarations. It first authors and renders a box
from JavaScript. `assets-bundle.ts` reuses `packages/assets/src/native-package.ts`'s TNPK writer to
cook a 146-byte package containing 36 bytes of f32 triangle positions (the format's existing raw
buffer path). Fetch hands it to native `parsePackage`/`verifyPackage` and `loadPackage`; GPU
readback must equal the verified bytes before those vertices fill the catalog-created geometry.
The renderer then draws that geometry to a real WebGPU canvas. This qualifies a cooked geometry
buffer, not a cooked glTF/model loader or a backend-specific texture format.

Local proof, all exit 0 on this uncommitted implementation:

- `EMSDK="$HOME/emsdk" cmake --preset wasm-browser` (from `packages/runtime-native`), then `EM_CACHE="$PWD/packages/runtime-native/build/emscripten-cache" cmake --build packages/runtime-native/build/wasm-browser --target tn-native-engine-wasm-assets -j 4` (from the repository root): module linked; bundle audit passed. The sandbox SDK cache is read-only, so its preinstalled cache was copied into that ignored build directory before linking.
- `node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts --cpu`: valid cooked package accepted; hash damage, truncation and nonfinite positions refused by the linked native reader.
- `node --import tsx packages/three-native/tests/browser-backend-smoke.ts packages/runtime-native/build/wasm-browser/tn-native-engine-wasm-browser.js`: `TN_BROWSER_BACKEND_OK`, including callback error/refusal behavior.
- `pnpm exec biome check packages/runtime-native/tests/native-engine/wasm/assets-{page,bundle,reference}.ts` and `node packages/runtime-native/scripts/check-source-list.mjs`: 3 files clean; source list passed. Focused strict TypeScript checking of the three new TS files also passed; the existing scenario validator accepted the new scenario (validation only, not execution).

`node --import tsx scripts/prd-progress.ts docs/PRDs/native-engine/PRD-532-n19-webassembly-native-core-browser-port.md`
reports 7/8 boxes, 2/3 phases, `prd:75%`; no boxes were newly ticked. The ordinary
`pnpm prd:progress` invocation failed on this sandbox's prohibited tsx IPC socket, so the same
script ran through Node's import hook. Source review passed after fixing a per-frame owned queue
reference leak in the test host; GPU execution is still required.

Coordinator GPU proof from the repository root (build artifacts already prepared):

```sh
sh scripts/xvfb.sh node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts
node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-core-wasm-assets.playtest.json --url http://127.0.0.1:4317/native-core-assets.html --server-command "python3 -m http.server 4317 --bind 127.0.0.1 -d packages/runtime-native/build/wasm-browser" --browser-recipe webgpu --headed
```

The capture harness reports the actual adapter, refuses software or unnamed adapters, asserts the
box and cooked-triangle frames (13 and 2 triangles including the output pass), and saves
`packages/runtime-native/build/wasm-browser/cooked-assets.png`. It checks that the PNG itself contains
the green triangle and fails on page, console or network errors. The scenario additionally checks
that engine ticks keep advancing after the package renders. Both GPU executions remain unverified.

2026-10-06 box 62 repair (complexity 0 → LOW; no risk override): the coordinator's
`TN_WASM_BOOT_FRAME` reports 2 draws / 13 triangles, matching the renderer's box plus its output
pass. The page aborts before `fetch("assets.tnpk")`; `packageLoaded: false` is not a loader refusal.
The page, capture and scenario now include that pass (boot 13, cooked 2; 2 draws each). The page
prints native synchronous/asynchronous load errors with their code/message and the capture harness
forwards browser console errors to stderr. `--cpu` now exercises the page's real catalog ABI and
fetch/load sequence with simulated frame reports: red reproduced the coordinator's boot error;
green reaches fetch, native verification and cooked-frame assertions. This does not prove GPU upload.

Repair checks on the dirty worktree, all exit 0: `EMSDK=/home/joao/emsdk` with the existing local
`EM_CACHE` and `cmake --preset wasm-browser`; `cmake --build packages/runtime-native/build/wasm-browser
--target tn-native-engine-wasm-assets -j 4` linked the module and passed the TNPK/no-three bundle
audit. An explicit `rg` audit of both emitted JS files found no upstream `REVISION` or
`WebGPURenderer` bodies. `node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts
--cpu` passed page sequencing plus valid-package/hash/truncation/nonfinite checks.
`pnpm exec biome check packages/runtime-native/tests/native-engine/wasm/assets-{page,bundle,reference}.ts`
checked 3 files clean; `node packages/runtime-native/scripts/check-source-list.mjs` passed (2 explicit
exclusions). Focused `pnpm exec tsc --ignoreConfig --noEmit --strict --module esnext --moduleResolution
bundler --target es2023 --lib ES2023,DOM --esModuleInterop --resolveJsonModule --skipLibCheck` on those
three TS files passed. The existing scenario validator accepted the adjusted JSON (validation
only, not execution); progress remains 7/8 boxes, `prd:75%`. The box stays open until the
coordinator reruns GPU capture/scenario; GPU upload/rendering remain unverified here. No engine
algorithms change.
