<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__

Instructions for the AI agent working in this game. This project was scaffolded with
`create-threenative`. `CLAUDE.md` is a copy of this file; edit this one.

## What the framework owns, and what you own

ThreeNative owns the plumbing: renderer bootstrap and WebGPU fallback, the fixed-step loop,
scene lifecycle, input mapping, asset loading, the physics binding, and the state bridge to
React.

**You own everything a player sees.** `src/render/`, `src/entities/`, `src/scenes/`, and
`src/ui/` are ordinary code in this repository. Nothing in `@threenative/*` reads them.
Rewrite or delete any of it.

## Commands

```sh
pnpm dev      # vite dev server
pnpm build    # production build
pnpm test     # build, start the dev server, and run the committed playtest
```

## The layout

```
src/
  main.ts               defineGame(...) + React mount
  scenes/Play.ts        gameplay: load, enter, update, exit
  entities/             Player.ts, Crate.ts — plain classes, not an ECS
  render/               lighting, post, materials, shapes, camera — YOURS, plain Three.js
  ui/                   App.tsx, Hud.tsx, Menu.tsx — React 19 + Tailwind 4
  state.ts              the state shape the HUD subscribes to
playtests/play.playtest.json  one scenario, run by pnpm test
playtest/boot-to-play.json  Boot-to-Play jump proof for the standalone runner
threenative.config.ts   renderer + plugins. No visual options, by design.
```

## How to write gameplay here

A scene is a class with optional `load`, `enter`, `update`, `exit`, and `render`. That is
the whole lifecycle — there is nothing else to register.

`ctx` hands you the real objects. There is no wrapper to unwrap:

```ts
ctx.scene          // THREE.Scene
ctx.camera         // THREE.PerspectiveCamera
ctx.renderer       // the renderer
ctx.physics.world  // Rapier World
player.body        // Rapier body (via CharacterBody3D)
player.mesh        // THREE.Mesh
```

Any Three.js tutorial, StackOverflow answer, or snippet you already know works unchanged
inside a scene. Prefer that over looking for a framework helper — if a helper does not
appear in the imports of an existing file, it probably does not exist.

Physics uses Godot's names: `RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`.
Every node has `dispose()`, and `exit()` must dispose what `enter()` created.

Entities are plain classes. There is no ECS, and adding one is a real decision, not a
default — `pnpm add miniplex` if a game genuinely needs it.

## Visuals

Edit everything in `src/render/` directly. It is a starting point, not a constraint, and it
imports nothing from `@threenative/*`. Do not look for a config option to change the look —
deliberately, there is none.

What is already there, so you do not rebuild it:

- `shapes.ts` — `roundedBox`, `block`, `ball`, `tube`, `spike`, `makeRandom`. **Build props
  out of these, not raw `BoxGeometry`.** A sharp box reads as Minecraft; the same box with
  a 0.14 corner radius reads as a toy, and that is most of the difference between a scene
  that looks designed and one that looks like a test harness.
- `lighting.ts` — key, sky/ground bounce, **rim**, ambient, with soft shadows and a
  `normalBias` tuned for rounded geometry. The rim is what stops silhouettes reading as
  flat cut-outs; do not delete it while "simplifying".
- `camera.ts` — `createSpringArm`, a frame-rate-independent follow camera.
- `postprocessing.ts` — ACES tone mapping and the WebGPU render pipeline.

Three traps, all of which cost real debugging time before they were written down:

1. **`CanvasTexture` samples black under `WebGPURenderer`.** Procedurally painting a canvas
   and using it as a `map` produces a black surface, silently. Get variety from alternating
   material colours across a run of meshes instead — that is what `makeRandom` is for.
2. **`flatShading` fights `roundedBox`,** which welds its seams precisely so normals
   interpolate across them. Do not set both.
3. **Import a render module and then call it.** `setupPost` and `setupLighting` are inert
   if `Play.ts` only imports them, and nothing in typecheck, lint, or a playtest will fail.

Nothing in the toolchain can see your game. `pnpm test` proves behaviour, never the look —
so when you change something visual, actually look at it before reporting it done.

## UI

React renders the HUD, menus, and overlays. **React never touches the scene graph** — no
JSX for meshes, lights, or cameras.

The bridge is a throttled store, not a per-frame render:

```ts
ctx.state.set({ score });        // in update(), at loop rate — it coalesces
const { score } = useGameState(); // in a component, ~10Hz
```

Never subscribe a React component to per-frame data.

## Register entities you want to inspect or test

```ts
ctx.entities.add("player", this.player);
```

A registered entity's `debug()` shows up in the dev overlay, in `window.__THREENATIVE__`,
and in playtest assertions. That is how a scenario checks the game state rather than
guessing from pixels.

## Playtests

`playtests/play.playtest.json` drives a real browser through the game. Steps count frames, not
milliseconds — `holdFrames`, `waitFrames` — because the harness drives the fixed-step clock
instead of racing it.

A scenario fails closed: a missing entity, an absent observation, or a scenario with no
assertions is a failure, never a quiet pass. When you add a feature, add the assertion that
would catch its absence, and run the scenario before reporting the feature works.
