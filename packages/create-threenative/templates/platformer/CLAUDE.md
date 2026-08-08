<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ platformer

This project is an editable Three.js platformer starter. The framework owns the loop,
input, renderer, physics bindings, and playtest bridge; this repository owns the feel,
level, entities, and look.

## Commands

```sh
pnpm dev
pnpm build
pnpm test
pnpm typecheck
```

## Where to work

- `src/entities/Character.ts` contains every movement and feel constant.
- `src/entities/Patrol.ts` is the ordinary scripted-route enemy; use `Chaser.ts` when an
  enemy should pursue a target across baked level geometry. Steering, aggro rules, and
  re-path cadence remain gameplay decisions in these classes.
- `src/entities/Pickup.ts` is an ordinary gameplay class.
- `src/level/` contains plain level helpers and checkpoint state.
- `src/render/` is ordinary Three.js source. It has no framework imports. The six baseline
  files are `palette.ts`, `camera.ts`, `sky.ts`, `lighting.ts`, `materials.ts`, and
  `postprocessing.ts`.
- `src/scenes/Level.ts` is the live caller that wires the pieces together.
- `playtests/` proves movement, collection, stomping, respawn, and one-way platforms.

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Put a
`.glb` in `public/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the player beside the entity that owns the loaded model.

Use Godot names for physics nodes: `CharacterBody3D`, `Area3D`, `RigidBody3D`, and
`CollisionShape3D`. Register persistent entities with `ctx.entities`; the framework clears
registered entities, scene objects, and physics nodes when a scene exits. Dispose a node
explicitly only when removing it during play. Feel belongs in the character, not in
`defineGame` options.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the character movement code.

`Level.static initialState` is the single initial-state value. `defineGame` discovers it from
the start scene, and gameplay updates use partial patches such as `ctx.state.set({ coins })`.
`main.ts` calls `acceptHotUpdate(game, import.meta.hot)` in development; seed the player in
`Level.enter()` from the JSON-shaped state fields you want to preserve. The scene graph,
physics world, audio, particles, and renderer are rebuilt on every update.

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
4. `asset_download_file` writes into `public/`; `audio_download_asset` is the audio path.
5. Append the file, its source, its license and its URL to `CREDITS.md` **before the turn
   ends**. Poly Haven requires a visible Poly Haven credit when its API is used, ambientCG is
   CC0 per asset page, and audio and bundle licenses are per pack.

**Never state a license you did not read off a tool result.** If `polyhaven_list_files` or
`ambientcg_search_assets` did not tell you, you do not know it.

The other tools are narrower, and the directory spells out the conditions on each. The Fab
tools talk to a marketplace: the server never purchases anything, and only directly-free files
download. `smithsonian_search_assets` returns museum scans at scan resolution, which this
project has no pipeline to decimate — that geometry is the wrong shape for a game. When in
doubt check `asset_search_sources` first; its `caution` and license fields are the current
truth for the pinned version, and they change between versions.

Load what you downloaded the ordinary way — `ctx.assets.model("crate.glb")`,
`ctx.assets.texture(...)`, `ctx.assets.audio(...)` — and write your own material and lighting
around it in `src/render/`. The framework ships no asset and picks none for you.

## Budget real time for the look

The automated gates are blind to how the game looks. **Budget real time for the look:** boot
the game, capture a headed screenshot under `xvfb-run`, and inspect the silhouette, contact
shadows, motion, and HUD before calling a visual change done. headless Chromium usually cannot render WebGPU; use a real browser or browser tool, or headed Playwright with
`--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist`.
