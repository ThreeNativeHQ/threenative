# N22 — three.js surface coverage, ranked by real-game use

**Status:** PROPOSED — the children carry the boxes; this file has none.
**Work package:** N20 support — [native-engine batch](../README.md)

Owner goal (2026-10-08): "our end goal should be running any threejs goal on wasm/perry/native
without problems + blazing fast performance." This folder turns that goal into ranked engine work.
The corpus is 15 real games: the 13 templates in `packages/create-threenative/templates/`,
Midway Open Pacific and Bayview. Midway and Bayview are separate sandbox repositories. This
repository cites them by name and API only, and never copies their source or assets.

The work is four PRDs, not one, because the batch rule allows at most 3 phases and about 8 boxes
per PRD ([`docs/PRDs/AGENTS.md`](../../AGENTS.md), R5).

| Key | PRD | Depends on |
| --- | --- | --- |
| N22a | [PRD-541 — Corpus games construct the instancing and primitive classes they import](PRD-541-n22a-instancing-and-primitives.md) | [PRD-508](../../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md), [PRD-514](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) |
| N22b | [PRD-542 — Corpus materials and textures match three r185](PRD-542-n22b-materials-and-textures.md) | PRD-514, [PRD-509](../../done/native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md) |
| N22c | [PRD-543 — Corpus TSL reaches the screen, the vertex stage and the shared name table](PRD-543-n22c-screen-reads-vertex-stage-and-tsl-names.md) | [PRD-510](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md), [PRD-523](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md) |
| N22d | [PRD-544 — Corpus uniforms, post parameters and loaders behave as three r185](PRD-544-n22d-uniforms-post-parameters-and-loaders.md) | PRD-510, [PRD-526](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-526-n14d-post-effects-and-render-chains-run-native.md), [PRD-515](../../done/native-engine/PRD-515-n10-native-gltf-cooked-assets-and-decoders.md) |

The four PRDs are independent and can run in parallel. Each one names the done PRD that each box
extends.

## The rule: one engine, two language back ends

Every gap is implemented once, in the shared C++ engine (`packages/runtime-native/src/engine`),
and reaches the language back ends through the shared binding registry and `tn_tsl_call`. The V8
back end ([PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md)) and the browser back end over Wasm
([PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md)) then get it with no second
implementation. A box that needs JavaScript in one back end only is back-end work: it goes to
PRD-531 or PRD-540, not here. Each gap lives in exactly one box.

## How the ranking was measured (2026-10-08)

- **Imports.** `unsupportedThreeImports` (`tools/native-typescript/run-corpus.mjs`) ran over each
  game's `src/` and over `packages/core/src` against `packages/three-native/api/catalog.json`
  (495 entries). A namespace import (`import * as THREE`) was expanded to its `THREE.X` reads, and
  `three/addons/*` paths were listed apart.
- **Members.** A word search for each candidate member, method and TSL name, with its catalog
  status. A word match is a candidate, not proof: each box's proof decides.
- **Limits.** The catalog follows the native registry. The browser back end implements some names
  in JavaScript that the catalog still marks unsupported (for example `CanvasTexture` in
  `packages/three-native/src/texture-sources.ts`). TSL names are also checked against the string
  literals in the engine's TSL table (`abi/tsl_call.cpp`, `shader/ir.cpp`,
  `shader/graph/serialized.cpp`).
- **Order.** Rank by the number of corpus games that use the gap directly. "core" means
  `@threenative/core` uses it, so every game that turns that feature on reaches it. A tie goes to
  the gap that stops boot over the one that changes only pixels. A row ranked `—` is a fault
  whose users a static scan cannot count.

## Ranked gaps

| Rank | Gap | Corpus users (games) | Effect | Box |
| --- | --- | --- | --- | --- |
| 1 | Texture format, type, filter, wrap, colour-space and mapping constants that the catalog marks `partial` (`native-not-implemented`) | 15: `RGBAFormat` 15, `UnsignedByteType` 14, `EquirectangularReflectionMapping` 14, `FloatType`/`NearestFilter`/`SRGBColorSpace`/`NoToneMapping` 13, `ClampToEdgeWrapping` 12, `RepeatWrapping` 11, `LinearMipmapLinearFilter` 9; core | pixels | PRD-542 |
| 2 | `resolutionScale` and `bloom()` strength/radius/threshold do nothing after the first render | 14: 13 templates, Midway | pixels | PRD-544 |
| 3 | `CanvasTexture` is not an engine class: V8 refuses it, and the browser back end makes a one-mip `DataTexture` | 13: 11 templates, Midway, Bayview | boot on V8 | PRD-542 |
| 4 | Post and render-texture graphs keep a copy of their uniforms from lowering | 13 templates (post chain) | pixels | PRD-544 |
| 5 | `Material.prototype.onBeforeCompile` and `customProgramCacheKey` reads | 12 templates (`src/render/materialAssignments.ts`, `backlightMaterial.ts`); core | boot | PRD-542 |
| 6 | `normalWorld` on a `DoubleSide` material does not flip back faces, and ignores `normalNode` and a normal map | 9 use `DoubleSide`; 4 of them read `normalWorld` (Midway, rts, sailing, snow) | pixels | PRD-542 |
| 7 | Geometry classes: `IcosahedronGeometry` 4, `CapsuleGeometry` 3, `DodecahedronGeometry` 2, `OctahedronGeometry` 2, `TorusKnotGeometry` 2 | 7: Bayview, platformer, racing, rts, shooter, snow, tower-defense | boot | PRD-541 |
| 8 | TSL names missing from the shared table: `atan` 3, `hash` 3, `mod` 2, `time` 2; Bayview's `mx_fractal_noise_float`, `normalMap`, `normalWorldGeometry`, `saturation`, `triplanarTexture` | 5: action-rpg, rain, runner, snow, Bayview | boot | PRD-543 |
| 9 | `vertexColors` | 5: platformer, shooter, snow, Midway, Bayview; core impostors | pixels | PRD-542 |
| 10 | Depth reads: `viewportLinearDepth`, `linearDepth`, `cameraNear`, `cameraFar` | 3: starter, rain, Midway (core `water-surface.ts`) | boot | PRD-543 |
| 11 | `Line`, `LineSegments`, `LineBasicMaterial` | 3: Bayview, shooter, snow; core | boot | PRD-541 |
| 12 | `material.vertexNode` has no graph slot | 3: rain, shooter, Midway; core `world-cells.ts` | pixels | PRD-541 |
| 13 | `InstancedMesh.instanceColor` setter | 3: rts, tower-defense, Midway; core | pixels | PRD-541 |
| 14 | `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` (in progress, lane-midway-native) | 3: shooter, Midway, Bayview | pixels | PRD-542 |
| 15 | `InstancedBufferGeometry` and `instanceCount` (in progress, lane-wasm-templates) | 2: rain, Midway; core `projection-skinned.ts`, `world-cells.ts` | boot | PRD-541 |
| 16 | `SkeletonUtils.clone` over engine skinned meshes | 2: shooter, Bayview; core | boot | PRD-544 |
| 17 | `viewportSharedTexture`, `viewportDepthTexture` | 1: Midway (core `water-surface.ts`, `world-cells.ts`) | boot | PRD-543 |
| 18 | `Data3DTexture` and `texture3D` | 1: rain; core `fluid-particles.ts`, `render/probe-volume.ts` | boot | PRD-542 |
| 19 | Midway only: ocean `colorNode` lowers to invalid WGSL; `texture(object).level()` in a `positionNode`; the shadow-depth pass leaves the camera slots at 0; `forceSinglePass`; glTF `KHR_materials_clearcoat` refused; `HDRLoader`; "argument is not a Vector3" during update | 1: Midway | boot and pixels | PRD-542, PRD-543, PRD-544 |
| 20 | Bayview only: `getVertexPosition` on a skinned mesh | 1: Bayview | wrong values | PRD-544 |
| 21 | `Points` | 0 direct; core `clustered-mesh.ts`, `projection-apply.ts`, `world-cells.ts` | boot | PRD-541 |
| — | Uniform semantics: a value-type mismatch is not refused by name, getters do not return the JS value; two uniforms with one `setName` throw mid-frame, not at graph build | 14 games use `uniform`; the games that reach each fault are not counted | wrong values, late error | PRD-544 |
| — | A carried `varying(node)` is typed by a scratch lowering with no inputs (not reproduced) | 4 use `varying`: action-rpg, rain, runner, Midway | refusal | PRD-543 |

### Owned elsewhere, not boxes here

- The post chain on each back end — `pass`, `mrt`, `RenderPipeline`, `RenderTarget`, `QuadMesh`,
  `TempNode`, `RendererUtils`, `NodeUpdateType`, `screenCoordinate`, `positionViewDirection` and the
  nine `three/addons/tsl/display/*` nodes, all in 13 templates — is
  [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) phase 3 (Wasm) and
  [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) (V8). Nodes that a template imports but never
  runs at its tier leave the bundle (lane-tier-imports, PRD-531 `## Blocked on`).
- Back-end-only items stay in their PRDs: the Wasm `vec3(new Vector3())` leak and the fake runtime
  in `browser-tsl.spec.ts` (PRD-540 phase 3); the V8 catalog-coverage red, `pass()` overwriting
  `tn.scene`, `adapterIdentity()`, `renderer.info` on the V8 facade, the frozen MRT slot
  markers and the V8 player's performance series (PRD-531 open items).
- No corpus user, so not ranked: `AnimationMixer.clipAction` ignores its `optionalRoot` argument
  (`bindings_scene.cpp:972`). It becomes a box when a game reaches it.

### Done on `feat/native-engine` (context, not open work)

`attribute.array` as a JS-owned typed array on Wasm (6906e83b6); the clearcoat layer in the shared
physical program (f6c846377); DoubleSide back-face lighting and the two-pass transparent DoubleSide
draw (510d3fbe5); TSL swizzles (26ff3dd8d); the `addAssign` family, `dFdx`, `dFdy`, `sign` and
`cbrt` (6a7662d90); `texture(object, uv)` (25de2566a); `uniformArray` (fd29dcc32); `clamp` default
bounds (20f1af053); `Object3D.clone` (a564dd9c3); `BufferAttribute.clone` (3ae2da7b2); uniform
`onRenderUpdate` and `onFrameUpdate` (4d09a443b). Not on feat yet: core start-failed reporting
(dad980723, lane branch).

## Scorecard

"Any three.js game" means every row is green on every back end. "Blazing fast" means the FPS
column meets [PRD-533](../PRD-533-n20-platform-qualification-performance-default-promotion.md)'s
gates (§15.4): no unexplained GPU-time or visual regression against the legacy engine on the same
game and machine, and about 20% better end-to-end frame time beyond noise on the CPU-bound real
game. This file adds no new number. Two performance items stay where they are: the native
`native_engine_update_scaling` 18× gate is red and stays fixed (PRD-533, owner decision), and
Perry runs 13 to 16 times slower than V8 with five property-pattern cliffs
([PRD-530](../PRD-530-n17-strict-native-typescript-game-packaging.md) `## Blocked on`).

Each cell reads boots · renders · FPS · crashes. `—` means not run. A cell changes only with the
run that produced it, cited by date and commit.

| Game | Wasm web | Native V8 | Perry strict |
| --- | --- | --- | --- |
| minimal | — · — · — · — | — · — · — · — (PRD-531 box open) | no link (PRD-530 phase 4, 2026-10-08) · — · — · — |
| starter | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| action-rpg | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| platformer | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| puzzle | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| racing | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| rain | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| rts | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| runner | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| sailing | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| shooter | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| snow | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| tower-defense | — · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| Midway Open Pacific | load stalled at 70% before 6906e83b6; not rerun · — · — · — | — · — · — · — | no link (same run) · — · — · — |
| Bayview | — · — · — · — | — · — · — · — | not surveyed · — · — · — |

The commands that produce each cell:

| Column | Wasm web | Native V8 | Perry strict |
| --- | --- | --- | --- |
| boots, renders, crashes (templates) | `TN_TEMPLATE_ONLY=<template> TN_TEMPLATE_ENGINE=native pnpm test:templates` | `node packages/playtest/dist/runner/cli.js <template journey>.playtest.json --target desktop` on the native engine profile | `node tools/native-typescript/compile-game.mjs packages/create-threenative/templates/<template>` (boots = links), then the journey with `--target desktop` on the strict artifact |
| boots, renders, crashes (Midway, Bayview) | in the game's own repository, `engine: "native"` and `threenative build --target web`, then `node packages/playtest/dist/runner/cli.js <game journey>.playtest.json --url <preview url> --browser-recipe webgpu` | the same journey with `--target desktop` | `node tools/native-typescript/compile-game.mjs <game dir>`, then the journey on the strict artifact |
| FPS | the `measure-steady-state-fps` procedure with playtest `perf`, on a real display (`TN_PLAYTEST_HOST_DISPLAY=1`; a private-Xvfb rate is refused) | the same, `--target desktop` | the same, on the strict artifact |

"Renders" needs the journey's pixel assertions to pass, not only a frame count. "Crashes" is the
process exit, an uncaught error, or a `TN_*` refusal during the journey. The game-journey boxes
that turn a row green stay where they are: PRD-540 (Wasm), PRD-531 (V8), PRD-530 (Perry) and
PRD-533 phase 3 (every template).

Back to the [batch index](../README.md).
