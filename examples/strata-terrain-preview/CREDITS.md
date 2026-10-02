# Credits and assets — strata-terrain-preview

## Landscape Pro 2.0 Auto-Generated Material, by STF3d

The forest's trees, shrubs, ground cover and boulders are **Landscape Pro 2.0 Auto-Generated
Material** on Fab, listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1` (paid, Personal/Professional
licence, owned by this repository's owner).

**Those files are not in this repository, and must not be.** The Fab Standard License does not permit
redistributing a paid pack's assets as standalone files, so what is committed is the importer and the
loader. `scripts/prep-landscape-pro.mjs` copies the nine species this world grows, plus the Basis
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