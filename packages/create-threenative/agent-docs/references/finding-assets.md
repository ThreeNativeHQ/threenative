# Finding assets — the full MCP tool loop

Companion to the short `Finding assets` section in this project's `AGENTS.md`. Reach for the
asset tools when the asset is conventional; build anything specific to this game yourself in
`src/render/`. A fetched asset has to match what the game needs, not merely exist.

Installing `@threenative/core` writes the `.mcp.json` that launches `threenative-asset-mcp`, so
your host lists its tools alongside your own. Your host reads that file from the directory it was
launched in: start the session in this project, not in a parent of it. It advertises 34; these 8
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

**For a Poly Haven *model*, steps 3-4 collapse into `polyhaven_import_model`.** Poly Haven
publishes models as a `.gltf` beside a `.bin` and loose texture files and **never as a `.glb`**, so
doing it by hand means fetching five to eight URLs and rebuilding the directory layout the glTF's
relative URIs expect before anything will load. Pass `assetId`, an `outputPath` ending in `.glb`,
a `resolution` (it defaults to `1k`, which is what a game floor wants), and `acceptLicense: true`;
it downloads through the same guarded path, packs one self-contained GLB that
`ctx.assets.model()` loads directly, and returns **triangle count and per-texture dimensions** —
the two numbers `create-threenative inspect` does not report and that every triangle and texture
budget is written in. Ask for a resolution the asset does not publish and it names the ones that
exist. Textures and HDRIs still use `asset_download_file`.

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

## Fab: searching, and importing an Unreal asset you own

Most Fab listings ship Unreal-only — 272 `.uasset` files and no `.glb` anywhere — so Fab is two
steps, not one: find the listing, then convert it.

**1. Search free first.** `fab_search_assets` talks to Fab's public API anonymously; no account is
involved. Its default `priceMode: "free"` is the right default and should stay your first query —
a free asset is one anybody who clones this project can fetch too.

```jsonc
// fab_search_assets
{
  "query": "cave rocks",
  "formats": ["unreal-engine"],  // "gltf", "fbx", "obj", "unity" ... omit for every format
  "priceMode": "any",            // SEE BELOW — the default is "free"
  "sort": "relevance",           // or rating, newest, price_asc, recently_updated
  "limit": 24
}
```

**Then look at what the account already owns.** A paid listing sitting in the library costs
nothing further to use, and it will never appear in a free search — `priceMode: "free"` returns a
different result set than `"any"` does. `fab_list_owned` answers that directly, without guessing
at search terms:

```jsonc
// fab_list_owned
{ "unrealOnly": true, "query": "vegetation" }   // both optional; unrealOnly drops engine installs
                                                // and plugins the importer cannot take
// -> [{ listingId, title, url, categories, engineVersions, hasUnrealArtifact }]
```

Reach for `priceMode: "any"` in `fab_search_assets` only when you mean to look at paid listings
the account does *not* own yet — buying is not something these tools can do for you.

Each item carries a `title` and an `id` — that `id` is the listing UID the next two tools take.
`fab_list_filters` returns the usable `formats`, `categories` and `tags` slugs; guessing them
silently narrows the search instead of erroring.

**2. Check the licence.** Search results carry **no licence** — Fab's search endpoint omits it, so
every item comes back with an empty `licenses` array. `fab_get_asset` is where the slugs live:

```jsonc
{ "listingIdOrUrl": "75f42402-40bb-4a1b-b557-18e2c9604273" }
// -> licenses: [{ slug: "personal" }, { slug: "professional" }], freeLicenseSlugs: [...]
```

**3. Import.** `fab_import_asset` verifies the entitlement itself, downloads through the FabCLI
session, converts every static mesh, and writes source GLBs into your `assets/`:

```jsonc
// fab_import_asset
{
  "listingIdOrUrl": "https://www.fab.com/listings/<uid>",
  "outputDir": "assets/fab/soul-cave",
  "packages": ["SM_S_Soul_Statue"],   // omit to convert every static mesh — packs run to gigabytes
  "maxTextureSize": 2048,             // omit to keep Unreal's own resolution
  "acceptFabEula": true
}
```

Then load the returned path the ordinary way:
`ctx.assets.model("fab/soul-cave/.../SM_S_Soul_Statue.glb")`. The normal asset compiler picks the
GLBs up from `assets/` with no extra configuration.

What the import will and will not do:

- **A pack of uncooked editor assets cannot be converted at all**, and this is the common case for
  marketplace packs, which ship as Unreal *source* projects. Cooking is what writes the renderable
  vertex and index buffers into the file; an uncooked package keeps only the editable source mesh
  and lets the editor derive the rest, so there is no geometry for UE Viewer to read. The import
  detects this and fails `UNREAL_SOURCE_UNCOOKED` naming the evidence it found —
  `/Script/UnrealEd`, `AssetImportData`, `SourceModels`. **Believe it and stop.** No engine
  version, `packages` filter or flag changes the answer, and the download is gigabytes each time
  you try. The only route to those meshes is opening the pack in Unreal Editor and exporting FBX
  or glTF yourself. Prefer a listing that ships a non-Unreal format, and treat one that does not as
  a likely dead end before you spend the bandwidth.
- **A free listing still has to be in the library first.** `fab_import_asset` refuses with
  `FABCLI_NOT_OWNED` until the listing is claimed, and it never claims — by design. Run
  `fabcli claim <uid>` yourself, which needs the interactive `fabcli auth login` session rather
  than the API token `fabcli auth status` reports as authenticated. Note also that `fab_get_asset`
  reports a free CC-BY offer as `isFree: false` with an empty `freeLicenseSlugs`; the listing
  appearing in `fab_search_assets` with `priceMode: "free"` at `startingPrice.amount: 0` is the
  reliable signal, so check the search before concluding a listing costs money.
- **Only assets you already own**, and only under **Fab Standard (Personal or Professional) or
  CC-BY**. Unreal-Engine-only and legacy entitlements are refused, and a licence it cannot read is
  refused too. It never logs in, claims, or purchases — run `fabcli auth login` yourself once.
  Searching and `fab_get_asset` stay anonymous, so the licence check never depends on the
  authenticated path it is guarding.
- **Two external tools install themselves on first use** (FabCLI and UE Viewer). Set
  `THREENATIVE_TOOLCHAIN_AUTOINSTALL=0` to require you install them instead. Linux and Windows only.
- **`packages` is not optional in practice.** A marketplace pack converts to many gigabytes of
  GLBs; name the handful of meshes your scene uses. Run it once without `packages` against a
  scratch directory if you need to see what a pack contains, then re-run with the names.
- **Read `import-report.json` before trusting the result.** It reports `materials: "complete"` or
  `"degraded"`, counts textured against total sections, and names every mesh it skipped and every
  texture it could not map. Unreal shader graphs have no glTF equivalent, so some sections arrive
  with a neutral grey and say so. `.umap` levels, Blueprints, Niagara and foliage placement are
  reported as unsupported, never silently dropped.
- `asset_import_unreal` takes a local `sourceDir` instead of a listing, for a pack you already
  downloaded by any means.

`fab_download_free_asset` is the unrelated older path: it downloads a directly-available free
`glb`/`fbx`/`obj`/`unity` file with no account at all. Use it when the listing already ships a
format you can load, and the importer only when it does not.

## The narrower tools

The directory spells out the conditions on each. The Fab tools are covered above; the server
never purchases anything on any path. `smithsonian_search_assets` returns museum scans at scan resolution, which this project has no
pipeline to decimate — that geometry is the wrong shape for a game. When in doubt check
`asset_search_sources` first; its `caution` and license fields are the current truth for the
pinned version, and they change between versions.

Load what you downloaded the ordinary way — `ctx.assets.model("crate.glb")`,
`ctx.assets.texture(...)`, `ctx.assets.audio(...)` — and write your own material and lighting
around it in `src/render/`. The framework ships no asset and picks none for you.
