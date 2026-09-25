# Offline CSG authoring

An opt-in standalone authoring example, not a core dependency or runtime destruction system.

```sh
cd examples/integrations/csg
npm install --ignore-scripts
npm test
npm run generate -- /absolute/path/to/game/assets/doorway.glb
```

The generator refuses overwrites. Run the game's ordinary asset cook next and use `ctx.assets.model('doorway.glb')`. Create collision from the authored LOD0 geometry. No CSG code is needed at runtime.

`evaluateSolid(left, right, 'subtract' | 'union' | 'intersect')` calls three-bvh-csg and preserves caller geometries/materials. `result.dispose()` releases output geometry only. `writeSolidGlb(result.mesh)` writes actual GLB bytes through glTF Transform, normalizing active draw ranges and material groups without DOM/FileReader shims.

The exporter admits static, untextured standard PBR solids with position/normal/UV/color attributes. Textures, physical materials, morph targets and interleaved buffers fail explicitly. Boolean inputs must be watertight; this is not a CAD validator or topology repair tool. Empty results cannot be exported as misleading original meshes.

`npm test` builds strict TypeScript, runs CPU contracts and then executes the real donor/GLB round-trip suite. Missing dependencies fail, never skip. The dedicated PR workflow runs it because root Vitest excludes examples.

Executed locally: 10 CPU tests passed after their failing baseline; the dependency-free module also passes strict TypeScript 5.8.3 checking. The complete `npm test` was attempted and failed at build because dependency downloads are unavailable. Donor, GLB, GPU, native, collision-playtest and full repository results are not claimed. Generate/review the lockfile and qualify inside the actual framework before merging. This standalone Three pin does not apply the framework renderer patch.

Three.js, three-bvh-csg and glTF Transform retain their own MIT notices as dependencies. No demo assets were copied; the geometry fixture is authored here.
