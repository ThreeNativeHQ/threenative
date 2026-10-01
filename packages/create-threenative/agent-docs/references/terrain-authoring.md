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

## Optional live terrain editor

Install the authoring dependency above; Vite remains the project's development
server. Save `terrain/world.json` as `{ "version": 1, "recipe": terrain.toJSON() }`.
Add the optional plugin to this project's Vite configuration:

```ts
import { resolve } from "node:path";
import { terrainEditor } from "@threenative/terrain/editor/server";

const editor = terrainEditor({ documentPath: resolve("terrain/world.json") });
// Add editor to the existing Vite plugins. Bind the server to 127.0.0.1/localhost.
// Add "@threenative/terrain/editor" to optimizeDeps.exclude so its adjacent
// evaluator worker remains a separate module.
```

The project supplies `/terrain-editor/index.html`. Its browser entry calls
`mountTerrainEditor` from `@threenative/terrain/editor` with `createView(host)` and
an explicit eight-channel material colour palette. Implement the exported
`IEditorView` around this game's ThreeNative scene and `src/render/` helpers; keep
that authoring entry separate from `src/game.ts`. The addon reuses the recovered
brush, layer, recipe, cancellation and data-export controls around that view.
It does not create a second renderer or silently choose the game's appearance.

After the server listens and the route is ready, `await editor.activate()` returns
`editorUrl`, `projectId`, `sessionId` and the current content-hashed `revision`.
The development server also prints the bound editor URL. Present that returned
link; do not invent a port or give a user `0.0.0.0`. On a remote machine, configure
`viewerUrl` with the existing port-forwarded editor URL; without forwarding the
loopback link is local to that machine. Activation probes the advertised route;
an unreachable or failed private forward returns an error. Only the explicitly
configured viewer host/origin is additionally trusted; the server still binds to
loopback.

An agent can edit the same document without clicking the GUI:

```ts
import { TerrainEditorController } from "@threenative/terrain/editor";

const controller = new TerrainEditorController(activation.editorUrl);
const current = await controller.snapshot();
await controller.commit({
  baseRevision: current.revision,
  commands: [{ op: "update", id: "hills", patch: { params: { amplitude: 35 } } }],
});
```

Stale bases conflict. Read the latest snapshot and merge the intended semantic
edit; do not overwrite another agent/human's work with an old document. Complete
atomic JSON saves also update the shared view. Invalid disk saves retain the last
valid preview and show a diagnostic; restore a valid save before submitting more
patches. Editor imports, workers, watchers and the document stay out of the game
runtime. Bake committed data before handing it to the game. The currently shipped
GLB action remains terrain-only; complete portable world export is in development.
