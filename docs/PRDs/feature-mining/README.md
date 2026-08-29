# Batch — feature mining from the Three.js ecosystem, 2026-08-28

**Status:** IN FLIGHT — fourteen PRDs filed across three rounds. At this audit, dedicated
worktrees exist for 237, 238, 239, 241, 242, 244 and 247; that work is not reopened here.

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
| [237](./PRD-237-objects-answer-their-own-pointer-events.md) | `ctx.pointer.on(door, "tapped", …)` — hover, press, tap, drag on any `Object3D`, from `InputMap` + `ScenePicker`, no DOM. The `defense` template's blind tap-to-place gets hover feedback. | [`three.ez`](https://github.com/agargaro/three.ez) `src/events/` (1 258 lines), MIT | 5 → MEDIUM |
| [238](./PRD-238-the-projection-culls-what-the-camera-cannot-see.md) | The render projection stops submitting instances the camera cannot see. Prices the existing "per-instance culling is O(n)" decision instead of assuming it. | [`instanced-mesh`](https://github.com/agargaro/instanced-mesh) `src/core/feature/FrustumCulling.ts:172-196`, MIT | 6 → MEDIUM |
| [239](./PRD-239-camera-intent-is-one-portable-gesture-stream.md) | The zoom axis that does not exist: `InputMap` has no wheel and the native host installs no `WheelEvent`. Orbit/dolly/pan intent, same on mouse, pinch and stick. | [`camera-controls`](https://github.com/yomotsu/camera-controls) gesture table `src/CameraControls.ts:314-342`, MIT | 5 → MEDIUM |
| [240](./PRD-240-text-is-not-uppercase-only.md) | Text beyond 5×7 uppercase ASCII, HUD and world, on every target — via an offline bake, because the upstream runtime shaper is WASM and iOS JSC has none. | [`glyph`](https://github.com/pmndrs/glyph) bake CLI + `src/shaper.ts:89-92`, MIT | 8 → HIGH |
| [241](./PRD-241-a-sequence-is-one-cancellable-object.md) | `ctx.tween` takes a curve from the game. Sequencing, cancellation and vector targets turned out to be solved already; the PRD records why. | [`three.ez`](https://github.com/agargaro/three.ez) `src/tweening/`, [`timeline`](https://github.com/pmndrs/timeline) — MIT | 3 → LOW |
| [242](./PRD-242-gpu-simulation-has-one-lifetime.md) | Compute lifetime stops being hardcoded to `GPUParticles3D` (`game.ts:708`, `:805`, `:353`, `:424`); kernel warmup joins the startup window, which `warmup.ts` has never covered. **Enabler for 243–246.** | all five GPU-sim repos; `softbodies/src/FEMPhysics/FEMPhysics.js:341` hand-rolls the warmup this repo already owns | 6 → MEDIUM |
| [243](./PRD-243-softbody3d-cloth-first.md) | `SoftBody3D` — flag, cape, curtain. Mesh and material from the game. FEM tetrahedra is Phase 4 and may end unbuilt. | [`three-simplecloth`](https://github.com/bandinopla/three-simplecloth) (1 073), [`softbodies`](https://github.com/holtsetio/softbodies) (2 067) — MIT | 7 → HIGH |
| [244](./PRD-244-the-scenes-bvh-reaches-the-gpu.md) | `GPUSceneBVH` — the scene traceable from TSL. `three-mesh-bvh@0.9.14` is already installed and already exports `./webgpu`; no game can reach it. | [`webgiya`](https://github.com/jure/webgiya) `src/sceneBvh.ts`, MIT | 6 → MEDIUM |
| [245](./PRD-245-indirect-light-is-a-node-the-game-composites.md) | `SurfelGI` hands back **one TSL node**; the game composites it in its own `src/render/postprocessing.ts`, or never mentions it. **Reverses a bad refusal.** | [`webgiya`](https://github.com/jure/webgiya) (7 509 lines); composition is already app code there at `src/main.ts:709-722` | 9 → HIGH |
| [246](./PRD-246-two-oceans-two-contracts.md) | `SpectralOcean` beside PRD-236's `WaveField` — **both ship**, different names because different contracts: analytic height is exact and free, spectral height is an async throttled readback that is N frames stale. | [`poseidon`](https://github.com/owenyuwono/poseidon), [`SeedOcean`](https://github.com/reed-soul/SeedOcean) `src/core/buoyancy.js` — MIT | 7 → HIGH |
| [247](./PRD-247-drei-vanilla-per-item.md) | The drei-vanilla helpers that are mechanism, one at a time. **Reverses a bad refusal** — `billboarding` is named in CHARTER §5b as something the framework may own. | [`drei-vanilla`](https://github.com/pmndrs/drei-vanilla), MIT | 5 → MEDIUM |
| [248](./PRD-248-the-atmosphere-is-luts-the-sky-is-the-games.md) | `Atmosphere` bakes three LUTs and hands back `radiance()`, `sunTransmittance()` and `aerialPerspective()`. **No preset list, and it creates no light** — the sky mesh, the material and the `DirectionalLight` stay in the template. | [`SebH-TSL-Sky`](https://github.com/DennisSmolek/SebH-TSL-Sky) `src/sky/SkyAtmosphereBaker.js` (526), MIT | 7 → HIGH |
| [249](./PRD-249-a-fluid-field-is-data-the-game-draws.md) | `FluidField2D` — the seven-pass incompressible solver, unfused from the material upstream welds it to. The game samples `field.dye` and decides whether it is smoke or fire. **Last in the batch: zero in-repo callers today.** | [`threejs-fluid-simulation`](https://github.com/bandinopla/threejs-fluid-simulation) `src/FluidMaterialGPU.ts:53-325`, MIT | 6 → MEDIUM |
| [250](./PRD-250-native-workers-are-actually-workers.md) | The standard `Worker` surface already exposed by the native host actually runs work off the game/render thread. It links the existing `WorkerRegistry`/`WorkerThread` path and removes the production main-thread polyfill; it does **not** add `TN.jobs`. | Web Worker semantics + the existing unlinked native worker subsystem | 8 → HIGH |
| [251](./PRD-251-procedural-world-fields-and-terrain-residency.md) | Production procedural-world fields: deterministic height/flow/moisture/biome data, erosion/hydrology, CPU/GPU query parity and crack-free terrain consumption. The game still owns every material, biome look, species, water and sky decision. | [`threejs-world`](https://github.com/imsarah/threejs-world), mined as mechanism rather than public API | 10 → HIGH |
| [252](./PRD-252-imported-meshes-cook-portable-compound-colliders.md) | Opt-in offline decomposition of a real imported concave mesh into a deterministic bounded convex-part set, consumed as one logical Rapier body on web and native. No runtime cooker and no CoACD vocabulary in game code. | [`CoACD`](https://github.com/SarahWeiii/CoACD) tool-time candidate + Rapier compound semantics | 8 → HIGH |
| [253](./PRD-253-content-residency-and-screen-space-hlod.md) | Generic authored/generated content residency: measured-error LOD/HLOD, screen-space refinement, cancellation, refcount-safe eviction and hard resident-byte budgets. PRD-251 consumes this scheduler instead of creating a second one. | [`3DTilesRendererJS`](https://github.com/NASA-AMMOS/3DTilesRendererJS) mechanisms + existing `meshoptimizer` tooling | 10 → HIGH |

**Order to attack:** 250 → 253 → 251 → 252 → 237 → 239 → 247 → 242 → 244 → 238 → 241 → 248 → 243 → 246 → 240 → 245 → 249.
250 is first because the repository already calls the main-thread `Worker` polyfill an owed correctness
gate, while the other items are product capabilities.
237, 239 and 247 change what a game author writes on day one and are small. 242 gates 243–246.
245 is the largest and the most likely to be refused on device cost, by design. 249 is last
because §11.1's more-than-twice clause is not yet satisfied for it, and the PRD says so.

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
