# Batch — feature mining from the Three.js ecosystem, 2026-08-28

**Status:** PROPOSED — five PRDs filed, none started. Nothing below has been executed.

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
| [241](./PRD-241-a-sequence-is-one-cancellable-object.md) | `ctx.tween` gains easing, vector targets and sequencing, and a scene change cancels what it started. The smallest PRD in the batch and the one most likely to be refused under the kill switch. | [`agargaro/three.ez`](https://github.com/agargaro/three.ez) `src/tweening/` (1 069 lines), [`pmndrs/timeline`](https://github.com/pmndrs/timeline) — both MIT | 3 → LOW |

Order to attack: **237 → 239 → 238 → 240 → 241.** 237 and 239 are the two that change what a game
author writes on day one. 238 is a measurement before it is a change, and may end in "the existing
decision was right, recorded". 240 is the largest and carries a new package. 241 is optional.

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
