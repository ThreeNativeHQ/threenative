# PRD-466 — Agent-authored Strata terrain through the Three.js contract

**Status:** PARTIAL
**Complexity:** 7 (HIGH); risk override: none
**Owner:** ThreeNative maintainers
**Depends on:** None
**Progress:** 5/9 required boxes verified
**Required companion:** [PRD-467 — live terrain editor](PRD-467-strata-live-terrain-editor.md)
**Required companion:** [PRD-468 — atmosphere, cameras, and asset imports](PRD-468-strata-world-controls-and-asset-imports.md)

## Context

An agent should author useful terrain through code, without Blender or editor
clicks, and use the result through ordinary Three.js objects inside ThreeNative.
Strata already provides the heavy operations: noise, erosion, sculpting, pads,
roads, rivers, material masks, and scatter. The requested integration preserves
those operations and adds replaceable starter art, rendering, and physics wiring.

**Visual goal: Unreal look and feel.** The starter world should read as a realistic,
cinematic landscape: physically scaled PBR surfaces, believable tree/rock shapes,
coherent sun/sky/atmosphere, grounded vegetation, and a realistic coastal ocean.
Procedural shapes are the default; baked Poly Haven textures supply surface detail.
All geometry parameters, textures, lighting, water, and post effects remain editable
game source. The goal names the appearance, not an Unreal runtime dependency.

**Primary output: a self-contained GLB easily usable in any game.** The exported
world includes terrain, trees/rocks/grass, final authored transforms, and embedded
portable PBR textures. ThreeNative powers authoring/preview but is not required
to load the GLB. Export portability is a release criterion, not a later adapter.

The user also requires a terrain editor URL that shows agent changes live, with
individual selection, transform gizmos, GUI polish, and embedded spatial debugging
for map/screenshot reconstruction. That distinct authoring
tool is specified in PRD-467. Both PRDs are required for the complete requested
integration; finishing this runtime/package PRD alone does not finish that goal.

The subsequent execution request authorizes implementation in the shared
PRD-466/467/468 worktree and draft PR #381, with incremental pushes and screenshots of visible milestones attached to
PR #381. npm
publication remains outside this execution request. Complexity is 3 for 11+ implementation files
(mostly recovered supplied modules), 2 for the new authoring module, and 2 for an
independently packed/released optional addon. No marketplace API is required.

### Supplied source and existing integration points

The inputs are `/home/joao/Downloads/AGENT_GUIDE.md` (10,460 bytes, SHA-256
`487453218f870c5e829d58aea3fe9323e74ea93e0aecef8d5c329ecf56972d06`) and
`/home/joao/Downloads/strata-terrain.html` (216,039 bytes, SHA-256
`c0230e6891db829a5196d93ff7c9d714a8f2d964cac4722eb8ce4b2f723d794b`).
The HTML embeds named JS modules, including `src/index.js`, `src/core/*`,
`src/three/adapter.js`, and `src/editor/*`. Recover the supplied modules; do not
rewrite the evaluator or copy the minified HTML into the runtime. The guide names
types but the embedded source inventory does not contain `src/index.d.ts`.
Recover original declarations if available; otherwise type the supported public
surface from the implementation rather than inventing signatures.

Capability search and detail identified existing `Heightfield`, `TerrainTiles`,
`CollisionShape3D`, `rapier`, `compileAssets`, and `WorldCells`. Reuse the terrain,
physics, and asset mechanisms; do not make Strata output masquerade as a `WorldCells` manifest.
Its runtime archive is a different format.

- `packages/core/src/world.ts:94`: `Heightfield` accepts canonical height arrays;
  `toGeometry()` emits Three.js geometry and `toColliderHeights()` transposes to
  Rapier order. `origin` is the field centre, not the southwest corner.
- `packages/physics/src/CollisionShape3D.ts:140`: existing heightfield collider.
- `examples/abyss-framework/src/scenes/TerrainProbe.ts`: existing game-side
  terrain/physics wiring; reference it without replacing that unrelated probe.
- `packages/create-threenative/templates/*/src/render/`: game-owned visual source.
- `pnpm-workspace.yaml`: Three.js is currently 0.185.1; the supplied HTML imports
  0.180.0 from a CDN. The integration uses the consumer's installed Three.js.

## Solution

### Package and ownership

Ship an optional **`@threenative/terrain`** addon in `packages/terrain/`, integrated
with the engine's normal package, asset, and capability paths. Ordinary games do
not import it or load its starter assets unless they use terrain generation.
There is one authoring implementation and one optional package, not a separate
terrain renderer, scene graph, or second engine.

The root export contains the supplied headless `Terrain`, `Mask`, evaluation,
baking, and export operations. A `/three` subpath converts baked mesh arrays to
an ordinary indexed `THREE.BufferGeometry`; it never creates a renderer, scene,
camera, light, material, or render loop. `three` is a peer dependency. Keep physics
integration in game source using the existing engine API; the generator does not
depend on Rapier or install a second physics world.

The current [charter](../architecture/CHARTER.md) excludes recipe systems and
allows a new framework package only for an isolated dependency. Strata authoring
does not automatically satisfy that rule. This plan explicitly proposes a narrow
allowance for the requested optional terrain authoring addon in phase 1. Recipes
remain authoring documents compiled into ordinary runtime data; they never become
an engine scene format. The allowance also covers the five requested editable
terrain starter documents and the terrain-only authoring
companions in PRD-467/PRD-468, including world atmosphere/camera controls and
project asset imports, not a general game editor, genre preset system, or ownership
of appearance. The charter change is part of the integration's review,
not an exception a future implementer may silently infer.

### Consumer flow

```mermaid
flowchart LR
  Agent[Agent calls Terrain and Mask] --> Recipe[Serializable authoring recipe]
  Recipe --> Evaluate[Evaluate once during authoring or build]
  Evaluate --> Arrays[Canonical heights, splats, placements]
  Arrays --> Geometry[Ordinary Three.js BufferGeometry]
  Geometry --> Mesh[Game-owned Mesh and material]
  Arrays --> Field[Existing Heightfield]
  Field --> Physics[Existing CollisionShape3D and Rapier]
  Assets[Replaceable local asset mappings] --> Mesh
  Assets --> Cook[Existing asset compiler and loader]
  Mesh --> Game[ThreeNative game]
  Physics --> Game
  Cook --> Game
```

Agents use stable operation IDs and `applyPatch()` for revisions. The supported
entry points remain `evaluate()`, `bakeMesh()`, `bakeTerrain()`, and `makeExport()`.
Do not introduce a competing `generate()` API or a CLI vocabulary.

The first game is `examples/strata-terrain-preview/`: a seeded 512-metre map at
257 vertices per side, defaulting to Temperate Forest/Grassland, with an eroded
hill, flat building pad, graded road, procedural trees/rocks/grass, and a river.
A Coastal/Island benchmark supplies the visible realistic ocean. It has a playable character,
not just an orbit screenshot.
The full evaluator runs before play; desktop uses build-baked arrays/assets.
No generation, worker, erosion, or collider rebuild occurs during steady play.
Recover the supplied editor in PRD-467 instead of replacing it with a second
invented editor. The preview owns one ThreeNative renderer and loop. The
terrain generator remains dormant during play; the ocean advances normally.

### Existing capabilities to reuse

These candidates were found with `engine_search_capabilities` and inspected with
`engine_capability_detail`; this is API discovery, not platform execution evidence.

| Area | Installed mechanism/source | Integration and constraints |
| --- | --- | --- |
| Ocean | `SpectralOcean` from `@threenative/core`; `packages/create-threenative/templates/sailing/src/render/ocean.ts` | Reuse GPU cascaded spectra and adapt the existing lit, displaced water source. Supply every wave parameter; largest cascade first. Surface/material/foam remain the game's. CPU samples are stale readbacks, not exact current contacts. |
| Sky and distance | `Atmosphere`, `AtmosphereLuts`, `directionalTransmittance` from `@threenative/core` | Reuse physical atmosphere nodes/LUT lifetime; game supplies coefficients, sky, sun, and haze appearance. Do not add another atmosphere solver or silently assume Earth constants. |
| Procedural props | `createRandom`, `mergeParts`, `InstancedBatch`, `markStatic` from `@threenative/core` | Seed shape variants; merge static parts per material preserving authored UVs/normals; instance shared variants; freeze only genuinely static subtrees. The game supplies every shape and material. `GroundSnap` is only a rendered-model correction, not collider placement. |
| Baked textures/models | `compileAssets`, `texturePass` from `@threenative/assets`; existing cooked-model LOD | Prepare PBR maps offline, then reuse mipmapped KTX2 cooking and `ctx.assets`. Compressed dimensions must be divisible by four. Cooked GLB LOD applies only when eligible and configured; instancing does not imply automatic LOD. |
| Lighting and measurement | Existing game-owned `worldEnvironment.ts`/post source, Three.js GTAO/SSR, `FrameBudget` | Use current template stages where they improve the actual image. AO radii are metres; SSR is screen-space and does not supply offscreen reflections. Record main/shadow/reflection costs and real GPU measurements; absence is not zero. |

PRD-468 makes atmosphere, sky/sun direction, haze/fog, exposure, environment images
and ocean appearance editable live by both the controller and GUI. Reuse
`Atmosphere.setAtmosphere()` and its validated parameter/LUT mechanisms, plus
the game-owned `WorldEnvironment` source and its `TN_RENDER_CHAIN` diagnostics.
`ctx.assets.resolve()` supplies cooked/local paths for installed Three.js
`HDRLoader`/`EXRLoader`; the ordinary texture loader does not decode HDR skies.
These mechanisms are discovered, not proof that every chosen effect runs on a
target. Appearance and full custom replacement remain game-owned.

The realistic ocean is required. Start from the shipped sailing ocean source,
retain its lit material and displacement-derived normals, then tune wave bands,
shore masking/foam, sun highlights, and horizon coverage for this coastline.
Strata's water output identifies authoring extents/levels; it is not the wave
renderer. The preview's game-owned `src/render/ocean.ts` supplies that mapping.
Shore foam is a visual response to terrain/water depth, not a new fluid simulator.
Validate the chosen spectral path on browser and desktop; unsupported execution
fails visibly. `WaveField` is an explicit analytic alternative only if chosen and
reported; do not silently substitute it and claim the spectral path passed.

`RippleField` and `Buoyancy3D` are available for later interactive splashes/boats,
but neither is needed for this landscape scope. `lightmapPass` requires a static
self-contained GLB with a punctual light, so it is not a blanket terrain-lighting
solution. No blanket enabling of costly post stages to satisfy the visual goal.

`loadTerrainSplat` is another inspected terrain-surface capability: it supplies
world-metre texture tiling, optional triplanar cliffs, macro variation, normals,
and linear splat masks. Its public input requires `terrain.layers.table` and
`terrain.layers.splat` in a world-package document, so it cannot directly consume
Strata's eight-channel array. Reuse the compatible installed surface mechanism
where possible; do not invent a second world format merely to call it. Respect
the documented 16 sampled-texture limit, including mask planes and normal maps;
eight diffuse-plus-normal layers with masks do not fit automatically. The portable
GLB path bakes those blends rather than requiring that shader at load.

### Visual acceptance rubric

Capture the actual seeded coastal scene at fixed seed, time, camera, and 1920×1080:
a close ground/vegetation view, a coast/ocean view, and a landscape overview.
Compare browser and desktop results through the existing playtest capture path.
The implementing agent inspects the rendered captures against this rubric and
records concrete remaining defects on AC-5. A nonblank screenshot alone is not
visual acceptance; subjective Unreal-like quality is not certified by unit tests.

Capture the default Temperate world as well as the Coastal benchmark. Qualify
the remaining starter environments with their defining close/overview views;
do not substitute five labels over the same unchanged material/landform set.

| Area | Required visible result |
| --- | --- |
| Ground | Metre-scaled albedo/normal/roughness detail, coherent grass/dirt/rock/sand transitions, and no stretched cliff UVs or dominant repeated texture grid at the benchmark cameras. |
| Trees and rocks | Varied believable silhouettes, textured bark/leaves/stone, coherent scale and ground contact; simple primitives are construction inputs, not unpolished final cone-tree silhouettes. |
| Coast and ocean | Several visible wave scales, changing normals and sun response, shoreline masking/foam, and a continuous believable horizon without water rectangles cutting across land. |
| Lighting and depth | Consistent sun/sky/exposure, readable contact shadows, atmospheric depth, and restrained post effects without halos, blown glare, or visible shadow instability. |

### Five starter environments, in priority order

| Priority | Editable starter document | Terrain and asset coverage |
| --- | --- | --- |
| 1 | Temperate Forest / Grassland | Hills, grass, dirt, rocks, procedural trees, rivers; default reusable baseline. |
| 2 | Mountain / Alpine | Steep slopes, cliffs, valleys, exposed rock and snow; shared rock/tree assets with alpine distribution rules. |
| 3 | Desert / Canyon | Sand, dunes, mesas, ravines and dry rock formations; sparse vegetation rather than a recoloured forest. |
| 4 | Coastal / Island | Beaches, cliffs, coves, ocean edges and replaceable temperate/tropical vegetation; realistic installed ocean. |
| 5 | Snow / Tundra | Snowfields, frozen lake surfaces, rocky outcrops and sparse vegetation; ice is an editable surface, not a fluid simulation. |

Deliver all five as plain editable example recipes plus material/asset mappings
in `packages/terrain/starter/`, selectable by the companion editor. Prioritize
assets and implementation in this order; share textures, geometry variants and
mechanisms. These are authored starting documents, not a hidden runtime genre
system. Changing a biome, swapping all art, or starting blank remains ordinary
recipe/source editing. Default startup uses the first, never a locked showcase.

### Portable full-world GLB export

The supplied `makeExport(..., 'glb')` exports coloured terrain only. Preserve it as
an explicitly terrain-only export and add a full-world export action/API using
the installed Three.js `GLTFExporter`; do not write another GLB encoder. The
proposed public export name/signature must be documented and typed when landed.
Its input is the committed evaluated world plus the game-supplied asset/material
mapping, not an unrelated scene graph reconstructed from placeholder IDs.

Create an export snapshot with terrain, accepted procedural/imported placements,
their final transforms, and ordinary glTF 2.0 PBR materials. Embed every image and
buffer into one `.glb`; no external URLs, JS/TSL, engine plugin, registry lookup,
or unprocessed asset ID is required at load. Preserve metre scale, Y-up, normals,
UVs, winding, alpha cutoff/double-sided foliage choices, and stable object IDs in
optional node extras. Bake terrain splat/triplanar blends into portable UV-mapped
albedo/normal/roughness/AO textures; vertex colours alone do not satisfy the look.

Default export is compatible without engine-specific glTF extensions. Repeated
props can share mesh data through ordinary nodes; do not require
`EXT_mesh_gpu_instancing`, ThreeNative LOD metadata, or a custom shader to see them.
Offer such optimizations only as explicit profiles after the portable path passes.
Collision and editable recipes are optional sidecars; neither is required to draw
the GLB, and collision is not invented as a standard GLB guarantee.
Preserve optional local-origin/north/georeference metadata in root extras or an
authoring sidecar, using the PRD-467 coordinate contract. Debug grids, probes,
landmarks, reference overlays and imported reference images stay out of runtime
geometry/materials; a standard game still loads the GLB without GIS tooling.

GLB captures a static world. Bake shader-driven grass deformation and ocean
displacement/normals at an explicit export snapshot time into ordinary geometry
and PBR data. Obtain a coherent resolved ocean snapshot using existing readback
mechanisms; do not label stale running-simulation samples as the requested current
frame. No live FFT/wind/atmosphere/post-processing code is serialized into GLB.
Report any environment-dependent appearance that a receiving game supplies,
and any excluded procedural effect. Unsupported unbaked materials fail by name
rather than exporting a visually empty or terrain-only success.
Preserve editable environment settings and local HDR sources in the project or
optional sidecar; standard GLB cannot carry the running atmosphere, fog, exposure
or post chain. Named authored cameras may be explicitly exported as ordinary
glTF cameras, while default editor/debug cameras stay excluded. PRD-468 qualifies
on-demand imported models/textures through this same portable export path.

The GUI and agent call this same export path. A plain Three.js consumer loads the
file using `GLTFLoader` and renders it without ThreeNative or access to the source
project. Test from an isolated directory with all source/CDN requests disabled;
verify all five starter exports, representative prop counts, selected/manual
transforms, embedded images, and no external glTF resource references. The goal
is a portable asset, not identical lighting in every receiving engine.

### Replaceable starter assets, including Fab

Ship editable, seeded procedural tree, rock, and grass builders as starter render
source, producing ordinary Three.js geometry and materials. Recover useful pieces
of Strata's supplied `defaultAssets()` instead of rewriting them, but improve their
silhouettes/UVs/texturing to meet the rubric. Keep builder parameters in game source;
do not bake a fixed artistic style into the addon evaluator. Generate a bounded
variant set once, then reuse it through existing instancing. Imported models remain
optional replacements, not prerequisites for the default world.

Use baked/prepared Poly Haven PBR maps for surface detail. The ThreeNative asset
MCP's `polyhaven_search_assets`, `polyhaven_get_asset`, and `polyhaven_list_files`
were queried on 2026-09-30. The following shortlist returned explicit **CC0**
metadata; it is license/file-metadata qualification, not downloaded/visually graded
art or an implemented starter pack.

| Role | Qualified candidates | Authors / use |
| --- | --- | --- |
| Grass and soil | [Leafy Grass](https://polyhaven.com/a/leafy_grass), [Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | Charlotte Baglioni; Rob Tuytel/Rico Cilliers. Baked ground PBR maps. |
| Stone | [Coast Sand Rocks 02](https://polyhaven.com/a/coast_sand_rocks_02), [Rock Moss Set 02](https://polyhaven.com/a/rock_moss_set_02) | Rob Tuytel; Kless Gyzen. Coastal texture plus optional replacement rock meshes. |
| Beach | [Sand 01](https://polyhaven.com/a/sand_01) | Rob Tuytel. Sand PBR maps. |
| Trees | [Bark Brown 02](https://polyhaven.com/a/bark_brown_02), [Jacaranda Tree](https://polyhaven.com/a/jacaranda_tree) | Rob Tuytel; Rico Cilliers/Rob Tuytel. Bark and individually available leaf/alpha maps for procedural foliage; full tree is an optional custom replacement. |

Additional CC0 candidates returned by the same asset MCP are
[Snow 02](https://polyhaven.com/a/snow_02) and
[Snow 01](https://polyhaven.com/a/snow_01) for Alpine/Tundra, and
[Sandstone Cracks](https://polyhaven.com/a/sandstone_cracks) for dry rock/Desert.
All list Rob Tuytel as author. Qualify prepared snow/ice and dry-rock materials
for the relevant starters before claiming all five environments are ready.

File inspection found direct 1K texture downloads, including OpenGL normal maps,
and glTF dependencies. Rock Moss Set 02's 1K glTF plus all listed dependencies totals
1,942,240 bytes. Jacaranda's geometry binary alone is 208,307,808 bytes despite the
1K texture selection: use individual leaf/alpha atlas files for procedural trees,
not that raw mesh as a starter dependency. Measure cooked geometry and bounds before
accepting any optional replacement; catalog dimensions have no confirmed metre
unit here. Do not guess scale or treat a small texture resolution as a small model.

Actual selected file URLs, authors, licenses, content hashes, metre scale, and
preprocessing belong in `packages/terrain/starter-assets/credits.json` during
implementation. Nothing was downloaded or imported by this planning task.

**Fab assets are supported.** Users can load their licensed Fab models/textures
through the same normal asset loader and supply the same mappings. Engine/tool
choice is not the restriction. The distinction is shipping licensed art inside
a game versus redistributing reusable asset source files in an engine package:
[Fab's Standard License summary](https://www.fab.com/eula) permits compatible
tools and incorporated projects but prohibits standalone redistribution.
An asset listed on Fab with a different license or explicit redistribution
permission can be bundled when those terms permit it. No marketplace-wide ban.
[Poly Haven's asset license](https://polyhaven.com/license) is CC0 and explicitly
permits redistribution. Keep provenance even when attribution is not mandatory.
Use local prepared assets at runtime; no credentials, scraping, marketplace
client, or live network dependency is introduced.

The game has editable `src/render/terrain.ts` and `src/world/terrainAssets.ts`:
material construction and texture choices stay in the former; placement asset IDs
map to ordinary loaded `Object3D` models in the latter. The starter sources can be
copied into a game and edited directly. Supplying a custom `THREE.Material` and
custom asset mappings replaces the complete starter look without modifying
package code. Keep Strata's eight material channels as numerical authoring data;
games choose what each channel means visually. Unknown referenced asset IDs fail
with their rule/asset name rather than silently showing placeholder trees.

Prepared textures/imported replacements go through `compileAssets` and `ctx.assets`;
procedural geometry uses the same game-owned materials and `InstancedBatch`.
PRD-468 adds GUI file import and agent registration of local asset MCP outputs:
custom GLB models, PBR images and HDR environments are not limited to these starter
IDs. They are copied/registered under project-owned assets and use the same
compiler/loader, placement mappings and full-world export. Fab import/download
tools already exist in the asset MCP; use their returned local GLBs under the
applicable asset terms instead of adding a second marketplace client.
Never carry over the supplied viewer's renderer. Cap the cooked starter set at 25 MiB, use at most
2K source textures, and expose ordinary file replacement/removal. Every custom
configuration must avoid loading the replaced starter files. This is a bounded
example art set, not a universal art or asset marketplace system.
The 25 MiB cooked budget applies to each selected starter's required content;
do not eagerly load all five environments' textures at startup. Full GLB size is
measured separately, including geometry and baked material atlases.
Choose maps/channels deliberately: albedo is colour data; normals, roughness, AO,
height, and splat weights are linear data. Retain a reproducible packing/baking
step when combining channels or preparing leaf alpha; do not flatten all detail
into diffuse colour or bake one fixed sun into every material.

### Data correctness and failure handling

World units are metres, Y is up, the map is centred on zero, and input heights are
row-major Z then X. Construct `Heightfield` from the final arrays directly with
`rows = columns = resolution`, `width = depth = size`, and centre `{x: 0, z: 0}`.
Do not resample or erode again during collision creation. The baked collision
archive's corner origin must not be passed as a `Heightfield` centre.

Matching samples alone do not prove matching surfaces. The supplied sampler and
`Heightfield.heightAt()` are bilinear, whereas meshes/collision consist of
triangles. Test asymmetric nonplanar cells at interior points on both sides of
the diagonal, edges, and corners. Grounding/placement in the consumer must follow
the actual rendered/collidable triangles; do not claim bilinear queries are exact
triangle contacts. Prefer correcting consumer wiring through existing mesh or
physics queries; if a shared engine defect is demonstrated, fix it in its owning
layer with regression proof rather than patching every game.

Preserve recipe validation, atomic edits/rollback, bounded operations, diagnostics,
and deterministic seeds at the same resolution. Invalid recipes and nonfinite or
wrong-length arrays fail before replacing valid data. No evaluated array edits
pretend to update the recipe. Different export resolutions require fresh inspection;
cross-resolution equivalence is not promised. Splat textures are linear data and
their sampled weights are normalized by game-owned material source. Asset models
are caller-owned; disposing the generated geometry does not dispose shared art.

## Scope limits

The live editor and GUI extension belong to required PRD-467; world controls and
on-demand imports belong to required PRD-468. No new marketplace client, caves,
navigation generation, volumetric fluid simulation,
infinite-world generation, or seamless mixed-LOD claim. The existing spectral
ocean surface is in scope. Defer
`TerrainTiles` integration until a game needs streaming; first prove one finite
terrain using the installed `Heightfield`. Browser WebGPU and Linux native desktop
are required; Android/iOS support is not claimed by these results. Publishing to
npm is separate from locally packing and verifying installable tarballs.

## Acceptance Criteria

The eight phase boxes are required capability criteria AC-1 through AC-7 and AC-9.
AC-8 below proves the portable GLB consumer. Keep evidence on those boxes; do not duplicate
results here. The ninth box adds the explicitly requested ocean behavior rather
than hiding it in a terrain-contact claim. All nine criteria
are `local`, performed by the implementing agent. A Linux native host executable
was present at planning time; this is availability, not runtime proof.

- [ ] AC-8 [local, actor: implementing agent]: Each of the five starter worlds exports as a complete self-contained GLB usable by an ordinary game. proof: planned `pnpm --filter strata-terrain-preview test:consumer` — Evidence: pending; author through packed public imports, export all five, then load/render in isolated vanilla Three.js with `GLTFLoader`, verify terrain/prop content, final transforms, portable embedded PBR maps and zero external-resource/engine dependencies; record export bytes and time. The supplied terrain-only GLB cannot satisfy this criterion.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Agent terrain authoring | Preview build → public `@threenative/terrain` imports → final baked arrays | Supplied HTML's embedded modules become the maintained source; authoring remains headless | AC-1, AC-8 |
| Three.js interoperability | Consumer → `/three` conversion → game-owned `Mesh` in the existing scene | Do not import `ThreeTerrainView` or its renderer/default scene | AC-2 |
| Playable terrain | Preview scene → existing `Heightfield` and physics context | No separate collision resampling or Strata physics backend | AC-3, AC-4 |
| Starter/custom art | Game render source and asset mapping → compiler → `ctx.assets` | Supplied viewer placeholder assets are replaced; custom mappings bypass starter loads | AC-5, AC-6 |
| Realistic ocean | Game-owned ocean source → installed `SpectralOcean` → lit water mesh | Strata water metadata supplies level/extents; it does not become a wave renderer | AC-9, AC-5 |
| Agent discovery | Capability lookup and shipped addon guide → public imports | No HTML inspection or UI-click requirement | AC-7, AC-8 |
| Portable world export | Committed document → evaluated scene/material bake → GLTFExporter → vanilla GLTFLoader | Supplied terrain-only GLB remains explicitly labelled; new world action includes assets | AC-8; PRD-467 AC-8 |

Paths for the new package/preview are proposed. Record actual non-test entry-point
locations when each phase is implemented; no future line numbers are asserted.

## Decisions

- 2026-09-30 (João, execution steering): Attach rendered screenshots to PR #381 at visible milestones. Newly scaffolded create-threenative projects must ship instructions for the optional terrain editor: installation, controller activation/live URL, shared recipe edits, and baked game/portable GLB handoff. Document executable imports/commands only, and keep ordinary game runtime dependencies optional. Verify the instructions in a fresh scaffold under AC-7 and PRD-467 AC-7.

- 2026-09-30 (implementation): The charter forbids editors/recipe systems and admits packages only for isolated dependencies. The explicitly requested narrow terrain-authoring allowance is now written into the charter; runtime recipes and package-owned appearance remain excluded.

- 2026-09-30 (João): I own the supplied Strata code; use MIT. This explicitly authorizes recovering and distributing the supplied modules under the repository's MIT license; retain source hashes and this ownership grant in the addon provenance notice.

- 2026-09-30 (João): Terrain generation is integrated into ThreeNative and still
  consumed through the Three.js contract; abstractions do the authoring heavy work.
- 2026-09-30 (João): Starter art is wanted and must be fully replaceable with custom
  assets, including assets from Fab.
- 2026-09-30 (planning choice): One optional addon, game-owned appearance, build-time
  generation, and finite terrain first. Narrow charter/package allowance is
  proposed explicitly; no independent terrain editor product is being built.
- 2026-09-30 (planning choice): Fab is supported; bundled redistribution is assessed
  per asset license using the source terms cited above.
- 2026-09-30 (João): Default starter geometry is procedural trees/rocks/etc with
  baked Poly Haven textures; reuse realistic installed ocean mechanisms and aim
  for Unreal look and feel while retaining complete customizability.
- 2026-09-30 (João): A live terrain editor URL and individual object gizmos/GUI
  polish are required. PRD-467 replaces the previous editor-rebuild exclusion.
- 2026-09-30 (João): Deliver the five environment starters in the stated priority
  order, with Temperate Forest/Grassland first; final output is a portable GLB.
- 2026-09-30 (João): Embed spatial inspection/reference alignment and measurable
  terrain-surface feedback in PRD-467 to support reconstruction from maps/screenshots.
- 2026-09-30 (João): Include editable atmosphere/environment, controller camera
  CRUD/focus and arbitrary supported GLB/image imports; required PRD-468 owns
  these additional consumer paths while preserving the standard Three.js contract.
- 2026-09-30 (planning choice): Vegetation search surfaced reusable `mergeParts`,
  `InstancedBatch`, `createRandom`, and static/culling mechanisms, not a dedicated
  installed grass/tree generator. Recover the supplied procedural builders and
  keep appearance source editable. Do not misuse `SoftBody3D` cloth simulation
  as a solver per grass blade. Preserve candidate identity for editor overrides.

## Execution Phases

### Phase 1: Independent authoring library and Three.js output

**Status:** VERIFIED

**Files:** `packages/terrain/package.json`, `src/index.ts`, recovered `src/core/*`,
`src/three.ts`, public declarations, `AGENT_GUIDE.md`, and
`__tests__/terrain-consumer.spec.ts`; `docs/architecture/CHARTER.md` for the narrow
authoring/package allowance. New paths are proposed; recover rather than redesign.

**Implementation:** Port the supplied public evaluator with its validation and
transactions intact; export one small Three.js geometry adapter. Keep appearance
code, DOM, workers, CDN imports, and the editor out of runtime imports. Add the
addon to the normal build/release configuration without making core depend on it.
Document the generator's source ownership and retain any original license notice;
the supplied HTML alone is not proof of a third-party code license.

- [x] AC-1 [local, actor: implementing agent]: A public-import Node consumer evaluates the seeded recipe with stable-ID replacement and atomic validation failures. proof: `pnpm exec vitest run packages/terrain/__tests__/terrain-consumer.spec.ts` — Evidence: public-consumer suite passes 7 tests; deterministic arrays, stable-ID replacement, failed-patch rollback and headless imports verified. A SHA-256 regression preserves supplied noise/hydraulic/thermal output. The initial integration baseline directly compared supplied Alpine/Coastal/Desert at resolution 33, matching every layer height/splat buffer and final placements/biomes. PRD-467 subsequently fixes the supplied scatter identity/RNG defect: placement keys and distributions intentionally change; the supplied noise/erosion SHA-256 regression still passes.
- [x] AC-2 [local, actor: implementing agent]: Generated terrain is ordinary indexed geometry compatible with the consumer's Three.js identity. proof: `pnpm exec vitest run packages/terrain/__tests__/terrain-consumer.spec.ts` — Evidence: the same 7 tests pass with the consumer's `BufferGeometry`, custom magenta material and downward raycaster; upward winding, finite indexed attributes, collision arrays and caller disposal verified. Empty/nonfinite/wrongly typed GLB input fails; explicit palettes are optional and no material is selected by the addon.

### Phase 2: ThreeNative rendering and matching collision

**Status:** VERIFIED

**Files:** `examples/strata-terrain-preview/package.json`, existing-template-derived
build config, `src/game.ts`, `src/world/terrain.ts`, `src/render/terrain.ts`,
`src/render/ocean.ts`, and
`playtests/terrain.playtest.json`. Extend relevant existing engine tests only if
the asymmetric fixture demonstrates a shared engine defect.

**Implementation:** Bake the representative recipe before game startup; render its
mesh in the normal game scene and register collision through the owning physics
context. Match coordinates and triangle surfaces. Exercise an asymmetric height
fixture as well as the hill/road, with a grounded moving character. Reuse the
existing asset/build/playtest paths for both targets. Expose measured contact error
and travel distance through the existing playtest bridge; never hardcode success.
Adapt the existing sailing ocean source; use game-owned atmosphere/lighting and
material source. Ocean compute advances every frame without reevaluating terrain.

- [x] AC-3 [local, actor: implementing agent]: Browser WebGPU play exercises the generated hill/road with matching rendered and physical ground. proof: `pnpm --filter strata-terrain-preview test:terrain:web` — Evidence: PASS 2026-09-30 — existing runner with `--browser-recipe webgpu --headed`, NVIDIA/turing RTX 2080, 903 scenario ticks; the resource wait observes at least 50 m of walking (62.94 m in the isolated walk), grounded character, 371 coastal contact samples and maximum error 0.000043 m (isolated walk 609 samples, 0.000057 m). The 17×17 asymmetric fixture includes both cell interiors/diagonal sides and exact edge/corner probes, with measured bilinear-vs-triangle difference 1.5 m. No console, runtime or asset errors; inspected nonblank screenshots are attached on the PR. Walking probes compare identical oblique rays through the rendered and physical surfaces; this is not a claim that Rapier’s near-boundary vertical ray miss is fixed.
- [x] AC-4 [local, actor: implementing agent]: The same baked terrain scenario runs in the Linux native desktop host. proof: `pnpm --filter strata-terrain-preview test:terrain:desktop` — Evidence: PASS 2026-09-30 — existing native bundler plus `--target desktop --executable ../../packages/runtime-native/build/tn-linux/mystral` and `run dist/strata-terrain-native.js`; 903 scenario ticks, observed 50 m travel wait, grounded character, 371 final ground samples and maximum mesh/physics error 0.000043 m. NVIDIA RTX 2080 host, inspected nonblank terrain/coastal captures, no runtime/console errors. A separate host run completes 300 render frames in 7,655 ms and captures nonblank terrain (226 presentations; not a steady-state FPS result). Ocean compute/readback and actual displaced/lit water captures pass; mobile results are not claimed.
- [x] AC-9 [local, actor: implementing agent]: The coastal ocean mesh visibly consumes the installed spectral simulation in the game scene. proof: AC-3 and AC-4 scenario runs — Evidence: PASS 2026-10-01 — both target scripts pass the shared scenario and the installed PNG inspection check. Camera-matched early/later water captures change 71.2% of qualified water pixels; after moving the actual directional light, 54.2% change. Directly inspected browser/native captures show displaced wave shading, depth-colour transition and foam/masking from the baked coast. The lit standard node material consumes both spectral cascade buffers and central-difference normals. CPU sample slopes are reported separately as stale readback, not a numerical rendered-normal measurement. Both targets observe compute/readback activity; no runtime/asset errors. Final starter art/atmosphere quality remains AC-5.

Phase 2 verified: the preview bakes seeded 512 m / 257-vertex forest and
coastal worlds before startup and consumes only baked arrays in its game graph.
Headed browser capture names NVIDIA/turing; headless Chromium selected SwiftShader
and lost its WebGPU instance. Browser/native artifacts have separate directories.
The first native ocean failure was game clock wiring: deterministic ticks do not
run beforeRender. Ocean.advance now runs in Scene.update before compute dispatch.
The scenario observes 361 spectral steps and 360 samples. Two recorded ocean times
and an actual sunlight change qualify visible displaced/normal-lit water on both
targets; the game-owned shader samples canonical baked heights for depth colour,
shore foam and opacity. CPU slope variation remains a stale readback proxy.
The separate native host run renders 300 frames and captures the terrain; its
226 presentations and wall time are not a steady-state frame-rate claim.

Raw Rapier reproduces a vertical-ray miss at z=159.99998474121094 near a
heightfield grid boundary. Walking probes compare identical oblique rays in mesh
and physics; asymmetric fixtures retain exact vertical edge/corner checks. This
does not claim the dependency's near-boundary vertical miss is fixed.

### Phase 3: Replaceable starter assets and cold-agent workflow

**Status:** PARTIAL

**Files:** `packages/terrain/starter-assets/`, editable starter source under
`packages/terrain/starter/`, preview `src/world/terrainAssets.ts` and
`src/render/terrain.ts`, `packages/terrain/__tests__/starter-assets.spec.ts`,
`packages/create-threenative/capabilities.json` through its generator, and addon
agent documentation. Update the relevant template guidance and regenerate its
`CLAUDE.md` mirror only when the guidance changes.

**Implementation:** Prepare the bounded texture set and source/license metadata;
copy editable procedural builders, material, ocean, lighting, and mapping source
into the preview. Reuse seeded randomness, geometry merging, cooking, loading,
and instancing. Extend `test:terrain:web` / `test:terrain:desktop` with the fixed
visual benchmark cameras and inspect their actual captures against the rubric.
Use `FrameBudget` to record main/shadow/reflection cost at the representative prop
count; choose existing AO/SSR stages by measured benefit, not a blanket preset.
Add all five editable starter documents/mappings and the portable full-world
GLTFExporter path, including material/deformation baking and ordinary node
instances. Keep full-world export semantics distinct from the supplied legacy
terrain-only GLB. Extend the packed/vanilla consumer for all five files.
Custom assets, including licensed Fab assets, are supplied
as normal local models/textures; no special import format or vendor account is
needed. The automated replacement test uses attributable custom test art, not
private paid files. Make public terrain authoring discoverable in the installed
capability workflow without claiming optional imports exist before installation.

**Vegetation lane (owner: "trees are not ok, leaves look like crap; why insist on procedural
trees?").** The Temperate forest now draws the owner's licensed **Landscape Pro 2.0** pack
(Fab listing `1ac647da-b1bc-4e72-a56d-60aaeb6918e1`) instead of procedural trees:
`scripts/prep-landscape-pro.mjs` copies nine species plus three's Basis transcoder from the owner's
Fab import into the gitignored `local-assets/landscape-pro/` (1.4 MB of meshopt-compressed meshes,
11.4 MB with the pack's shared UASTC images; `--raw` reads the uncooked import instead), and
`src/render/pack.ts` loads them as ordinary prop variants — no new package, no new mechanism.
Measured by `pnpm --filter strata-terrain-preview test:terrain:web` on the RTX 2080 at 1920x1080:
prop draws 20 -> **24** (the scenario's ceiling, unchanged — the CC0 rocks' second LOD level paid for
the canopy's), prop triangles 1.92 M -> **2.20 M**, prop instances 6,672 -> 7,361, and the two judged
framings' p50 frame cost measured **3.9-7.4 ms at the meadow and 3.2-5.7 ms at the overview across
four runs** — a spread wider than the change, on a host whose load average was 15-26 from other
agents' browser benchmarks, and the engine's own scene warning names `objectsConsidered` rather than
triangles as the dominant term. Wildwood's per-section gains (`[3.9, 3.4, 2.7]` bark,
`[3.3, 3.6, 2.8]` leaf) render paper-white under this sky's 3.2-intensity sun and AgX curve and were
cut to about a third with a mip-compensated cutoff, which is what the captures show. The draw ceiling
was **not** raised. With the folder absent the world grows the procedural spruce, boulder, fern, grass
and poppy as before; that fallback run is recorded with this note. AC-5 stays open: one environment's
vegetation is not five.

#### Terrain relief pass (2026-10-02), Evidence: measured, plus four engine bugs

Owner feedback on the round-4 captures: *"everything too plane and thin. No erosion, cliffs, etc.
Looks unrealistic and synthetic."* Three of the four causes were engine defects, not recipe taste.

**Engine.** `hydraulic()` defaulted to a flat 5000 droplets at any resolution, so a 257-vertex world
got one droplet per 13 cells. The default is now grid-scaled (`n²` droplets, `maxSteps` that can cross
the world). Raising the count alone was not the fix: with the old 0.25 per-step bite, one droplet per
cell carved **746** single-cell dimples standing a metre proud of their neighbours, and incision
*fell* past ~0.5 n² because every extra droplet re-dug the same lines. A shallow 0.03 bite over the
same budget incises the same drainage (0.8 % of cells) with 14 spikes. Both are red-green in
`packages/terrain/__tests__/erosion-defaults.spec.ts`, including the spike assertion, which fails
against the 0.25 bite.

Two further engine bugs surfaced while measuring, both silent:
- `brushWeights` fell back to `mask ?? new Float32Array(len)` for a layer with no `at`/`points`.
  A fresh `Float32Array` is all **zeros**, so a brushless layer covered *nothing*: `smooth` was a
  no-op and `sculpt` added nothing. Now filled with ones
  (`terrain-consumer.spec.ts`: "applies a brush operation over the whole world when no brush is given").
- The bake cache's skip called `process.exit(0)`, which killed `measure-spikes.mjs` — it reported
  zero spikes without ever counting any. The skip is now entry-point only.

**Recipes** (`scripts/bake.mjs`, all five worlds). Billow folds for the shoulders and troughs the
carve then drains; one settle pass, not two; a thermal talus per world (40° scree on the alpine,
38° coastal cliff, 36° forest); terrace on the mesa walls; every hardcoded 1200-5000 droplet count
dropped for the grid default. The forest stream is re-traced — the old points ran off the east edge
under the new landform — and the lake reseeded onto the basin it actually ends in.

Measured by `scripts/measure-terrain.mjs` (D8 flow accumulation, prominence > 1 m as a spike):

| world | relief | % >30° | % >45° | channels % | spikes | bake ms |
| --- | --- | --- | --- | --- | --- | --- |
| forest | 76 → **91 m** | 3.8 → **22.4** | 0.7 → **3.0** | 7.4 → 4.9 | 1 → **3** | 2595 |
| coastal | 118 → **124 m** | 9.5 → **30.9** | 1.7 → **6.3** | 10.9 → 6.6 | 1 → **5** | 1554 |
| alpine | 150 → **181 m** | 21.3 → **35.6** | 11.8 → **15.7** | 7.4 → 6.6 | 104 → **28** | 1903 |
| desert | 74 → **70 m** | 11.3 → 11.3 | 8.5 → **6.5** | 5.9 → 4.4 | 93 → **10** | 1604 |
| tundra | 14 → **46 m** | 0.6 → **22.4** | 0.0 → 1.2 | 5.3 → 4.7 | 10 → **0** | 1787 |

Alpine and desert spikes fell from 104/93 to 28/10; the mesa stamp's own fbm skin at `roughness:
0.25` was standing a metre proud over a tenth of the desert, now 0.06. Bake is authoring-time only and
`pnpm dev` now skips an unchanged bake (19 s → 0.07 s), which the 15 s dev-server readiness budget
required. Gates: `pnpm --filter @threenative/terrain build` clean, `vitest run packages/terrain` 59/59,
`--filter strata-terrain-preview typecheck` clean, `pnpm lint` shows no diagnostic in any file this
change touches (its 10 errors are pre-existing on `develop`). Captures inspected directly:
`overview.png` shows dendritic drainage with rock in the channels, `forest-walk.png` a cut bank and a
worn dirt scatter, `river.png` the lake sitting in the basin the traced stream feeds. **AC-5 stays
open** — this fixes terrain only; the five environments' art, atmosphere and the coastal/alpine/
desert/tundra *defining views* are not yet captured and judged.

- [ ] AC-5 [local, actor: implementing agent]: The five editable starter environments satisfy their defining terrain/art coverage and Unreal-like visual rubric. proof: planned `pnpm exec vitest run packages/terrain/__tests__/starter-assets.spec.ts` plus AC-3/AC-4 benchmark captures — Evidence: partial (terrain half; see the relief pass above). Terrain relief, drainage, talus and mesa benches are measured and the temperate captures inspected; still pending: the four non-temperate defining views, final art and atmosphere, and the 25 MiB cooked budget per starter with no runtime fetches. Asset tests or nonblank captures alone cannot tick this visual criterion.
- [ ] AC-6 [local, actor: implementing agent]: A consumer completely replaces starter materials and placement models without generator edits. proof: `pnpm --filter strata-terrain-preview test:terrain:custom` — Evidence: pending; planned script runs the existing scenario with custom local material/model mappings, verifies the new model/material identities, zero starter asset requests, and unchanged terrain/collision arrays; a missing referenced asset fails by name.
- [ ] AC-7 [local, actor: implementing agent]: Installed capability lookup leads an agent to the actual public terrain authoring API. proof: `pnpm build` plus `pnpm capabilities:check` and packed-consumer capability lookup in `test:consumer` — Evidence: pending; request/individual-mechanic queries resolve installed imports and truthful constraints, including units, seed, resolution, synchronous evaluation, and custom art ownership. Fresh create-threenative output includes the optional terrain/editor install and workflow instructions, linked to the shipped addon guide; verify the generated AGENTS/CLAUDE mirrors and packed editor entry without adding authoring dependencies to ordinary game runtime.

## Verification and delivery

Phase 1 implementation: `packages/terrain/src/index.ts` is headless, and
`packages/terrain/src/three.ts` is the geometry-only consumer entry. The optional
package is discovered by the existing workspace/release scans; no core dependency
or custom release list was added. `pnpm --filter @threenative/terrain test` passes
7 consumer tests and both ordinary/strict publint. The approximately 3,700 typed
source lines recover the supplied evaluator/codecs rather than duplicate an
installed system; the geometry adapter is 25 lines and chooses no appearance.
The kill-switch review retained the supplied algorithms and reused the ordinary
Three.js geometry classes and package build/release discovery.

Repository integration: `pnpm typecheck`, `pnpm build`, `pnpm lint`,
`pnpm capabilities:check`, `pnpm budgets` and `pnpm check:docs` pass. The
`pnpm test` package phase passes after native contract prerequisites were built;
`pnpm gate:resume` reruns the failed unit phase successfully: 520 files, 6,468
tests pass; 3 files/12 tests are existing skips. Six prescribed docs suites pass
180 tests; the changed mirror/CI suites pass 149 tests. The full suite also
identified the required README package row, generated release comment, scoped
package test selector and a reasoned waiver for the exact supplied noise
coefficient; those integration fixes pass 15 targeted tests and retain compatibility. Those full-repository results used the original `0625f0f26` develop baseline.
The PR branch subsequently received develop commit `7d8367a58`; the terrain
consumer suite (7 tests), package integration suites (15 tests), strict publint
and capability regeneration pass again on the preserved merged baseline. Full
repository checks will be refreshed with the next behavior phase. The subsequently rerun browser/native scenarios verify rendering/contact and
coastal wave/lighting behavior. Editor, starter-art and full-world export remain open.


Commands naming the new package, example, tests, and `test:terrain:*` /
`test:consumer` scripts are **implementation targets**, not shipped commands today.
Each wrapper must invoke the existing harness; do not create another runner. Run
`pnpm prd:progress` before execution and after each phase. Tick only verified work.

Behavior work uses genuine red/green against public consumer paths. Final affected
repository gates include `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
`pnpm budgets`, and the selected existing CI/native gates. Document changes receive
the existing docs checks and necessary mirror regeneration. Keep results on the
owning boxes/PR, not separate verification reports.

One implementation PR targets `develop`, opened as a draft before phase 1 starts.
Use an owning-repository worktree, update its progress label, and archive this PRD
only after all nine boxes have current evidence. Overall requested integration
also requires PRD-467; do not describe a runtime-only delivery as editor completion.
It also requires PRD-468; live atmosphere/cameras/imports are part of the request.
Publishing requires its own
explicit authorization; packing tarballs and exercising a local install do not.

Scaffold instruction progress (2026-09-30): all ten template AGENTS files link to
`node_modules/create-threenative/agent-docs/references/terrain-authoring.md`;
their generated CLAUDE mirrors include the same guidance. The shipped guide
covers the optional authoring dependency, existing public Terrain/Mask/bake
imports, stable recipe edits, caller-owned materials, triangle/collision units,
and keeping evaluation out of the game loop. Template/mirror suites pass 48
checks (including all ten pristine scaffold typechecks), documentation links pass,
and the six prescribed documentation suites pass 180 checks. Live editor
installation/controller instructions and packed editor/scaffold proof remain
pending; AC-7 stays open until those APIs land.

The updated scaffold-tree snapshot passes all 60 scaffold checks after the
intentional AGENTS/CLAUDE instruction change. Root typecheck, lint and budgets
pass; the generated bake is ignored by Biome rather than increasing its input
size limit. Full refresh on the integrated develop baseline passes 520 unit files / 6,476
tests (3 files / 12 existing skips), plus workspace builds and package checks.
The subsequent game clock wiring is covered by the rerun example typecheck and
shared runtime scenario; no new full-suite verdict is claimed for that edit.

Phase 2 visual refresh (2026-10-01): both target scripts include the runnable
`verify-ocean.mjs` check, reusing the native conformance PNG inspector. Browser
and native shoreline/wave/sun captures are inspected and attached to PR #381.
The shoreline refresh passes root typecheck, lint, budgets and doc links; six
documentation suites pass 180 tests. Root `pnpm test` completes workspace/package
checks and 6,475 unit tests, with one source-hygiene failure because a removed
tracked palette file had not yet been staged. Staging that deletion fixes the
index-based scan; its one test then passes. This reports the actual full-command
failure and targeted repair, not a cached or invented full-command success.


Static-world export milestone (2026-10-01): `@threenative/terrain/export`
uses the installed GLTFExporter for ordinary shared-mesh nodes and embedded byte
PBR images. The caller supplies canonical terrain, actual static models and final
grounded placement matrices. Six public guards reject unresolved models/matrices,
noncanonical geometry, nonpositive/sheared poses, invisible models, unbaked
shader/displacement surfaces, missing/wrong-role PBR maps, malformed RGBA data,
object-space/anisotropic normals and missing/stale/incoherent water. DOM-free
imports remain separate from browser FileReader/canvas encoding. Frozen geometry,
images and materials prevent source edits from mixing the asynchronous snapshot.

The real renderer exports 100 actual final placement matrices, including saved
position `[12,100,-4]`, 90-degree yaw, nonuniform scale `[2,.5,1.5]` and grounding
false. The 1,218,368-byte GLB encodes in 301 ms in the observed run. A temporary
consumer installs only the packed installed Three.js, loads through GLTFLoader
and compares every component of all 100 matrices. Four embedded PNG PBR bindings,
101 meshes, shared model mesh data, no external image/buffer URIs, no required
instancing extension and no cameras/animations are verified. The vanilla capture
uses WebGLRenderer on Mesa llvmpipe; producer WebGPU provenance must not be used
to claim consumer WebGPU or hardware FPS. An ordinary ThreeNative Linux game
with no terrain authoring imports loads that same GLB through `ctx.assets.model`;
its actual scene/resource observations and inspected screenshot pass. Eleven
static decoded-content assertions declare their held-invariant reasons; the frame
counter must change during the scenario.

This is a bounded interchange proof with 16-pixel test maps, not final starter
art. The producer first refuses its unresolved river without changing the saved
revision, then explicitly removes it from the temporary fixture for successful
static-world proof. Chosen-resolution evaluation/material/deformation baking,
coherent ocean/river export, the default GUI action, all five realistic starter
exports and packed-scaffold handoff remain open. The generated API/capability
snapshots and shipped addon guide now name the explicit `/export` contract.
Actual vanilla/native/reassignment screenshots are tracked under
`docs/verification/visuals/strata/` and will be attached to PR #381.
