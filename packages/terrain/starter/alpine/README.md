# Alpine starter kit (bake only)

A 512 m alpine headwall on a real survey (USGS 1 m DEM, Longs Peak, Colorado), with hydraulic and
thermal erosion, rock base, dirt on slopes, snow on the high steep ground and boulder scree. It is
game source: once copied, every file is yours to edit.

| File | What it decides |
| --- | --- |
| `recipe.json` | The terrain: the survey heightmap, erosion, the rock, dirt and snow surfaces, and the scree. |
| `assets.json` | The boulder model, its LOD distance and draw distance, and its bounds. |
| `surface.json` | The ground: the rock base, the dirt and snow layers, tiles, tints and blend thresholds. |
| `bake.mjs` | Writes the world package from the three files above. |

Art is CC0 (Poly Haven); provenance is in `@threenative/terrain/starter-assets/credits.json`.

## Status

This kit bakes. It has no scene, collider, water or playtest yet: a game cannot add it to a scene
until `world.ts` and `sky.ts` are written the way the forest kit has them.

## Steps

1. Copy `node_modules/@threenative/terrain/starter/alpine` to `src/terrain/alpine`.
2. Run `node src/terrain/alpine/bake.mjs --out assets/terrain/alpine` (needs `@threenative/terrain`
   as a devDependency). The same recipe always writes the same bytes.
