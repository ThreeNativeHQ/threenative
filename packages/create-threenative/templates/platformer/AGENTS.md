# AGENTS.md — __PROJECT_NAME__ platformer

This project is an editable Three.js platformer starter. The framework owns the loop,
input, renderer, physics bindings, and playtest bridge; this repository owns the feel,
level, entities, and look.

## When the framework blocks you, write plain Three.js

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

## Commands

```sh
pnpm dev
pnpm studio                   # chat, preview and proof in one page; needs claude or codex
pnpm build                    # web build; identical to vite build
pnpm build --target desktop   # native executable; Linux is the only verified host
pnpm test
pnpm typecheck
```

The normal physics API selects native Rapier on Android. This template's chasers use editable
steering in `src/entities/Chaser.ts`, not Recast, so the portable game runs on desktop and the
Android emulator. `@threenative/physics/navigation` remains browser-only because it carries
Recast WASM. Linux desktop and Android x86_64 emulator runs are source-machine evidence, not
clean-machine distribution proof; macOS, Windows, iOS, arm64, and physical hardware remain
OPEN.

If you care about the desktop target, keep the game portable: no real DOM there (`document`
is a Three.js compatibility stub), no dynamic `import()`, and `.raw` on a physics handle is
a Rapier object on web but opaque on native. Writing against `ctx`, `three`, and the
Godot-named nodes keeps that correct without thinking about it.

## Where to work

- `src/entities/Character.ts` contains every movement and feel constant.
- `src/entities/Patrol.ts` is the ordinary scripted-route enemy; `Chaser.ts` demonstrates a
  two-corner route around this level's blocker plus short-range peer separation. Change its
  route with the level. General navmesh pathfinding is browser-only.
- `src/entities/Pickup.ts` is an ordinary gameplay class.
- `src/level/` contains plain level helpers and checkpoint state.
- `src/render/` is ordinary Three.js source. It has no framework imports. Its baseline
  concerns include palette, camera, sky, lighting, materials, postprocessing, and the
  camera-parented geometry HUD in `hud.ts`.
- `src/scenes/Level.ts` is the live caller that wires the pieces together.
- `playtests/survives.playtest.json` is the durable smoke proof: keep it when replacing the
  platformer gameplay. The other root `playtests/` scenarios prove movement, collection,
  stomping, respawn, and one-way platforms in this example game. The native-only
  `playtests/native/touch-controls.playtest.json` is run explicitly with `--target android` or
  `--target ios`; it is intentionally outside the browser test glob.

**This template has one HUD, and it is `src/ui/Hud.tsx`.** It previously shipped a
camera-attached geometry HUD as well, and both drew hearts, coins and the clock on top of each
other. Gameplay and state transitions live in the portable scene and reach the HUD through
`ctx.state.set`, so nothing about that is web-only. **This template claims desktop, and a desktop
build has no HUD until you add one** — write it in your own `src/render/` code, as instanced
Three.js geometry rather than DOM, if your game needs one there. That is a real gap and it is
stated rather than hidden. `src/render/touch-controls.ts`
draws the thumbstick, jump and dash surfaces and maps `ctx.input.raw.pointers` in the scene, so
the platformer remains playable without a keyboard on a touch target.

`threenative.config.ts` is the one game-owned app-shape file. Set the launcher identity and
icon, mobile orientation and display flags, desktop window, renderer preference, and native
entry there. `package.json` may retain only `threenative.nativeEntry` as a compatibility
fallback for older projects.

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Put a
`.glb` in `public/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the player beside the entity that owns the loaded model.

Use Godot names for physics nodes: `CharacterBody3D`, `Area3D`, `RigidBody3D`, and
`CollisionShape3D`. Register persistent entities with `ctx.entities`; the framework clears
registered entities, scene objects, and physics nodes when a scene exits. Dispose a node
explicitly only when removing it during play. **The id is the name a scenario resolves.** A
playtest `subject`, and every `movement` or `visibility` assertion, looks the entity up by that
string — an unregistered player fails `TN_PLAYTEST_VISIBILITY_FAILED` however visible it is on
screen. Feel belongs in the character, not in `defineGame` options.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the character movement code.

`Level.static initialState` is the single initial-state value. `defineGame` discovers it from
the start scene, and gameplay updates use partial patches such as `ctx.state.set({ coins })`.
`main.ts` calls `acceptHotUpdate(game, import.meta.hot)` in development; seed the player in
`Level.enter()` from the JSON-shaped state fields you want to preserve. The scene graph,
physics world, audio, particles, and renderer are rebuilt on every update.

## Playtest resources

The playtest bridge registers exactly two resource ids for the JSON-safe game state: `state` is the
canonical id, and `GameState` is a compatibility alias for older scenarios. New scenarios,
including the ones shipped here, must use `state`; resource paths address fields from `ctx.state`.
Keep the alias until existing published scenarios have migrated, then remove it in a future
breaking release.

The state bridge flushes every 100 ms by default, so keep values a human reads — coins, hearts, or
terminal state — in `ctx.state`. Per-frame visual feedback belongs in scene-owned Three.js objects;
anything shorter than about 100 ms must not go through React. If an event must appear in the HUD,
give it a decay longer than one flush interval. `CharacterBody3D.moveAndSlide(dt)` queues motion
for the shared bulk physics step rather than moving its object immediately. Because
`THREE.Vector3` is mutable, use `const before = mesh.position.clone()` (or copy its `x`, `y`, and
`z` scalars) before the call, then compare `mesh.position.distanceTo(before)` on the next update,
after the step. Storing `mesh.position` itself aliases the live transform and reports zero.

Keep the palette to six named colours with exactly one `accent`, and import it from materials
and sky. Set camera framing, tonemapping and exposure deliberately; keep the rim light,
soft shadows with `normalBias`, sky-derived fog, and bloom through
`renderer.setOutputNode()`. These visual decisions belong in this generated project, not in
the framework packages. Run `pnpm visuals` when changing the render layer.

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


## Budget real time for the look

The automated gates are blind to how the game looks. **Budget real time for the look:** boot
the game, capture a headed screenshot, and inspect the silhouette, contact shadows, motion,
and HUD before calling a visual change done. Note that headless Chromium usually cannot render WebGPU;
use a real browser or browser tool, or
`npx @threenative/playtest <scenario> --browser-recipe webgpu --headed`, whose recipe carries
the flags a WebGPU capture needs — including `--enable-features=Vulkan`, without which
Chromium silently serves WebGPU from its CPU rasteriser. On a screenless machine start `Xvfb`
yourself rather than using `xvfb-run`, which replaces a successful command's exit status with
a failing one.
