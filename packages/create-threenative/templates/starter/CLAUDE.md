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
  render/               palette, camera, sky, lighting, materials, postprocessing — YOURS
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
Every node has `dispose()`. Register disposable entities with `ctx.entities`; the framework
clears registered entities, scene objects, and physics nodes when a scene exits. Dispose a
node explicitly only when removing it during play.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the player movement code.

`CharacterBody3D.moveAndSlide(dt)` owns gravity through `body.velocity`; the player keeps
the coyote-time and jump-buffer timers in the entity so jump feel stays game-owned.

## Assets and animation

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Put a
`.glb` in `public/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the `AnimationPlayer` beside the entity that owns the loaded model. This starter
does not ship a rigged asset; adding one belongs in `public/`, not in the framework.

Entities are plain classes. There is no ECS, and adding one is a real decision, not a
default — `pnpm add miniplex` if a game genuinely needs it.

## Visuals

Edit everything in `src/render/` directly. The six baseline files are `palette.ts`,
`camera.ts`, `sky.ts`, `lighting.ts`, `materials.ts`, and `postprocessing.ts`; `shapes.ts`
and `particles.ts` are additional helpers. They are ordinary Three.js source in this project,
not a framework look or a config option. Keep the palette to six named colours with one
`accent`; import it from materials and sky. Set tonemapping and exposure deliberately, use a
rim light with soft shadows and `normalBias`, derive fog from the sky, and route bloom through
`renderer.setOutputNode()` so midtones remain readable.

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

The start scene owns the initial state in `static initialState`; omit a duplicate
`initialState` literal from `defineGame`. Update only the fields that changed:
`ctx.state.set({ score })`.

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

## Budget real time for the look

Read this as an instruction about **where your effort goes**, not as a style tip.

Every automated gate in this project — `typecheck`, `lint`, `pnpm test`, every playtest
scenario — is blind to how the game looks. All of them pass on a game that is grey boxes on
a black screen. If you let the gates define "done", you will ship grey boxes on a black
screen and the gates will tell you that you succeeded.

So the rule here is: **a feature is not done when its assertion passes. It is done when you
have looked at it and it reads well.** Plan for roughly as much work on presentation as on
mechanics. That is not gold-plating; it is the majority of what a player experiences, and
it is the part nothing else in this repo will catch.

Concretely, when you add anything a player sees, do all of these before calling it done:

1. **Look at it.** Boot the game, get the thing on screen, take a screenshot, open the
   screenshot. Reading your own diff is not looking at it.
2. **Silhouette first.** Can you tell what it is from its outline alone? Break up long
   straight edges — overhangs, fringes, props crossing the line. A shape that reads at a
   glance beats a detailed shape that does not.
3. **Give it depth.** Something bright behind it, something dark under it. Contact shadows
   and a rim make a prop sit in the world instead of floating on top of it.
4. **Make it move.** Idle bob, a squash on impact, a particle on pickup, a screen shake on
   damage. A few frames of motion is the cheapest quality-per-line in the whole project.
5. **Finish the HUD too.** Spacing, hierarchy, a transition on every number that changes.
   An unstyled HUD makes a good-looking game look unfinished.

### How to actually look at it

Run `pnpm dev`, then get eyes on it. In rough order of preference:

1. **Browser automation against the user's real Chrome**, if you have it — Claude in Chrome
   or any equivalent MCP browser tool. This is the best option by a wide margin: it runs on
   a real GPU, so WebGPU works, and you can navigate, press keys, screenshot, and read the
   console in the same loop you are already coding in. Drive the game, do not just load the
   menu.
2. **Headed Chromium via Playwright**, under a virtual display if the machine has no screen
   (`xvfb-run -a -s "-screen 0 1600x900x24"`), launched with
   `--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist`.
3. **Ask the user to look**, and say specifically what you want them to check.

What does *not* work: **headless Chromium usually cannot render WebGPU.** The page loads,
the HUD paints, and the 3D canvas comes out blank or black. That looks exactly like a bug
in your scene, and it is not. Symptoms are `Instance dropped in popErrorScope` and
`createBuffer failed, size (N) is too large for the implementation` in the console.

So: if a screenshot comes back black or empty, suspect the capture before you rewrite the
scene. Confirm the renderer works at all before you go debugging your materials.

### When you think you are done

Ask yourself, honestly: *would a player screenshot this?* If the answer is no, you are not
finished — and no command in this repo is going to tell you that.
