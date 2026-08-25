# Menu screens: scenes are the screens

Use a scene for every screen that needs a world, camera, lighting, or ordinary Three.js art. Put
the chrome in `src/ui/` so the same React tree runs beside the web canvas and in the native web
view.

## The flow

1. Give the menu scene a static `initialState` with `screen: "menu"` and all fields the game
   state needs.
2. Render a form in a UI component with `useUiState` and `useUiIntent`. Mark every input and
   button with `data-tn-interactive`.
3. Validate the intent payload in `src/game.ts`. The game owns the transition:

```ts
if (intent === "start-game" && name.length > 0) {
  void game.goto("play", { carry: { characterName: name } });
}
```

`game.goto()` resets to the destination scene's `initialState`, then merges the serializable
`carry` patch. `ctx.goto()` rebuilds without resetting state; use it only when the current run
should survive the rebuild.

4. Give the played scene its own initial state with `screen: "playing"`. The carried values are
   available in `enter()` through `ctx.state.getState()` and are also visible to the UI and
   playtest bridge.
5. Switch the chrome from the published `screen` value. The menu component returns `null` outside
   the menu, and the HUD/menu bar return `null` outside play.

## Add a settings screen

To insert settings between the menu and play screens, extend the state union with `"settings"`,
add a `Settings` scene whose `initialState.screen` is `"settings"`, and add a `SettingsUi` form
that follows the same `useUiState`/`useUiIntent` pattern. Register the scene, render the form
when `screen === "settings"`, and keep navigation in `src/game.ts`:

```ts
if (intent === "open-settings") void game.goto("settings");
if (intent === "start-game") {
  void game.goto("play", { carry: { characterName: name, difficulty } });
}
```

The menu's settings button and the settings form's start button both carry
`data-tn-interactive`. Prove the complete flow with viewport-pixel clicks and assert the carried
settings resource after the final scene transition.

## Prove it with a click scenario

`click` uses viewport pixels and emits a real pointer-down/up pair on the web target:

```json
{ "kind": "click", "at": { "x": 640, "y": 365 }, "label": "name-field" }
```

Click the form field, use ordinary `input` steps for the text, click submit, then assert the
carried value through `resources`:

```json
{ "equals": "axo", "id": "state", "path": "characterName" }
```

The bridge samples the state after the transition settles. A missing bridge or an unobserved
entity click target is a named failure, never a skipped step.

The native renderer draws quads and has no text input today. Form screens therefore use the shared
webview UI; `ui: { renderer: "native" }` is appropriate only when the screen does not need text
entry.
