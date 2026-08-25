# The UI layer — one `src/ui/` in a web view, on every platform

`src/ui/` is the whole UI and the same source on every target. On web it is a React tree beside
the canvas. On native it is the same React tree, loaded by **the platform's own browser-class
renderer** into a transparent surface composited over the game — not a browser the framework
ships, and never the game itself. The scene stays in the native runtime; only the UI crosses.

| target | what loads `src/ui/main.tsx` | status |
| --- | --- | --- |
| web | the page itself, beside `GameCanvas` | shipped |
| Android | a transparent `WebView` over the SDL surface | shipped, proven on a Pixel 8 |
| desktop (Linux) | a transparent WebKitGTK window over the game window | shipped |
| desktop (Windows, macOS) | — | no host yet; use `ui: { renderer: "native" }` |
| iOS | a transparent `WKWebView` over the Metal layer | written, **unproven on hardware** |

Turn it off with `ui: { renderer: "native" }` in `threenative.config.ts`. That ships no web view
and no extra process, and draws `View`/`Text` quads inside the rendered frame instead.

## Two things cross the boundary, and nothing else

On native the UI is a different process from the game. It cannot hold the game object, call
`game.pause()`, or import a scene. It reads **published state** and sends **intents**.

```tsx
import { UiLayer, useUiIntent, useUiState } from "@threenative/ui";

function Hud() {
  const state = useUiState<GameState>();
  const send = useUiIntent();
  // The web view loads this page before the game has run a tick, so this is the normal first
  // paint rather than an error path.
  if (state === undefined) return null;
  return (
    <button data-tn-interactive onClick={() => send("restart")}>
      restart · {state.score}
    </button>
  );
}
```

`src/game.ts` decides what an intent means. This is the whole of the game side:

```ts
game.ui.onIntent((intent, payload) => {
  if (intent === "restart") void game.goto("play");
  if (intent === "pause") game.pause();
});
```

State flows the other way by itself: whatever the scene writes with `ctx.state.set(...)` is
published to the UI. It is serialised to compare frames, so keep it small — live numbers, not
level geometry. Static data the UI needs (a minimap's layout, a weapon table) belongs in a module
both sides import, and that module must not import `three`, or the renderer lands in the UI
bundle. If a value only the game can compute must reach the UI, publish it as state.

## `data-tn-interactive` is how a press finds its owner

Mark every element the player presses. The page publishes those rectangles, normalised to the
viewport, and the **host** decides on pointer-down whether the press belongs to the UI or falls
through to the game.

```tsx
<button data-tn-interactive onClick={fire}>fire</button>   // takes the press
<div className="score">{score}</div>                        // scenery; the press reaches the game
```

`pointer-events: none` is **not** the mechanism and cannot be. The platform hands the gesture to
the web view before any CSS runs; by the time the page could refuse it, the game has already
missed it.

Rectangles are republished while anything moves — a CSS transition, a resize, an element
appearing — so a button is hit where it is *drawn*, not where it started. You do not call
anything to make that happen; `UiLayer` observes the tree.

## What breaks, and what it looks like

Every one of these shipped at least once here, and none of them failed a build.

- **A `body` background.** `src/ui/main.tsx` imports your stylesheet, and on native that page is
  composited over the game. `body { background: … }` is an opaque sheet over the frame the game
  just rendered — the HUD looks right and the game is gone. Put the page backdrop on `#root`,
  which exists only in the web document.
- **Absolute asset URLs.** The UI is served from a subdirectory. A `/assets/app.js` resolves
  outside it and 404s, and the page renders nothing at all — no error, no HUD.
- **Importing game code.** It works on web and drags the renderer into the UI bundle on native.
  The rule that keeps you honest: `src/ui/` may import types and plain data, never a scene, an
  entity, or anything that imports `three`.
- **Assuming the first render has state.** It does not. Return `null` until it arrives.

## Watching it work

Markers, all greppable from the game's output (`adb logcat` on Android):

| marker | means |
| --- | --- |
| `TN_UI_OVERLAY:{"attached":true}` | the host brought the web view up and the page reached it |
| `TN_UI_OVERLAY:{"attached":false,…}` | it did not, and `reason` says why |
| `TN_UI_HIT_REGIONS:{"count":N}` | the page published N interactive rectangles |

`attached` stays false until the page sends its first message, so a false here means the page
never loaded — look at the page, not at the host.

**The page's console does not reach the game's stdout on desktop.** A `console.log` in a UI
component is invisible there. Report through an intent when you need to see something, or open the
same `src/ui/` in a browser, where it is an ordinary page with ordinary devtools.

## Proving it

A `--target android` playtest drives the real build and asserts what the game received: a press on
empty HUD space must reach the game, a press on a published rectangle must not, and a drag that
starts on the game and crosses a button must stay with the game. Assert the game's own counters —
`pointerDowns`, the intents it handled — rather than what the UI shows, which is the half that can
lie about the half you care about.
