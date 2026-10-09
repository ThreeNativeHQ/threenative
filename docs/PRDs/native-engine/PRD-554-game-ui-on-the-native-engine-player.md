# PRD-554 — A game's UI runs on the native-engine player

**Status:** NOT STARTED
**Priority:** P1 — Midway's `launch` journey cannot start a flight on the V8 player: its briefing's "take deck" button lives in its React UI, which the native-engine player never shows, so every UI-driven journey of a game with `src/ui/` fails there
**Complexity:** 7 (HIGH) — the legacy host's UI overlay, state bridge, compositing and input routing, moved into the engine player's loop and renderer
**Owner:** João
**Work package:** native-engine, games with `ui.renderer: "web"` or `"native-css"` on the V8 player (desktop first)
**Depends on:** [PRD-531](PRD-531-n18-v8-game-runtime-adapter.md) (V8 player), [PRD-545](../done/native-engine/N22-three-surface-coverage/PRD-545-n22a-math-object-model-and-geometry.md) (done: Midway boots on the player)

## Context

On 2026-10-09 Midway's native boot journey passed on the V8 player (`1f112d809`), but its `launch`
journey timed out after 60 s waiting for `state.ui.screens.flight`: the second step clicks the
briefing's "take deck" button, and the player shows no UI. The legacy desktop host has the whole
path (mapped 2026-10-09):

- **Bridge:** core's `ui-bridge.ts` calls `__tnUiPost`, `__tnUiOverlayAttached` and
  `__tnUiCompositeMs`, and native calls core's `__tnUiGameReceive`; the legacy host installs them in
  `runtime.cpp` `setupUiBridge` (2693-2720) and drains intents in `drainUiMessages` (2779-2790).
- **Overlay:** `ui_overlay.cpp` (`tn_ui_overlay_attach`, `pumpUiOverlay`, `uiOverlayFrame`,
  `uiOverlayHitTest`, `uiOverlayRoutePointer`) owns the offscreen WebKit view (Linux) or the
  native-css renderer, both producing premultiplied RGBA frames.
- **Composite:** `bindings_ui_composite.cpp` `compositeUiOverlayToWebGPU` uploads the newest frame and
  blends it "over" the world after the scene and before present.
- **Input:** `window.cpp` offers each SDL event to the UI first through the hit regions the page
  publishes (`tn:hit-regions`).

The player (`src/engine/player/run.cpp`, `v8_main.cpp`) has none of it, and the native bundler
compiles `@threenative/core/ui-layer` into an in-process transport that publishes nothing.

## Solution

Reuse the overlay seam (`ui_overlay.cpp`) and core's bridge as they are. The player installs the
same four globals on its V8 context, pumps the overlay at the top of each frame, drains intents into
`__tnUiGameReceive`, composites the overlay frame with the engine renderer between `blitTo` and
present, and offers input to the UI first. The engine renderer owns the composite (a textured
full-screen pass in the shared renderer), so the Wasm build keeps the page's own DOM UI and needs
nothing new.

## Execution Phases

#### Phase 1: State and intents cross the bridge
**Status:** NOT STARTED

- [ ] The V8 player installs `__tnUiPost`, `__tnUiOverlayAttached` and `__tnUiCompositeMs`, attaches the overlay for a bundle with a UI entry, and delivers the page's `tn:intent` messages to `__tnUiGameReceive` at the top of a frame. proof: a player ctest whose UI page posts an intent the game reads, red before
- [ ] Game state reaches the page: core's `publishUiState` posts `tn:state` frames the page receives. proof: the same ctest reads a state value back through the page

#### Phase 2: The page is drawn into the frame
**Status:** NOT STARTED

- [ ] The engine renderer composites the overlay's newest premultiplied frame over the world before present, uploading only when the frame changed. proof: a render test comparing a known overlay frame over a known scene, and a counter that a steady frame uploads nothing
- [ ] A Midway screenshot on the player shows its briefing UI. proof: `native-playtests/boot.playtest.json` capture on a private copy, judged against the legacy host's capture

#### Phase 3: Input reaches the UI first
**Status:** NOT STARTED

- [ ] A pointer press inside a published hit region goes to the page and not the game; outside it, to the game. proof: a player ctest with one hit region and both presses
- [ ] Midway's `launch` journey passes on the V8 player. proof: `node packages/playtest/dist/runner/cli.js native-playtests/launch.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player-v8 --host-arg <private copy>/native/game.js`

## Blocked on

- Windows and macOS: their web views draw themselves above the window; the player's window needs the same child-view attach there. Needs those machines.
