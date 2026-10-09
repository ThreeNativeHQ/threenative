# PRD-554 — A game's UI runs on the native-engine player

**Status:** DONE on Linux (2026-10-09); Windows and macOS blocked on a hosted run
**Priority:** P1 — Midway's `launch` journey cannot start a flight on the V8 player: its briefing's "take deck" button lives in its React UI, which the native-engine player never shows, so every UI-driven journey of a game with `src/ui/` fails there
**Complexity:** 7 (HIGH) — the legacy host's UI overlay, state bridge, compositing and input routing, moved into the engine player's loop and renderer
**Owner:** João
**Work package:** native-engine, games with `ui.renderer: "web"` or `"native-css"` on the V8 player (desktop first)
**Depends on:** [PRD-531](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md) (V8 player), [PRD-545](../../done/native-engine/N22-three-surface-coverage/PRD-545-n22a-math-object-model-and-geometry.md) (done: Midway boots on the player)

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
**Status:** DONE

- [x] The V8 player installs `__tnUiPost`, `__tnUiOverlayAttached` and `__tnUiCompositeMs`, attaches the overlay for a bundle with a UI entry, and delivers the page's `tn:intent` messages to `__tnUiGameReceive` at the top of a frame. proof: a player ctest whose UI page posts an intent the game reads, red before — 2026-10-09: `native_engine_player_ui_bridge` (offscreen WebKitGTK under Xvfb) was red ("no intent reached the game (timeout)"), green after. The player compiles the legacy host's own `ui_overlay.cpp`, which now takes its window through `setUiOverlayWindow` and its keyboard reset through a hook instead of the legacy window module; the hit-region parser moved into it, so both hosts apply `tn:hit-regions` with one function. The UI root is `ui/` beside the game bundle; `TN_UI_RENDERER=native-css` selects the CSS backend.
- [x] Game state reaches the page: core's `publishUiState` posts `tn:state` frames the page receives. proof: the same ctest reads a state value back through the page — 2026-10-09: the game posts `tn:state` with `score: 7` through `__tnUiPost` each frame, the page's `__tnUiReceive` reads it and echoes it in an intent, and the game receives `"score":7`; green.

#### Phase 2: The page is drawn into the frame
**Status:** DONE

- [x] The engine renderer composites the overlay's newest premultiplied frame over the world before present, uploading only when the frame changed. proof: a render test comparing a known overlay frame over a known scene, and a counter that a steady frame uploads nothing — 2026-10-09: `native_engine_renderer_overlay_over_frame`: a half-covering premultiplied red page over the lit sphere reads 180,126,97 -> 218,63,48 (premultiplied "over" gives 217.6, 62.8, 48.3), a padded B,G,R,A page gives the same pixels, the same version uploads nothing (`overlayUploads`), and removing the overlay gives the world back. `Renderer::setOverlay` keeps one texture and `blitTo` draws it in its own pass with the new premultiplied blend mode 3; the player hands it `uiOverlayFrame` each frame.
- [x] A Midway screenshot on the player shows its briefing UI. proof: `native-playtests/boot.playtest.json` capture on a private copy, judged against the legacy host's capture — 2026-10-09: a 420-tick briefing capture on the player against the legacy host's on the same packaged `ui/` (Midway's `dist-native`), judged by a fresh agent: PASS, UI panel mean difference 0.02-0.61 of 255, no halo or channel swap. The first judgement failed (text wrapped one line lower): GTK had joined the desktop's Wayland session through an inherited `WAYLAND_DISPLAY`; the player now forces X11 for the web UI, as the legacy host does. Screenshots with a UI read the presented frame (`Renderer::readPresented`).

#### Phase 3: Input reaches the UI first
**Status:** DONE

- [x] A pointer press inside a published hit region goes to the page and not the game; outside it, to the game. proof: a player ctest with one hit region and both presses — 2026-10-09: `native_engine_player_ui_input` through the playtest mailbox: one press inside the left-half island reaches the page, the one outside does not; red with the routing removed ("the page saw 0 presses"). It also holds that every held key reaches the game by code (red with the code set removed: "a held W never reached the game by code").
- [x] Midway's `launch` journey passes on the V8 player. proof: `node packages/playtest/dist/runner/cli.js native-playtests/launch.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player-v8 --host-arg <private copy>/native/game.js` — 2026-10-09: exit 0, 8/8 (briefing click, flight screen, throttle, airborne, altitude, speed) with Midway's packaged `ui/` beside the bundle. It also needed pointer lock (core's `releaseMouse` on the flight start) and every held key by code: the host shim had polled only the arrows, so W never throttled.

## Blocked on

- Windows and macOS: their web views draw themselves above the window; the player's window needs the same child-view attach there. Needs those machines.
