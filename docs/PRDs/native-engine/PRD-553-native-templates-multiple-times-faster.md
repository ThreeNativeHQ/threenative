# PRD-553 — Native templates run multiple times faster than three.js

**Status:** IN PROGRESS
**Priority:** P0 — owner, 2026-10-09: "zero tolerance. Native must be multiple times faster than threejs"; the Wasm `minimal` template is 1.7x three.js (637 vs 370 fps), not multiple times
**Complexity:** 6 (MEDIUM) — per-frame work that crosses the JS-engine boundary moves into the shared engine, one measured lever at a time
**Owner:** João
**Work package:** native-engine performance, measured on real templates against the three.js control on the same lane
**Depends on:** [PRD-540](../done/native-engine/PRD-540-web-games-boot-on-the-wasm-engine.md) (done), [PRD-531](PRD-531-n18-v8-game-runtime-adapter.md)

## Context

`pnpm profile:wasm-page --url <native minimal> --control <three.js minimal>` on 2026-10-09 (nvidia
turing, private Xvfb): native p50 1.40 ms, 637 fps; three.js p50 2.10 ms, 370 fps. The native page's
CPU: page JS 33.5%, engine Wasm 22.4%, `getCurrentTexture` 19.9% (the frame's backpressure wait;
three.js waits in `submit`, 44%), `(program)` 12.7%. The page JS makes 365 engine calls per frame;
about 250 of them are core's projected-size cull (`render-camera-cull.ts`), which walks the visible
scene every frame in JS and reads each object's bounds, matrices and flags through the engine.
Stubbing that walk drops the calls to 113 per frame and raises the frame rate 8%.

## Solution

Move per-frame work that the engine can do in one call into the shared C++ engine, keeping core's
rule as the one specification: core calls the engine's version when the scene root offers it, and
keeps its JS walk otherwise. Each lever is measured on the template against the control, and each
is hardened with a counter (engine calls per frame), never a timing gate.

## Execution Phases

#### Phase 1: The projected-size cull runs in the engine
**Status:** DONE

- [x] The engine's projected-size cull makes the decisions core's JS cull makes, object for object, including its exemptions and bound staleness. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` (core's own cull over the same scenes in the pinned three and in the engine; the oracle is core's TypeScript, so the comparison runs on the real Wasm module, not a C++-only test) — 2026-10-09: `native_engine_wasm_browser_backend` runs core's own `RenderCameraCull` over the same scene in the pinned three (JS walk) and in the engine (`Object3D.__cullProjected`), three frames: the same report and the same hidden set, over camera-attached, alwaysRender, frustumCulled = false, an off-screen shadow caster, no usable bounds, a buffer rewritten every frame, and culled far objects, pass. The JS walk over engine objects never tracked a rewritten buffer (the wrapper has no `geometry.attributes.position.version`); the engine path does, as core's rule over three does.
- [x] Core uses it when the root offers it, and the Wasm `minimal` page drops its per-frame engine calls. proof: `pnpm profile:wasm-page --calls` engine calls per frame, and a counter assertion on the wasm-engine-boot renderer page — 2026-10-09: `pnpm profile:wasm-page --calls` on the `minimal` template: 365 -> 124 engine calls per frame, page JS 34.7% -> 24.5% of CPU (frame p50 unchanged at 1.40 ms: the native frame now waits on GPU and present). Gate: `pnpm --filter wasm-engine-boot playtest:game` bounds a steady drawn frame of the core game page at 37 engine calls, exit 0; with core's JS walk instead of the engine's cull it makes 62 and fails.

#### Phase 2: The template is multiple times faster than three.js
**Status:** PARTIAL

- [ ] The Wasm `minimal` page runs at least 2x the three.js control's frame rate on the same lane. proof: `pnpm profile:wasm-page --url <native> --control <three.js>`, subject/control frame p50
  2026-10-09: 1.40 ms vs 2.10 ms (1.5x). This lane cannot show 2x: a blank page that only clears and presents runs at 1.20 ms p50 (642 fps) under the same private Xvfb, and 2x the control is 728 fps. See Blocked on.
- [x] A steady safe point asks the engine about a bounded slice of the wrappers it holds, not every one every frame. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_gc` — 2026-10-09: red at 503 wrappers asked per steady safe point (at most 64 allowed), green after (32 plus the new ones), and a wrapper detached after it was confirmed is still collected. On the `minimal` page, page JS fell from 25.2% to 16.2% of the CPU profile.
- [x] Engine objects fire three's graph events (`added`, `removed`, `childadded`, `childremoved`), so core tracks LOD and clustered meshes instead of walking the scene twice a frame. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` and `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_skeletal` — 2026-10-09: the Wasm smoke was red ("Object3D has addEventListener"), green after with the events in three's order, a removed listener silent, and a throwing listener throwing from the graph call; V8 green on the same order. `pnpm --filter wasm-engine-boot playtest:game` now bounds a steady frame at 33 engine calls (37 before), exit 0. On the `minimal` page `updateModelLods` fell from 3.0% to 0.1% of the CPU profile and `updateClusteredMeshes` from 2.4% to 0.
- [ ] The native page's CPU work per frame is at most half the control's. proof: `pnpm profile:wasm-page --cpu-work`, subject/control work p50
  2026-10-09: 0.6 ms vs 1.1 ms (1.8x; `performance.now()` steps 0.1 ms here); 0.5 ms after the graph events (2.2x, inside the timer's step, so not ticked). After the uniform-packing change, five runs of `profile:wasm-page` with the profile-derived CPU busy time, desktop load 4-12: control/subject busy 1.26x, 2.88x, 2.84x, 1.99x, 1.60x (median 1.99x); frame p50 ratio median 1.6x. Too noisy to tick; needs a quiet machine. GPU work per frame is 1.03 ms vs 2.41 ms (2.3x, `--gpu-passes`).

## Known gaps

- The engine's cull reads an InstancedMesh's own bound and every other object's geometry bound. Core's walk reads `object.boundingSphere` whenever three has set one, which it does for a SkinnedMesh (posed) and a BatchedMesh, so those two can cull differently; the parity test covers plain meshes only. (Fresh-eyes review, 2026-10-09.)

## Blocked on

- A display lane that presents faster than ~640 fps, for the frame-rate box: private Xvfb caps a blank WebGPU page at 642 fps, headless Chrome falls back to SwiftShader, and the host display is not for playtests. Until then the CPU-work and GPU-pass ratios carry the claim.
