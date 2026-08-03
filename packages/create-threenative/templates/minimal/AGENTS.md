# AGENTS.md — __PROJECT_NAME__

Instructions for the AI agent working in this game. Scaffolded with `create-threenative`
(`minimal` template: no React, no Tailwind). `CLAUDE.md` is a copy of this file; edit this one.

## What the framework owns, and what you own

ThreeNative owns the plumbing: renderer bootstrap and WebGPU fallback, the fixed-step loop,
scene lifecycle, input mapping, asset loading, the physics binding, and the state store.

**You own everything a player sees.** `src/render/`, `src/entities/`, and `src/scenes/` are
ordinary code in this repository. Nothing in `@threenative/*` reads them. Rewrite or delete
any of it.

## Commands

```sh
pnpm dev      # vite dev server
pnpm build    # production build — also the test gate
```

## The layout

```
src/
  main.ts               defineGame(...); HUD is plain DOM here
  scenes/Play.ts        gameplay: load, enter, update, exit
  entities/Player.ts    a plain class, not an ECS
  render/               lighting, postprocessing, materials — YOURS, plain Three.js
  state.ts              the state shape the HUD reads
tests/play.playtest.ts  one scenario, green on the scaffold
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

Any Three.js snippet you already know works unchanged inside a scene. Prefer that over
hunting for a framework helper — if one does not appear in an existing file's imports, it
probably does not exist.

Physics uses Godot's names: `RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`.
Every node has `dispose()`, and `exit()` must dispose what `enter()` created.

## Visuals

Edit `src/render/lighting.ts`, `postprocessing.ts`, and `materials.ts` directly. They are a
starting point, not a constraint, and they import nothing from `@threenative/*`. There is no
config option for the look, deliberately.

## HUD

This template has no React. `main.ts` subscribes a plugin to the store and writes to a DOM
node. `ctx.state.set()` coalesces, so write it from `update()` freely — but never rebuild
the DOM per frame.

If the UI grows past a few readouts, scaffold with the `starter` template instead, which
ships React 19 + Tailwind and `@threenative/ui`.

## Register entities you want to inspect or test

```ts
ctx.entities.add("player", this.player);
```

A registered entity's `debug()` shows up in `window.__THREENATIVE__` in dev, and in playtest
assertions. That is how a scenario checks game state instead of guessing from pixels.

## Playtests

`tests/play.playtest.ts` drives a real browser through the game. Steps count frames, not
milliseconds — `holdFrames`, `waitFrames` — because the harness drives the fixed-step clock
instead of racing it.

A scenario fails closed: a missing entity, an absent observation, or a scenario with no
assertions is a failure, never a quiet pass. Add the assertion that would catch a feature's
absence, and run it before reporting the feature works.
