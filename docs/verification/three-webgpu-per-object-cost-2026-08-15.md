# three.js WebGPU per-object submission cost, measured against Godot 4.7.1 — 2026-08-15

What the PRD-117 load test found about the renderer underneath ThreeNative. The engine-vs-engine
result lives in `engine-load-test-summary-2026-08-15.md`; this page is only about the one place
ThreeNative loses, why it is three.js's cost rather than the framework's, and what the framework does
about it.

## The two questions this answers

**Is ThreeNative faster than plain three.js?** Yes, by 11.6× on the workload below — not because it
draws faster, but because it removes most of the draws.

**Is ThreeNative faster than Godot?** On instanced rendering, yes, on all three platforms. On raw
unbatched per-object rendering on the web, no — and that path *is* plain three.js, with the framework
contributing nothing.

**Does a developer have to ask for this?** No. `defineGame` constructs `SceneCollapse`
unconditionally, so the L1 → L3 gain below is what a normally-written game already gets. The L1 rung
exists only because the benchmark harness bypasses `defineGame` on purpose.

## The workload

`examples/engine-load-test`, N animated unit cubes, one shared `MeshStandardMaterial`, one shared
`BoxGeometry`, one directional light, no shadows, `antialias: false`, `setPixelRatio(1)`. Three modes
over the same authored scene:

- **L1** — one `Mesh` per cube. This is plain three.js; the framework does nothing.
- **L2** — one `InstancedMesh`. The author opted into instancing.
- **L3** — L1 authoring plus ThreeNative's `SceneCollapse`.

## ThreeNative against plain three.js

Chromium/WebGPU, RTX 2080, 1280×720, vsync off. Same authored scene in every row:

| N | L1 (plain three.js) | L3 (with collapse) | draws L1 → L3 | margin |
|---|---|---|---|---|
| 1 024 | 4.00 ms | 0.70 ms | 604 → 3 | 5.7× |
| 4 096 | 20.90 ms | **1.80 ms** | 2 381 → 3 | **11.6×** |
| 16 384 | 95.20 ms | **8.20 ms** | 9 400 → 3 | **11.6×** |

Knee at ≤20 ms p95: **1 024 without the framework, 16 384 with it — 16×.**

The framework's contribution is entirely "stop submitting 9 400 draw calls", not "submit them
faster". Nothing here makes three.js's draw path quicker.

## Where three.js's per-object cost actually goes

Stage profile of L1 at 4 096 cubes, 2 350 visible, 26.5 ms/frame (profiling inflates the frame ~27%;
the unprofiled figure is 20.90 ms p50). `stepMs` is **0.00** at every rung, so the game's transform
loop contributes nothing — all of it is inside `renderer.render()`:

| stage | ms/frame | calls/frame |
|---|---|---|
| `renderer.renderObjectDirect` | 20.97 | 2 351 → **8.9 µs per object** |
| ↳ `bindings.updateForRender` | 6.03 | 2 350 |
| ↳ `nodes.updateForRender` | 2.88 | 2 350 |
| ↳ `renderObjects.get` | 2.20 | 2 351 |
| ↳ `backend.draw` | 1.45 | 2 351 |
| ↳ `pipelines.getForRender` | 1.25 | 2 351 |
| ↳ `geometries.updateForRender` | 0.88 | 2 350 |
| ↳ `nodes.updateBefore` + `updateAfter` | 1.02 | 2 350 each |
| `renderer.projectObject` | 3.97 | 4 100 |
| `renderList.sort` | 0.33 | 2 |

Against Godot's `gl_compatibility` backend on the identical scene: **~11.3 µs per drawn object
against ~5.3 µs.**

## Why this is not redundant work three fails to cache

`Nodes.updateGroup()` already short-circuits. Object-scoped groups always update; shared material and
frame groups do a version check and bail:

```js
if ( groupNode.updateType === NodeUpdateType.OBJECT ) return true;
// ...
if ( groupData.version !== groupNode.version ) { groupData.version = groupNode.version; return true; }
return false;
```

So the residual cost is the **bookkeeping of the cache**, not a cache miss. Per object, per binding,
per frame, `Bindings._update()` walks the bind group, and each binding does a chained-map lookup
(`groupsData.get( _chainKeys )`) plus a version compare. At 2 350 objects × 3–4 bindings that is
~8 000 chained lookups per frame before a single draw is issued.

That is the architectural cost of per-object bind groups in the WebGPU backend, against a tight GLES
path with far less per-object indirection. It is not a small diff.

## Self-check: is this a three.js defect? No.

Before treating any of the above as an upstream problem, the same scene was rebuilt as a **standalone
plain-three page** — no ThreeNative, one `WebGPURenderer`, N separate `Mesh`es sharing one material
and one geometry — and run against three's **own WebGL backend** via `forceWebGL: true`. Identical
scene, identical draw counts, three 0.185.1, same machine:

| scene | WebGPU backend | WebGL backend |
|---|---|---|
| 4 096 meshes (3 760 draws/frame) | **24.30 ms** p50 | 27.10 ms |
| 16 384 meshes (14 926 draws/frame) | **117.10 ms** p50 | 153.30 ms |
| 16 384 instanced (2 draws/frame) | 4.80 ms | 4.20 ms |

**three's WebGPU backend is already faster than its WebGL backend** on the per-object case — by 24%
at 16 384 draws. There is no regression and nothing actionable to report upstream. The per-object
cost is what it costs to issue thousands of draw calls from JavaScript; Godot is quicker at it
because it does that work in compiled C++, not because three.js is doing something wrong.

An earlier draft of this page proposed filing a three.js issue. **That was wrong and is withdrawn.**
A "slower than Godot at 4 000 draw calls" report is a JavaScript-versus-C++ comparison, not a
renderer defect, and it would not have survived triage.

The standalone repro also independently confirms the harness: 20.90 ms / 2 381 draws in the
benchmark is 8.8 µs per draw, against 24.30 ms / 3 760 draws in the plain-three page at 6.5 µs — same
order, different camera framing. The framework is not adding the cost.

## What this does and does not license

- It is **not** a ThreeNative defect. The framework contributes no code to this path.
- It is **not** fixable inside ThreeNative, and **not** an upstream three.js bug either — see the
  self-check above. Patching `three` here would fork it for no defect.
- The 4× knee gap against Godot at L1 **overstates it**. Rungs are 4× apart, so missing the 20 ms
  line by a hair costs a whole rung. The frame-time gap at 4 096 is **1.45–1.55×** — ThreeNative
  p50 20.5–21.4 / p95 26.2–28.0 against Godot p50 13.2–13.8 / p95 17.8–19.8. Flipping the knee needs
  ~25–30% off, and Godot clears the line by a hair itself.
- The honest framework claim is that **`SceneCollapse` is the answer to this workload**, with the 16×
  above as evidence — never that three.js draws individual meshes quickly.

## Reproducing

```sh
pnpm bench:engines --arm tn-web  --ladder 256,1024,4096,16384 --modes L1,L2,L3 --out tn-web
pnpm bench:engines --arm godot-web --ladder 256,1024,4096,16384 --modes L1,L2 --out godot-web
node profile-l1.mjs        # stage-level breakdown of the L1 frame
```

The standalone plain-three page is `three-webgpu-per-object-repro.html` beside this file. Serve it
next to three's `three.webgpu.js`, `three.tsl.js` and `three.core.js` builds and open it with
`?mode=mesh|instanced&n=<N>&backend=webgpu|webgl`; it prints its own result as JSON.

Artifacts land in `artifacts/engine-load-test/`. Run `checkEquivalence` on any pair before quoting
it — triangle counts, draw calls, build type and display state all have to match, and on this pair
they do not (culling differs by 9%, in Godot's disfavour: it draws 122 942 triangles to ThreeNative's
112 779 at 16 384 and still wins).
