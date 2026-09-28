# csg-doorway

Proof that a TypeScript-authored Boolean model reaches a playable game through the **ordinary**
asset path: the [CSG authoring integration](../../integrations/csg) writes `assets/doorway.glb`, the
normal cook compiles it, and `ctx.assets.model("doorway.glb")` loads the cooked GLB. No CSG
generator, no `three-bvh-csg`, and no authoring dependency is present in this game or its bundle.

## What this proves

`src/scenes/Doorway.ts` loads the cooked model, adds it to the scene, and builds fixed trimesh
collision from its LOD0 geometry with the engine's own `buildStaticColliders`. Two walkers then
cross the wall in +Z:

- one at `x = 0` passes through the 1 m opening;
- one at `x = -1.5` is stopped by the intact wall.

Four ray observations are published as scene state. Two cast against the **rendered** mesh
(`ctx.raycast`) and two against the **cooked collision** (`ctx.physics.directSpaceState
.intersectRay`, doorway layer only). The opening is a miss and the intact wall is a hit on both
sides, which is the rendered-opening == collision-opening agreement the PRD asks for.

## Commands

```sh
# Regenerate the authored source, then run the ordinary cook during dev.
node ../integrations/csg/dist/generate.js "$PWD/assets/doorway.glb"   # refuses to overwrite

pnpm dev                             # cook + serve
pnpm typecheck
pnpm build:native                    # desktop JS bundle into dist/
```

The desktop and Android scenarios assert the same resources. Pass the packed host explicitly on
desktop:

```sh
node ../../packages/playtest/dist/runner/cli.js playtests/doorway-desktop.playtest.json \
  --target desktop --project . \
  --executable packages/runtime-native/build/tn-linux/mystral \
  --host-arg run --host-arg dist/csg-doorway-native.js
```

The runner names its own adapter in `artifacts/playtest/console.json` (`[WebGPU] Adapter: …`).
