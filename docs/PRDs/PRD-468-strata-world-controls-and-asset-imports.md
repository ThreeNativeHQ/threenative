# PRD-468 — Live world atmosphere, controller cameras, and asset injection

**Status:** NOT STARTED
**Complexity:** 7 (HIGH); risk override: none
**Owner:** ThreeNative maintainers
**Depends on:** PRD-466's public rendering/asset/export contract and PRD-467 phase 1's shared document/live session
**Progress:** 0/7 required boxes verified

## Context

João requires the AI controller to create/read/update/delete cameras, change camera
focus, and inject custom GLB models or image textures on demand using the
ThreeNative asset MCP. Atmosphere and the surrounding world presentation are
editable too: sky, sun, haze/fog, lighting/exposure, environment images and ocean.
The user sees these changes at the live terrain-editor link returned by PRD-467.
Agent-first authoring, complete custom replacement, an Unreal-like visual goal and
a portable full-world GLB remain the outcomes.

This is required companion scope, split from PRD-466/467 to keep each plan at three
phases/about eight boxes. It is not a later optional feature. Their ninth boxes
retain the separately requested ocean and spatial diagnostics; additional camera,
environment and import outcomes have their own bounded checklist here. Complexity
is 3 for the affected implementation files, 2 for live asset/material consumption,
and 2 for the editor/runtime/export boundary. This request authorizes planning,
not implementation or publication.

## Solution

### One live world, ordinary Three.js objects

Extend PRD-467's saved authoring document, semantic transactions, revision checks,
undo/redo and local middleware. Environment and camera fields are authoring
settings consumed by editable game render source, not a new runtime scene format.
Use the same renderer, scene, selection IDs and controller session. Camera-only
and environment-only operations must not reevaluate/erode terrain, rebuild its
collider or restart the scene. Reuse normal Three.js cameras, lights, textures and
models through the existing engine context.

Capability search/detail identified `Atmosphere`, `AtmosphereLuts`,
`resolveAtmosphereParameters`, `updateAtmosphereParameters`,
`directionalTransmittance`, `WorldEnvironment` and `createAssetLoader`.
Atmosphere owns compute/LUT lifetime, not sky meshes, materials or lights; the game
supplies all scattering coefficients and radii. `WorldEnvironment` is generated
game source, not a new engine package. Its `TN_RENDER_CHAIN` reports applied/dropped
stages with reasons; this is not proof that their pixels look right. Discovery
found no camera-bookmark CRUD system: use installed PerspectiveCamera,
OrthographicCamera, `lookAt`, bounds and the recovered orbit controls.

### Controller camera CRUD and focus

Expose documented structured operations through the shared authoring API/local
endpoint: create, get/list, update, delete, activate, and focus a camera. Return
stable IDs, current values, active-camera ID and revision. Save named cameras with
position, target, up, projection type, perspective FOV or orthographic extent/zoom,
and near/far planes. Reads also expose the actual current viewer pose; manual orbit
changes must not make controller observations stale or be reset by terrain rebakes.
Persist an orbit edit to a bookmark only through an explicit save/update action.

Validate finite values, noncoincident position/target, usable up vector, positive
zoom, valid FOV and ordered clipping planes. Compute aspect from the current
viewport rather than saving a stale browser aspect. Deleting the active camera
selects the ordinary editor fallback and reports it; unknown IDs fail without
changing the view. API and GUI camera lists/inspectors consume the same operations.

Focus targets may be a local XYZ point, stable selected prop ID, registered
landmark or terrain region. Resolve actual world bounds/registered coordinates;
frame with viewport aspect and projection, derive a useful distance/clipping range
and expose framing-margin overrides. Do not focus an instancing batch when one
tree was requested. Update world matrices before reading hidden-object bounds.
An orthographic top-down camera supports map overlays and surface inspection.
Missing targets return named diagnostics and retain the last valid camera.

### Editable atmosphere and environment

Provide controller reads/patches and GUI fields for the following appearance
groups. The same saved settings drive the live editor and baked-world preview.

| Group | Required editable behavior |
| --- | --- |
| Sky/atmosphere | Procedural physical sky or imported background image, sun direction/elevation, scattering parameters and atmospheric depth/haze. Reuse atmosphere LUT updates and game-owned sky/material source. |
| Lighting/exposure | Sun colour/intensity, environment illumination/rotation/intensity, exposure and existing tone/post settings. Sky/background and illumination are independently selectable. |
| Fog | Enable/disable and tune game-owned distance/height fog where the chosen render source supports it; reuse installed atmospheric aerial perspective for depth haze. Unsupported selected modes return a diagnostic, never a silent replacement. |
| Water | Ocean level/extents and supported spectral/appearance parameters from PRD-466's existing ocean source, without a terrain rebuild unless the edit also changes its recipe. |
| Custom look | Replace the sky/material/post source or all environment mappings in project source; no package edits and no locked starter style. |

Persist explicit units and complete validated physical atmosphere parameters.
Initial values come from the selected editable starter, with named overrides.
Recompute only affected LUTs/material bindings. Invalid values preserve the last
valid scene/document; failed or rebuilding environment loads show status. Imported
HDR illumination and a procedural sun must have explicit authored contributions,
so swapping backgrounds does not silently double light intensity. Keep controller
readbacks and the GUI on the same rendered/requested revision, including pending
LUT/asset work. New cloud/weather solvers are not a prerequisite; custom sky source
remains replaceable rather than claiming an installed weather simulation.

### Import models, surface images and environment images on demand

The GUI offers file picker/drop import; the agent can register local files returned
by the existing ThreeNative asset MCP without UI clicks. Both paths stage bounded
files and create stable project asset IDs under the preview/game's `assets/` tree.
Store source hash, project-relative path, type, measured bounds, provenance/license
metadata where supplied, and preparation status. Same-name conflicts require an
explicit replacement or new ID; failure retains existing art and the document.
Do not erase referenced files when removing a palette entry or undoing placement.

| Input | Consumption |
| --- | --- |
| GLB | Any valid model supported by the installed loader, not a starter allowlist. Load through `ctx.assets.model()`, expose measured bounds and explicit source-unit/scale/pivot adjustments, and make it available for placement/scatter and the existing individual gizmo. A rigged import may be placed in a declared static pose; this does not add animation authoring. |
| PBR image | Supported PNG/JPEG/WebP images are assigned explicitly as albedo, normal, roughness, AO, height, opacity or other game-owned material inputs. Decode/validate, cook through existing asset preparation, and use `ctx.assets.texture()` with colour data in sRGB and numerical maps linear. Images are not assumed to be heightmaps or models. |
| Environment image | HDR/EXR equirectangular files, or supported ordinary environment images, may be assigned to background and/or environment lighting. Resolve local/cooked paths with `ctx.assets.resolve()` and reuse installed `three/addons/loaders/HDRLoader.js`/`EXRLoader.js`; do not send HDR through the ordinary image texture decoder or clamp its radiance as albedo. |

Loading/preparation happens asynchronously with visible asset-specific progress.
Promote a mapping only when validation/load succeeds, then update affected objects
or materials in the open scene. New files use content-addressed/versioned loader
paths to avoid stale cache reuse. Reuse the existing compiler and asset cache;
preserve tiling textures rather than indiscriminately atlasing them. Import byte
and decoded-dimension limits are explicit, configurable project limits; the
25 MiB starter budget is not a ban on larger custom models.

Validate actual file format, finite geometry, image dimensions, dependencies and
supported extensions. Report missing/unsupported resources by name; never promise
all malformed GLBs, image codecs or proprietary shader formats will work. External
GLB references require explicitly supplied project-local dependencies and are not
silently fetched. Browser requests cannot select arbitrary filesystem paths; use
bounded uploads or configured project-local registration. The trusted local agent
can copy MCP outputs into the project before registration.

Reuse existing MCP Poly Haven downloads, Fab owned/free import tools and local
Unreal-to-GLB conversion where applicable; do not build a new marketplace client.
Honor their supplied license acknowledgement/provenance contracts. No purchase,
account login, public sharing or bundling private art is needed to test imports.
The automated fixture uses licensed test files in the same local-file shape as
MCP outputs; an actual marketplace account is not a closure dependency.

### Portable output and editable presentation

Imported placed models and surface images must survive PRD-466's self-contained
full-world GLB export with final transforms and ordinary PBR maps. Default export
requires no compressed-texture/instancing/engine extension or external files.
Do not replace imported geometry with the procedural starter during export.

Atmosphere, fog, HDR environment illumination, exposure and the live post chain
are receiving-game responsibilities; they are not standard GLB scene settings.
Preserve their settings/source assets in the authoring project and optional sidecar
with explicit export diagnostics. Export named authored cameras only by explicit
option, as standard glTF perspective/orthographic cameras; default editor/debug
cameras, gizmos and reference overlays remain excluded. This limitation must be
visible in the export result, not an implied promise of identical lighting in any
game. The static GLB still loads and renders without ThreeNative or the sidecar.

## Scope and ownership

PRD-467 owns document/middleware validation, live activation/link, recovered UI,
selection and spatial inspection. This PRD owns narrow camera/environment/import
operations and their live consumers, with shared validators updated in sequence
when integrating. PRD-466 owns terrain conversion, collision, ocean and full-world
export. Appearance remains editable preview/game source, never engine defaults.
New paths below are proposed, not shipped entry points. No generic editor, second
asset cache, hosted upload service, new engine scene format or weather framework.

## Acceptance Criteria

AC-1 through AC-6 are phase boxes; AC-7 proves the portable consumer handoff.
All are `local`, actor: implementing agent. Commands below are implementation
targets using the existing Vitest/playtest/packed-consumer paths, not shipped
scripts today. Every named camera/environment/import operation is public and
reachable through the live authoring session rather than an internal test helper.

- [ ] AC-7 [local, actor: implementing agent]: An imported-and-edited world exports for an ordinary game without its authoring runtime. proof: planned `pnpm --filter strata-terrain-preview test:consumer` — Evidence: pending; import a custom GLB and PBR image, place/gizmo them, save/reload, export and render through isolated vanilla GLTFLoader; assert final identities/transforms and embedded image content with no external requests. Explicit camera export produces standard glTF cameras; default editor cameras remain absent. The export result identifies environment effects carried separately.

## Integration Ledger

| Capability | Real consumer path | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Camera lifecycle/focus | Controller/GUI operation → saved bookmark or live pose → actual Three.js camera | UI-only orbit access and guessed focus coordinates | AC-1, AC-2 |
| Atmosphere and look | Shared settings patch → game render source/installed atmosphere → visible live world | fixed showcase lighting or a second atmosphere solver | AC-3 |
| Model injection | GUI upload/agent local registration → project assets → compiler/ctx.assets → placed prop | closed starter catalog and transient dropped-file objects | AC-4 |
| Surface/environment images | Registered image → semantic mapping → texture/HDR loader → actual material/sky | hardwired starter textures and mismatched colour spaces | AC-5, AC-6 |
| Portable delivery | Committed document/imports → PRD-466 world exporter → vanilla game | starter substitution and environment-code portability claims | AC-7 |

## Decisions

- 2026-09-30 (João): Controller camera CRUD and camera focus are required.
- 2026-09-30 (João): Import custom GLBs and image textures, including assets
  supplied on demand through the ThreeNative asset MCP.
- 2026-09-30 (João): Atmosphere and surrounding presentation are part of the world.
- 2026-09-30 (planning choice): Reuse the shared editor session, standard Three.js
  cameras and installed atmosphere/loaders; qualify these consumer paths separately
  to preserve the three-phase/about-eight-box limit. All three PRDs are required.

## Execution Phases

### Phase 1: Controller cameras in the live editor

**Status:** NOT STARTED
**Files:** proposed `packages/terrain/editor/cameras.ts`, shared document/operation
validation, recovered camera inspector/orbit integration and
`__tests__/editor-cameras.spec.ts`; extend the existing editor scenario.
**Implementation:** Add bookmarks/actual-view reads and CRUD/activate/focus through
public middleware. Reuse projection/bounds/orbit controls and stable target IDs.

- [ ] AC-1 [local, actor: implementing agent]: Controller camera CRUD changes the actual live camera and survives document reload. proof: planned `pnpm exec vitest run packages/terrain/__tests__/editor-cameras.spec.ts` through public middleware plus `pnpm --filter strata-terrain-preview test:terrain:editor` — Evidence: pending; create/list/get/update/activate/delete, observe projection/view changes and active-deletion fallback, retain manual orbit on terrain rebake, and reject invalid/stale writes without terrain evaluation.
- [ ] AC-2 [local, actor: implementing agent]: Controller focus frames the requested object or location in either projection. proof: planned `test:terrain:editor` — Evidence: pending; focus one nonuniformly scaled prop instance while siblings stay unchanged, a landmark/region and a point; measure target inside the safe frame at two viewport aspects, exercise orthographic map view, and retain the view on unknown target errors.

### Phase 2: Editable live atmosphere and model injection

**Status:** NOT STARTED
**Files:** proposed `editor/environment.ts`, `editor/assetImport.ts`, existing
document validators/inspector, preview game-owned `src/render/` and
`src/world/terrainAssets.ts`; extend existing compiler/loader wiring and scenario.
**Implementation:** Bind validated appearance settings to existing atmosphere/
lighting/ocean source. Register staged GLBs from GUI and agent-local MCP-shaped
inputs into project asset mappings. Asset import and camera implementation can
proceed independently once PRD-467's shared document contract is stable; integrate
shared validators sequentially.

- [ ] AC-3 [local, actor: implementing agent]: AI and GUI atmosphere/environment edits visibly update the same live world. proof: planned `pnpm --filter strata-terrain-preview test:terrain:editor` — Evidence: pending; change sun direction/intensity, scattering/haze, supported fog, exposure and ocean appearance; inspect fixed-camera captures and rendered revision/chain status, preserve terrain/collision arrays, persist settings after reload, and retain valid appearance after rejected values or failed LUT work.
- [ ] AC-4 [local, actor: implementing agent]: A custom GLB enters the palette and is placed/selected in the live editor through either import path. proof: planned `test:terrain:editor` plus public import middleware checks — Evidence: pending; exercise actual GUI file import and local agent registration from an MCP-shaped file result, measure/override scale, scatter and gizmo one instance, survive reload, and report invalid/unsupported assets without replacing valid art or escaping project paths.

### Phase 3: Image injection and portable handoff

**Status:** NOT STARTED
**Files:** proposed `editor/assetImport.ts` image validation/mapping, material and
environment inspectors/source, `__tests__/editor-assets.spec.ts`, existing export
integration, consumer fixture and addon agent guide.
**Implementation:** Register surface/environment images, prepare/load with existing
colour-space-aware texture/HDR paths, preserve mappings after reload, and extend
the full-world consumer fixture rather than introducing another exporter.

- [ ] AC-5 [local, actor: implementing agent]: Imported PBR images replace chosen live surface inputs and retain their numerical meaning. proof: planned `pnpm exec vitest run packages/terrain/__tests__/editor-assets.spec.ts` through public import/mapping operations plus `test:terrain:editor` — Evidence: pending; import colour and normal/roughness fixtures via GUI/agent paths, observe actual material/image identities and sRGB/linear configuration, reload and explicitly replace an asset without stale cache pixels or starter loads.
- [ ] AC-6 [local, actor: implementing agent]: Imported environment imagery changes the actual background/illumination and remains replaceable. proof: planned `test:terrain:editor` — Evidence: pending; register a licensed HDR or EXR fixture and an ordinary environment image, observe independent background/lighting use with retained HDR radiance, rotation/intensity and saved source hashes; switch back to procedural sky and recover from an invalid image while keeping valid scene state.

## Verification and delivery

Browser WebGPU proves the live authoring controls. Portable output reruns the
affected PRD-466 consumer/native scenarios; platform claims stay limited to those
actually executed. Exercise public operations and visible render changes, not
only document serialization or notification counts. Use genuine behavior
red/green and existing affected checks; prose-only work uses document checks.

Run `pnpm prd:progress` before execution and after each phase. One draft
implementation PR targets `develop` from an owning-repository worktree. Keep
current results on these boxes/the PR; archive only when all seven boxes are
verified. PRD-466/467 and this PRD must all pass before claiming the full requested
integration. Planning does not authorize marketplace purchases or publication.
