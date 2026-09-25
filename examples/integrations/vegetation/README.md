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

`createTreeWind(material, options)` in src/render/wind.ts is editable appearance source. All amplitude, frequency, phase, direction and envelope values are explicit. Call updateTime with simulation time and expandBounds on the owned geometry. This first wind path supports ordinary static meshes only; instanced/skinned inputs fail at shader build. Static generated geometry can still use existing batching. Instanced wind, GLB round-trip, LOD selection and actual shadow/native screenshots remain open.

Executed locally: 10 index/wind CPU tests passed after a failing baseline, including a finite-difference check of the displacement gradient. The dependency-free module passes strict TypeScript 5.8.3. Real EZ Tree/node-material tests and the dependency-backed build are written but unrun locally because downloads are unavailable. Integration vegetation runs the full npm test command on PR changes; GPU and native proof are separate. Generate/review a lockfile and test inside the framework's actual patched Three runtime before admission.

EZ Tree and Three.js remain MIT dependencies; no demo textures or assets are copied. The game controls the look.
