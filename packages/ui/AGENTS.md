# AGENTS.md — @threenative/ui

Read `/AGENTS.md` first. This file only covers what is different here.

## The one rule

**React renders the HUD, menus, and overlays. React never touches the scene graph.**

No JSX for meshes, lights, materials, or cameras. No R3F dependency. If a component would
render something the camera sees, it belongs in a scene, not here.

## The 60fps problem

React must not re-render on the game loop. The bridge is a plain external store the game
writes to and React subscribes to via `useSyncExternalStore` (zustand backs it):

```tsx
const { hull, score } = useGameState();   // throttled, ~10Hz, not 60Hz
```

`ctx.state.set()` writes at whatever rate the game wants; the store coalesces and notifies
on an interval. Any change that makes a subscriber fire per frame is a regression — even if
the profiler still looks fine on a small scene.

## Surface

`GameCanvas`, `DebugOverlay`, `useGameState`. Keep it that small. HUD styling belongs in the
user's generated `src/ui/`, in Tailwind classes they own — the framework must not ship a
styled HUD, for the same reason it must not ship a lighting rig.

## Tests

`__tests__/*.spec.tsx`, vitest + `react-test-renderer` in a node environment. React and
`@threenative/core` are peer dependencies; they must stay peers, so the game and the UI
never end up with two copies of the store.
