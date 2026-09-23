# AGENTS.md — @threenative/ui

Read `/AGENTS.md` first. This file covers only what is different here.

## The one rule

**React renders the HUD, menus, and overlays. React never touches the scene graph.**

No JSX for meshes, lights, materials, or cameras. No R3F dependency. If a component would
render something the camera sees, it belongs in a scene, not here.

## The UI has its own realm on native

The native game host has no DOM: its `document` is a Three.js compatibility stub.
With the default `ui.renderer: "web"`, the build ships `src/ui/` and this package in a separate
React DOM bundle loaded by the platform WebView. Import React DOM only from the UI entry;
the portable game entry must stay independent. Explicit `ui.renderer: "native"` opts out.

Note the one exception, because it is the native UI: on desktop the HUD is a web view whose
frames are composited into the game's own frame, so this package *does* run there even
though `react-dom` does not stand behind it in the usual way. What that costs is one control:
a `<select>` has no native popup to open, because there is no view to open it into. The host
draws that list in the page instead — `[data-tn-native-select]`, styled by the project the
same way `[data-threenative-debug-overlay]` is — and reports whether the page holds the
keyboard so the host can forward keys to a focused control and leave every other key to the
game. Everything else — published state in, intents out, `data-tn-interactive` on every touch
target — crosses unchanged.

That makes one mistake fatal: gameplay, state transitions, or scoring written inside a
component are simply missing on native, with no gate reporting it. Components read state and
draw; the game writes state. A HUD is a view of `ctx.state`, never its owner.

## State follows the rendered frame

The game coalesces simulation writes and publishes once per rendered frame. React subscribes
through `useSyncExternalStore`; the native UI consumes a mirror in its own realm:

```tsx
const state = useUiState<GameState>(); // undefined until the first game snapshot arrives
```

`ctx.state.set()` can run many times in a frame without sending intermediate snapshots. A game
may select a slower publication interval with `stateFlushMs`; no interval is imposed by default.
Measure native delivery and visible UI cadence separately: an attached WebView is not proof of
responsive presentation.

## Surface

`GameCanvas`, `DebugOverlay`, `useGameState`, `UiLayer`, `useUiState`, `useUiIntent`. HUD styling belongs in the
user's generated `src/ui/`, in Tailwind classes they own — the framework must not ship a
styled HUD, for the same reason it must not ship a lighting rig.

`DebugOverlay` follows the same rule: it renders one
`<aside data-threenative-debug-overlay="true">` and no presentation at all. Every project that
mounts it owns a rule for that selector in its own stylesheet — without one the overlay paints
behind an absolutely positioned `GameCanvas`. The browser playtest in
`examples/abyss-framework/tests/viewport.playtest.ts` opens the overlay and checks its computed
positioning and pointer behavior.

## Tests

`__tests__/*.spec.tsx`, vitest + `react-test-renderer` in a node environment. React and
`@threenative/core` are peer dependencies and must stay peers, so the game and the UI never
end up with two copies of the store.
