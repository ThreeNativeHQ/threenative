<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — Strata terrain preview

Read `/AGENTS.md` first. This example consumes build-baked arrays, not runtime recipes.

- Units are metres; Y is up; canonical heights are row-major Z then X, centred at zero.
- `scripts/bake.mjs` owns authoring. The game imports baked JSON and never evaluates terrain.
- Game appearance lives in `src/render/`; the ocean uses installed `SpectralOcean`.
- The ground's PBR maps are the CC0 starter sets in `packages/terrain/starter-assets/`, served
  through this example's Vite `publicDir` and loaded by `ctx.assets`; provenance is that folder's
  `credits.json`, and `src/render/terrain.ts` owns the layer, tile-size and blend choices.
- The forest, its undergrowth and its stone are the owner's licensed **Landscape Pro 2.0** pack,
  loaded by `src/render/pack.ts` out of this example's gitignored `local-assets/landscape-pro/`,
  which `scripts/prep-landscape-pro.mjs` copies from the Fab import; provenance and the licence
  constraint are in this example's `CREDITS.md`, and nothing licensed is ever committed. Every pack
  section keeps its own atlas; the rocks alone take the starter's triplanar stone, because the pack
  binds a packed data map as a base colour. `src/render/prepared.ts` loads the CC0 prepared art and
  its list is empty; the procedural spruce, boulder, fern, grass and poppy are the fallback a machine
  without the pack draws, and they must keep drawing.
- Use one `Heightfield` buffer for geometry and existing heightfield collision; do not resample.
- Ground contacts use actual mesh and physics queries. Bilinear heights are not triangle contacts.
- WASD/arrows move, Space jumps, C switches forest/coast, L changes sunlight. The player owns its camera.
- The live editor and resolved static-world export proof are implemented; final starter art, complete GUI tooling and baked-water export remain subsequent PRD work.

Run `pnpm --filter strata-terrain-preview test:terrain:web` and
`pnpm --filter strata-terrain-preview test:terrain:desktop` for the shared scenario.

Run `pnpm --filter strata-terrain-preview test:terrain:export` to produce the bounded
static PBR fixture and load it in an isolated vanilla Three.js project. Its checker
textures qualify interchange, not final starter art; unresolved river export first
fails, then the proof removes the river from its temporary document only.
Run `pnpm --filter strata-terrain-preview test:terrain:export:desktop` afterward to
load that same generated GLB in an ordinary native game with no authoring imports.
The native host must already be built; both runs use the existing playtest harness.
