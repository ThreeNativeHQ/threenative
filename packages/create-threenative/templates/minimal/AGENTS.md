# AGENTS.md — __PROJECT_NAME__

Instructions for the AI agent working in this game. Scaffolded with `create-threenative`
(`minimal` template: no React, no Tailwind). `CLAUDE.md` is a copy of this file; edit this one.

## What the framework owns, and what you own

ThreeNative owns the plumbing: renderer bootstrap and WebGPU fallback, the fixed-step loop,
scene lifecycle, input mapping, asset loading, the physics binding, and the state store.

**You own everything a player sees.** `src/render/`, `src/entities/`, and `src/scenes/` are
ordinary code in this repository. Nothing in `@threenative/*` reads them. Rewrite or delete
any of it.

<!-- shared: framework-blocks-you -->
### Before you write a system, ask what already exists

You have `engine_search_capabilities` in your tool list. **Call it before writing any entity
system, movement system, pathfinding, attachment, audio bus, particle system, or measurement
helper** — describe the situation in plain words: *"enemy walks around a wall"*, *"put a weapon
in a character's hand"*, *"keep a character's feet on the floor"*.

The engine's public surface is about twenty classes across four packages, and several are
**subpath imports** like `@threenative/physics/navigation` that no amount of grepping this
project will reveal — nothing imports them yet. The tool is the only complete answer; this file
is a summary and always will be.

Treat the returned constraints as binding. For patrol, chase, obstacle-avoidance, or line-of-sight
movement, import `NavigationAgent3D` from exactly `@threenative/physics/navigation`;
`@threenative/physics` is not a valid import for that symbol. For a weapon held in a hand, import
and call `attachToBone` from `@threenative/core`; do not manually parent, position, or rotate the
rifle. If the stock visual has no skeleton, add a portable Three.js `Bone` named `RightHand`
under the character, then call the helper.

This is not a suggestion about tidiness. A previous game hand-wrote 446 lines of navigation and
bone attachment that were installed and importable at the time, and the hand-written grounding
that came with them ran the game at 9 FPS.

## When the framework blocks you, write plain Three.js

**First rule out your machine and your project**: when a build or a playtest fails for a reason that
is not your game code — a browser that will not launch, a blank screenshot, a device that will not
answer, an import that resolves to nothing — run `npx threenative doctor` and
`npx @threenative/playtest doctor`. They check the project and the machine and name the cause; only
after they come back clean is the framework itself the suspect.

**And when the game runs but looks wrong, ask it what it is:**

```sh
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text
```

One sample from the running game: how many entities exist and how many are visible, the world
extents they occupy, whether their scale is consistent with one unit being one metre, draw calls,
triangles, frame time and frame rate, the states and animation clips actually advancing, and the
console error count. It is the fastest way to tell "nothing is there" from "everything is there and
off-screen", or a stall from a scene that is simply drawing far too much. It reports only what the
bridge observes and names what it cannot see, so treat a missing line as unobserved, never as zero.

An API in `@threenative/*` that is broken, missing, or does not do what you need is **not
something to wait for or to work around from inside its shape.** Drop to vanilla Three.js —
or to the plain code that does the job — for that one thing and keep building. Your `src/`
is ordinary source; nothing in `@threenative/*` reads it, so a hand-written `THREE.*`
implementation sitting beside a framework API is a supported outcome, not a hack.

1. **Scope the fallback to what actually blocked you.** Keep the loop, scenes, input, entity
   registry and playtest bridge; replacing all of them because one node misbehaved costs far
   more than it saves.
2. **Keep the fallback portable.** Plain Three.js and plain math run on native. `document`,
   `window`, `localStorage`, dynamic `import()`, and a raw physics handle do not — reach for
   one of those and this part of the game is web-only from then on.
3. **Report what blocked you**: the API, what you expected, what happened, and what you
   wrote instead. That is how the gap gets fixed for the next game; a silent workaround
   leaves it in place.

Never contort the game to flatter the framework, and never stall on a framework bug. A
finished game carrying a plain Three.js patch beats a blocked one every time.

### Where the long recipes live

This file and the sections around it are the mandatory inline instructions: the first-use
capability search, the fallback rules, the platform constraints, and the fail-closed playtest
rules. The step-by-step recipes are separate searchable pages shipped into this project under
`agent-docs/` — open the one a pointer names when you need it:

- `agent-docs/finding-assets.md` — the full asset-MCP loop: sources, licenses, downloads, ZIPs.
- `agent-docs/sculpt-from-a-reference.md` — the sculpt gate loop and branch definitions.
- `agent-docs/webview-ui.md` — the web-view UI layer: state, intents, hit regions.
- `agent-docs/capture-the-frame.md` — how to screenshot a WebGPU game that actually renders.
- `agent-docs/ctx-cookbook.md` — `ctx.raycast()`, scene rebuild, and seeded-randomness recipes.
- `agent-docs/gameplay-recipes.md` — movement mapping, gamepad bindings, physics-step timing.
- `agent-docs/visual-baseline.md` — the `src/render/` per-file baseline and its traps.
<!-- /shared -->

## Commands

```sh
pnpm dev                       # Vite dev server
pnpm studio                    # chat, preview and proof in one page; needs claude or codex
pnpm build                     # web build; identical to vite build
pnpm build --target desktop    # native executable; Linux is the only verified host
pnpm test                      # build, start the dev server, and run the committed playtest
```

The normal `@threenative/physics` API selects native Rapier on Android; its source-workspace
APK and emulator scenario are proven without Rapier WASM. A published scaffold still cannot
ship Android or iOS until signed prebuilt runtime assets and their checksum manifest exist,
so those targets fail closed for consumers. Linux desktop is source-machine evidence, not a
clean-machine distribution proof; macOS, Windows, iOS, and physical hardware remain OPEN.

## Playtest assertions

<!-- shared: playtest-fail-closed -->
## Playtests fail closed

A scenario fails closed: a missing entity, an absent observation, or a scenario with no
assertions is a failure, never a quiet pass. When you add a feature, add the assertion that
would catch its absence, and run the scenario before reporting the feature works.

Every `allowTrivial` waiver must be a reason string with at least 20 non-whitespace characters
explaining why the initial value is intentionally held; `allowTrivial: true` is invalid. A
scenario whose every triviality-eligible assertion is waived fails with
`TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING`, so keep an independent assertion in the scenario.

Steps count fixed-step ticks, not milliseconds — use `holdTicks` and `waitTicks`. The deprecated
`holdFrames` and `waitFrames` aliases remain accepted for compatibility and are treated as ticks
on a fixed-step bridge; `warmupFrames` remains a genuine requestAnimationFrame warmup.

The assertion vocabulary — every kind the validator accepts, its fields, and when to reach for
it — is generated into `agent-docs/assertion-reference.md`; open it before inventing a new
assertion shape. To probe a running game by hand, every bridge global and its shape is
documented in `agent-docs/debug-surface.md`.

The bridge registers exactly one resource id for the JSON-safe game state: `state`; resource
paths address fields from `ctx.state`. (`GameState` is a deprecated compatibility alias kept
until published scenarios migrate.)
<!-- /shared -->

## Keep the game portable to native

`pnpm build --target desktop` runs this same source on a native host with **no browser**.
Three things break there, and none of them fail on the web build:

1. **No real DOM.** `document` exists only as a Three.js compatibility stub, so anything drawn
   through it — a DOM chip, a React HUD, a CSS loading screen — is invisible natively. This
   template draws no DOM readout for that reason: `src/render/hud.ts` is camera-parented
   Three.js geometry, so its score, counter and clock run with the game everywhere.
2. **No dynamic `import()` and no `window.localStorage` reach.** The native build is one
   bundled file; save games go through your own JSON via `ctx.state`.
3. **`.raw` is web-only.** `ctx.physics.world.raw` is a Rapier object in the browser and
   opaque on native. Anything reading it is a web-only code path by contract.

Writing against `ctx`, `three`, and the Godot-named physics nodes keeps all three correct
without thinking about it. If you only ever ship to the web, ignore this section.

## The layout

`src/main.ts` boots the game and mounts its canvas, deliberately without a DOM score;
`src/scenes/Play.ts` is the gameplay
(load, enter, update, exit); `src/entities/Player.ts` is a plain class, not an ECS;
`src/render/` is your look including the camera-parented HUD geometry; `state.ts` holds the
shape gameplay publishes; `playtests/survives.playtest.json` is the durable smoke proof run by
`pnpm test`.

`threenative.config.ts` is the one game-owned app-shape file. Set the launcher identity and
icon, mobile orientation and display flags, desktop window, renderer preference, and native
entry there. `package.json` may retain only `threenative.nativeEntry` as a compatibility
fallback for older projects.

`src/render/hud.ts` is generated user-owned source, not a framework widget. It uses instanced
plane geometry rather than `CanvasTexture`, and the scene registers it with `ctx.entities` so
native and web dispose it the same way. Rewrite its glyphs, labels, colours or layout freely.
Touch controls are not generated yet: keep keyboard mappings for now, then add the small
pointer-action mapping when the core multitouch surface from PRD-053 is available.

## How to write gameplay here

A scene is a class with optional `load`, `enter`, `update`, `exit`, and `render`. That is
the whole lifecycle — there is nothing else to register. `ctx` hands you real Three.js objects
(`ctx.scene`, `ctx.camera`, `ctx.renderer`) and backend-neutral physics handles
(`ctx.physics.world`, `player.body`, `player.mesh`). The handles expose `.raw` as an explicitly
backend-specific escape hatch: Rapier on web, opaque on native. Code that reads `.raw` is not
portable between those targets.

Any Three.js tutorial, StackOverflow answer, or snippet you already know works unchanged
inside a scene. Prefer that over hunting for a framework wrapper — **for anything Three.js
itself does (geometry, materials, lights, math), there is no wrapper and you should write
the Three.js.** The exception is the loop: scene changes, timers and tweens are on `ctx`,
not in an import, so grepping the imports of an existing file will not find them. The
ctx-only table is followed by the public core-and-physics capability index; call
`engine_search_capabilities` for imports.

Physics uses Godot's names: `RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`.
Every node has `dispose()`. Register disposable entities with `ctx.entities`; the framework
clears them when a scene exits. **The id is the name a scenario resolves** — an unregistered
player fails `TN_PLAYTEST_VISIBILITY_FAILED` however visible it is on screen.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the player movement code.

Gamepad bindings and their deadzone trap, the deferred `moveAndSlide(dt)` step-timing rule,
and save/load snippets live in `agent-docs/gameplay-recipes.md`.

<!-- shared: ctx-surface -->
## The `ctx` surface — you already have these, do not rebuild them

`ctx` carries six things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table covers only the `ctx` properties; call
`engine_search_capabilities` for imports. The recipes behind this table live in
`agent-docs/ctx-cookbook.md`.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("<scene-name>")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4)` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds) => Promise<void>` |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | deterministic when `seed` is configured; otherwise `Math.random()` |
| `ctx.raycast()` / `ctx.raycastAll()` | `new Raycaster()` + `intersectObject(s)` | `(options?: { screen?, origin?, direction?, far?, targets?, exclude? }) => Intersection \| undefined` / `readonly Intersection[]` |

Three rules are load-bearing enough to stay here:

- **`ctx.goto(name)` rebuilds the scene without resetting game state.** Values in `ctx.state`
  survive the rebuild; reset your own state explicitly when death-and-retry should start
  fresh:

```ts
if (player.dead) {
  ctx.state.set({ /* copy this game's initial-state shape */ });
  ctx.state.flush();
  void ctx.goto("<scene-name>");
  return;
}
```

- **One rule when calling it from a frame function: `goto` and then `return`, immediately.**
  Everything after the call runs against a torn-down scene.
- From React, `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state
  to its declared initial state first — that is the full restart button; `ctx.goto()` is for
  preserving game state across the rebuild.

**`ctx.random` is deterministic only when `defineGame({ seed })` is configured.** Never use
`Math.random()` for a value the scenario must reproduce.

<!-- generated: superseded-constructs -->

**Reinvention fails CI.** `pnpm budgets` scans this project's `src/` for these raw
constructs and fails, naming the capability instead. The list and the gate are generated
from the capabilities' own doc tags, so they cannot disagree:

| Rather than write | Use instead | Import from |
|---|---|---|
| `new Audio(` | `AudioBus` | `@threenative/core` |
| `Math.random(` | `createRandom` | `@threenative/core` |
| `new Box3().setFromObject(` | `normaliseToMetres` | `@threenative/core` |
| `.visible = false` | `prewarm` | `@threenative/core` |
| `new Raycaster(` | `ScenePicker` | `@threenative/core` |

When the raw construct is genuinely right, annotate that exact line with a non-empty
reason — a bare `// engine-override:` still fails:

```ts
const bounds = new Box3().setFromObject(viewmodel); // engine-override: measuring, not scaling
```

<!-- /generated -->
<!-- /shared -->

## Engine capabilities — look it up before writing a replacement

<!-- shared: engine-capabilities -->
Two routes to look a capability up, and the second needs no MCP server:
`engine_search_capabilities("pool decals on surfaces")` — plain situations work — or the
generated index at `agent-docs/capability-reference.md`.
<!-- /shared -->


`@threenative/physics/navigation` carries WASM and is browser-only under the current native
portability rule; do not import it in a portable game. For browser-only games, navigation agents
calculate a path but never move your object: write the steering velocity and call
`CharacterBody3D.moveAndSlide()`. A `NavigationRegion3D` is static and must be baked from the
world geometry; changing geometry needs an explicit re-bake. `GroundSnap` keeps `clearance`
truthful when `enabled = false`, `normaliseToMetres` measures a skinned crown for height, and
`prewarm` keeps transient meshes renderable with zero opacity so the first-use frame is not a stall.
`AnimationPlayer` matches a travelling clip's rate to the ground covered, so feet never skate;
`strideRoot` names the moved body and `strideSync: false` overrides while `stride` still reports.

## Assets and animation

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Drop a
rigged `.glb` in `assets/` — sources there are compiled into `public/` and resolved through
the asset manifest — await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the `AnimationPlayer` beside the entity that owns the loaded model. This minimal
template does not ship a rigged asset.

<!-- shared: asset-mcp-loop -->
## Finding assets — you have an MCP server for this

**Reach for it when the asset is conventional; build anything custom yourself.** Textures,
materials, HDRIs, sound effects, and conventional models (a car, a crate, a tree) come from the
tools; anything specific to this game is written in `src/render/` — a downloaded model standing
in for a bespoke design reads as a weird asset dropped into the scene. When in doubt, build it
programmatically.

Installing `@threenative/core` writes the `.mcp.json` that launches `threenative-asset-mcp`, so
your host lists its tools alongside your own. Your host reads that file from the directory it was
launched in: start the session in this project, not in a parent of it. The loop:

1. `asset_search_sources` first, never a provider — its output is the authority on what is
   reachable.
2. `polyhaven_search_assets`, `ambientcg_search_assets`, or `audio_search_assets` to find
   candidates.
3. `polyhaven_list_files` / `ambientcg_list_files` **before downloading** — read licenses and
   pick a sane resolution there (a game does not need the 16k).
4. `asset_download_file` / `audio_download_asset` with `acceptLicense: true`; they write where
   `.mcp.json` points, never where you pass a path.
5. Append file, source, license and URL to `CREDITS.md` before the turn ends.

**Never state a license you did not read off a tool result.**

The full loop — ZIP unpacking rules, the two argument shapes that bite, and the narrower
marketplace tools — is `agent-docs/finding-assets.md`.
<!-- /shared -->

<!-- shared: sculpt-loop -->
## Building what you cannot download — sculpt from a reference

Choose one branch before writing code: conventional and downloadable — use the asset tools;
trivial (a platform, a wall) — write it, `BoxGeometry` under 20 lines is the answer; bespoke
with a reference image — the sculpt tools below; bespoke without one — ask for it, never
invent a reference.

`.mcp.json` launches `threenative-sculpt-mcp`; it does not ship runtime code, it guides the
source you write: plan with `sculpt_plan`, loop on `sculpt_spec_gate` until every named region
passes **before writing geometry**, write one factory per pass in `src/render/`, prove each
pass with `sculpt_compare` plus `sculpt_pass_gate` against a real captured frame (the sculpt
server never launches a browser), and pull technique topics from `sculpt_grimoire`.

A missing or blank capture is a failed run, never a finished model. Add the reference image,
its creator, license, and source URL to `CREDITS.md` before the turn ends. The branch
definitions and environment-splitting guidance are `agent-docs/sculpt-from-a-reference.md`.
<!-- /shared -->


## Visuals

Edit the six files in `src/render/` directly: `palette.ts`, `camera.ts`, `sky.ts`,
`lighting.ts`, `materials.ts`, and `postprocessing.ts`. They are ordinary Three.js source in
this project, not a framework look or a config option. Keep the palette to six named colours
with one `accent`; import it from materials and sky. Set tonemapping and exposure deliberately,
use a rim light with soft shadows and `normalBias`, derive fog from the sky, and route bloom
through `renderer.setOutputNode()` so midtones remain readable. The per-file baseline and the
silent-failure traps (`CanvasTexture` sampling black under `WebGPURenderer`; importing a render
module without calling it) are in `agent-docs/visual-baseline.md`.

Nothing in the toolchain can see your game. `pnpm test` proves behaviour, never the look.

## HUD

This template has no React and **no DOM readout**: the HUD is `src/render/hud.ts`, camera-parented
instanced-quad glyphs drawn in the scene, and `main.ts` deliberately draws no second copy of the
score. That is the one HUD shape that survives every target — identical text on web, desktop and
Android, no per-target branch. Rewrite its glyph table, labels, colours and layout freely; keep
exactly one layer, because a DOM chip over the same score is how a build scored 1 of 5 for an
unreadable doubled readout. If the UI grows past a few readouts **and the game is web-only**,
scaffold with `starter`, which ships React 19 + Tailwind and `@threenative/ui`.

The start scene owns the initial state in `static initialState`; omit a duplicate
`initialState` literal from `defineGame`. `ctx.state.set({ playerX })` is a partial patch.
Hot reload carries JSON-shaped store state only: rebuild the scene in `enter()` from the
values you want to keep.

## Register entities you want to inspect or test

```ts
ctx.entities.add("player", this.player);
```

A registered entity's `debug()` shows up in `window.__THREENATIVE__` in dev, and in playtest
assertions. That is how a scenario checks game state instead of guessing from pixels.

## Playtests

`playtests/survives.playtest.json` is the durable smoke proof — boot, diagnostics, a nonblank
canvas, player movement — and stays green however far you replace the minimal gameplay.
`playtests/play.playtest.json` is the minimal-game example you may delete or rewrite.

<!-- shared: look-at-it-and-budget-the-look -->
## Budget real time for the look

Read this as an instruction about **where your effort goes**, not as a style tip.

Every automated gate in this project — `typecheck`, `lint`, `pnpm test`, every playtest
scenario — is blind to how the game looks. All of them pass on a game that is grey boxes on
a black screen. So: **a feature is not done when its assertion passes. It is done when you
have looked at it and it reads well.** Plan for roughly as much work on presentation as on
mechanics; it is the majority of what a player experiences and the part nothing else catches.

Before calling anything a player sees done: look at it (a screenshot you actually open, not
your own diff); break up silhouettes; give it depth with contact shadows and rim; make it move;
finish the HUD.

Get eyes on it in rough order of preference: browser automation against the user's real Chrome — Claude in Chrome or an equivalent MCP browser tool, which runs on a real GPU; then
`npx @threenative/playtest <scenario> --browser-recipe webgpu --headed` (the recipe carries the
Chromium flags WebGPU needs including `--enable-features=Vulkan`; without it Chromium serves
SwiftShader and the runner fails the run with `TN_PLAYTEST_SOFTWARE_ADAPTER`); then ask the
user to look, saying what to check.

**Do not use `xvfb-run`:** its failing cleanup kill replaces the real exit status. And
**headless Chromium usually cannot render WebGPU** — if a screenshot comes back black or empty,
suspect the capture before you rewrite the scene.

The capture recipes, virtual-display setup, and the silhouette checklist are
`agent-docs/capture-the-frame.md`. When you think you are done: *would a player screenshot
this?* If no, you are not finished.
<!-- /shared -->

<!-- shared: performance-default -->
## Performance default

Refill scratch; pool objects.

`TN_FRAME_BUDGET` prints `fps` and the frame split: `hostGap`, `update`, `render`, `overlay`,
`residual`. `defineGame({ frameBudget: false })` silences it, not the measurement.

`{"performance":{"maxFrameMsP95":33,"minFps":30,"maxPhaseMsP95":{"render":12}}}`
`agent-docs/assertion-reference.md#performance`

Phone memory is a ~500 MiB driver floor plus what you ask for, and one equirect on both
`scene.background` and `scene.environment` costs 48 MiB extra — measured, Pixel 8.
Budgets and the fix: `agent-docs/mobile-memory-budget.md`.
<!-- /shared -->
