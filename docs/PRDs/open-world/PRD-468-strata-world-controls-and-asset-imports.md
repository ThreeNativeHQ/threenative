# PRD-468 — Live world atmosphere, controller cameras, and asset injection

**Status:** NOT STARTED
**Complexity:** 7 (HIGH); risk override: none
**Owner:** ThreeNative maintainers
**Depends on:** PRD-466's public rendering/asset/export contract and PRD-467 phase 1's shared document/live session
**Progress:** 0/8 required boxes verified

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

### Responsibility contract

This is a terrain authoring tool with a realistic preview, not the game's runtime
or a general scene editor. This section is the authoritative boundary for all
three terrain PRDs. A feature is not assigned by which screen exposes it: the
editor may edit an appearance value, while project render source owns what that
value does. New appearance defaults never enter `@threenative/core` or the addon.

| Owner | Required responsibilities | Boundary |
| --- | --- | --- |
| Existing engine packages | Render/compute lifecycle, asset loading/cooking, instancing/culling, physics binding, and installed atmosphere/ocean mechanisms. | No terrain editor state, starter art style, lighting rig, shader composition or camera framing defaults. Extend an engine mechanism only for a demonstrated shared defect/capability gap. |
| `@threenative/terrain` authoring addon | Recover/evaluate Strata recipes; produce canonical geometry/masks/placements and surface diagnostics; adapt to ordinary Three.js geometry and perform tooling-side bakes/exports. | Pure root and `/three` imports do not pull editor/server/DOM code. No game loop, renderer, material factory, physics world, gameplay or requirement that games load recipes. |
| Terrain editor tooling | Saved authoring transactions/history, live link/revisions, selection/gizmos, spatial references, asset registration, preview camera CRUD/focus and controls for project-owned preview settings. | Editor cameras and debug views stay authoring-only. No gameplay entities, follow-camera system, animation editor, runtime scene graph or automatic writes to a game's chosen configuration. |
| Project-owned `src/render/` source and assets | Procedural prop shapes, material construction, texture-channel meaning, sky/sun/fog, ocean surface, lighting/exposure/post composition and all artistic defaults. | Copy starter source into the project; edit/delete/replace it there. Editor controls call those project functions directly with validated values, not a new render-plugin registry or engine-wide appearance vocabulary. |
| Consuming game source | Load chosen baked artifacts, register desired collision, select its own camera, configure appearance and implement interaction/gameplay. | The game runs without an editor URL, authoring document, file watcher, worker or recipe evaluator. A sidecar never spawns nodes, cameras, scripts, colliders or render stages automatically. |

**What the saved document means.** Keep Strata recipe/placement data, project-local
asset references, spatial annotations, named editor cameras and preview environment
values as clearly named authoring groups with documented units. It describes
terrain construction and preview state, not arbitrary game entities or behavior.
Physical water level/extent and biome/material-channel data belong to terrain;
wave bands, foam colour and shading belong to project-owned render source. Each
field has one authoritative owner; controls must not store a second water level
or silently reinterpret a material channel. Actual orbit pose and active viewer
navigation are session state; only explicit bookmark edits enter saved history.

**What an edit invalidates.** Terrain height edits invalidate evaluated geometry
and affected grounding; placement edits invalidate affected instance data; image
mapping edits invalidate the relevant material/asset bindings. Preview atmosphere
edits invalidate only affected render/LUT state; camera navigation changes only
the authoring view. Reading a probe or changing a debug overlay never edits the
world. Any terrain-dependent appearance cache may refresh after a terrain edit,
but a render-only edit must not trigger erosion or collider work.

### Concrete deliverables and game handoff

| Deliverable | Contents and consumer |
| --- | --- |
| Default `world.glb` | Terrain, placed prop geometry, final transforms and embedded portable PBR images; optional static water snapshot. No cameras, lights, fog, HDR environment binding, debug/reference objects, editor state or gameplay. A frozen ocean is labelled static. |
| Authoring project | Recipe/document, original imported assets/provenance, preview settings/bookmarks and editable render source. The agent/editor reopens it; games do not deserialize it at startup. |
| Explicit ThreeNative handoff | On request, emit/copy baked terrain/placement data, required prepared assets and project-owned `src/render/` source, plus a small environment-settings sidecar. Ordinary game source loads these and wires the existing engine APIs. It does not import the editor. |
| Optional collision/geospatial data | Canonical collision heights and coordinate metadata already specified by PRD-466/467. The game explicitly opts into their use; the GLB has no universal collision/GIS guarantee. |

The settings sidecar carries only preview appearance values, units and local asset
references for the copied render source. It is not a universal scene format or
portable substitute for atmospheric shaders. Generating that handoff is required
when requested; consuming it is optional. Do not overwrite an existing game's
render files/settings: produce an explicit new destination or return a conflict.
Preview edits never alter a previously exported game until a new handoff is
explicitly applied by game source. Source customization remains ordinary code,
not executable strings in authoring JSON.

For a ThreeNative handoff, choose either the static GLB scene or the baked-data
scene construction in game source. The latter may use live spectral ocean and
wind from copied render source. Do not load both representations of the terrain,
props or water. Imported asset lights/cameras are not activated as world lighting
or the gameplay camera merely because they were present in the model file.
Export returns the committed revision, snapshot time, written files and included/
excluded feature groups; it does not call a static GLB a complete live game.

### One live world, ordinary Three.js objects

Extend PRD-467's saved authoring document, semantic transactions, revision checks,
undo/redo and local middleware. Environment and camera fields are authoring
settings consumed by editable game render source, not a new runtime scene format.
Each running view uses one normal ThreeNative renderer/loop. The editor and normal
game fixture share project render source, not mutable camera/world state or a
second renderer embedded in the editor. Keep stable selection IDs and the shared
controller authoring session. Camera-only
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

These operations control editor observation cameras only. Gameplay follow/aim/
cutscene cameras and camera behavior belong to the consuming game's source.
Bookmarks are never part of the default GLB or environment handoff.

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
groups. Saved preview settings drive the live editor. A consuming ThreeNative
game adopts them only through the explicit project-source/settings handoff;
another game engine supplies its own equivalent. The editor validates/binds
values; `editor/environment.ts` must not implement shaders, create an artistic
lighting rig or own appearance defaults.

| Group | Required editable behavior |
| --- | --- |
| Sky/atmosphere | Procedural physical sky or imported background image, sun direction/elevation, scattering parameters and atmospheric depth/haze. Reuse atmosphere LUT updates and game-owned sky/material source. |
| Lighting/exposure | Sun colour/intensity, environment illumination/rotation/intensity, exposure and fields already exposed by the project's tone/post source. Sky/background and illumination are independently selectable; this is not a universal render-stage editor. |
| Fog | Enable/disable and tune game-owned distance/height fog where the chosen render source supports it; reuse installed atmospheric aerial perspective for depth haze. Unsupported selected modes return a diagnostic, never a silent replacement. |
| Water | Ocean level/extents and supported spectral/appearance parameters from PRD-466's existing ocean source, without a terrain rebuild unless the edit also changes its recipe. |
| Custom look | Replace the sky/material/post source or all environment mappings in project source; no package edits and no locked starter style. |

Custom render source may expose different controls or report an unsupported field;
that never makes the original starter shader mandatory. Changing the appearance
completely must remain possible without modifying package code or an editor
rendering backend. A source edit uses existing Vite HMR, not JSON code execution.

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

Keep necessary model geometry/hierarchy and its authored materials. Imported
lights/cameras remain inactive, with explicit diagnostics; they do not overwrite
the world environment or editor camera. Preserve the source file for custom game
use, but omit those authoring-irrelevant nodes from default world export.

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
Preserve their settings/source assets in the authoring project and the explicitly
requested ThreeNative source/settings handoff, with export diagnostics. All editor
cameras, gizmos and reference overlays remain excluded from game handoff and GLB;
camera export is removed from this scope. This limitation must be
visible in the export result, not an implied promise of identical lighting in any
game. The static GLB still loads and renders without ThreeNative or the sidecar.

## Scope and ownership

PRD-467 owns document/middleware validation, live activation/link, recovered UI,
selection and spatial inspection. This PRD owns narrow camera/environment/import
operations and their live consumers, with shared validators updated in sequence
when integrating. PRD-466 owns terrain conversion, collision, ocean and full-world
export. Appearance remains editable preview/game source, never engine defaults.
PRD-468 owns the explicit environment/source handoff contract; PRD-466 owns
the shared export implementation. PRD-468 AC-8 proves their consuming-game boundary.
New paths below are proposed, not shipped entry points. No generic editor, second
asset cache, hosted upload service, new engine scene format or weather framework.

## Acceptance Criteria

AC-1 through AC-6 and AC-8 are phase boxes; AC-7 proves the portable GLB handoff.
AC-8 separately proves the ThreeNative game runs without authoring dependencies
and only adopts preview appearance through an explicit handoff.
All are `local`, actor: implementing agent. Commands below are implementation
targets using the existing Vitest/playtest/packed-consumer paths, not shipped
scripts today. Every named camera/environment/import operation is public and
reachable through the live authoring session rather than an internal test helper.

- [ ] AC-7 [local, actor: implementing agent]: An imported-and-edited world exports as a portable terrain asset for an ordinary game. proof: planned `pnpm --filter strata-terrain-preview test:consumer` — Evidence: pending; import a custom GLB and PBR image, place/gizmo them, save/reload, export and render through isolated vanilla GLTFLoader; assert final identities/transforms and embedded image content with no external requests. All editor/imported cameras, lights and debug nodes remain absent. The export result identifies environment effects carried separately and static water where exported.

## Integration Ledger

| Capability | Real consumer path | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Camera lifecycle/focus | Controller/GUI operation → saved bookmark or live pose → actual Three.js camera | UI-only orbit access and guessed focus coordinates | AC-1, AC-2 |
| Atmosphere and look | Shared settings patch → game render source/installed atmosphere → visible live world | fixed showcase lighting or a second atmosphere solver | AC-3 |
| Model injection | GUI upload/agent local registration → project assets → compiler/ctx.assets → placed prop | closed starter catalog and transient dropped-file objects | AC-4 |
| Surface/environment images | Registered image → semantic mapping → texture/HDR loader → actual material/sky | hardwired starter textures and mismatched colour spaces | AC-5, AC-6 |
| Portable delivery | Committed document/imports → PRD-466 world exporter → vanilla game | starter substitution and environment-code portability claims | AC-7 |
| ThreeNative game handoff | Explicit export → baked data/assets plus project render source/settings → normal game entry | runtime dependence on editor JSON/server and automatic adoption of preview state | AC-8 |

## Decisions

- 2026-09-30 (João): Controller camera CRUD and camera focus are required.
- 2026-09-30 (João): Import custom GLBs and image textures, including assets
  supplied on demand through the ThreeNative asset MCP.
- 2026-09-30 (João): Atmosphere and surrounding presentation are part of the world.
- 2026-09-30 (planning choice): Reuse the shared editor session, standard Three.js
  cameras and installed atmosphere/loaders; qualify these consumer paths separately
  to preserve the three-phase/about-eight-box limit. All three PRDs are required.
- 2026-09-30 (João delegated scope decision): Define exact terrain/editor/game
  responsibilities. Editor cameras are observation tools only; remove their
  optional GLB export. Preserve atmosphere controls and custom imports, but make
  game adoption an explicit baked-data/assets/render-source handoff. No runtime
  recipe/preview-settings interpreter, automatic game mutation or general editor.

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

### Phase 3: Image injection and explicit game handoff

**Status:** NOT STARTED
**Files:** proposed `editor/assetImport.ts` image validation/mapping, material and
environment inspectors/source, `__tests__/editor-assets.spec.ts`, existing export
integration, consumer fixture and addon agent guide; project-owned render source
and a consuming-game entry for the explicit ThreeNative handoff proof.
**Implementation:** Register surface/environment images, prepare/load with existing
colour-space-aware texture/HDR paths, preserve mappings after reload, and extend
the full-world consumer fixture rather than introducing another exporter. Add
the explicit environment/source export using the same committed revision. Keep
camera/debug state out and never overwrite existing game source implicitly.

- [ ] AC-5 [local, actor: implementing agent]: Imported PBR images replace chosen live surface inputs and retain their numerical meaning. proof: planned `pnpm exec vitest run packages/terrain/__tests__/editor-assets.spec.ts` through public import/mapping operations plus `test:terrain:editor` — Evidence: pending; import colour and normal/roughness fixtures via GUI/agent paths, observe actual material/image identities and sRGB/linear configuration, reload and explicitly replace an asset without stale cache pixels or starter loads.
- [ ] AC-6 [local, actor: implementing agent]: Imported environment imagery changes the actual background/illumination and remains replaceable. proof: planned `test:terrain:editor` — Evidence: pending; register a licensed HDR or EXR fixture and an ordinary environment image, observe independent background/lighting use with retained HDR radiance, rotation/intensity and saved source hashes; switch back to procedural sky and recover from an invalid image while keeping valid scene state.
- [ ] AC-8 [local, actor: implementing agent]: A normal ThreeNative game explicitly adopts exported appearance and runs independently of authoring. proof: planned `pnpm --filter strata-terrain-preview test:consumer` through a packed/install-like game fixture and the existing browser playtest path — Evidence: pending; start from exported baked data/assets, copied project `src/render/` source and explicitly loaded settings with no authoring document/editor modules/dev middleware available. Observe the adopted sun/exposure/environment bindings, game-owned camera and collision registration, one terrain/prop/water representation, and no editor/network/file-watch/worker dependency. Further preview edits leave that game artifact unchanged; conflicting handoff destinations preserve existing source. A custom render-source replacement must work without changing addon code.

## Verification and delivery

Browser WebGPU proves the live authoring controls. Portable output reruns the
affected PRD-466 consumer/native scenarios; platform claims stay limited to those
actually executed. Exercise public operations and visible render changes, not
only document serialization or notification counts. Use genuine behavior
red/green and existing affected checks; prose-only work uses document checks.

Run `pnpm prd:progress` before execution and after each phase. One draft
implementation PR targets `develop` from an owning-repository worktree. Keep
current results on these boxes/the PR; archive only when all eight boxes are
verified. PRD-466/467 and this PRD must all pass before claiming the full requested
integration. Planning does not authorize marketplace purchases or publication.
