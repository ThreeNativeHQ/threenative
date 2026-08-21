# @threenative/ui

## What it is

`@threenative/ui` provides React bindings for a ThreeNative game: `GameCanvas` mounts the game
surface, `useGameState` reads its throttled state store, and `DebugOverlay` exposes development
snapshots. It is not a scene-graph or visual-design layer; React renders HUDs, menus, and overlays,
while the game owns gameplay and the Three.js scene.

## Install

Install the package with its peer dependencies:

```sh
pnpm add @threenative/ui @threenative/core react react-dom three
```

## Example

In a generated `starter` project, `src/ui/App.tsx` mounts the real game and its HUD:

```tsx
import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Menu game={game} />
      <DebugOverlay />
    </main>
  );
}
```

## Styling the debug overlay

`DebugOverlay` ships no presentation — it renders one `<aside data-threenative-debug-overlay="true">`
and leaves every pixel to you. Generated projects already carry a rule for it in their stylesheet;
a project that imports the package directly must write its own, or the overlay paints behind an
absolutely positioned `GameCanvas` and its diagnostics are invisible:

```css
[data-threenative-debug-overlay="true"] {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 50;
  pointer-events: none;
  background: rgb(2 6 23 / 90%);
  color: #cffafe;
}
```

## Links

- [Repository](https://github.com/ThreeNativeHQ/threenative)
- [MIT License](https://github.com/ThreeNativeHQ/threenative/blob/main/LICENSE)
- Start a project with `pnpm create threenative my-game`.
