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
pnpm build    # production build
pnpm test     # build, start the dev server, and run the committed playtest
```

## The layout

```
src/
  main.ts               defineGame(...); HUD is plain DOM here
  scenes/Play.ts        gameplay: load, enter, update, exit
  entities/Player.ts    a plain class, not an ECS
  render/               palette, camera, sky, lighting, materials, postprocessing — YOURS
  state.ts              the state shape the HUD reads
playtests/play.playtest.json  one scenario, run by pnpm test
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
inside a scene. Prefer that over hunting for a framework wrapper — **for anything Three.js
itself does (geometry, materials, lights, math), there is no wrapper and you should write
the Three.js.** The exception is the loop: scene changes, timers and tweens are on `ctx`,
not in an import, so grepping the imports of an existing file will not find them. The
table below is the complete list.

Physics uses Godot's names: `RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`.
Every node has `dispose()`. Register disposable entities with `ctx.entities`; the framework
clears registered entities, scene objects, and physics nodes when a scene exits. Dispose a
node explicitly only when removing it during play.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the player movement code.

`CharacterBody3D.moveAndSlide(dt)` owns gravity through `body.velocity`; keep coyote time
and the jump buffer in `src/entities/Player.ts` so the two templates teach the same motion
API.

## The `ctx` surface — you already have these, do not rebuild them

`ctx` carries five things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table is the complete list.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("play")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4)` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds) => Promise<void>` |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | seeded — a replay produces identical results |

**`ctx.goto(name)` restarts the current scene.** Calling `ctx.goto("play")` from inside
`Play` tears the scene down and rebuilds it: `exit()` runs, scheduled callbacks are cleared,
registered entities are cleared, the Three scene is emptied, then a fresh instance runs
`load()` and `enter()`. That is your entire restart button, and your entire death-and-retry.

Do **not** write a `#reset()` that walks your entities putting them back. It is ~15 lines
that look right and quietly miss the scheduler and anything you spawned after `enter()`, so
the second playthrough behaves differently from the first — and no gate in this project will
catch that.

**One rule when calling it from a frame function: `goto` and then `return`, immediately.**

```ts
if (player.dead) {
  void ctx.goto("play");
  return;              // ← required. Everything below now runs against a torn-down scene.
}
```

From React, the same call is `game.goto("play")` — use that for a restart button instead of
routing a counter through game state.

**`ctx.tween` is for timing, not for looks.** Use it for the *when* — a pickup rising over
0.4s, a door opening, a hit flash — and keep the *what* (colour, shape, easing feel) in
`src/render/`. Motion driven by a persistent `Math.sin(elapsed)` in `update()` is still the
right tool for a continuous idle bob; `tween` is for anything that starts, runs once, and
finishes.

**`ctx.random` is seeded from `defineGame({ seed })`.** Use it for anything a playtest needs
to reproduce — spawn positions, patrol offsets, level variation. `Math.random()` makes a
scenario that passes once and fails on replay for no visible reason.

## Assets and animation

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Put a
`.glb` in `public/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the `AnimationPlayer` beside the entity that owns the loaded model. This minimal
template does not ship a rigged asset; adding one belongs in `public/`, not in the framework.

## Visuals

Edit the six files in `src/render/` directly: `palette.ts`, `camera.ts`, `sky.ts`,
`lighting.ts`, `materials.ts`, and `postprocessing.ts`. They are ordinary Three.js source in
this project, not a framework look or a config option. Keep the palette to six named colours
with one `accent`; import it from materials and sky. Set tonemapping and exposure deliberately,
use a rim light with soft shadows and `normalBias`, derive fog from the sky, and route bloom
through `renderer.setOutputNode()` so midtones remain readable.

`lighting.ts` ships key, bounce, **rim** and ambient with soft shadows. The rim is what
stops silhouettes reading as flat cut-outs against the background; do not delete it while
"simplifying".

Two traps worth knowing before you spend an afternoon on either:

1. **`CanvasTexture` samples black under `WebGPURenderer`.** Painting a canvas and using it
   as a `map` silently produces a black surface. Vary material colours across meshes
   instead. (The `starter` template ships a `shapes.ts` with rounded primitives and a
   seeded RNG for exactly this; copy it in if you want it.)
2. **Import a render module and then call it.** `setupPost` is inert if `Play.ts` only
   imports it, and no gate here will fail.

Nothing in the toolchain can see your game. `pnpm test` proves behaviour, never the look.

## HUD

This template has no React. `main.ts` subscribes a plugin to the store and writes to a DOM
node. `ctx.state.set()` coalesces, so write it from `update()` freely — but never rebuild
the DOM per frame.

If the UI grows past a few readouts, scaffold with the `starter` template instead, which
ships React 19 + Tailwind and `@threenative/ui`.

The start scene owns the initial state in `static initialState`; omit a duplicate
`initialState` literal from `defineGame`. `ctx.state.set({ playerX })` is a partial patch.

## Register entities you want to inspect or test

```ts
ctx.entities.add("player", this.player);
```

A registered entity's `debug()` shows up in `window.__THREENATIVE__` in dev, and in playtest
assertions. That is how a scenario checks game state instead of guessing from pixels.

## Playtests

`playtests/play.playtest.json` drives a real browser through the game. Steps count frames, not
milliseconds — `holdFrames`, `waitFrames` — because the harness drives the fixed-step clock
instead of racing it.

A scenario fails closed: a missing entity, an absent observation, or a scenario with no
assertions is a failure, never a quiet pass. Add the assertion that would catch a feature's
absence, and run it before reporting the feature works.

## Budget real time for the look

Read this as an instruction about **where your effort goes**, not as a style tip.

Every automated gate here — `typecheck`, `lint`, `pnpm test`, every playtest scenario — is
blind to how the game looks. All of them pass on a game that is grey boxes on a black
screen. If you let the gates define "done", that is what you will ship, and the gates will
tell you that you succeeded.

**A feature is not done when its assertion passes. It is done when you have looked at it
and it reads well.** Plan for roughly as much work on presentation as on mechanics.

When you add anything a player sees, do all of these before calling it done:

1. **Look at it.** Boot the game, get it on screen, screenshot, open the screenshot.
   Reading your own diff is not looking at it.
2. **Silhouette first.** Can you tell what it is from its outline? Break up long straight
   edges. A shape that reads at a glance beats a detailed shape that does not.
3. **Give it depth.** Something bright behind it, something dark under it. Contact shadows
   and the rim light make a prop sit in the world instead of floating on it.
4. **Make it move.** Idle bob, squash on impact, a particle on pickup. A few frames of
   motion is the cheapest quality-per-line in the project.
5. **Finish the HUD.** Spacing, hierarchy, a transition on numbers that change.

### How to actually look at it

Run `pnpm dev`, then get eyes on it. In rough order of preference:

1. **Browser automation against the user's real Chrome**, if available — Claude in Chrome
   or an equivalent MCP browser tool. Best option by far: real GPU, so WebGPU works, and
   you can navigate, press keys, screenshot and read the console in one loop. Drive the
   game, do not just load the menu.
2. **Headed Chromium via Playwright**, under a virtual display if there is no screen
   (`xvfb-run -a -s "-screen 0 1600x900x24"`), with
   `--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist`.
3. **Ask the user to look**, saying specifically what to check.

What does *not* work: **headless Chromium usually cannot render WebGPU.** The page loads,
the DOM HUD paints, and the 3D canvas comes out blank — which looks exactly like a bug in
your scene and is not. Look for `Instance dropped in popErrorScope` in the console.

If a screenshot comes back black, suspect the capture before you rewrite the scene.

### When you think you are done

Ask honestly: *would a player screenshot this?* If not, you are not finished — and no
command here is going to tell you that.
