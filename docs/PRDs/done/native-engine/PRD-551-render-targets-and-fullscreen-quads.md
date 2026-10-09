# PRD-551 — Render targets and fullscreen quads on the native engine

**Status:** DONE (2026-10-09)
**Priority:** P1 — the `minimal` template's V8 bundle is refused for `RenderTarget` and `QuadMesh` (PRD-531's last box), and render-to-texture is everyday three.js (minimaps, portals, GPGPU, readbacks)
**Complexity:** 6 (MEDIUM) — the renderer's target switch and readback, one binding class, one shared JS facade; no new module
**Owner:** João
**Work package:** N22d renderer layer, back-end binding per [PRD-548](N22-three-surface-coverage/PRD-548-n22d-renderer-loaders-animation-and-addons.md) Context (PRD-540 phase 3 for Wasm, PRD-531 for V8)
**Depends on:** [PRD-514](PRD-514-n09-native-renderer-and-standard-materials.md) (done), [PRD-531](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md), [PRD-540](PRD-540-web-games-boot-on-the-wasm-engine.md)

## Context

The native bundler refuses `three:RenderTarget` and `three/webgpu:QuadMesh` in the `minimal`
template (`environmentSampling.ts`, `autoExposure.ts`), and the Wasm back end binds them as
throw-on-use refusals. three's API surface used there and by corpus games:

- `new RenderTarget(w, h, { type, format, depthBuffer })`, `target.texture` (sampled by a material
  map or TSL `texture(target.texture)`), `setSize`, `dispose`.
- `renderer.setRenderTarget(target, activeCubeFace, activeMipmapLevel)`, `getRenderTarget()`; a
  `render(scene | object, camera)` while a target is set draws into it, in the linear working colour
  space, without the output pass's tone mapping or colour-space conversion (r185).
- `renderer.readRenderTargetPixelsAsync(target, x, y, w, h)` resolving a typed array of the
  target's type.
- `QuadMesh(material)`: a `Mesh` over a fullscreen triangle; `render(renderer)` is
  `renderer.render(quad, orthographicCamera)`.

The engine already draws into an arbitrary texture view (`Renderer::PresentScope`) and reads frames
back (`readPixels`); post passes own offscreen targets. This PRD adds the user-visible target.

## Phases

#### Phase 1: The engine draws into a game's render target
**Status:** DONE (2026-10-09)

- [x] A scene rendered into a `RenderTarget` and then sampled as a map on a plane shows the scene, as r185 shows it (linear target, no tone mapping into the target). proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_render_target` — 2026-10-09 pass: an unlit red square over a (0.25, 0.5, 0.75) clear, sampled by a plane under linear output, reads back corner 64/127/191 and middle 255/0/0 (red first: the plane drew white until material slots and TSL `texture()` accepted an imageless render-target texture, `Texture::sampleable`).
- [x] The engine reads a region of a target's last render back (`readRenderTarget`, RGBA16Float rows, top row first), from which the facades build the typed array of the target's type. proof: the same ctest — 2026-10-09 pass: the 32×32 readback is exactly 0.25/0.5/0.75 at the corner and 1/0/0 in the middle.
- [x] A frame that renders into a target and then to the canvas adds no setup work after warm-up (steady-state counters at 0). proof: the same ctest — 2026-10-09 pass: 30 target-then-frame rounds add 0 compiles, 0 text keys, 0 bind groups, 0 programs.

#### Phase 2: V8 and Wasm bind it, and `QuadMesh` is shared JS
**Status:** DONE (2026-10-09)

- [x] The Wasm renderer facade binds `setRenderTarget`, `getRenderTarget` and `readRenderTargetPixelsAsync`, and `QuadMesh.render` draws a node material fullscreen into a target. proof: `ctest --test-dir packages/runtime-native/build/wasm -R native_engine_wasm_browser_backend` and `pnpm --filter wasm-engine-boot playtest:renderer` — 2026-10-09 both pass: the renderer page's QuadMesh draws (0.25, 0.5, 0.75) into a HalfFloat and an UnsignedByte target and reads back `Uint16Array:13312,14336,14848,15360` (three's `DataUtils.toHalfFloat`) and `Uint8Array:64,128,191,255`; steady-state counters stay 0. Host calls `tnw_web_render_target`, `tnw_web_read_target`, `tnw_web_read_target_take`; shared facade `render-target.ts`, `quad-mesh.ts`.
- [x] The V8 player binds the same calls through the shared facade. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_player_render_target` — 2026-10-09 pass on the real player (headless GPU): the same QuadMesh into HalfFloat and UnsignedByte targets reads back three's half bits and bytes (red first: the HalfFloat target came back as bytes until `Texture.type` was bound). Host calls `tn.renderTarget`, `tn.readTarget`.
- [x] The `minimal` template bundles for the V8 player with no `TN_NATIVE_ENGINE_UNBOUND` for `RenderTarget` or `QuadMesh`. proof: `node packages/runtime-native/scripts/bundle-native-engine.mjs --engine native --game-runtime v8 --entry <minimal>/src/game.ts --out <dir>/game.js` — 2026-10-09: the bundler now reports only `normalLocal`, `positionPrevious`, `storage` and `tangentLocal` (PRD-547 TSL names, on lane-midway-native), no longer `RenderTarget` or `QuadMesh`.

## Acceptance criteria

- [x] A game renders into a `RenderTarget`, samples `target.texture` and reads the target back with three's typed arrays on both the V8 player and the Wasm engine, with no setup work per steady frame. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R "native_engine_render_target|native_engine_player_render_target"` and `pnpm --filter wasm-engine-boot playtest:renderer` — 2026-10-09: all pass (see phases 1 and 2).

## Decisions

- 2026-10-09 (Claude): phase 1's proofs are exact-value native checks rather than three.js golden
  fixtures. An unlit material over a known clear colour has one correct answer in a linear target,
  and the fixture runner has no render-target ops yet; the facades' typed arrays are checked against
  three's shape in phase 2.

- 2026-10-09 (Claude, lead of PR #438): render targets are built in the shared engine rather than
  folded out of the template with a build-time target constant, because the goal is any three.js
  game, and corpus games use render targets outside minimal's web-only gate.
