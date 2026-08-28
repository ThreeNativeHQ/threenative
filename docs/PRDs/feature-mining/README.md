# Batch — feature mining from the Three.js ecosystem, 2026-08-28

**Status:** PROPOSED — ten PRDs filed across two rounds, none started.

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

**Order to attack:** 237 → 239 → 247 → 242 → 244 → 238 → 241 → 243 → 246 → 240 → 245.
237, 239 and 247 change what a game author writes on day one and are small. 242 gates 243–246.
245 is the largest and the most likely to be refused on device cost, by design.

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
| `SebH-TSL-Sky` as shipped | **Admissible in kind, refused as shipped.** The LUT machinery is mechanism and would pass; `preset: 'earth'` is a preset menu, which is on §2's closed list and is the `postprocessing: ['bloom']` mistake by another name. File it and it ships parameterised with no preset list — say the word and it gets a PRD. |
| `bandinopla` fluids | **Admissible in kind, not yet needed.** After PRD-242 a game writes these TSL passes itself, and §11.1 admits framework code once one game writes it more than twice — which has happened zero times. Its pass decomposition (`FluidMaterialGPU.ts:70-84`) is the reference when that changes. |
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

## The clone the evidence was read from

```sh
# reproduce, 2026-08-28
for r in agargaro/three.ez agargaro/instanced-mesh yomotsu/camera-controls pmndrs/glyph \
         pmndrs/timeline jure/webgiya holtsetio/softbodies bandinopla/three-simplecloth \
         bandinopla/threejs-fluid-simulation owenyuwono/poseidon reed-soul/SeedOcean \
         lo-th/phy DennisSmolek/SebH-TSL-Sky owenyuwono/tiamat pmndrs/drei-vanilla; do
  git clone --depth 1 https://github.com/$r.git
done
```

All MIT. No copied source is proposed in any PRD in this batch — every one mines a technique and
cites where it was read.
