# Optional terrain authoring

For authored terrain, install `@threenative/terrain` as a development dependency:

```sh
npm install --save-dev @threenative/terrain
```

Search `engine_search_capabilities` for terrain authoring and inspect the returned
`engine_capability_detail` before creating a terrain generator. Use the installed
terrain operations rather than writing noise, erosion, masks, roads or rivers again.

## Generate once, play the bake

Run this in an authoring/build script, outside the game loop:

```js
import { Terrain, Mask, bakeMesh, bakeTerrain } from "@threenative/terrain";

const terrain = new Terrain({ size: 512, resolution: 257, seed: 42 })
  .noise({ id: "hills", amplitude: 30, scale: 180 })
  .flatten({ id: "spawn", height: 8, mask: Mask.circle([0, 0], 12) });
const state = terrain.evaluate();
const mesh = bakeMesh(state);
const collision = bakeTerrain(state).collision;
```

Persist the recipe with `terrain.toJSON()` for later editing, and save the baked
arrays for the game. Stable layer IDs let an agent replace an operation instead of
appending duplicate layers. `Terrain.fromJSON(recipe)` restores the authored stack;
`terrain.applyPatch(commands)` applies a validated edit atomically.

## Keep the game's appearance editable

`toGeometry(mesh)` from `@threenative/terrain/three` creates an ordinary caller-owned
Three.js `BufferGeometry`. Choose its material, lighting, water and vegetation in
this game's `src/render/`. Colours are only baked when you provide an explicit
palette; the package does not choose a material or a renderer. Dispose the geometry
and material when the scene releases them.

For collision, reuse `Heightfield` from `@threenative/core/world` and
`CollisionShape3D.heightfield` from `@threenative/physics`. Supply the same baked
height samples and extent to rendering and collision. Heightfield dimensions count
vertices; `toColliderHeights()` converts the canonical row-major samples once for
Rapier. One unit is one metre. Bilinear `heightAt()` is an interpolation aid; compare
actual triangles and physics contacts when verifying ground alignment.

Keep terrain evaluation, erosion and editor tooling out of the shipped game graph.
The runtime consumes baked arrays and assets. The legacy `encodeGLB`/`makeExport`
terrain export contains the terrain mesh only; it is not a full-world export of
vegetation, rocks, water and imported assets.
