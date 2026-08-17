# ThreeNative

ThreeNative is an application framework for games whose same vanilla Three.js source runs in
the browser on WebGPU and on an owned C++ runtime for desktop, Android, and iOS. It uses
Godot-shaped node names, React and Tailwind for UI, and vanilla `three` underneath on every
surface.

## Quickstart

Run these commands inside the scaffolded project:

```sh
pnpm create threenative my-game
cd my-game
pnpm install
pnpm dev
```

The default `starter` template gives you a complete game loop and React HUD. The seven templates
are listed in [`create-threenative`](packages/create-threenative/README.md): `starter` is the
default, `minimal` is the smallest core-and-physics project, `platformer` adds navigation,
`action-rpg` adds combat and progression, `defense` adds tower placement, `racing` adds laps and
ranking, and `shooter` adds targets and weapons.

## A small game

This is the real portable entry from the minimal template's `src/game.ts`:

```ts
import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
  },
  plugins: [rapier(), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  start: "play",
});

export default game;
```

## What you get

- Bootstrap and lifecycle management; the look stays in generated `src/render/` source.
- Godot-named nodes such as `RigidBody3D`, `CharacterBody3D`, `Area3D`, and `CollisionShape3D`
  over Rapier; gameplay remains yours to write.
- React HUD bindings for menus and game state; the framework does not prescribe your visual design.
- A playtest harness that drives a real browser and asserts what happened; your scenarios define
  the game's behaviour.
- An owned native runtime for desktop, Android, and iOS; the framework supplies the host plumbing,
  not your game's content.

## Packages

| Package | Version | Purpose |
| --- | --- | --- |
| `@threenative/core` | `0.2.0` | Bootstrap, scenes, lifecycle, input, and renderer integration |
| `create-threenative` | `0.2.2` | Scaffold a readable game project from seven templates |
| `@threenative/physics` | `0.2.1` | Rapier-backed Godot-shaped physics and navigation |
| `@threenative/playtest` | `0.2.0` | Browser, native, and scenario assertion harness |
| `@threenative/runtime-native` | `0.2.0` | Owned C++ host for desktop, Android, and iOS |
| `@threenative/studio` | `0.2.0` | Local browser Studio for project work |
| `@threenative/ui` | `0.2.1` | React bindings for HUD and game state |

## Status

This is alpha. Browser WebGPU and desktop native are green; iOS-simulator evidence is produced
on a hosted `macos-15` runner; the Android emulator is red on the hosted lane. No physical phone
has run this, and no stranger has played a ThreeNative game for five minutes. This is not
mobile-ready. The external performance control is
[`engine-load-test-summary-2026-08-15.md`](docs/verification/engine-load-test-summary-2026-08-15.md).

## Contributing and development

Install the pinned dependencies, then use the default checks:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:browser
pnpm test:playtest
```

**There is no root `pnpm dev`.** To run an example, name it:
`pnpm --filter abyss-framework dev`.

Native compilation is opt-in. The default gate needs no CMake, NDK, or Xcode.

## Docs

- [`docs/README.md`](docs/README.md) is the map for PRDs, verification, benchmarks, strategy,
  architecture, product, and spikes.
- [`create-threenative/README.md`](packages/create-threenative/README.md) documents the templates
  and scaffold command.
- [`CHARTER.md`](docs/architecture/CHARTER.md) is the binding document for the framework.

## Licence

MIT — [`LICENSE`](LICENSE).
