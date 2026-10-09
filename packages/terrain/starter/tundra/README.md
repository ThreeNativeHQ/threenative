# Tundra starter kit (bake only)

A 512 m low-relief tundra on a real survey (USGS 1 m DEM, Colorado), with hydraulic and thermal
erosion, two meltwater rivers, two kettle lakes, moss ground with snow and rock, and boulder
erratics. It is game source: once copied, every file is yours to edit.

| File | What it decides |
| --- | --- |
| `recipe.json` | The terrain: the survey heightmap, erosion, the kettle beds, the two rivers, the two lakes, the surfaces and the erratics. |
| `assets.json` | The boulder model, its LOD distance and draw distance, and its bounds. |
| `surface.json` | The ground: the moss base, the snow and rock layers, tiles, tints and blend thresholds. |
| `bake.mjs` | Writes the world package and `world/water.json` (the rivers and lakes) from the three files above. |

Art is CC0 (Poly Haven); provenance is in `@threenative/terrain/starter-assets/credits.json`.

## Status

This kit bakes and writes its water. It has no scene, water look, kettle ice surface, collider or
playtest yet. Until `world.ts`, `sky.ts` and the water look exist, a game cannot add it to a scene.

## Steps

1. Copy `node_modules/@threenative/terrain/starter/tundra` to `src/terrain/tundra`.
2. Run `node src/terrain/tundra/bake.mjs --out assets/terrain/tundra` (needs `@threenative/terrain`
   as a devDependency). The same recipe always writes the same bytes.
