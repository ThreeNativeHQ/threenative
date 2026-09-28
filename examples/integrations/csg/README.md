# Offline CSG authoring

An opt-in standalone authoring example, not a core dependency or runtime destruction system.

```sh
cd examples/integrations/csg
npm install --ignore-scripts
npm test
npm run generate -- /absolute/path/to/game/assets/doorway.glb
```

The generator refuses overwrites. Run the game's ordinary asset cook next and use `ctx.assets.model('doorway.glb')`. Create collision from the authored LOD0 geometry. The generated GLB does not require the authoring program to load it; `examples/csg-doorway` qualifies the complete engine cook, collision and platform route.

`evaluateSolid(left, right, 'subtract' | 'union' | 'intersect')` calls three-bvh-csg with owned scratch geometry. Caller geometries and shared materials retain their lifetime. `result.dispose()` releases output geometry only and is idempotent. The evaluation target is owned before the donor runs, so a thrown evaluation also reaches cleanup.

`writeSolidGlb(result.mesh)` writes GLB bytes through glTF Transform without DOM/FileReader shims. It compacts active triangles and groups, bakes world transforms with corrected winding for reflections, and retains Three.js single-material group behavior.

## Admitted inputs

Use static, untextured standard PBR solids. Position and normal attributes have three components, UVs two, and colors three or four. Unknown glTF semantics, malformed layouts, non-finite float32 values and invalid PBR factors fail explicitly. Base color, opacity, metalness, roughness, alpha cutoff and the final emissive factor must fit the supported glTF ranges; HDR emissive-strength extensions are not supplied.

Textures, physical materials, BackSide, morph targets and interleaved buffers are not admitted. Boolean inputs must be watertight; this is not a CAD validator or topology repair tool. Empty results cannot be exported as misleading original meshes.

## Checks

`npm test` builds strict TypeScript, runs 13 dependency-free contracts and then the 34 configured donor/export/CLI cases. These include Khronos GLB validation, actual Three.js GLTFLoader readback, reflected winding, indexed/nonindexed active material groups, normalized colors, invalid-input diagnostics and failure/disposal paths. Missing dependencies fail, never skip. `npm run test:contracts` can run the CPU-only subset without downloading the donor.

The dedicated workflow runs on relevant PRs and pushes because root Vitest excludes examples. Every phase and acceptance box of the [PRD](../../../docs/PRDs/done/PRD-threejs-csg-cook.md) is ticked with its evidence; the lockfile is committed. The standalone Three pin does not apply the framework renderer patch.

The installed dependencies retain their own license notices. No demo assets were copied; the geometry fixtures are authored here. The Khronos validator is a development dependency, not part of asset generation or runtime loading.
