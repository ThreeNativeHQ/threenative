# Desert starter kit (bake only, placeholder scatter)

A 512 m desert on a real survey (USGS 1 m DEM, Colorado), with hydraulic and thermal erosion, sand
on the low ground, dirt patches, rock on the steep ground and a scatter of 140 props. It is game
source: once copied, every file is yours to edit.

| File | What it decides |
| --- | --- |
| `recipe.json` | The terrain: the survey heightmap, erosion, the sand, dirt and rock surfaces, and the scatter. |
| `assets.json` | The boulder model, its LOD distance and draw distance, and its bounds. |
| `surface.json` | The ground: the sand base, the dirt and rock layers, tiles, tints and blend thresholds. |
| `bake.mjs` | Writes the world package and `world/water.json` from the three files above. |

Art is CC0 (Poly Haven); provenance is in `@threenative/terrain/starter-assets/credits.json`.

## Placeholder

The preview's desert scrub is drawn from generated cards, and the starter assets do not ship a CC0
shrub model. Until one is added, this kit scatters the CC0 boulder in the scrub's place, with the
same count, spacing and slope limits. The result does not look like the preview's desert. Replace the
`scrub` entry in `recipe.json` and the boulder row in `assets.json` with a CC0 shrub model to fix it.

## Status

This kit bakes. It has no scene, colliders, playtest or judge yet. Until `world.ts` and `sky.ts`
exist, a game cannot add it to a scene.

## Steps

1. Copy `node_modules/@threenative/terrain/starter/desert` to `src/terrain/desert`.
2. Run `node src/terrain/desert/bake.mjs --out assets/terrain/desert` (needs `@threenative/terrain`
   as a devDependency). The same recipe always writes the same bytes.
