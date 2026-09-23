# Performance basics — what the engine already does, and what you choose

Every frame this framework runs the same measured loop. Some performance work is done for you;
the rest is a content choice only the game can make. This page is the short list of both, so you
reach for the right abstraction before you profile anything.

## The split

- **The engine decides what it can measure where it is used**: world-transform preparation, scene
  batching and projection, per-pass culling, resolution, load scheduling, asset cooking, first-use
  warmup, and the frame meter. Do not hand-roll these — a hand-rolled version usually costs you the
  engine's version.
- **You decide what cannot be read from the code**: how much detail is on screen, how many objects,
  what never moves, how far shadows reach, how many particles. Those are content decisions, and the
  frame meter reports what they cost.

If you can measure the value where it is used, let the engine decide; a constant you are told to
revisit later is the engine's job, not yours.

## Automatic — leave it alone

- **Scene batching and projection.** The engine merges equal geometry and material into fewer draws
  and projects the authored scene automatically. A per-mesh `onBeforeRender` / `onAfterRender` hook
  that packs buffers or mutates geometry makes the whole scene decline projection. Put once-per-draw
  work in `ctx.beforeRender(fn)` instead: it runs after the frame's last fixed update and before
  projection packs, on the batched and unbatched paths alike.
- **Transform preparation.** Exactly one world-matrix preparation runs per actual world draw. Never
  call `updateMatrixWorld(true)` yourself, and do not set `scene.matrixWorldAutoUpdate = false`
  unless you then update the scene yourself. Marking a measured-static subtree
  `matrixWorldAutoUpdate = false` is allowed and the engine will skip it, but its parents must stay
  still.
- **Per-pass culling.** The main camera, each shadow and each reflection pass cull their own way,
  and the engine owns that. Do not set `frustumCulled = false` on a batch, and do not give one
  batch bounds that span the map.
- **Resolution.** `render.resolutionScale: "auto"` holds GPU headroom and never lowers resolution
  on a CPU overrun; `TN_FRAME_BUDGET` reports the scale actually used. A number is the named pin
  override.
- **Quality.** Each template ships `src/render/quality.ts` (three tiers, platform default,
  `TN_QUALITY_TIER`) and `adaptiveQuality.ts` (measured frame windows). Use the tiers; do not invent
  a fourth switch.
- **Loading.** `loadAll(items, load)` loads with bounded concurrency and returns results in the
  input's order. `addInSlices(objects, add)` attaches hundreds of objects across frames. A pool that
  pushes results lands a different asset every load.
- **Assets.** The build cooks textures to KTX2/Basis, deduplicates model images and reports bytes;
  `assets.budget` fails the build over a ceiling. Do not ship unpacked 4K textures and plan to
  optimize later.
- **First use.** `warmUpScene(scene, camera)` compiles what a scene needs in slices, presenting a
  frame between each. Warm up the real scene before interactive play; do not pre-touch every
  possible variant.

## Reach for these before you write your own

| You have | Use | What it gives you |
| --- | --- | --- |
| Many copies of one shape | `InstancedBatch` | One draw, no per-copy mesh |
| One over-detailed body seen at many distances | `ClusteredBatch` / `ClusteredMesh` | Each copy submits the detail its distance earns |
| A particle surface | `GPUParticles3D` | Pooled dispatch, game-owned appearance |
| Bullet streaks | `TracerPool3D` | Pooled travelling meshes |
| A sprite that faces the camera | `Billboard3D` | No hand-written per-frame orientation |
| One directional shadow over an open world | `VirtualShadowNode` | Camera-centred, texel-snapped clip levels; `trackCaster` for movers |
| Distance detail swaps | three's `LOD` | Standard, and the engine can still batch it |
| Raycasts over a large static scene | `GPUSceneBVH` / `ScenePicker` | Built once, queried many times |

## The shortcuts that cost a frame

- One mesh per bullet or particle. Pool them (`TracerPool3D`, `GPUParticles3D`) or instance them.
- A fresh `Vector3`, array or object per entity inside `update`. Hoist it out of the loop and reuse
  it; allocation shows up as GC in the trace, not in the average.
- A per-mesh render hook that packs buffers. That is `ctx.beforeRender` once per draw.
- Many shadow-casting lights, or one 4K shadow map for a whole valley. One directional light plus
  `VirtualShadowNode`.
- The same large equirect on `scene.background` and `scene.environment`. The environment light is
  charged again and moves in power-of-two steps — see `agent-docs/mobile-memory-budget.md`.
- A unique material or texture per copy. Share materials and images; the batcher merges equal
  material and geometry.

## Measure, then change one thing

`TN_FRAME_BUDGET` reports `fps` and the five phases (`update`, `render`, `overlay`, `residual`,
`hostGap`); `TN_RENDER_PROJECTION` reports whether the scene batched and, when it did not, the
reason. `npx @threenative/playtest perf` turns a log into a windowed report. When the percentile is
bad but the cause is not obvious, `agent-docs/trace-a-slow-frame.md` names the function before you
change a line.
