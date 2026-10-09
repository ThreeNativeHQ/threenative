# N22 — three.js surface coverage, ranked by real-game use

**Status:** PROPOSED — the children carry the boxes; this file has none.
**Work package:** N20 support — [native-engine batch](../README.md)

Owner goal (2026-10-08): "our end goal should be running any threejs goal on wasm/perry/native
without problems + blazing fast performance." This folder maps the whole three.js catalog onto the
engine's layers and turns the gaps that real games reach into ranked engine work. The corpus is 15
games: the 13 templates in `packages/create-threenative/templates/`, Midway Open Pacific and
Bayview. Midway and Bayview are separate sandbox repositories. This repository cites them by name
and module only, and never copies their source or assets.

The work is four PRDs, one per group of layers, because the batch rule allows at most 3 phases and
about 8 boxes per PRD ([`docs/PRDs/AGENTS.md`](../../AGENTS.md), R5). Each PRD runs after the one
below it, because a higher layer uses the lower ones.

| Key | PRD | Layers | Depends on |
| --- | --- | --- | --- |
| N22a | [PRD-545 — Corpus gaps in math, the object model and geometry](PRD-545-n22a-math-object-model-and-geometry.md) | 1–3 | [PRD-501](../../done/native-engine/N04-lifetime-and-numerics/PRD-501-n04a-math-matches-the-pinned-reference.md), [PRD-508](../../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md) |
| N22b | [PRD-546 — Corpus gaps in materials, textures and render state](../../done/native-engine/N22-three-surface-coverage/PRD-546-n22b-materials-and-render-state.md) | 4 | N22a, [PRD-514](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) |
| N22c | [PRD-547 — Corpus gaps in TSL and shader nodes](PRD-547-n22c-tsl-and-shader-nodes.md) | 5 | N22b, [PRD-510](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md) |
| N22d | [PRD-548 — Corpus gaps in renderer passes, loaders, animation and addons](../../done/native-engine/N22-three-surface-coverage/PRD-548-n22d-renderer-loaders-animation-and-addons.md) | 6–9 | N22c, [PRD-526](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-526-n14d-post-effects-and-render-chains-run-native.md) |

The layer order is a dependency order, not a hard gate: a box whose own inputs are ready can start
early, for example the in-progress `InstancedBufferGeometry` and `polygonOffset` boxes.

## The rule: one engine, two language back ends

Every gap is implemented once, in the shared C++ engine (`packages/runtime-native/src/engine`),
and reaches the language back ends through the shared binding registry and `tn_tsl_call`. The V8
back end ([PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md)) and the browser back end over Wasm
([PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md)) then get it with no second
implementation. A box that needs JavaScript in one back end only is back-end work: it goes to
PRD-531 or PRD-540, not here. Each gap lives in exactly one box.

## Context: what the catalog is

- `packages/three-native/api/catalog.json` (schema `catalog.schema.json`, version 1) pins three
  0.185.1 with `@types/three` 0.185.3 and the core patch, and the ABI versions it serves.
- It has 495 entries, keyed by export `name` plus its `source` module: 350 from `three`, 43 from
  `three/webgpu`, 86 from `three/tsl` and 16 from `three/addons/*`. An entry is a `class` (125), a
  `constant` (205), a `function` (93, the TSL names and addon functions), an `enum` (40) or a `type`
  (23). A class carries `extends`, `constructor` overloads, `fields` and `methods`.
- Every entry, and any member that differs from it, has one status: `supported`, `partial` with
  named gaps (223 entries `native-not-implemented`, one `native-not-bound`), or `unsupported` with
  its `TN_NATIVE_UNSUPPORTED_<NAME>` diagnostic. 98 entries are `supported`.
- `sync-native-status` derives the status from the engine's binding registry
  (`api/native-registry.json`, 77 classes, printed by `tn-native-engine-registry-dump`): a bound
  class or member becomes `supported`, an unbound member of a bound class becomes
  `partial(native-not-bound)`. It reads no TSL table and no constant table, so those statuses are
  hand-set and drift.
- `generate` turns the catalog into `generated/three.d.ts`, the C header `tn_abi.h` and a type
  table. It adds no behaviour: the catalog is the contract, the generator only spells it.
- `unsupportedThreeImports` (`tools/native-typescript/run-corpus.mjs`) refuses a game import that
  the catalog does not mark `supported`. The stub ledger (`api/native-stubs.json`) must stay empty.

## The catalog by engine layer

Every entry is in exactly one layer. The rule: an entry belongs to the engine subsystem that
implements it. The display nodes from `three/addons/tsl/display/*` are post effects (layer 6), and
`GLTFLoader` is a loader (layer 7). Layer 9 holds the addons with no engine subsystem of their own.
"Used gaps" counts the entries that are not `supported` and that at least one corpus game imports.

| # | Layer | Entries | Supported | Partial | Unsupported | Used gaps | Engine subsystem (`packages/runtime-native/src/engine/`) | Built by | N22 PRD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Math foundation | 37 | 15 | 21 | 1 | 0 | `foundation/math/`, `abi/bindings_math.cpp`, `abi/bindings_mathutils.cpp` | [PRD-501](../../done/native-engine/N04-lifetime-and-numerics/PRD-501-n04a-math-matches-the-pinned-reference.md) | PRD-545 |
| 2 | Object model and scene graph | 37 | 25 | 7 | 5 | 2 | `scene/`, `foundation/handles.*`, `foundation/reachability.*`, `abi/bindings_scene.cpp` | [PRD-502](../../done/native-engine/N04-lifetime-and-numerics/PRD-502-n04b-handles-keep-identity-and-aliases.md), [PRD-503](../../done/native-engine/N04-lifetime-and-numerics/PRD-503-n04c-unreachable-cycles-are-reclaimed.md), [PRD-508](../../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md) | PRD-545 |
| 3 | Geometry and buffers | 42 | 20 | 12 | 10 | 6 | `scene/geometries.cpp`, `scene/geometry.cpp`, `foundation/buffers.*`, `abi/bindings_geometry.cpp` | [PRD-504](../../done/native-engine/N04-lifetime-and-numerics/PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md), PRD-508 | PRD-545 |
| 4 | Materials and render state | 206 | 20 | 168 | 18 | 17 | `scene/material.cpp`, `renderer/gpu_resources.*`, `shader/standard.cpp`, `abi/bindings_material.cpp` | [PRD-509](../../done/native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md), [PRD-514](../../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md) | PRD-546 |
| 5 | TSL and shader nodes | 95 | 0 by the catalog; 55 of the 86 `three/tsl` names are in the engine table | 3 | 92 | 77 by the catalog; 23 not in the engine table | `shader/`, `abi/tsl_call.cpp` | [PRD-510](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md) to [PRD-513](../../done/native-engine/N08-native-tsl-and-shader-packages/PRD-513-n08d-compute-multipass-and-a-dynamic-graph.md) | PRD-547 |
| 6 | Renderer passes, post and render targets | 44 | 5 | 11 | 28 | 19 | `renderer/` (`chain/`, `graph/`, `compute.*`), `wasm/web_host.cpp` | PRD-509, [PRD-523](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md) to [PRD-527](../../done/native-engine/N14-native-render-chain-and-advanced-visuals/PRD-527-n14e-particles-and-fluids-run-native.md) | PRD-548; the post chain binding is PRD-540 and PRD-531 |
| 7 | Loaders and assets | 1 | 0 | 0 | 1 | 1 | `assets/` (`gltf/`, `package.*`) | [PRD-515](../../done/native-engine/PRD-515-n10-native-gltf-cooked-assets-and-decoders.md), [PRD-520](../../done/native-engine/N13-native-streaming-and-world/PRD-520-n13a-bounded-streaming-admission-and-io-events.md) | PRD-548 |
| 8 | Animation | 27 | 12 | 11 | 4 | 0 | `animation/` | [PRD-516](../../done/native-engine/N11-native-animation/PRD-516-n11a-animation-mixer-semantics-in-native.md) to [PRD-518](../../done/native-engine/N11-native-animation/PRD-518-n11c-skinning-palettes-and-pose-history.md) | PRD-548 |
| 9 | Addons | 6 | 1 | 0 | 5 | 1 by import; `mergeGeometries` and `mergeVertices` by name in 9 games | by addon: `scene/` (geometry utilities), `animation/skinning/` | PRD-508, PRD-518 | PRD-548 |
| | **Total** | **495** | **98** | | | | | | |

Two facts show in the table. First, layer 4 is mostly constants that the back end binds by value
and the engine does not implement, so `partial` hides real behaviour gaps. Second, layer 5 reads
0 supported while the engine answers most TSL names: the catalog does not follow the TSL table.
The proposed decision below closes both.

## How the ranking was measured (2026-10-08)

- **Imports.** `unsupportedThreeImports` ran over each game's `src/` and over `packages/core/src`
  against the catalog. A namespace import (`import * as THREE`) was expanded to its `THREE.X`
  reads, and `three/addons/*` paths were listed apart.
- **Members.** A word search for each candidate member, method and TSL name, with its catalog
  status. A word match is a candidate, not proof: each box's proof decides.
- **TSL.** A name counts as known to the engine when it is a string literal in
  `abi/tsl_call.cpp`, `shader/ir.cpp` or `shader/graph/serialized.cpp`. This is a lower bound: the
  statement forms (`Fn`, `If`, `Loop`) run through `tn::abi::TslScopes`.
- **Midway's native run.** lane-midway-native reported the native-only faults and the ten TSL
  names that Midway's native bundler refused on 2026-10-08. They are cited from that report.
- **Order.** Layers go in dependency order. Inside a layer, rank by the number of corpus games
  that use the gap directly. "core" means `@threenative/core` uses it, so a game that turns that
  feature on reaches it. A tie goes to the gap that stops boot. A gap that no corpus game reaches is
  in the backlog, not in a phase.

## Ranked gaps, by layer

| Layer | Gap | Corpus users (games) | Effect | Box |
| --- | --- | --- | --- | --- |
| 1 | "argument is not a Vector3" during Midway's update loop | 1: Midway | boot | PRD-545 |
| 2 | `Line`, `LineSegments`, `LineBasicMaterial` | 3: Bayview, shooter, snow; core | boot | PRD-545 |
| 2 | `InstancedMesh.instanceColor` setter | 3: rts, tower-defense, Midway; core | pixels | PRD-545 |
| 2 | `getVertexPosition` on a skinned mesh | 1: Bayview | wrong values | PRD-545 |
| 3 | `IcosahedronGeometry` 4, `CapsuleGeometry` 3, `DodecahedronGeometry` 2, `OctahedronGeometry` 2, `TorusKnotGeometry` 2 | 7: Bayview, platformer, racing, rts, shooter, snow, tower-defense | boot | PRD-545 |
| 3 | `InstancedBufferGeometry`, `instanceCount`, `attribute()` on instance attributes (in progress, lane-wasm-templates) | 2: rain, Midway; core | boot | PRD-545 |
| 4 | Texture filter, wrap, format, type, colour-space and mapping constants marked `partial` | 15: all; `RGBAFormat` 15, `UnsignedByteType` 14, `EquirectangularReflectionMapping` 14, `SRGBColorSpace` 14, `FloatType` 13, `NearestFilter` 13, `ClampToEdgeWrapping` 12, `RepeatWrapping` 11, `LinearMipmapLinearFilter` 9 | pixels | PRD-546 |
| 4 | `CanvasTexture` as an engine class | 13: 11 templates, Midway, Bayview | boot on V8 | PRD-546 |
| 4 | `Material.prototype.onBeforeCompile` and `customProgramCacheKey` reads | 12 templates; core | boot | PRD-546 |
| 4 | `vertexColors` | 5: platformer, shooter, snow, Midway, Bayview; core | pixels | PRD-546 |
| 4 | `material.vertexNode` | 3: rain, shooter, Midway; core | pixels | PRD-546 |
| 4 | `polygonOffset`, `polygonOffsetFactor`, `polygonOffsetUnits` (in progress, lane-midway-native) | 3: shooter, Midway, Bayview | pixels | PRD-546 |
| 4 | `Data3DTexture` and `texture3D` | 1: rain; core | boot | PRD-546 |
| 4 | `forceSinglePass` | 1: Midway | pixels | PRD-546 |
| 5 | TSL names the corpus imports and the engine table lacks: `screenCoordinate` 13, `positionViewDirection` 12, `atan` 3, `hash` 3, `mod` 2, `time` 2, and 15 one-game names | 14: 13 templates, Bayview | boot | PRD-547 |
| 5 | `normalWorld` on `DoubleSide` | 9 use `DoubleSide`; 4 read `normalWorld` | pixels | PRD-547 |
| 5 | TSL names Midway's native bundler refuses through core: `normalLocal`, `tangentLocal`, `positionPrevious`, `storage` | 1: Midway | boot | PRD-547 |
| 5 | Ocean `colorNode` lowers to invalid WGSL (`TN_NATIVE_SHADER_INVALID`) | 1: Midway | boot | PRD-547 |
| 5 | `texture(object).level()` in the vertex stage | 1: Midway | boot | PRD-547 |
| 5 | Uniform value types; `setName` conflict at graph build | 14 use `uniform`; the games that reach each fault are not counted | wrong values | PRD-547 |
| 5 | A `varying(node)` typed by a scratch lowering with no inputs (not reproduced) | 4 use `varying` | refusal | PRD-547 |
| 6 | `resolutionScale` and `bloom()` parameters do nothing after the first render | 14: 13 templates, Midway | pixels | PRD-548 |
| 6 | Post and render-texture graphs keep a copy of their uniforms | 13 templates | pixels | PRD-548 |
| 6 | `viewportLinearDepth`, `linearDepth`, `cameraNear`, `cameraFar` | 3: starter, rain, Midway (core `WaterSurface3D`) | boot | PRD-548 |
| 6 | `viewportSharedTexture`, `viewportDepthTexture` | 1: Midway (core `WaterSurface3D`) | boot | PRD-548 |
| 6 | Shadow-depth pass leaves the camera slots at 0 | 1: Midway | pixels | PRD-548 |
| 7 | glTF `KHR_materials_clearcoat` refused | 1: Midway | boot | PRD-548 |
| 7 | `HDRLoader` | 1: Midway | boot | PRD-548 |
| 9 | `mergeGeometries`, `mergeVertices` | 9: action-rpg, puzzle, racing, sailing, shooter, snow, starter, Midway, Bayview | boot on V8 | PRD-548 |
| 9 | `SkeletonUtils.clone` | 2: shooter, Bayview; core | boot | PRD-548 |

### Owned elsewhere, not boxes here

- The post chain binding on each back end — `pass`, `mrt`, `output`, `convertToTexture`, `rtt`,
  `RenderPipeline`, `RenderTarget`, `QuadMesh`, `PassNode`, `TempNode`, `RendererUtils`,
  `NodeUpdateType`, `NoToneMapping` as the output tone mapping and the nine
  `three/addons/tsl/display/*` nodes, all in 13 templates — is
  [PRD-540](../PRD-540-web-games-boot-on-the-wasm-engine.md) phase 3 (Wasm) and
  [PRD-531](../PRD-531-n18-v8-game-runtime-adapter.md) (V8). Nodes that a template imports but never
  runs at its tier leave the bundle (lane-tier-imports, PRD-531 `## Blocked on`). The
  `WebGPURenderer` facade is PRD-540 phase 2 and PRD-531.
- Back-end-only items stay in their PRDs: the Wasm `vec3(new Vector3())` leak and the fake runtime
  in `browser-tsl.spec.ts` (PRD-540 phase 3); the V8 catalog-coverage red, `pass()` overwriting
  `tn.scene`, `adapterIdentity()`, `renderer.info` on the V8 facade, the frozen MRT slot markers and
  the V8 player's performance series (PRD-531 open items).

## Backlog: gaps no corpus game reaches

Ranked by layer, then by core use. A backlog entry moves into its layer's PRD as a box when a
corpus game reaches it.

1. **Object model.** Core only: `Points` (`clustered-mesh.ts`, `projection-apply.ts`,
   `world-cells.ts`), `BatchedMesh` (projection, picking, velocity), `Audio`, `AudioListener`,
   `PositionalAudio`. Unused: `EventDispatcher`, `BaseEvent`, `Event`, `EventListener`, `GridHelper`.
   Not an entry but an engine gap with no user: `AnimationMixer.clipAction` ignores `optionalRoot`
   (`bindings_scene.cpp:972`).
2. **Math.** Unused: `Line3`, `Triangle`, `Spherical`, `Cylindrical`, `REVISION`, the coordinate
   system constants and the tuple and `*Like` types.
3. **Geometry.** Unused: `EdgesGeometry`, `InterleavedBufferAttribute`, `Uint16BufferAttribute`, the
   draw modes, `TypedArray` and the usage constants other than `StaticDrawUsage` and
   `DynamicDrawUsage`.
4. **Materials.** Core only: `MeshLambertNodeMaterial`. Unused (168): `DepthTexture`,
   `MeshNormalMaterial`, `PointsMaterial`, the compressed formats (ASTC, BPTC, ETC, EAC, PVRTC,
   S3TC, RGTC), the integer and packed types, the depth, compare and stencil functions and stencil
   ops, the blend factors, equations and modes, the depth and normal packings, cube and UV mappings,
   mipmap filter aliases, `MirroredRepeatWrapping`, the colour-space transfers and the enum types.
5. **TSL.** Core only: `instancedArray`, `normalGeometry`. Unused: `Node`, `NodeBuilder`,
   `NodeFrame`, `TextureNode`, `StorageBufferNode`, `StructNode`, `ComputeNode`, `wgslFn`,
   `deltaTime`, `modelWorldMatrixInverse`, the GLSL constants and the interpolation sampling enums.
6. **Renderer.** Core only: `BundleGroup`. Unused: `PostProcessing`, `Renderer`, `TimestampQuery`,
   the tone-mapping constants other than the supported ones, `BasicShadowMap`, `VSMShadowMap`,
   `ShadowMapType`, the cull-face constants, `Compatibility`.
7. **Animation.** Core only: `AttachedBindMode`, `InterpolateDiscrete`, `InterpolateLinear`,
   `NormalAnimationBlendMode`. Unused: `DetachedBindMode`, `AdditiveAnimationBlendMode`,
   `InterpolateBezier`, `InterpolateSmooth`, the ending modes and their enums.
8. **Addons.** Unused: `CCDIKSolver`, `DecalGeometry`.

## Proposed decision (owner to accept)

Not accepted yet; nothing is implemented. To keep coverage organized as the engine grows:

- Each catalog entry carries `layer` (one of the nine above), `subsystem` (its directory under
  `packages/runtime-native/src/engine/`) and `owner` (the PRD that builds or extends it).
- `sync-native-status` also reads the TSL table and the constant table, so TSL names and constants
  get their status from the engine, as classes already do.
- A check (proposed beside `catalog-registry.spec.ts`) fails closed when a `supported` entry has no
  `owner`, when an entry has no `layer` or `subsystem`, or when an entry is not `supported` while
  its `owner` PRD is in `docs/PRDs/done/`.
- Cost: one schema field set and one sync pass; the layer map in this README becomes generated.

## Done on `feat/native-engine` (context, not open work)

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
| Midway Open Pacific | load stalled at 70% before 6906e83b6; not rerun · — · — · — | boots only with bypasses; the ocean shader aborts the windowed run (lane-midway-native report, 2026-10-08) · — · — · — | no link (same run) · — · — · — |
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
