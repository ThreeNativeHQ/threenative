# Batch — feature mining from the Three.js ecosystem, 2026-08-28

**Status:** PROPOSED — eight PRDs filed across two rounds, none started. Nothing below has been executed.

Every upstream repository named here was **cloned at depth 1 on 2026-08-28 and read**. Claims about
what a source contains are cited by file and line against that clone. Claims about this repository
are cited against `HEAD` at filing (`05b5973f`). No claim here has been measured.

## What this batch is

A survey asked which Three.js ecosystem repositories are worth mining. The survey's ranking was
reordered by this repository's own filter, which is narrower than "is this a good library":

1. **Does it run on native?** A helper that needs `document`, WebGL, or a WASM engine on iOS is
   web-only, and a feature that works on web only is unfinished.
2. **Does it decide how anything looks?** If yes it ships as generated source in
   `templates/*/src/render/`, at any size, and never as package code.
3. **Could the game write it portably itself?** If yes, and it needs no platform seam, the
   framework does not own it.

Three of the survey's top six failed on 1 or 3 and are **not filed**. Two more were already shipped
here and are not filed either. What survives is below.

## Filed

| PRD | Outcome | Mined from | Complexity |
| --- | --- | --- | --- |
| [237](./PRD-237-objects-answer-their-own-pointer-events.md) | `ctx.pointer.on(door, "tapped", …)` — hover, press, tap and drag on any `Object3D`, driven by `InputMap` and `ScenePicker`, no DOM. The `defense` template's blind tap-to-place gets hover feedback. | [`agargaro/three.ez`](https://github.com/agargaro/three.ez), MIT — `src/events/` (1 258 lines) | 5 → MEDIUM |
| [238](./PRD-238-the-projection-culls-what-the-camera-cannot-see.md) | The render projection stops submitting instances the camera cannot see. Today it disables per-instance culling by an explicit, documented decision; this PRD prices that decision instead of assuming it. | [`agargaro/instanced-mesh`](https://github.com/agargaro/instanced-mesh), MIT — `src/core/feature/FrustumCulling.ts:172-196` | 6 → MEDIUM |
| [239](./PRD-239-camera-intent-is-one-portable-gesture-stream.md) | Orbit / dolly / pan **intent** arrives the same on mouse wheel, two-finger pinch and gamepad stick. Framing stays in `src/render/camera.ts` where it already lives. | [`yomotsu/camera-controls`](https://github.com/yomotsu/camera-controls), MIT — the `ACTION` gesture table, `src/CameraControls.ts:314-342` | 5 → MEDIUM |
| [240](./PRD-240-text-is-not-uppercase-only.md) | Text that is not 5×7 uppercase ASCII, in the HUD and in the world, on every target — via an **offline** bake, because the upstream runtime shaper is WASM and iOS has no WASM engine. | [`pmndrs/glyph`](https://github.com/pmndrs/glyph), MIT — bake CLI + `src/shaper.ts:89-92`, `:207` | 8 → HIGH |
| [241](./PRD-241-a-sequence-is-one-cancellable-object.md) | `ctx.tween` takes a curve **from the game** — the only gap the reading left standing. Sequencing, cancellation and vector targets all turned out to be solved already, and the PRD records why so nobody re-proposes a timeline DSL. | [`agargaro/three.ez`](https://github.com/agargaro/three.ez) `src/tweening/` (1 069 lines), [`pmndrs/timeline`](https://github.com/pmndrs/timeline) — both MIT | 3 → LOW |

Order to attack (round one): **237 → 239 → 238 → 240 → 241.** 237 and 239 are the two that change what a game
author writes on day one. 238 is a measurement before it is a change, and may end in "the existing
decision was right, recorded". 240 is the largest, and lands as an `@threenative/assets` pass plus a `core` runtime rather than as a new package. 241 is optional.

## Not filed — already shipped here

The survey ranked these highly without checking the manifest. They are already installed:

| Survey item | What already exists | Evidence |
| --- | --- | --- |
| `gkjohnson/three-mesh-bvh` — "foundational dependency" | It **is** a direct dependency of `@threenative/core`, and `ScenePicker` raycasts through it. | `packages/core/package.json` dependencies; `packages/core/src/picking.ts:11`, `:222` |
| `creativelifeform/three-nebula`, `Alchemist0823/three.quarks` — "`TN.Particles`" | `GPUParticles3D` and `TracerPool3D` ship, and `GPUParticles3D` is the charter's named example of mechanism-without-look. Absorbing an emitter/behaviour/JSON model would own the look **and** introduce a scene-adjacent serialization format — refused twice over. | `packages/core/src/particles.ts`, `packages/core/src/tracers.ts`; `/AGENTS.md` rule 3 |
| `donmccurdy/three-pathfinding` — "optional `TN.Navigation`" | `NavigationAgent3D`, `NavigationObstacle3D`, `NavigationRegion3D` and a recast build ship in `@threenative/physics/navigation`. Strictly weaker; nothing to take. | `packages/create-threenative/capabilities.json` |
| `agargaro/instanced-mesh` — "make a `TN.Instancing` layer" | Automatic instancing and batching already exist and are **invisible to the game**: the renderer is handed a private mirror in which eligible meshes are `InstancedMesh` instances. A game-facing instancing API would be a second implementation of a solved problem. What is genuinely missing is culling — that is PRD-238, and it is much smaller than the survey implied. | `packages/core/src/renderProjection.ts`, `projection-plan.ts`, `projection-apply.ts` (2 203 lines) |

## Not filed — refused, with the reason

| Survey item | Refusal |
| --- | --- |
| `pmndrs/drei-vanilla` → `@threenative/extras` | `Billboard`, `Stars`, `Sparkles`, `CameraShake`, `Outlines`, `Grid` are **all look**. They ship as generated source in `templates/*/src/render/`, at any size, and a package to hold them would violate "a package exists only when it carries a dependency the others must not inherit". Mining drei-vanilla is a template job, not a package job — worth doing, wrong artifact. |
| `yomotsu/camera-controls` as a camera **rig** | Already decided, in writing, before this survey: "Camera framing is one of the loudest things in a screenshot, so it lives here in your repo rather than behind a framework option" (`templates/starter/src/render/camera.ts:8-9`). Seven templates each own a rig of 8–60 lines (`wc -l templates/*/src/render/camera.ts` = 186 total). PRD-239 takes only the gesture table, which is a platform seam and not framing. |
| `pmndrs/koota` — optional ECS | A code-first ECS is on the charter's closed-with-evidence list. Not reopened by a library being good. |
| `pmndrs/uikit`, `three-mesh-ui`, `troika-three-text` | The UI path is already chosen and shipped: `src/ui/` renders through the platform's own browser-class renderer composited over the game surface, with a bitmap-glyph fallback. Spatial in-world UI is a different product question; if it is ever asked, PRD-240's baked atlas is its prerequisite anyway. |
| `pmndrs/postprocessing`, `THREE-CustomShaderMaterial` | WebGL and GLSL-patching oriented. The renderer here is `WebGPURenderer` and the shader language is TSL. |
| `enable3d` | LGPL-3.0. This repository is MIT throughout. |
| `pmndrs/viverse`, `repalash/threepipe`, `pmndrs/three-stdlib` | Read for architecture; nothing to absorb. `three-stdlib` in particular is mostly `three/examples/jsm`, which a game can already import — the useful work there is compatibility coverage, which [PRD-123](../agent-leverage/PRD-123-threejs-ecosystem-compatibility-corpus.md) already owns. |

## The clone the evidence was read from

```sh
# reproduce, 2026-08-28
for r in agargaro/three.ez agargaro/instanced-mesh yomotsu/camera-controls \
         pmndrs/glyph pmndrs/timeline; do
  git clone --depth 1 https://github.com/$r.git
done
```

Licences at that clone: three.ez MIT, instanced-mesh MIT, camera-controls MIT, glyph MIT,
timeline MIT (unnamed MIT text, `LICENSE`). No copied source is proposed in any PRD in this batch —
every one of them mines a technique and cites where it was read.

---

# Round two — the GPU-simulation candidates, 2026-08-28

A second survey scored 29 repositories 0–100 on architectural fit, WebGPU/TSL portability,
capability unlocked, abstraction quality and effort. Same treatment: every repository below was
cloned at depth 1 on 2026-08-28 and read, and the ranking was reordered by this repository's filter.

**The scoring and the charter disagree in one specific way, and the charter wins.** The survey put
ocean (90), soft bodies (89), cloth (88), fluids (87) and surfel GI (92) near the top because they
unlock a lot of capability. But *"anything a screenshot shows — materials, shaders, TSL, lights,
tonemapping, post, framing"* ships as generated source in `templates/*/src/render/`, **at any size**,
and that clause is a veto no score outweighs. Ocean, sky, atmosphere, caustics and GI are all on the
wrong side of it.

What survives is the layer underneath them, which every one of those repositories had to build
first and none of them could share: **GPU simulation lifetime, and the scene in traceable buffers.**

## Filed

| PRD | Outcome | Mined from | Complexity |
| --- | --- | --- | --- |
| [242](./PRD-242-gpu-simulation-has-one-lifetime.md) | Compute lifetime stops being hardcoded to `GPUParticles3D` (`game.ts:708`, `:805`, `:353`, `:424`) and becomes a contract anything can implement — including kernel warmup inside the startup window, which `warmup.ts` has never done. **The enabler for 243 and 244.** | all five round-two repos converge on the same four steps; `softbodies/src/FEMPhysics/FEMPhysics.js:341` hand-rolls the warmup this repository already owns for draws | 6 → MEDIUM |
| [243](./PRD-243-softbody3d-cloth-first.md) | `SoftBody3D` — a flag, a cape, a curtain. Mesh and material from the game, spring graph and integrator from the framework. FEM tetrahedra is Phase 4 and may honestly end unbuilt. | [`three-simplecloth`](https://github.com/bandinopla/three-simplecloth) `src/SimpleCloth.ts` (1 073 lines), [`softbodies`](https://github.com/holtsetio/softbodies) `src/FEMPhysics/` (2 067) — both MIT | 7 → HIGH |
| [244](./PRD-244-the-scenes-bvh-reaches-the-gpu.md) | `GPUSceneBVH` — the scene in storage buffers, traceable from a TSL kernel. `three-mesh-bvh@0.9.14` is **already installed and already exports `./webgpu`**; no game can reach it. Unlocks occlusion, contact shadows, mass visibility checks — and GI, in the game's own `src/render/`. | [`webgiya`](https://github.com/jure/webgiya) `src/sceneBvh.ts`, MIT | 6 → MEDIUM |

Order to attack (round two): **242 → 244 → 243.** 242 gates both; 244 is smaller than 243 and its
differential gate (GPU trace vs `ScenePicker`) is the cleanest proof in either round.

## Not filed — already owned by an open PRD

| Survey item | Where it belongs |
| --- | --- |
| `owenyuwono/poseidon` (90), `reed-soul/SeedOcean` (87) | **[PRD-236](../starter-kits/PRD-236-sailing-starter-kit.md) already made this exact split**: the wave field is the engine's, the ocean is the kit's, and *"the guarantee that both evaluations agree"* — which is SeedOcean's `buoyancy-body` — is named as the framework's half. Poseidon's `Ocean.js:122` `evolve(t, dt)` and its FFT cascade (`OceanCascade.js`, `fft.js`, `spectrum.js`) are **evidence for that PRD**, not a new one. Filing an ocean PRD here would be a second live implementation of a decision already made. |

## Not filed — refused, with the reason

| Survey item | Score given | Refusal |
| --- | --- | --- |
| `jure/webgiya` — surfel GI | 92 | GI is lighting, and lighting is on the list of things a screenshot shows. It ships as generated source in `templates/*/src/render/`, at any size. The absorbable layer is the scene BVH underneath it — that is PRD-244, and webgiya's own `sceneBvh.ts` is the citation. Note it **vendors** three-mesh-bvh because it pins `^0.9.2`; this repository is on 0.9.14, where `./webgpu` is published, so no vendoring is needed here. |
| `DennisSmolek/SebH-TSL-Sky` | 84 | Sky, atmosphere and aerial perspective are look, and its API (`preset: 'earth'`, `turbidity`, `groundAlbedo`) is a look API — a framework option that decides how every game's horizon reads. Excellent template `src/render/` material; refused as package code. MIT, worth copying into a kit. |
| `lo-th/phy` — 8-backend physics abstraction | 86 | **No second backend is wanted.** Rule 4 says the physics vocabulary is borrowed from Rapier, and it already is (`RigidBody3D`, `Joint3D`, `PhysicsDirectSpaceState3D`). An abstraction over Ammo/Box2D/Cannon/Havok/Jolt/Oimo/PhysX/Rapier is the archetype of what `count-loc.ts` deletes: it costs more code than the thing it wraps and is justified by a portability nobody asked for. Genuinely worth **reading** before any physics API change — its `Body`/`Character`/`Vehicle`/`Terrain` decomposition is good — which is a different act from absorbing it. |
| `bandinopla/threejs-fluid-simulation` | 87 | Once PRD-242 lands, a game can write these passes portably itself — splat, curl, vorticity, divergence, pressure, gradient subtraction, advection are TSL a game author writes. And a fluid's parameters are look. Its pass decomposition (`FluidMaterialGPU.ts:70-84`) is the reference implementation for a template, not a package. MIT (Pavel Dobryakov's original shaders). |
| `owenyuwono/tiamat` | 82 | Raw WGSL against the WebGPU API rather than `WebGPURenderer`, so it is an algorithm reference and not a port candidate — as the survey itself concluded. Nothing to file until something needs a FLIP solver. |

## On the "five foundational abstractions" sketch

The proposed tree — Compute / Physics / Environment / Lighting / Effects — is right about one branch
and wrong about two, by this repository's rules:

- **Compute** is the real one, and it is PRD-242. Not as a new API (`ctx.renderer.compute(node)` is
  already exposed at `renderer.ts:104`, already guarded to WebGPU at `:267-270`, and already proven
  on native by conformance `73-storage-buffer-smoke` and `74-compute-smoke`) but as the *lifetime*
  around it, which today only `GPUParticles3D` gets.
- **Environment** and **Lighting** — Sky, Ocean, Fog, Caustics, GI, GodRays, Volumetrics — are
  look, wholesale. They belong in kits and `src/render/`, and a package holding them would be
  rejected on rule 1(b) before rule 5 even applied.
- **Physics** already exists and already borrows Rapier's vocabulary; `SoftBody3D` (PRD-243) is the
  one genuinely missing node, and it is missing because there is nothing to wrap, not because the
  package needs restructuring.
- **Effects** already has `GPUParticles3D` and `TracerPool3D`; Decals and PostFX are look.

The useful reframing the sketch does get right: these repositories are **reference implementations
of primitives, not dependencies that should dictate the API.** Every PRD in both rounds is written
that way — nothing here adds a runtime dependency, and the one library that already is a dependency
(`three-mesh-bvh`) is used further rather than replaced.
