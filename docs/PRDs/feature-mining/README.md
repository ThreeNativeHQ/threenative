# Batch — feature mining from the Three.js ecosystem, 2026-08-28

**Status:** IN FLIGHT — twenty-two PRDs filed across six rounds. **Seven are archived in
[`../done/`](../done/):** [242](../done/PRD-242-gpu-simulation-has-one-lifetime.md) and
[244](../done/PRD-244-the-scenes-bvh-reaches-the-gpu.md) with web *and* native desktop evidence;
[237](../done/PRD-237-objects-answer-their-own-pointer-events.md),
[239](../done/PRD-239-camera-intent-is-one-portable-gesture-stream.md),
[247](../done/PRD-247-drei-vanilla-per-item.md) and
[248](../done/PRD-248-the-atmosphere-is-luts-the-sky-is-the-games.md) with their features shipped
and reachable on the public surface, each archived Status naming the native or device lane that is
still `UNVERIFIED` rather than implying it passed; and
[241](../done/PRD-241-a-sequence-is-one-cancellable-object.md), which shipped in `affb48e8` with its
boxes unaudited and was closed on 2026-08-29 after every negative control it names was executed
(`docs/verification/prd-241-easing-closure-2026-08-29.md`).

250 closed Phase 1 only and 254 is PARTIAL, so both stay. Everything else here is unbuilt: **no
grass, ocean, fluid, soft body, surfel GI, procedural terrain or portable text exists in any
package**, and a demo cannot be written against them.

Every upstream repository named here was **cloned at depth 1 on 2026-08-28 and read**. Claims about
what a source contains are cited by file and line against that clone. Claims about this repository
are cited against `HEAD` at filing. No claim here has been measured.

## Correction: several refusals in the first draft of this file were wrong, and why

The first draft refused `drei-vanilla`, surfel GI and sky/atmosphere on the grounds that *"anything a
screenshot shows"* ships as generated source. **That is the wording CHARTER §5b explicitly
retired**, in a paragraph naming `GPUParticles3D` as the code it wrongly banned:

> That right-hand column used to read *anything a screenshot shows*, and taken literally it banned
> code this framework already ships and should ship. `GPUParticles3D` … owns storage buffers,
> compute dispatch and lifetime, and takes `material`, `start` and `process` from the game. A
> screenshot shows its output. **It owns none of the look.** — CHARTER §5b

**Root cause, and it was a real repository defect:** `AGENTS.md`'s "Where a change goes" table still
carried the retired sentence long after the charter replaced it, so the file agents actually read
every session contradicted the charter it is a summary of. Fixed in the same commit as this
correction; the table now names the mechanism row explicitly.

**The live test, which is what every verdict below now uses:**

> Can the game change the appearance completely without editing framework code? If any answer is no,
> the whole thing ships as generated source in `src/render/`. There is no partial credit and no
> "sensible default" that a game reaches through a config option — `postprocessing: ['bloom']` is
> still the v1 mistake. — CHARTER §5b

Two consequences worth stating plainly, because they are what the bad refusals got backwards:

1. **"It is optional" is not what saves a feature — "every appearance parameter comes from the game"
   is.** `postprocessing: ['bloom']` is optional too, and it is the named v1 mistake. A game that
   never constructs `SpectralOcean` is unaffected by it; a game that reaches for `sky: 'earth'` has
   had its sky chosen for it.
2. **A feature the game can ignore and rewrite from scratch costs the framework nothing.** The
   `src/render/` model already works this way — generated, yours, delete it freely. An optional
   class with no defaults truncates no vocabulary, which is the failure §5b actually guards against.

## Filed

| PRD | Outcome | Mined from | Complexity |
| --- | --- | --- | --- |
| [237](../done/PRD-237-objects-answer-their-own-pointer-events.md) **DONE (web)** | `ctx.pointer.on(door, "tapped", …)` — hover, press, tap, drag on any `Object3D`, from `InputMap` + `ScenePicker`, no DOM. The `defense` template's blind tap-to-place gets hover feedback. | [`three.ez`](https://github.com/agargaro/three.ez) `src/events/` (1 258 lines), MIT | 5 → MEDIUM |
| [238](./MEDIUM/PRD-238-the-projection-culls-what-the-camera-cannot-see.md) | The render projection stops submitting instances the camera cannot see. Prices the existing "per-instance culling is O(n)" decision instead of assuming it. | [`instanced-mesh`](https://github.com/agargaro/instanced-mesh) `src/core/feature/FrustumCulling.ts:172-196`, MIT | 6 → MEDIUM |
| [239](../done/PRD-239-camera-intent-is-one-portable-gesture-stream.md) **DONE (web)** | The zoom axis that does not exist: `InputMap` has no wheel and the native host installs no `WheelEvent`. Orbit/dolly/pan intent, same on mouse, pinch and stick. | [`camera-controls`](https://github.com/yomotsu/camera-controls) gesture table `src/CameraControls.ts:314-342`, MIT | 5 → MEDIUM |
| [240](./HIGH/PRD-240-text-is-not-uppercase-only.md) | Text beyond 5×7 uppercase ASCII, HUD and world, on every target — via an offline bake, because the upstream runtime shaper is WASM and iOS JSC has none. | [`glyph`](https://github.com/pmndrs/glyph) bake CLI + `src/shaper.ts:89-92`, MIT | 8 → HIGH |
| [241](../done/PRD-241-a-sequence-is-one-cancellable-object.md) **DONE** | `ctx.tween` takes a curve from the game. Sequencing, cancellation and vector targets turned out to be solved already; the PRD records why. | [`three.ez`](https://github.com/agargaro/three.ez) `src/tweening/`, [`timeline`](https://github.com/pmndrs/timeline) — MIT | 3 → LOW |
| [242](../done/PRD-242-gpu-simulation-has-one-lifetime.md) **DONE** | Compute lifetime stops being hardcoded to `GPUParticles3D` (`game.ts:708`, `:805`, `:353`, `:424`); kernel warmup joins the startup window, which `warmup.ts` has never covered. **Enabler for 243–246.** | all five GPU-sim repos; `softbodies/src/FEMPhysics/FEMPhysics.js:341` hand-rolls the warmup this repo already owns | 6 → MEDIUM |
| [243](./HIGH/PRD-243-softbody3d-cloth-first.md) | `SoftBody3D` — flag, cape, curtain. Mesh and material from the game. FEM tetrahedra is Phase 4 and may end unbuilt. | [`three-simplecloth`](https://github.com/bandinopla/three-simplecloth) (1 073), [`softbodies`](https://github.com/holtsetio/softbodies) (2 067) — MIT | 7 → HIGH |
| [244](../done/PRD-244-the-scenes-bvh-reaches-the-gpu.md) **DONE** | `GPUSceneBVH` — the scene traceable from TSL. `three-mesh-bvh@0.9.14` is already installed and already exports `./webgpu`; no game can reach it. | [`webgiya`](https://github.com/jure/webgiya) `src/sceneBvh.ts`, MIT | 6 → MEDIUM |
| [245](./HIGH/PRD-245-indirect-light-is-a-node-the-game-composites.md) | `SurfelGI` hands back **one TSL node**; the game composites it in its own `src/render/postprocessing.ts`, or never mentions it. **Reverses a bad refusal.** | [`webgiya`](https://github.com/jure/webgiya) (7 509 lines); composition is already app code there at `src/main.ts:709-722` | 9 → HIGH |
| [246](../done/PRD-246-two-oceans-two-contracts.md) **DONE, web only** | `SpectralOcean` beside PRD-236's `WaveField` — **both ship**, different names because different contracts: analytic height is exact and free, spectral height is an async throttled readback that is N frames stale. | [`poseidon`](https://github.com/owenyuwono/poseidon), [`SeedOcean`](https://github.com/reed-soul/SeedOcean) `src/core/buoyancy.js` — MIT | 7 → HIGH |
| [247](../done/PRD-247-drei-vanilla-per-item.md) **DONE (web)** | The drei-vanilla helpers that are mechanism, one at a time. **Reverses a bad refusal** — `billboarding` is named in CHARTER §5b as something the framework may own. | [`drei-vanilla`](https://github.com/pmndrs/drei-vanilla), MIT | 5 → MEDIUM |
| [248](../done/PRD-248-the-atmosphere-is-luts-the-sky-is-the-games.md) **DONE (web)** | `Atmosphere` bakes three LUTs and hands back `radiance()`, `sunTransmittance()` and `aerialPerspective()`. **No preset list, and it creates no light** — the sky mesh, the material and the `DirectionalLight` stay in the template. | [`SebH-TSL-Sky`](https://github.com/DennisSmolek/SebH-TSL-Sky) `src/sky/SkyAtmosphereBaker.js` (526), MIT | 7 → HIGH |
| [249](./MEDIUM/PRD-249-a-fluid-field-is-data-the-game-draws.md) | `FluidField2D` — the seven-pass incompressible solver, unfused from the material upstream welds it to. The game samples `field.dye` and decides whether it is smoke or fire. **Last in the batch: zero in-repo callers today.** | [`threejs-fluid-simulation`](https://github.com/bandinopla/threejs-fluid-simulation) `src/FluidMaterialGPU.ts:53-325`, MIT | 6 → MEDIUM |
| [250](./HIGH/PRD-250-native-workers-are-actually-workers.md) | The standard `Worker` surface already exposed by the native host actually runs work off the game/render thread. It links the existing `WorkerRegistry`/`WorkerThread` path and removes the production main-thread polyfill; it does **not** add `TN.jobs`. | Web Worker semantics + the existing unlinked native worker subsystem | 8 → HIGH |
| [251](./HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md) | Production procedural-world fields: deterministic height/flow/moisture/biome data, erosion/hydrology, CPU/GPU query parity and crack-free terrain consumption. The game still owns every material, biome look, species, water and sky decision. | [`threejs-world`](https://github.com/imsarah/threejs-world), mined as mechanism rather than public API | 10 → HIGH |
| [252](./HIGH/PRD-252-imported-meshes-cook-portable-compound-colliders.md) | Opt-in offline decomposition of a real imported concave mesh into a deterministic bounded convex-part set, consumed as one logical Rapier body on web and native. No runtime cooker and no CoACD vocabulary in game code. | [`CoACD`](https://github.com/SarahWeiii/CoACD) tool-time candidate + Rapier compound semantics | 8 → HIGH |
| [253](./HIGH/PRD-253-content-residency-and-screen-space-hlod.md) | Generic authored/generated content residency: measured-error LOD/HLOD, screen-space refinement, cancellation, refcount-safe eviction and hard resident-byte budgets. PRD-251 consumes this scheduler instead of creating a second one. | [`3DTilesRendererJS`](https://github.com/NASA-AMMOS/3DTilesRendererJS) mechanisms + existing `meshoptimizer` tooling | 10 → HIGH |
| [255](../done/PRD-255-a-million-grass-candidates-are-game-source.md) **DONE, web only; the generic extraction was DECLINED** | A 1,048,576-candidate GPU field proven as game source: reset, game-supplied candidate kernel, atomic survivor compaction and an indirect draw over the existing `IComputeDriven`. The generic `GPUInstanceField` extraction is conditional and may end declined. | [`momentchan/false-earth`](https://github.com/momentchan/false-earth), MIT | 8 → HIGH |
| [256](./HIGH/PRD-256-static-light-is-a-standard-baked-asset.md) | The existing asset compiler generates deterministic `TEXCOORD_1`/UV2 plus a compressed KTX2 static lightmap, and stock Three.js `material.lightMap` consumes the same compiled artifact on web and native. No runtime baker, scene format or copied unlicensed source. | [`repalash/xatlas-three`](https://github.com/repalash/xatlas-three) + `Ibrahim-3d/three-lightmap-baker`, MIT; unlicensed Lucas source is technique-only | 9 → HIGH |
| [257](./HIGH/PRD-257-character-ground-contact-is-observable.md) | Consumer-gated `CharacterBody3D` observations: stable `groundNormal`, logical `groundBody` and derived `slopeAngle`, carried through the existing bulk web/native state seam. Phase 0 declines it unless one real consumer needs at least two fields. | [`pmndrs/ecctrl`](https://github.com/pmndrs/ecctrl), MIT; observation semantics only | 7 → HIGH |
| [258](./HIGH/PRD-258-many-actors-share-one-animation-texture.md) | Consumer-gated GPU-instanced skeletal animation: bake shared clip bone matrices once, then let ordinary Three/WebGPU draw independently timed actors from one payload. No motion matching, state graph, ragdoll, VAT, WebGL shader patch or look ownership. | upstream Three WebGPU instanced-skinning examples, MIT; `mbarbier/threejs-gpu-skinning`, ISC, as historical technique only | 8 → HIGH |
| [259](./HIGH/PRD-259-fewer-pixels-must-still-look-like-the-same-game.md) | Consumer-gated temporal reconstruction after PRD-228 lowers the drawing buffer: compare current presentation, catalog Three `TAAUNode` and `pmndrs/upscaler` without adding a renderer option or claiming the upscaler fixes Bayview's CPU term. Emulator closes compatibility/visual gates; physical Pixel closes performance. | upstream Three 0.185.1 `TAAUNode`, MIT; `pmndrs/upscaler`, MIT + AMD FSR notice | 8 → HIGH |
| [260](./HIGH/PRD-260-standard-navigation-reaches-native-without-webassembly.md) | Consumer-gated native navigation through the existing `NavigationRegion3D`/`NavigationAgent3D` vocabulary, with a pure-JS backend only if a named native consumer beats the prior 31-line steering result. No second nav API, AI policy or WASM on native. | [`isaac-mason/navcat`](https://github.com/isaac-mason/navcat) `bc9d3c3f372a`, MIT | 8 → HIGH |

**Order to attack:** 259 Phase 0 → 257 Phase 0 → 256 Phase 0 → 258 Phase 0 → 260 Phase 0 → 250 → 253 → 251 → 252 → 237 → 239 → 247 → 242 → 244 → 238 → 241 → 248 → 243 → 246 → 240 → 245 → 249.
259, 257, 256, 258 and 260 begin with bounded refusal gates, so run those cheap decisions before feature work. If any
survives, return it to the queue by measured value; none jumps ahead merely because it is new. 250
remains the first implementation because the repository already calls the main-thread `Worker` polyfill
an owed correctness gate, while the other items are product capabilities. 237, 239 and 247 change what
a game author writes on day one and are small. 242 gates 243–246.
245 is the largest and the most likely to be refused on device cost, by design. 249 is last
because §11.1's more-than-twice clause is not yet satisfied for it, and the PRD says so.
260 additionally stops before comparison if no named native navmesh consumer exists; its place in the
Phase 0 queue is permission to decide, not evidence that a second backend is wanted.

## Third survey — the broad engine-stack proposal

The supplied 35-domain map is directionally useful, but most rows are not missing ThreeNative
integrations. The charter asks a stricter question than whether an upstream library is good: does a
portable game currently need framework-owned plumbing that it cannot write with ordinary Three.js or
an ordinary dependency? The corrected audit produced four PRDs: 250–253. The earlier one-PRD verdict
was wrong because it treated PRD-043's terrain fixture and declined PRD-098 as shipped equivalents.

| Proposed area / repositories | Verdict against current ownership |
| --- | --- |
| SDL3, GLFW, host lifecycle and device APIs | **Mine concepts only.** The native host already owns window, lifecycle, input and device normalization. Do not introduce a second platform abstraction or expose SDL types. |
| Taskflow, custom thread pool, `TN.jobs` | **PRD-250, but preserve the standard API.** Native `Worker` is already promised and currently executes on the main thread. Link the existing real worker subsystem; do not add a proprietary job vocabulary. |
| `three.ez`, `camera-controls`, `drei-vanilla` | **Already owned/in flight:** 237, 239, 241 and 247. Do not reopen their worktrees. |
| glTF-Transform, meshoptimizer, Draco, KTX/Basis, asset packing | **Mostly shipped, with one corrected exception:** PRDs 094–097 and 099 own compile, validation, compression and native decode. PRD-098 was **declined and built nothing**; generated LOD/HLOD is therefore owned by new PRD-253. Native mobile decoder gaps remain under PRD-097 rather than a second pipeline. |
| 3DTilesRendererJS, HLOD, residency, terrain and huge-world streaming | **Selected as two distinct outcomes.** PRD-253 owns generic measured-error HLOD and bounded content residency. PRD-251 owns procedural height/flow/erosion/hydrology fields and terrain-specific crack/query correctness while consuming 253's scheduler. PRD-043 remains useful substrate only: three sinusoidal wireframe chunks, heightfield collision and release. |
| `three-mesh-bvh`, GPU scene queries | **Already shipped/in flight:** CPU picking and ray queries ship; 244 owns the GPU reach. |
| Koota, bitecs, Miniplex and mandatory ECS | **Refused by charter.** Games keep real `THREE.Object3D`; a game may install an ECS without a ThreeNative wrapper. |
| Glyph, UIKit, screen/spatial UI | **Already owned:** 240 owns portable text. The shipped `src/ui/` composition path remains the screen-UI owner; a second UI framework is not admitted by this survey. |
| Jolt, Rapier, PhysX, `lo-th/phy`, CoACD | **Keep Rapier; select CoACD's separate tool-time outcome.** A second solver is maintenance debt. PRD-252 uses CoACD only to cook an explicit imported concave asset into a backend-neutral convex-part set, replacing the shooter's hand-fed arena colliders and preserving one Rapier body on web/native. |
| Cloth, soft bodies, fluids, destruction and CSG | **243 and 249 own the admitted simulation primitives.** `three-pinata`, `three-bvh-csg` and Manifold remain ordinary game dependencies/research until a repeated portable engine seam appears; no speculative framework wrapper is filed. |
| three-vrm, closed-chain IK, Yuka, character/AI frameworks | **The old “covered” claim was false, but no PRD now.** `AnimationPlayer`, bone attachment and `CharacterBody3D` do not provide foot placement, aim/two-hand IK or retargeting. A low-level game-supplied-target IK mechanism is the next credible candidate; wholesale VRM policy, Yuka behaviour and humanoid presets remain optional game dependencies. File when a character consumer supplies the real uneven-ground/weapon-grip proof. |
| procedural worlds, SeedThree, Poseidon, SebH sky, GI/AO, Quarks/Nebula, splats | **Procedural world data is selected in 251; appearances stay game-owned.** PRDs 242–249 keep the admitted compute/environment mechanisms. SeedThree species/presets, N8AO/post looks, Quarks/Nebula effect vocabularies and Spark's splat format remain optional until a real asset/consumer needs their distinct mechanism. |
| miniaudio, Steam Audio, GameNetworkingSockets, OpenXR, Tracy, Theatre/editor | **Not quality-equivalent, but already owned or not broadly required.** Continue PRD-057 for Web Audio/native parity; miniaudio may be its private backend. Tracy is optional diagnostics after PRD-232. Multiplayer replication deserves a PRD only when multiplayer is admitted. XR/editor/Steam Audio need genre/platform consumers. Do not pretend the current debug overlay equals Theatre or that transport plumbing equals replication. |

**Selected from this survey:** PRD-250, PRD-251, PRD-252 and PRD-253. IK/retargeting is the first
deferred candidate, not a solved capability. Everything else is deduplicated, already owned, charter-
refused, genre-specific, or held behind a real-consumer trigger.

## Sixth survey — rendering scale, terrain, animation and engine-shaped references

All fifteen proposed candidates were audited against live code, active/closed PRDs and pinned source
on 2026-08-29. **One new production outcome survived:** PRD-258. Four strong sources improve existing
PRDs; the rest are ordinary game/tool dependencies, compatibility-corpus subjects, deferred research
or charter-closed engine/editor scope. Repository quality is not ownership.

| # | Candidate | Pinned source / licence | Primary verdict |
| ---: | --- | --- | --- |
| 1 | `pmndrs/upscaler` | `b5029b18baca50cb48e132bf77299c1349ae5428`, MIT + AMD FSR notice | **Compatibility-corpus row / consumer defer.** PRD-228 already owns resolution scaling; first prove the ordinary addon unchanged on web/native. Do not wrap it or add `renderer.upscaling`. |
| 2 | `kenjinp/hello-terrain` | `51b022cc964a05217701a05edd94deca04b44af7`, MIT | **Already planned.** PRD-251 now mines its vanilla Three/WebGPU quadtree, seam and CPU/GPU query invariants; PRD-253 remains the one residency scheduler. |
| 3 | `agargaro/octahedral-impostor` | `ca0046a49fef8f8c75745a6e49e52752ef3cf8e3`, MIT | **Defer behind PRD-253's real-consumer gate.** No parallel `AutoLOD`; a later build-time terminal HLOD level needs its own measured visual-error case first. |
| 4 | `Ibrahim-3d/three-lightmap-baker` | `f0eee56182e0c13ff5232c265fb5c8d4dcae2ab7`, MIT | **Already planned.** Licensed implementation reference added to PRD-256; no second baker PRD. |
| 5 | `mariojgt/featherEngine` | `a8d5c580a139c41f2ed07ea2c3e0bb72f9ff2667`, MIT | **Reject.** Editor, serialized project/prefab graph and visual scripting are explicitly closed; mine no parallel engine architecture. |
| 6 | `sweriko/ai4anim-webgpu` | `b539455f849f284a1e814eb11ab649eb594319dc`, CC BY-NC 4.0 | **Research only.** No source absorption or commercial dependency. PRD-258 explicitly excludes neural motion matching. |
| 7 | `flement/VAT-blender-addon` | `f832300d704349f9eef4b284035641810e426066`, no licence found | **Game/tool source, not framework.** No code may be copied; arbitrary vertex-cache playback stays outside PRD-258 until a licensed repeated consumer exists. |
| 8 | `Usnul/meep` | `fe637fea2ea0abdc9301510377c675151bcaf5b5`, MIT archived tree | **Mine concepts into existing owners only.** Terrain/residency, workers and rendering already have PRDs; its ECS/engine/time/visibility architecture is not a ThreeNative surface. |
| 9 | `Feelsrat/creature-playground` | `8970dbe40ba8716f535ac75ae6df99cc0a3be44a`, no licence found | **Application reference / prior withdrawal stands.** PRD-144 already proved a ragdoll wrapper loses the LOC kill switch; active-ragdoll gait and recovery remain gameplay. |
| 10 | `promontis/threejs-pom` | `8ae189a974f9d833c9123e3f8ca3ca474dd2316a`, MIT | **Ordinary game dependency / generated `src/render/`.** POM is a material/look choice; no `@threenative/materials` wrapper. |
| 11 | CDLOD references | `nickyvanurk/cdlod` `1b92e75c920c5f28218420645792562139115fef`; `tschie/terrain-cdlod` `d2b6d4e746dd9b7175cc114d87d5e60435740fe7`, MIT | **Already planned.** Morph/bounds math added to PRD-251; no competing terrain system. |
| 12 | `ext-sakamoro/ALICE-SDF` + `BorisTheBrave/mc-dc` | `6aeee904d80bd162cd838a65b52a2635ba6f77a8`, MIT core with trademark/scope notice; `c7fae71b90da0d82e083bfae8b4dccac795fac6f`, CC0 | **Consumer-gated research.** WASM/format/experimental package work has no live game owner; ordinary dependencies or game tooling win today. |
| 13 | GPU skeletal animation | `mbarbier/threejs-gpu-skinning` `09f184c23bc85022da6ad51b38dea4dfc0c85cb8`, ISC declaration; upstream Three `444f238c63b594fbaf1d5adde301fa7e10c29a83`, MIT | **New framework candidate: PRD-258.** The measured many-soldier subject can prove or decline shared baked bone data without inventing animation policy. |
| 14 | `LinearAbiltyCastingThreeJS` | `ba61847cb6887e5ccae9cd591e6390082cac5f05`, MIT | **Generated game source.** Ability shapes, colours, timing and targeting semantics are gameplay/look; no `TN.Indicator` API. |
| 15 | upstream WebGPU occlusion + Meep visibility policy | Three `444f238c63b594fbaf1d5adde301fa7e10c29a83`, MIT; Meep above | **Compatibility row / existing-owner amendment.** Prove `object.occlusionTest` and `renderer.isOccluded()` through PRD-123; PRD-238 owns measured render culling. AI/audio/animation cadence stays game-owned until a repeated consumer proves otherwise. |

Source audit is complete for all fifteen rows. Missing source licences are a rejection, not a TODO
silently converted into permission. Current upstream Three support is also not evidence that the
catalog version and native host pass it; PRD-123 must execute that claim.

## Seventh survey — current framework state, native fit and measured reconstruction

The deeper source/consumer audit on 2026-08-29 corrected two earlier deferrals without promoting a
library API into ThreeNative. PRD-228 proved both sides of the upscaling decision: fill rate has a
real `9.94 ms/Mpx` slope, while Bayview's remaining miss at scale 0.32 is a 13.79 ms CPU fixed term.
That evidence earns **PRD-259's bounded quality spike**, not an engine upscaling option. Catalog Three
`TAAUNode` is the first arm; `pmndrs/upscaler` is only the challenger. Emulator evidence is useful
now for native compatibility and temporal artifacts, while the physical Pixel remains the timing
authority.

The same audit found one credible new native platform lead: `isaac-mason/navcat` is maintained, MIT,
pure JavaScript, renderer-independent and supports solo/tiled construction plus query/corridor/crowd
building blocks. It could remove the Recast-WASM native wall while preserving the already-shipped
Godot-shaped navigation API. Prior evidence still says 31 lines of steering beat framework work for
the platformer, so **PRD-260 starts with a named-consumer refusal gate** and may end as ordinary
dependency or DECLINED.

Everything else remains under an existing owner:

| Candidate | Verdict after deep check |
| --- | --- |
| `needle-tools/gltf-progressive` | Mine screen-error/loader behavior into PRD-253; do not adopt its browser patching, cloud or extension vocabulary. |
| `agargaro/batched-mesh-extensions` | Algorithm reference for PRD-238/253; no prototype/private-field patch dependency. |
| `mrdoob/draco.js` | PRD-123 compatibility row for pure-JS Draco on iOS/JSC; it does not solve Meshopt/KTX2. |
| `stats-gl` | Compatibility/reference row only: core/playtest already own timestamp GPU ms, frame/render/host-gap windows and native phase profiling. |
| `pixiv/three-vrm`, `pmndrs/meshline` | High-value PRD-123 unchanged-source rows; no avatar or line-rendering framework API. |
| `model-viewer` | Mine golden-image/fidelity workflow only; reject DOM/WebGL runtime. |
| IK/retargeting references | Continue consumer-defer until a real weapon-grip, uneven-ground foot or repeated cross-rig case exists. |

## Not filed — already shipped here

| Survey item | What already exists |
| --- | --- |
| `three-mesh-bvh` | Already a direct `@threenative/core` dependency; `ScenePicker` traces it (`picking.ts:11`, `:222`). PRD-244 reaches the WebGPU export it also already ships. |
| `three-nebula`, `three.quarks` | `GPUParticles3D` and `TracerPool3D` ship. A JSON emitter/behaviour format is additionally on §2's closed list (a scene format). |
| `three-pathfinding` | `NavigationAgent3D/Obstacle3D/Region3D` + recast ship in `@threenative/physics/navigation`. |
| `instanced-mesh` as an instancing **API** | Automatic instancing already exists and is invisible to the game (`renderProjection.ts` + 2 203 lines). What is missing is culling — PRD-238. |
| `pmndrs/timeline` sequencing | `ctx.tween` returns a promise, so `await` and `Promise.all` already compose. See PRD-241. |

## Not filed — refused, each against the live test

| Survey item | Verdict |
| --- | --- |
| `camera-controls` as a camera **rig** | Fails the test: a rig ships offsets, damping and look-ahead, and a game cannot change framing without editing them. Already decided in writing before this survey — `templates/starter/src/render/camera.ts:8-9`, and seven templates own a rig each (186 lines total). PRD-239 takes only the gesture table, which is a platform seam. |
| `lo-th/phy` — 8-backend physics | Not a look question at all. No second backend is wanted, Rapier's vocabulary is already borrowed (`RigidBody3D`, `Joint3D`, `PhysicsDirectSpaceState3D`), and an abstraction over eight engines is the archetype `count-loc.ts` deletes. Worth **reading** before any physics API change — its `Body`/`Character`/`Vehicle`/`Terrain` split is good. |
| `owenyuwono/tiamat` | Raw WGSL against the WebGPU API rather than `WebGPURenderer`. Algorithm reference, not a port candidate. |
| `koota` | A code-first ECS is on §2's closed list. Not reopened by a library being good. |
| `uikit`, `three-mesh-ui`, `troika-three-text` | The UI path is chosen and shipped: `src/ui/` through the platform's browser-class renderer, with a bitmap-glyph fallback. In-world UI is a separate product question, and PRD-240's baked atlas is its prerequisite either way. |
| `postprocessing`, `THREE-CustomShaderMaterial` | WebGL and GLSL-patching. The renderer is `WebGPURenderer` and the language is TSL. |
| `enable3d` | LGPL-3.0. This repository is MIT throughout. |
| `viverse`, `threepipe`, `three-stdlib` | Read for architecture; nothing to absorb. `three-stdlib` is mostly `three/examples/jsm`, which a game can already import — the useful work is compatibility coverage, owned by [PRD-123](../agent-leverage/PRD-123-threejs-ecosystem-compatibility-corpus.md). |

## On the "five foundational abstractions" sketch

The proposed tree — Compute / Physics / Environment / Lighting / Effects — holds up better than the
first draft of this file allowed:

- **Compute** is real, and it is PRD-242. Not as a new API (`ctx.renderer.compute(node)` is already
  exposed at `renderer.ts:104`, guarded to WebGPU at `:267-270`, and proven on native by conformance
  `73-storage-buffer-smoke` and `74-compute-smoke`) but as the *lifetime* around it.
- **Environment** and **Lighting** are admissible as mechanism — PRD-245 and PRD-246 are exactly
  that. What stays out is the preset-shaped API, not the subsystem. Ocean, sky and GI ship as classes
  a game constructs with its own parameters and its own materials, or never mentions.
- **Physics** exists and borrows Rapier's vocabulary; `SoftBody3D` (PRD-243) is the missing node.
- **Effects** has `GPUParticles3D` and `TracerPool3D`; PRD-247 adds the drei-vanilla mechanism items.

The sketch's real insight, and it is the batch's organising principle: **these repositories are
reference implementations of primitives, not dependencies that should dictate the API.** No PRD in
either round adds a runtime dependency, and the one library already depended on (`three-mesh-bvh`)
is used further rather than replaced.

## The clones the evidence was read from, pinned

Line numbers in these PRDs only mean something against a fixed commit. Every reference in this batch
is against the depth-1 clone taken on **2026-08-28** at these exact commits:

| Repository | Commit | Used by |
| --- | --- | --- |
| `agargaro/three.ez` | `91e73f3cececd1a7e8ec5e9ff44fd6e4f4f81064` | 237, 241 |
| `agargaro/instanced-mesh` | `78f5a94e63ad45aa32fadce82490c275cb617fff` | 238 |
| `yomotsu/camera-controls` | `c51601107e266097edf6a9caa57bfa9eaa77427c` | 239 |
| `pmndrs/glyph` | `f08a90cf66dd43c95fdec4458a469e149fe994dc` | 240 |
| `pmndrs/timeline` | `d97c31265bf1f0aef82f83931dc924f1de253cde` | 241 |
| `bandinopla/three-simplecloth` | `f829b8d8f633d2d180aeb564c0c2aa1540deb190` | 243 |
| `holtsetio/softbodies` | `5d304d36006fcf2201061df0d1a27ce79bba2183` | 243 |
| `jure/webgiya` | `0cd7f96859adc34e181f34a5d804e53fa94799cb` | 244, 245 |
| `owenyuwono/poseidon` | `671053b812fcbffe8ecc4668eaa6ab7ffeb63287` | 246 |
| `reed-soul/SeedOcean` | `115e0ba0d79c46fcb1a0fe27df2046651aa2c103` | 246 |
| `pmndrs/drei-vanilla` | `28978f680f9071e4f4794611781c19f46de48e35` | 247 |
| `DennisSmolek/SebH-TSL-Sky` | `f7659396815e8d193b84ba97020319ca8bb903d9` | 248 |
| `bandinopla/threejs-fluid-simulation` | `14ff3b0e55954685dc14648d5625715fa8e8c14a` | 249 |
| `lo-th/phy` | `7fe6ca802f581bfdeb3835147bb1923f372cc622` | read, refused |
| `owenyuwono/tiamat` | `e389a99192c5158fb3b95d9df5427feaf9d97fea` | read, refused |

```sh
# reproduce any of them
git clone --depth 1 https://github.com/<repo>.git && git -C <name> checkout <commit>
```

**Every PRD that mines a source carries a "Borrow map — where to read what" table** naming the exact
files to read and, as importantly, the files **not** to borrow. All MIT. No copied source is proposed
anywhere in this batch.
