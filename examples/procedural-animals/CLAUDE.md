<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — procedural animals example

Read the root and `examples/AGENTS.md` first. This owns one baked wolf, high/crowd geometry, editable base DQS material and motion source. Fur/fins/eyes/full species catalogue are outside this consumer.

Generation runs only in `scripts/bake-assets.ts`. The portable entry loads the normal asset manifest through `ctx.assets.resolve`; corruption rejects and never regenerates an animal. Render and donor motion source under `src/render/` remain editable game code; preserve the pinned MIT notice and report source hashes when qualifying an edited consumer.

Rapier's completed fixed step is the sole root writer. `afterPhysics` computes accepted displacement velocity and hands that state to `follow`; requested controller velocity is not accepted velocity. The first adapter rejects a parent whose world transform is not identity. A centred capsule uses the explicit `visualOriginOffset` from its measured half-height/radius so feet reach the floor; the actor reports that offset. Ground heights come from physics rays using the level-only collision mask. Teleport goes through the body first, then resets animal history. Pause freezes pose evaluation; disposal removes the actor and releases its geometry/material/pose texture.

DQS includes the donor affine scale pre-pass, hemisphere alignment, real/dual normalization, position translation and normal rotation; the shadow path uses that same deformed position. Animated bounds are measured from the current pose packet and bake, never an unbounded sphere or disabled frustum culling.

No browser, native or performance qualification has run yet. Do not claim pixels, GPU probe accuracy, platform support or frame budgets from CPU tests.

Qualification uses `game.ts` on browser and desktop and runs playtests with `--live-clock`. The asynchronous GPU probe compares immutable pose snapshots with the independent CPU oracle. Its invisible diagnostic Mesh uses `frustumCulled: false` solely to establish normal Three attribute ownership; actual wolf meshes retain measured animated bounds and frustum culling. It stays hidden during startup compilation, exposes no warmup compute, and waits for a completed render with `renderer.compiling === false` before dispatch. This scene does not issue later explicit asynchronous compilation of the probe.

`crowd.html`, `high.html` and `baseline.html` use matching portable entries for paired performance runs. Those modes never create the diagnostic probe. Each records actual visible wolf submissions before measurements; a visible wolf omitted from the renderer fails. The baseline shares the collision course and lighting. All four entries build with Vite. Fifty real GPU lifecycle cycles and the original paired CPU/GPU frame budgets remain unverified.
