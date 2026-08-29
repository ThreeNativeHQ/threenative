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

## Commands

```sh
pnpm dev                       # Vite dev server
pnpm studio                    # chat, preview and proof in one page; needs claude or codex
pnpm build                     # web build; identical to vite build
pnpm build --target desktop    # native executable; Linux is the only verified host
pnpm test                      # build, start the dev server, and run the committed playtest
node tools/look.mjs            # build, serve dist/, screenshot each vantage to artifacts/look/
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
Four host differences break there, and `@threenative/physics/navigation` is a separate
browser-only boundary under the current native portability rule:

1. **The native host has no DOM in the game.** `src/game.ts` and everything it imports must stay
   free of `react-dom` and of `document`; `TN_NATIVE_WEB_ONLY_UI` refuses a build that breaks it.
   `src/ui/` is a separate bundle and has no such rule — see "One UI, on every target".
2. **No `document`, `window`, or `localStorage` reach outside the canvas.** Use `ctx` and
   Three.js. Save games go through your own JSON, not `window.localStorage` directly.
3. **No dynamic `import()`.** The native build is one bundled file.
4. **`.raw` is web-only.** `ctx.physics.world.raw` is a Rapier object in the browser and
   opaque on native. Anything reading it is a web-only code path by contract.

Writing against `ctx`, `three`, and the Godot-named physics nodes keeps all four host differences
correct without thinking about it. If you only ever ship to the web, ignore this section.

## One UI, on every target

`src/ui/` is the whole UI and the same source everywhere — ordinary React DOM, Tailwind and SVG,
beside the canvas on web and in the platform's own browser-class renderer over the game surface on
native. `GameUi.tsx` holds it; `App.tsx` and `main.tsx` mount it.

**The game and the UI are separate processes on native**, so the UI cannot hold the game object: it
reads *published* state and sends *intents*, and `src/game.ts` decides what each means.

```tsx
const state = useUiState<GameState>();   // ~10 Hz; undefined until the first snapshot
if (state === undefined) return null;
const send = useUiIntent();
<button data-tn-interactive onClick={() => send("restart")}>restart</button>
```

**`data-tn-interactive` marks every element the player touches** — the one thing a UI must do
differently from a web page. The host decides on pointer-down whether a touch is
the UI's or the game's; unmarked elements are scenery a touch passes through.
`pointer-events: none` is not that mechanism, and `agent-docs/webview-ui.md` says why.
`ui: { renderer: "native" }` draws `View`/`Text` quads in the frame instead.

## The game this ships with

One ledge over a chasm, a pickup on it, a crate that drops onto it, and a gap with a flag:
reaching the flag sets `state.status` to `"won"`; falling past the kill plane costs one of
three `state.lives`, and the third fall sets `"lost"`. Either ending stops the scene from
simulating the character and paints a React banner; `R` and the restart button rebuild the
scene from `initialState`.

That is a whole game loop in about forty lines of `src/scenes/Play.ts`, there to be replaced.
Keep the shape — an outcome in `ctx.state`, the scene stopping itself, a React component
reading the outcome — and change everything else. The flag's pennant is the packaged
`assets/native-proof.glb`: it is loaded in `Play.load()` and the console marker that follows
is what the desktop asset gate greps for, so if you delete the flag, keep the load.

## The layout

`src/main.ts` mounts React and calls `defineGame`; `src/scenes/Play.ts` is the gameplay
(load, enter, update, exit); `src/entities/` are plain classes, not an ECS; `src/render/` is
your look; `src/ui/` is React 19 + Tailwind 4; `state.ts` holds the shape the HUD subscribes
to; `playtests/*.playtest.json` run under `pnpm test`. There is no ECS to join and no
registration file — the tree is small enough to read.

`threenative.config.ts` is the one game-owned app-shape file: launcher identity and icon,
mobile orientation and display flags, desktop window, renderer preference, native entry.
`package.json` may retain only `threenative.nativeEntry` as a compatibility fallback.

`src/ui/MainMenuUi.tsx` is the starter's form screen, and `src/ui/Hud.tsx` is its gameplay HUD;
keep gameplay decisions in the portable scenes and let the published `state.screen` choose which
chrome is visible.
The complete menu-to-settings-to-play recipe is `agent-docs/menu-screens.md`; the starter's
`playtests/menu-flow.playtest.json` shows the menu-to-play proof.
Touch controls are not generated yet: add the small pointer-action mapping after the core
multitouch surface from PRD-053 lands.

## How to write gameplay here

A scene is a class with optional `load`, `enter`, `update`, `exit`, and `render`. That is
the whole lifecycle — there is nothing else to register. `ctx` hands you real Three.js objects
(`ctx.scene`, `ctx.camera`, `ctx.renderer`) and backend-neutral physics handles
(`ctx.physics.world`, `player.body`, `player.mesh`). The handles expose `.raw` as an explicitly
backend-specific escape hatch: Rapier on web, opaque on native. Code that reads `.raw` is not
portable between those targets.

Any Three.js tutorial or snippet you already know works unchanged inside a scene. Prefer that
over hunting for a framework wrapper — **for anything Three.js itself does (geometry,
materials, lights, math), there is no wrapper and you should write the Three.js.** The
exception is the loop: scene changes, timers and tweens are on `ctx`, never imports.

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

`ctx` carries seven things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table covers only the `ctx` properties; call
`engine_search_capabilities` for imports. The recipes behind this table live in
`agent-docs/ctx-cookbook.md`.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("<scene-name>")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4, { ease: ... })` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds, options?: { ease?: (progress: number) => number }) => Promise<void>`; `ease` receives progress 0–1 and returns the interpolation factor |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | deterministic when `seed` is configured; otherwise `Math.random()` |
| `ctx.pointer.on(...)` / `ctx.pointer.drag(...)` | hand-written hover, press, tap, and drag state | `(object, type, listener) => disposer` / `(object) => IPointerDragHandle` |
| `ctx.raycast()` / `ctx.raycastAll()` | `new Raycaster()` + `intersectObject(s)` | `(options?: { screen?, origin?, direction?, far?, targets?, exclude? }) => Intersection \| undefined` / `readonly Intersection[]` |

`ctx.pointer` dispatches `pointerEntered`, `pointerExited`, `pointerPressed`, `pointerReleased`,
`tapped`, `dragStarted`, `dragged`, and `dragEnded` from the same pointer-id stream on web and
native. Register a mesh or model root; only registered objects are raycast, and events bubble
through the parent chain.

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

## Assets and animation

Files the game loads live in `assets/`; the dev server and `threenative build` compile them
into hashed outputs in `public/` plus `public/assets.manifest.json`, and
`ctx.assets.model("hero.glb")` resolves the logical name through that manifest. Favicon and
launcher icons stay hand-owned in `public/`. This starter ships
`assets/native-proof.glb`, `assets/native-proof.png` and `assets/pickup.wav`; compiled
outputs are gitignored. **Audio is WAV** because Android decodes RIFF/WAVE only;
`--target android` refuses the rest.

For clips from a rigged asset, drop the `.glb` in `assets/`, await
`ctx.assets.model("hero.glb")` in `Scene.load()`, then drive an `AnimationPlayer` beside the
owning entity.

Before placing an unfamiliar model, inspect it with
`npx create-threenative inspect assets/hero.glb` (`--json` for machine output): observational
heuristics — units, forward axis — never a rewrite.

Entities are plain classes. There is no ECS, and adding one is a real decision, not a
default — `pnpm add miniplex` if a game genuinely needs it.

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

Edit everything in `src/render/` directly. The six baseline files are `palette.ts`,
`camera.ts`, `sky.ts`, `lighting.ts`, `materials.ts`, and `postprocessing.ts`; `shapes.ts`
and `scenery.ts` are additional helpers. These are ordinary Three.js source in this project,
not a framework look or a config option. Keep the palette to six named colours with one
`accent`; import it from materials and sky. Set tonemapping and exposure deliberately, use a
rim light with soft shadows and `normalBias`, derive fog from the sky, and route bloom through
`renderer.setOutputNode()` so midtones remain readable. Build props out of `shapes.ts`
(`roundedBox`, not raw `BoxGeometry`) and keep something in all three scenery bands — a lit
floor alone in black reads as a test fixture.

The per-file baseline and three traps that cost real debugging time (`CanvasTexture` sampling
black under `WebGPURenderer`, `flatShading` fighting `roundedBox`, importing a render module
without calling it) are in `agent-docs/visual-baseline.md`. Nothing in the toolchain can see
your game — when you change something visual, actually look at it before reporting it done.

## UI

**React never touches the scene graph** — no JSX for meshes, lights or cameras. `ctx.state.set()`
writes at loop rate and the bridge coalesces into a flush every ~100 ms, so per-frame feedback
belongs in scene-owned Three.js objects.

Each scene owns its initial state in `static initialState`; omit a duplicate `initialState` literal
from `defineGame`. Update only the fields that changed:
`ctx.state.set({ score })`. Hot reload carries JSON-shaped store state only — seed entities
in `Play.enter()` from carried values such as `playerX`, because the scene graph, physics
world, audio voices, particles, and renderer are rebuilt on every update. The keyboard and
intent restart paths reset `Play.initialState` before rebuilding the scene.

## Register entities you want to inspect or test

```ts
ctx.entities.add("player", this.player);
```

A registered entity's `debug()` shows up in the dev overlay, in `window.__THREENATIVE__`,
and in playtest assertions. That is how a scenario checks the game state rather than
guessing from pixels.

## Playtests

`playtests/menu-flow.playtest.json` is the screen-flow proof — click the menu form, carry a name
into play, and assert it through `resources`. `playtests/survives.playtest.json` is the durable smoke proof — boot, diagnostics, a nonblank
frame, player movement — and stays green however far you replace the starter gameplay.
`playtests/goal.playtest.json` and `playtests/gameover.playtest.json` prove the win and fail
outcomes; rewrite that pair when you replace the win and fail conditions, keeping the pairing:
an outcome nothing asserts is an outcome that quietly stops happening. `odometer.playtest.json`
shows the deferred-motion pattern, and the remaining scenarios are examples you may delete or
rewrite.

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

<!-- shared: pixel-budget -->
## The pixel budget is the engine's

`renderer.resolutionScale: "auto"` ships on. The engine scales the **3D drawing buffer only** —
never CSS, UI, camera or aspect — to hold `display.maxFps`. A Pixel 8 hands three.js 2400×1080 as
CSS pixels: 2.592 Mpx at a measured 9.94 ms/Mpx. Never hand-author that constant.

```ts
renderer: { resolutionScale: "auto", antialias: true,
  android: { resolutionScale: 0.44, antialias: false } },
```

A number in `(0, 1]` pins it and stops the loop; `0`, negatives, `> 1` and `NaN` are refused by
name at config load, not at frame time. Pinning never stops the measurement: every
`TN_FRAME_BUDGET` window carries
`surface: { resolutionScale, scaleSource, sampleCount, drawingBufferWidth, drawingBufferHeight }`
in both modes, and `perf --text` prints it beside the fps. `scaleSource` is `pinned`, `auto`, or
`auto-pinned` (chose, then held rather than pump visibly); at the floor and still over budget it
reports `atFloor` instead of implying the budget was met. `antialias` overrides per-platform on
the same seam — a scaled buffer is upscaled, magnifying every aliased edge. Pass
`display: config.display` into `defineGame`, or the scaler assumes 60.
<!-- /shared -->

<!-- shared: performance-default -->
## Performance targets

Refill scratch; pool objects.

`TN_FRAME_BUDGET` reports `fps`/`hostGap`/`update`/`render`/`overlay`/`residual`;
`defineGame({ frameBudget: false })` silences output, never measurement.

Unexecuted platforms stay unverified; never-invent-numbers. Withdraw thermally-confounded Tiers 1–3 comparisons; always report Tier 4.

|Tier|Measure|Floor|Target|
|---|---|---:|---:|
|1|Starter/browser-desktop|60fps|display-refresh|
|1|Starter/browser-Android|30fps|58fps|
|1|Starter/native-desktop|60fps|display-refresh|
|1|Starter/native-Android|55fps|58fps|
|1|Starter/native-iOS|unverified|no-number|
|1|All-platform/hostGap-p95|—|≤4ms|
|1|All-platform/update-p95|—|≤2ms|
|1|All-platform/residual-p95|—|≤0.5ms|
|1|All-platform/overlay-p95|—|≤1ms|
|2|Same-device-fps-parity|.85|.95|
|2|Inverted-render-p95-parity|.80|.95|
|3|Light|55fps|58fps|
|3|Medium|30fps|58fps|
|3|Heavy|30fps|58fps|
|4|Sustained-duration|10min|10min|
|4|Final/opening-fps|.75|.90|
|4|Last-minute-heavy|25fps|50fps|
|4|Peak-battery-temperature|≤45C|≤40C|
|4|Thermal-status|≤2|≤1|
|4|Whole-device-current|—|report;not-gated|

`{"performance":{"maxFrameMsP95":33,"minFps":30,"maxPhaseMsP95":{"render":12}}}`
`agent-docs/assertion-reference.md#performance`

Pixel-8-memory: ~500MiB-driver-floor; dual-use-equirect adds-48MiB. Fix:
`agent-docs/mobile-memory-budget.md`.
<!-- /shared -->
