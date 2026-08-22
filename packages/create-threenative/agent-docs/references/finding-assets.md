# Finding assets — the full MCP tool loop

Companion to the short `Finding assets` section in this project's `AGENTS.md`. Reach for the
asset tools when the asset is conventional; build anything specific to this game yourself in
`src/render/`. A fetched asset has to match what the game needs, not merely exist.

Installing `@threenative/core` writes the `.mcp.json` that launches `threenative-asset-mcp`, so
your host lists its tools alongside your own. Your host reads that file from the directory it was
launched in: start the session in this project, not in a parent of it. It advertises 32; these 8
are the loop you will use for nearly everything:

1. `asset_search_sources` — start here, never at a provider. It returns every catalogued
   source with its license summary, attribution requirement, browse URL, and whether an agent
   can complete a download from it. **That output is the authority on what is reachable** —
   not your memory of some other project.
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

## What arrives is usually a ZIP, not a texture

ambientCG and Kenney ship archives: unpack one, keep only the maps you actually use (`_Color`,
`_NormalGL`, `_Roughness` — not the `.blend`, `.usdc` or displacement), and put those beside
your code under `public/`. A 1K JPEG set is right for a game; the 8K set of the same material
is 200 MB.

## Two argument shapes that bite

Both learned the hard way: `ambientcg_search_assets` takes lowercase `type` values (`material`,
`hdri`, `3d-model`), and the audio catalog is **pack-level** — `audio_search_assets` matches
pack names, so `query: "pickup coin"` returns nothing while `kind: "sfx"` returns the packs
that exist. Pick a pack, download it, unzip it, and choose a file yourself.

## The narrower tools

The directory spells out the conditions on each. The Fab tools talk to a marketplace: the
server never purchases anything, and only directly-free files download.
`smithsonian_search_assets` returns museum scans at scan resolution, which this project has no
pipeline to decimate — that geometry is the wrong shape for a game. When in doubt check
`asset_search_sources` first; its `caution` and license fields are the current truth for the
pinned version, and they change between versions.

Load what you downloaded the ordinary way — `ctx.assets.model("crate.glb")`,
`ctx.assets.texture(...)`, `ctx.assets.audio(...)` — and write your own material and lighting
around it in `src/render/`. The framework ships no asset and picks none for you.
