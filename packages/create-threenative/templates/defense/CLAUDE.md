<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ defense

This project is an editable Three.js tower-defense starter. The framework owns the loop,
renderer, physics bindings and playtest bridge; this repository owns the route, attackers,
towers, economy, waves and look.

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
<!-- /shared -->

## Commands

```sh
pnpm dev
pnpm build
pnpm build --target desktop
pnpm test
pnpm typecheck
```

The portable entry is `src/game.ts`; React mounting stays in `src/main.ts`. Attackers follow
the authored route with `PathFollow3D`. This kit deliberately has no navmesh, fog of war,
marquee selection or tech tree: `@threenative/physics/navigation` carries WASM, and WASM is web-only
on this framework's native hosts, so it would make the strategy sample web-only too.

`src/placement/Buildable.ts` validates a prospective tower with `directSpaceState.intersectShape`
before the economy spends anything. `src/towers/Tower.ts` acquires attackers through a jittered
shape scan and fires on its own reload clock. Change route points in `src/board/Route.ts`, tower
rules in `src/towers/`, and the wave schedule in `src/waves.ts`.

`src/render/` owns the camera, palette, sky, lighting, materials and postprocessing. The HUD is
`src/ui/Hud.tsx` and there is only one of it: this template used to draw a geometry HUD on top of
the React one, showing every number twice. A native build has no HUD until you add one. The React
HUD reads `GameState`; it never reaches into an attacker or tower. Register gameplay
entities with `ctx.entities` so playtests can observe them and the framework can dispose them.

`B` places a tower in the next safe build slot for deterministic playtesting; real games place
with the primary pointer on the board. `X` attempts the route test slot and `O` repeats the last
safe slot, making the two placement negative controls reproducible.
Arrow keys or WASD move the registered command beacon, which is the `player` subject used by the
durable movement proof.

`playtests/survives.playtest.json` is the durable smoke proof. Keep it when replacing the
defense gameplay; the other `playtests/` scenarios are examples for placement, scanning,
survival, and leaks.

Every `allowTrivial` waiver in `playtests/` must be a reason string with at least 20 non-whitespace
characters explaining why the initial value is intentionally held; `allowTrivial: true` is invalid.
The reason appears in the report. A scenario whose every triviality-eligible assertion is waived
fails with `TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING`, so keep an independent assertion in the scenario.

## Playtest resources

The playtest bridge registers exactly two resource ids for the JSON-safe game state: `state` is the
canonical id, and `GameState` is a compatibility alias for older scenarios. New scenarios,
including the ones shipped here, must use `state`; resource paths address fields from `ctx.state`.
Keep the alias until existing published scenarios have migrated, then remove it in a future
breaking release.

The state bridge flushes every 100 ms by default, so keep values a human reads — wave, health, or
economy — in `ctx.state`. Per-frame visual feedback belongs in scene-owned Three.js objects;
anything shorter than about 100 ms must not go through React. If an event must appear in the HUD,
give it a decay longer than one flush interval.

The normal physics API selects the native backend on desktop and Android. Keep source portable:
do not import React from `src/game.ts`, do not use dynamic `import()`, and do not read a raw
physics handle. No physical mobile or performance parity claim is made by this template.

<!-- shared: asset-mcp-loop -->
## Finding assets — you have an MCP server for this

**Reach for it when the asset is conventional; build anything custom yourself.**

- **Textures, materials, HDRIs and sound effects — prefer the tools.** Rusted metal, oak
  planks, a studio HDRI, a UI click: these are well-established and a CC0 one beats what you
  would hand-author.
- **Models — only when the thing is conventional.** A car, a plane, a crate, a barrel, a
  tree, a chair. If this game's main character is a car, fetching a compatible `.glb` is the
  right call.
- **Anything specific to this game — write it in `src/render/`.** A downloaded model standing
  in for a bespoke design reads as a weird asset dropped into the scene, and it looks worse
  than a clean composition of primitives. This is the failure the tools make easy.

When in doubt, build it programmatically. A fetched asset has to match what the game needs,
not merely exist.

`.mcp.json` in this project launches `threenative-asset-mcp` from `node_modules`, so your host
lists its tools alongside your own. It advertises 32; these 8 are the loop you will use for
nearly everything:

1. `asset_search_sources` — start here, never at a provider. It returns every catalogued
   source with its license summary, attribution requirement, browse URL, and whether an agent
   can complete a download from it. **That output is the authority on what is reachable** —
   not this file, and not your memory of some other project.
2. `polyhaven_search_assets` (CC0 models, textures, HDRIs), `ambientcg_search_assets` (CC0
   materials and textures), or `audio_search_assets` (Kenney, Sonniss).
3. `polyhaven_list_files` / `ambientcg_list_files` — the license, official URL, byte size and
   md5 of every resolution and format. **Read this before downloading, not after**, and pick a
   sane one: Poly Haven lists 16k PNGs over 1 GB beside 8k JPEGs at 28 MB. A game does not
   need the 16k.
4. `asset_download_file` for textures and models, `audio_download_asset` for audio. Both take
   `acceptLicense: true` — you are asserting you read step 3. **They ignore any path you pass
   and write to the directories `.mcp.json` sets** (`public/assets/<provider>/<sha>/` and
   `public/audio/<source>/<pack>/`); without that config they would write to `~/Downloads` and
   never reach the game.
5. Append the file, its source, its license and its URL to `CREDITS.md` **before the turn
   ends**. Poly Haven requires a visible Poly Haven credit when its API is used, ambientCG is
   CC0 per asset page, and audio and bundle licenses are per pack.

**Never state a license you did not read off a tool result.** If `polyhaven_list_files` or
`ambientcg_search_assets` did not tell you, you do not know it.

**What arrives is usually a ZIP, not a texture.** ambientCG and Kenney ship archives: unpack
one, keep only the maps you actually use (`_Color`, `_NormalGL`, `_Roughness` — not the
`.blend`, `.usdc` or displacement), and put those beside your code under `public/`. A 1K JPEG
set is right for a game; the 8K set of the same material is 200 MB.

Two argument shapes that will bite you, both learned the hard way: `ambientcg_search_assets`
takes lowercase `type` values (`material`, `hdri`, `3d-model`), and the audio catalog is
**pack-level** — `audio_search_assets` matches pack names, so `query: "pickup coin"` returns
nothing while `kind: "sfx"` returns the seven packs that exist. Pick a pack, download it,
unzip it, and choose a file yourself.

The other tools are narrower, and the directory spells out the conditions on each. The Fab
tools talk to a marketplace: the server never purchases anything, and only directly-free files
download. `smithsonian_search_assets` returns museum scans at scan resolution, which this
project has no pipeline to decimate — that geometry is the wrong shape for a game. When in
doubt check `asset_search_sources` first; its `caution` and license fields are the current
truth for the pinned version, and they change between versions.

Load what you downloaded the ordinary way — `ctx.assets.model("crate.glb")`,
`ctx.assets.texture(...)`, `ctx.assets.audio(...)` — and write your own material and lighting
around it in `src/render/`. The framework ships no asset and picks none for you.
<!-- /shared -->

<!-- shared: sculpt-loop -->
## Building what you cannot download — sculpt from a reference

Choose one branch before writing code:

- **Conventional and downloadable** — a crate, an oak plank texture, a click. Use the asset
  tools. Sculpting one of these is slower and worse.
- **Trivial** — a platform, a wall, a pickup ring. Write it. If `BoxGeometry` finishes the
  job in under 20 lines, that is the answer.
- **Bespoke, with a reference image** — an identity-bearing creature, vehicle, hero prop,
  landmark, scenery composition, or environment set piece whose silhouette must match. Use
  the sculpt tools to turn that reference into editable `src/render/` source.
- **Bespoke, without a reference image** — ask for one, or write it and accept that it will
  be generic. Do not invent a reference: comparison without evidence is unguided iteration.

For a full environment, split the decision: sculpt the signature landmark or bounded scene
kit that makes the reference recognisable; use the asset tools for interchangeable trees,
rocks, textures, HDRIs, and sounds around it. Do not sculpt an entire world as one object.

`.mcp.json` launches `threenative-sculpt-mcp` beside the asset server. It does not generate
or ship runtime code; it guides the source you write:

1. Call `sculpt_plan` with the image path and a one-line intent, then read the returned
   grimoire resources.
2. Write the returned object contract and loop on `sculpt_spec_gate` until every named
   region and depth requirement passes. Do not write geometry before this gate is green.
3. For each ordered pass, write or extend one factory in `src/render/`. Capture the real
   frame with `npx @threenative/playtest`; the sculpt server never launches a browser.
4. Call `sculpt_compare` with the reference and captured frame, then give that evidence to
   `sculpt_pass_gate`. Advance only when it says advance; ambiguity means retry.
5. Use `sculpt_grimoire` for a named technique topic. It rejects pages containing concrete
   paste-ready material or shader recipes so the tool never owns this game's look.

A missing or blank capture is a failed run, never a finished model. Add the reference image,
its creator, license, and source URL to `CREDITS.md` before the turn ends.
<!-- /shared -->

<!-- shared: look-at-it-and-budget-the-look -->
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
2. **`npx @threenative/playtest <scenario> --browser-recipe webgpu --headed`.** The recipe
   carries the Chromium flags a WebGPU capture needs, including `--enable-features=Vulkan`.
   Do not hand-roll the flag list: without that one flag Chromium never reaches the Linux
   Vulkan driver and serves WebGPU from SwiftShader, its CPU rasteriser — no error, healthy
   limits, and a software renderer's picture. The runner now fails such a run with
   `TN_PLAYTEST_SOFTWARE_ADAPTER` and prints the adapter it got; `--allow-software` accepts
   the fallback if you truly want it.
3. **Ask the user to look**, and say specifically what you want them to check.

On a machine with no screen, run any of those under a virtual display. **Do not use
`xvfb-run`:** on `xorg-server-xvfb` 21.1.x its cleanup `kill` fails after Xvfb has already
exited and that failing kill's status replaces the real one, so
`xvfb-run -a -s '-screen 0 1600x900x24' true` exits `1`. Every gate wrapped in it reports
failure whether it passed or not. Start `Xvfb` yourself on a free display and export
`DISPLAY`, or check the command's own exit code separately.

What does *not* work: **headless Chromium usually cannot render WebGPU.** The page loads,
the HUD paints, and the 3D canvas comes out blank or black. That looks exactly like a bug
in your scene, and it is not. Symptoms are `Instance dropped in popErrorScope` and
`createBuffer failed, size (N) is too large for the implementation` in the console.

So: if a screenshot comes back black or empty, suspect the capture before you rewrite the
scene. Confirm the renderer works at all before you go debugging your materials.

### When you think you are done

Ask yourself, honestly: *would a player screenshot this?* If the answer is no, you are not
finished — and no command in this repo is going to tell you that.
<!-- /shared -->

<!-- shared: ctx-surface -->
## The `ctx` surface — you already have these, do not rebuild them

`ctx` carries six things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table covers only the `ctx` properties; call
`engine_search_capabilities` for imports.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("<scene-name>")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4)` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds) => Promise<void>` |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | deterministic when `seed` is configured; otherwise `Math.random()` |
| `ctx.raycast()` / `ctx.raycastAll()` | `new Raycaster()` + `intersectObject(s)` | `(options?: { screen?, origin?, direction?, far?, targets?, exclude? }) => Intersection \| undefined` / `readonly Intersection[]` |

**`ctx.raycast()` is how you pick geometry under the pointer.** It defaults to the current
pointer position and the whole scene, returns the nearest `THREE.Intersection`, and stays
under a millisecond on meshes large enough that a plain `Raycaster` visibly stutters — it
keeps an acceleration structure per geometry and rebuilds it when that geometry's positions
change. Pass `{ origin, direction }` for a world ray, `{ far }` to cap its distance, `{ exclude }`
to remove subtrees, and `{ targets }` to narrow it. Use `raycastAll` when occlusion or another
query needs every hit; results are sorted nearest first. `{ screen }` tests a point that is not
the pointer. Skinned, instanced and morphed meshes fall back to the stock Three.js path
automatically, so the result always matches `Raycaster.intersectObject`.

When scene collapse runs on a large static scene, a mesh with non-empty `userData` stays as the
original object in the live graph. Put the target or entity metadata you already use for picking on
the mesh; `ctx.raycast()` then still returns that mesh and its metadata. Meshes without `userData`
may be merged into fewer draws.

**`ctx.goto(name)` rebuilds the scene without resetting game state.** Calling
`ctx.goto("<scene-name>")` from inside the matching scene tears it down and rebuilds it: `exit()` runs,
scheduled callbacks are cleared, registered entities are cleared, the Three scene is emptied,
then a fresh instance runs `load()` and `enter()`. Values in `ctx.state` — health, score,
inventory, or any other game-owned state — survive this scene rebuild. When death-and-retry
should reset gameplay, reset your own state explicitly before calling `ctx.goto()`:

```ts
if (player.dead) {
  ctx.state.set({ /* copy this game's initial-state shape */ });
  ctx.state.flush();
  void ctx.goto("<scene-name>");
  return;
}
```

Do **not** write a `#reset()` that walks your entities putting them back. It is ~15 lines
that look right and quietly miss the scheduler and anything you spawned after `enter()`, so
the second playthrough behaves differently from the first — and no gate in this project will
catch that.

**One rule when calling it from a frame function: `goto` and then `return`, immediately.**

```ts
if (player.dead) {
  void ctx.goto("<scene-name>");
  return;              // ← required. Everything below now runs against a torn-down scene.
}
```

From React, `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state to its
declared initial state first. Use `game.goto("<scene-name>")` for a full restart button; use
`ctx.goto("<scene-name>")` only when preserving game state across the scene rebuild is intended.

**`ctx.tween` is for timing, not for looks.** Use it for the *when* — a pickup rising over
0.4s, a door opening, a hit flash — and keep the *what* (colour, shape, easing feel) in
`src/render/`. Motion driven by a persistent `Math.sin(elapsed)` in `update()` is still the
right tool for a continuous idle bob; `tween` is for anything that starts, runs once, and
finishes.

**`ctx.random` is deterministic only when `defineGame({ seed })` is configured.** Check
`src/game.ts`: the templates that declare a seed get replayable values for spawn positions,
patrol offsets, and level variation; without a seed, `ctx.random` falls back to `Math.random()`.
Add a fixed seed when a playtest needs replayable randomness. Never use `Math.random()` for a
value the scenario must reproduce.
<!-- /shared -->


## Engine capabilities — use the convention before writing a replacement

These public class and function exports are the discoverability index for imports. The `ctx`
conveniences are documented separately; this index covers the public exports scanned from
`@threenative/core` and `@threenative/physics`.

| Import surface | Public class/function exports |
|---|---|
| `@threenative/core` | `AnimationPlayer`, `AudioBus`, `CanvasLayer`, `createRandom`, `defineGame`, `getPlatform`, `GPUParticles3D`, `GroundSnap`, `isMobile`, `isNative`, `isTouchscreenAvailable`, `isWeb`, `PathFollow3D`, `ScenePicker`, `createReplayDriver`, `replay`, `Scheduler`, `Scene`, `prewarm`, `normaliseToMetres`, `attachToBone`, `skeletonBones` |
| `@threenative/core/playtest` | `playtest` |
| `@threenative/core/hot` | `acceptHotUpdate` |
| `@threenative/physics` | `Area3D`, `CharacterBody3D`, `CollisionShape3D`, `Joint3D`, `PhysicsDirectSpaceState3D`, `interactionGroups`, `RigidBody3D`, `rapier` |
| `@threenative/physics/navigation` | `recast`, `NavigationAgent3D`, `NavigationObstacle3D`, `NavigationRegion3D` |

`@threenative/physics/navigation` carries WASM and is browser-only under the current native
portability rule; do not import it in a portable game. For browser-only games, navigation agents
calculate a path but never move your object: write the steering velocity and call
`CharacterBody3D.moveAndSlide()`. A `NavigationRegion3D` is static and must be baked from the
world geometry; changing geometry needs an explicit re-bake. `GroundSnap` keeps `clearance`
truthful when `enabled = false`, `normaliseToMetres` measures a skinned crown for height, and
`prewarm` keeps transient meshes renderable with zero opacity so the first-use frame is not a stall.
