# Forest starter kit

A baked 512 m forest: real elevations, hydraulic erosion, a lake, a river, an access road, and
scatter for firs and boulders. It ships data only. The scene, the materials and the props are
yours.

`recipe.json` is the editable recipe: change `config.seed`, `config.size`, or any scatter layer's
`count`, `minDistance`, slope limits or `scale`, then re-run the bake. The same recipe always
produces the same package. `assets.json` names each prop's two models, its LOD distance, its cull
distance and its authored bounds; `surface.json` is the terrain table `loadTerrainSplat` reads.

## Three steps

1. Copy `node_modules/@threenative/terrain/starter/forest` to `src/terrain/forest`.
2. Run `node src/terrain/forest/bake.mjs` (needs `@threenative/terrain` as a devDependency).
3. Copy the `world/` folder it wrote into the game's asset source as `terrain/forest/`.

The bake writes a self-contained world package into `world/`: `world.json`, `heightmap.u16`,
`placements.bin`, `splat.rgba`, `terrain-table.json`, `models/` and `textures/`. It reads the CC0
models and JPGs from the installed `@threenative/terrain/starter-assets`, so nothing has to be
copied by hand; pass `--assets <dir>` to read them from somewhere else, and `--out <dir>` to write
the package somewhere other than `world/`.

## Adding it to a scene

TODO(world.ts)