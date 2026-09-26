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

`treeToGlb(variant)` in src/export.ts writes that variant to one binary glTF: a `Tree` node with `branches` and `leaves` meshes, the baked `_wind` weight as the custom `_WIND` semantic (three's GLTFLoader hands an unknown semantic back lower-cased, so it arrives as `_wind`), and neutral `bark` (opaque) and `leaf` (alpha-masked at 0.5, double-sided) materials, so the game still owns the look. `node scripts/export-variants.mjs --out <existing dir> --seeds 11,23 [--config <module.mjs>]` writes `tree-<seed>.glb` per seed and refuses to create the output directory; the optional module default-exports `(options, seed) => void` in place of the default configure.

The published 1.1.0 JavaScript eagerly loads browser textures at import, which the real CI test caught. The build therefore bundles the inspected source revision `dcf309bd86bd521083d9c70f01f2de45fdc7c457` for Node, externalizing Three and retaining its license. That source accepts caller-supplied texture maps. The npm 1.1.0 dependency provides declarations only and its browser JavaScript is never imported. No fake document, image loader or browser globals are added. The source/build/declaration combination is covered by the unchanged real integration test and remains subject to its result.

`generateTree` also bakes a per-vertex `_wind` attribute into both meshes: each vertex's share of the tree's own height, measured in tree space before any cook, and `variant.height` is that height. That weight is what the wind reads, so the asset cook's per-mesh dequantization scale, its separate local frames and a local y=0 that is no longer the ground all stop mattering.

`createTreeWind(material, options)` in src/render/wind.ts is editable appearance source. All amplitude, frequency, phase, height and direction values are explicit; `amplitude` and `height` are world metres and `direction` is a world-space XZ heading, so the sway is the same number of metres at any node scale, including a cooked one. Call `updateTime` with simulation time and `expandBounds(geometry, minWorldScale)` on the owned geometry, where `minWorldScale` is the smallest world scale the mesh is drawn at (it defaults to 1): the box and sphere are recomputed and padded in place, because the engine's LOD levels share those very objects. Because the weight is tree-space, one options object per tree is safe for both bark and leaves, before or after a cook. Place a forest with `variant.root.clone()` (a plain Group). Cut leaves with `material.maskNode`; three's shadow pass reads it and the wind's `positionNode`, so shadows are dappled and sway with the canopy. The normal correction assumes a yaw plus a uniform node scale, which is what a placement and the cook produce.

Worked demo: the `grove` game in [ThreeNativeHQ/examples](https://github.com/ThreeNativeHQ/examples/tree/main/grove) copies these files into a scaffolded game, with a playtest that goes red when the wind stops. This first wind path supports ordinary static meshes only; instanced/skinned inputs fail at shader build. Static generated geometry can still use existing batching. Instanced wind, LOD selection and actual shadow/native screenshots remain open.

Executed locally: 19 index/wind/cook CPU tests passed after a failing baseline, including a finite-difference check of the displacement gradient in world height, and a culling sweep over 1 656 000 swayed vertices — every vertex of both meshes at 200 simulation times, for three yaws, three uniform world scales and a cook-style extra node scale — asserting each swayed point stays inside the `expandBounds` box and sphere while the world displacement never exceeds `amplitude`; dropping `minWorldScale` from that pad turns the sweep red at the first vertex. The dependency-free module passes strict TypeScript 5.8.3. CI has executed the strict dependency-backed build and CPU tests, and exposed the published donor's import-time DOM dependency; the source-build fix needs a fresh passing run. Integration vegetation runs the full npm test command on PR changes; GPU and native proof are separate. Generate/review a lockfile and test inside the framework's actual patched Three runtime before admission.

The glTF path was also executed on CPU only, not on a browser or device: seed 42 exports a 22 860-byte glTF that reads back element-for-element on POSITION, NORMAL, TEXCOORD_0, `_WIND` and indices, two exports of one seed are byte-identical, and a 250 281-vertex variant promotes both index buffers to Uint32 and round-trips exactly in 335 ms. The wind's TSL graph is built but not shader-compiled here: `npm test` is CPU-only, so the `_wind` and instanced/skinned guards fire on a device, not in this run.

EZ Tree, Three.js and glTF Transform retain their MIT notices. No demo textures or assets are copied. The game controls the look.

## Donor audit — 2026-09-26

- **Pin:** `github:dgreenheck/ez-tree#dcf309bd86bd521083d9c70f01f2de45fdc7c457`, MIT © 2024 Daniel Greenheck; its `package.json` names no runtime dependency besides Three. The npm `@dgreenheck/ez-tree@1.1.0` package supplies declarations only. `package-lock.json` pins the tree; `npm audit` reports 0 vulnerabilities.
- **Noise:** the donor's only third-party code is the Ashima Arts / Stefan Gustavson simplex-noise GLSL (MIT, github.com/ashima/webgl-noise) inside its `onBeforeCompile` wind shader. This integration discards donor materials and never runs that shader; the TSL wind here is original. The string still sits in the offline generator bundle, which a game built from cooked GLBs does not ship (see the grove's `check:no-generator`).
- **Textures:** `src/lib` references no image file; presets are JSON parameters and maps are caller-supplied. This integration copies no texture; the grove's leaves are a procedural cut-out.
