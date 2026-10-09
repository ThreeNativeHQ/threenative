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

- [x] The engine's projected-size cull makes the decisions core's JS cull makes, object for object, including its exemptions and bound staleness. proof: a native test comparing both on the same scenes, `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_projected_cull` — 2026-10-09: proved on the real Wasm module instead of a C++-only test, because the oracle is core's TypeScript: `native_engine_wasm_browser_backend` runs core's own `RenderCameraCull` over the same scene in the pinned three (JS walk) and in the engine (`Object3D.__cullProjected`), three frames: the same report and the same hidden set, over camera-attached, alwaysRender, frustumCulled = false, an off-screen shadow caster, no usable bounds, a buffer rewritten every frame, and culled far objects, pass. The JS walk over engine objects never tracked a rewritten buffer (the wrapper has no `geometry.attributes.position.version`); the engine path does, as core's rule over three does.
- [x] Core uses it when the root offers it, and the Wasm `minimal` page drops its per-frame engine calls. proof: `pnpm profile:wasm-page --calls` engine calls per frame, and a counter assertion on the wasm-engine-boot renderer page — 2026-10-09: `pnpm profile:wasm-page --calls` on the `minimal` template: 365 -> 124 engine calls per frame, page JS 34.7% -> 24.5% of CPU (frame p50 unchanged at 1.40 ms: the native frame now waits on GPU and present). Gate: `pnpm --filter wasm-engine-boot playtest:game` bounds a steady drawn frame of the core game page at 37 engine calls, exit 0; with core's JS walk instead of the engine's cull it makes 62 and fails.

#### Phase 2: The template is multiple times faster than three.js
**Status:** NOT STARTED

- [ ] The Wasm `minimal` page runs at least 2x the three.js control's frame rate on the same lane. proof: `pnpm profile:wasm-page --url <native> --control <three.js>`, subject/control frame p50
