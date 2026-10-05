# Forest starter kit

A baked 512 m forest: real elevations, hydraulic erosion, a lake, a river, an access road, and
scatter for firs, boulders and ferns. It ships data only. The scene, the materials and the props
are yours.

`world.json` is the editable recipe: change `config.seed`, `config.size`, or any scatter layer's
`count`, `minDistance`, slope limits or `scale`, then re-run the bake. The same recipe always
produces the same arrays.

## Three steps

1. Copy `node_modules/@threenative/terrain/starter/forest` to `src/terrain/forest`.
2. Copy `node_modules/@threenative/terrain/starter-assets` to your asset source directory.
3. Run `node src/terrain/forest/bake.mjs` (needs `@threenative/terrain` as a devDependency).

The bake writes `baked.json` beside itself: `size`, `resolution`, `heights`, `colors`,
`placements`, `lakes`, `rivers` and `waterLevel`.

## Adding it to a scene

TODO(world.ts)