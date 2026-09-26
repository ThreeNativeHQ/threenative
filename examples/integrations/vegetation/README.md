# Procedural vegetation source

Opt-in EZ Tree generation with game-owned materials, not a new world streamer or engine forest preset.

```sh
cd examples/integrations/vegetation
npm install --ignore-scripts
npm test
```

```ts
const variant = generateTree({
  seed: 42, maxVertices: 100_000, trunkMaterial, leafMaterial,
  configure(options) { options.branch.levels = 2; },
});
scene.add(variant.root);
variant.dispose(); // after all users of the generated buffers have released them
```

Generation validates an authoring budget before work and checks the actual output. It repairs indices from the donor's raw numeric index lists, before Uint16 truncation can hide overflow. Caller materials/textures remain caller-owned; donor-created GLSL materials are discarded. Use the existing authoring exporter and asset cook for finished variants; no second cache is installed.

`treeToGlb(variant)` in src/export.ts writes that variant to one binary glTF: a `Tree` node with `branches` and `leaves` meshes and neutral `bark` (opaque) and `leaf` (alpha-masked at 0.5, double-sided) materials, so the game still owns the look. `node scripts/export-variants.mjs --out <existing dir> --seeds 11,23 [--config <module.mjs>]` writes `tree-<seed>.glb` per seed and refuses to create the output directory; the optional module default-exports `(options, seed) => void` in place of the default configure.

The published 1.1.0 JavaScript eagerly loads browser textures at import, which the real CI test caught. The build therefore bundles the inspected source revision `dcf309bd86bd521083d9c70f01f2de45fdc7c457` for Node, externalizing Three and retaining its license. That source accepts caller-supplied texture maps. The npm 1.1.0 dependency provides declarations only and its browser JavaScript is never imported. No fake document, image loader or browser globals are added. The source/build/declaration combination is covered by the unchanged real integration test and remains subject to its result.

`createTreeWind(material, options)` in src/render/wind.ts is editable appearance source. All amplitude, frequency, phase, direction and envelope values are explicit; direction is world space, the rest are the mesh's local units. Call updateTime with simulation time and expandBounds on the owned geometry. Give a variant's bark and leaves the same wind options, or leaves slide off their twigs. Place a forest with `variant.root.clone()` (a plain Group). Cut leaves with `material.maskNode`; three's shadow pass reads it and the wind's `positionNode`, so shadows are dappled and sway with the canopy.

Worked demo: the `grove` game in [ThreeNativeHQ/examples](https://github.com/ThreeNativeHQ/examples/tree/main/grove) copies these files into a scaffolded game, with a playtest that goes red when the wind stops. This first wind path supports ordinary static meshes only; instanced/skinned inputs fail at shader build. Static generated geometry can still use existing batching. Instanced wind, LOD selection and actual shadow/native screenshots remain open.

Executed locally: 10 index/wind CPU tests passed after a failing baseline, including a finite-difference check of the displacement gradient. The dependency-free module passes strict TypeScript 5.8.3. CI has executed the strict dependency-backed build and CPU tests, and exposed the published donor's import-time DOM dependency; the source-build fix needs a fresh passing run. Integration vegetation runs the full npm test command on PR changes; GPU and native proof are separate. Generate/review a lockfile and test inside the framework's actual patched Three runtime before admission.

The glTF path was also executed on CPU only, not on a browser or device: seed 42 exports a 20 788-byte glTF that reads back element-for-element on POSITION, NORMAL, TEXCOORD_0 and indices, two exports of one seed are byte-identical, and a 250 281-vertex variant promotes both index buffers to Uint32 and round-trips exactly in 335 ms.

EZ Tree, Three.js and glTF Transform retain their MIT notices. No demo textures or assets are copied. The game controls the look.
