# Credits and assets — strata-terrain-preview

## Temperate forest: Project Nature and Epic Games

The owner imported **Spruce Forest**, **Grass Library**, **Ground Foliage**,
**Meadow Flowers**, **Fern Collection** and **Conifer Bushes & Saplings 1** from Project Nature, and **Open World
Demo Collection / Kite Demo** from Epic Games, through the owner's entitled Fab
library. The per-pack `import-report.json` records source, entitlement and model provenance.
These are licensed source assets, not CC0 files.

**All licensed originals and cooked outputs are LOCAL-ONLY, gitignored, and never committed.**
Only the preparation script and game-owned rendering code are distributed.
Run from this example:

```sh
FAB_TEMPERATE=/path/to/imported/fab node scripts/prep-fab-temperate.mjs
```

The script reads the import reports and selects three full, two half and three small
spruces; four grasses; four flowers including a red poppy; three ground clumps;
two ferns; three Kite boulders, river rock, scree and `SM_Cliff01`; both
`SM_MountainRock` faces, four `LargeVolcanicRock` variants, both `SM_GroundRevealRock`
meshes and the `RockFace003` diffuse/normal/height ground maps. New rock textures are
bounded to 1K; Unreal's ground normal green channel is flipped for OpenGL. It repairs
Project Nature atlas bindings and composites each photographed opacity mask into
its albedo, then reuses `@threenative/assets` for meshopt geometry and compressed
textures. Duplicate sections are joined before cooking. Outputs live under
`local-assets/temperate/` with a 130 MB gate and Three.js's Apache-2.0 Basis transcoder.
Round 3 bounded `--worlds` cook measures 121.6 MiB (127.5 MB); the prior 120 MB cap rises by 10 MB for this
bounded rock selection. Licensed provenance remains in the owner's import reports.

Round 16 adds a bounded `--canopy` cook: the unthinned `ScotsPineTall_01`,
`SM_FieldGrass_01` with its recovered `T_FieldGrass_01_D` color/alpha atlas,
and `Spruce_08` with opacity from the blue channel of `Spruce_AORO`.
The pine keeps its authored alpha cutoff and 2K needle atlas; the sapling atlas is 1K.
The forest mixes full-crown pine with mature spruce, uses the new spruce at sapling
size, and grows the broad FieldGrass mat. Each optional addition falls back to the
previous species before procedural art. Coast retains its existing species.
The 130 MB gate counts unique live manifest payload, including shared images,
rather than obsolete hashes retained by incremental cooks.

`src/render/pack.ts` retains photographed material maps. Every section of a tree
uses the same whole-model scale and ground origin. `src/render/props.ts` draws
reduced copies of the full spruce meshes at distance using the existing instancing bands.
If the folder or a species is absent, procedural geometry and CC0 starter surfaces
continue to draw through the same placements. The licensed pack is optional.

## Landscape Pro 2.0 Auto-Generated Material, by STF3d

The earlier optional forest pack is **Landscape Pro 2.0 Auto-Generated
Material** on Fab, listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1` (paid, Personal/Professional
licence, owned by this repository's owner).

**Those files are not in this repository, and must not be.** The Fab Standard License does not permit
redistributing a paid pack's assets as standalone files, so what is committed is the importer and the
loader. `scripts/prep-landscape-pro.mjs` copies the earlier nine-species selection, plus the Basis
transcoder a cooked model decodes through, out of the owner's Fab import into this example's
gitignored `local-assets/landscape-pro/`:

```sh
node scripts/prep-landscape-pro.mjs            # from a cooked asset tree (the default)
node scripts/prep-landscape-pro.mjs --raw      # from the uncooked .glb import
```

It reads the owner's Wildwood sandbox by default and honours `LANDSCAPE_PRO=<dir>`. The source is
either that sandbox's `public/` — where the ThreeNative asset pipeline has already cooked this
listing, so a mesh is 5–215 KB of meshopt-compressed geometry with its images content-addressed under
`shared/images/` — or, with `--raw`, its `assets/fab/<listing>/Models/*.glb`, which draw identically
and cost 200 MB of downloads instead of 11.

**Without that folder the world still grows.** `src/render/pack.ts` fails soft per species and
`buildPropVariants` builds the procedural spruce, boulder, fern, grass and poppy in its place, which
is what CI, a fresh clone and any review get. That fallback is a live path, not a stub: the same
playtest runs green without the pack.

## Everything else

The ground's PBR maps, the fir and the prepared props are the CC0 sets in
`packages/terrain/starter-assets/`, served through this example's `publicDir`; provenance is that
folder's `credits.json`.

Use `node scripts/prep-fab-temperate.mjs --worlds` to update only crags/RockFace003.
It cooks into a separate staging output before merging; existing forest/coast species
and intentionally missing aliases remain untouched. The default command rebuilds the full set.
