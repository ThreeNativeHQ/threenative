# The render projection batches nothing on a real scene: 835 candidates, 835 draws

**Status:** fix landed and device-measured — unit red/green, browser reproduction and Pixel 8
before/after all recorded below (commits `385fd50e`, this record, 2026-08-25). Improvement is
−35 % frame cost at native resolution; the scene is not yet at 60 fps, so PRD-level follow-ons
(GPU command pressure per sub-draw, game-side enemy AI cost) remain open levers.
**Severity:** high — it is the top frame-time lever on mobile and the thermal-headroom lever for
the whole device lane. A physical Pixel 8 holds 17–19 fps on a 60 Hz display with the phone cool
(31 °C, thermal status 0), so this is real cost and not throttling.
**Reported:** 2026-08-25
**Layer:** `packages/core` — `projection-plan.ts`, `projection-apply.ts`, `renderProjection.ts`
**Game used as the specimen:** `sandbox/fps-framework` (Bayview), `com.threenative.bayview`
**Prior filings this supersedes in detail:** PRD-214's lever table row "Material-keyed
`BatchedMesh` lane", filed by PRD-218 on 2026-08-24. That row is correct; this adds the measured
population and the browser reproduction so the fix can be written and scored without a phone.

---

## Fix record (2026-08-25)

The material-keyed lane landed exactly where this filing sketched it, with every constraint kept:
keyed on material identity plus batch flags plus an attribute signature (what three's
`_validateGeometry` refuses to mix — never material value); instanced grouping keeps first claim
on any mesh; `WORTHWHILE_DRAW_RATIO` and `MIN_BATCH_MEMBERS` untouched; all existing
`exactLaneReason`s preserved and one added (`negativeScale`, for the matrices `BatchedMesh`
cannot carry). Two correctness obligations came with the packed copies, both corpus-tested:

- a geometry whose attribute versions move after admission is demoted to the exact lane *before*
  that frame's plan is built — no frame ever renders a stale copy;
- negatively scaled sources are refused apply-side and counted before build, so a projected
  frame never hands the renderer more draw candidates than the authored scene holds.

Red first (`batches: 0`, `resultDrawCandidates == sourceRenderables` on distinct geometries over
one shared material), then green (`300 → 1`). One pre-existing spec row was superseded rather
than broken: "hands back a scene whose meshes each carry their own geometry" encoded the old
decline verdict for exactly this scene shape; it now asserts the projection engages while keeping
its authored-graph invariant. Gates at commit time: typecheck, lint, 2 186 unit tests, budgets —
all exit 0.

Browser reproduction against the sandbox game, headed Chromium, same scene as the symptom above:

```
BEFORE  {"projecting":false,"reasonCode":"notWorthwhile","sourceRenderables":835,
         "resultDrawCandidates":835,"batches":0,"exact":{}}
AFTER   {"projecting":true,"reasonCode":"projected","sourceRenderables":835,
         "resultDrawCandidates":561,"batches":13,"instancedBatches":0,
         "materialBatches":13,"projectedObjects":287,
         "exact":{"skinned":40,"renderOrder":336,"transparent":75,"points":5,
                  "instanced":12,"tooFewToBatch":80}}
```

Honest reading of the 561: 287 sources fold into 13 material-keyed draws; the rest are exact-lane
proxies dominated by `renderOrder: 336` — mostly the ~224 hidden decal slots this filing already
flagged as game-side work, which the mirror must still carry because they may become visible at
any frame. The renderer-level GPU command count does not collapse to 13: r185's WebGPU backend
walks one `BatchedMesh` as one render object (one pipeline/bind-group setup, one sort entry) but
still issues a `drawIndexed` per packed sub-draw. The claimed win is the per-object CPU walk and
shared state, and the arbiter for what that buys in frames and heat is the device run below.

## Device record (2026-08-25, physical Pixel 8, `shiba` 37251FDJH0037Z)

Wi-Fi adb, discharging, APK marker-verified (`materialBatches` grepped inside the installed
bundle) and launch-verified (`com.threenative.bayview`, not the conformance harness). Three layers
of evidence, hottest last; every number is a full 300-frame `TN_FRAME_BUDGET` window.

**Matched-cool pair at native resolution** — the after arm ran from ~29 °C battery, thermal
status 0, the same conditions as this file's before table:

| 2400×1080 | fps | frame mean | render mean |
| --- | --- | --- | --- |
| before (declined) | 17.3 | 51.8 ms | 41.7 ms |
| **after (13 material batches)** | **20.1** | **33.7 ms** | **28.5 ms** |

Frame cost −35 %, render phase −32 %, windows 4 and 5 agreed within 0.04 fps.

**Matched-warm pair at 1200×540** — both arms back-to-back at ~36 °C battery (the phone would not
shed below ~34 that hour), so only the relative delta is claimed:

| 1200×540 | projecting | fps | frame mean | render mean |
| --- | --- | --- | --- | --- |
| pre-fix core | false · notWorthwhile | 30.1 | 32.4 ms | 31.4 ms |
| **after** | true · 13 batches | **34.5** | **25.0 ms** | **21.6 ms** |

**Thermally confounded, reported anyway:** a later fixed-build window at 36 °C read 16.9 fps /
50.8 ms — at that soak throttling dominates and the two builds converge. Comparability claims
above rest on the pairs, not on any single hot window.

On-device `TN_RENDER_PROJECTION` matched the browser line exactly: `projecting:true`,
835 → 561 candidates, 13 material batches folding 287 sources.

Honest ceiling: ~34 fps at ¼ pixels, ~20 at native — better, not fixed to 60. r185's WebGPU
backend still issues one GPU command per packed sub-draw; the lane removed the per-object CPU
walk and the per-mesh state churn, which is a third of the frame, not all of it.

An intermittent physics-bridge SIGSEGV met during this session is A/B-proven pre-existing and is
filed separately:
`docs/bugs/physics-simulation-callback-segv-flaky-2026-08-25.md`.

---

## Symptom

The projection declines on every frame and every mesh is submitted as its own draw:

```
TN_RENDER_PROJECTION:{"projecting":false,"reasonCode":"notWorthwhile",
 "reason":"projecting would draw 835 of 835 candidates, which is not worth its own cost",
 "sourceRenderables":835,"resultDrawCandidates":835,"batches":0,
 "projectedObjects":0,"exactObjects":0,"exact":{}}
```

`exact: {}` is the part that matters. **Nothing was ruled ineligible** — not transparency, not
`renderOrder`, not a render hook, not `drawRange`. Every one of the 835 is batchable. They simply
never share a group.

## Root cause

`addToBatchGroup` (`packages/core/src/projection-plan.ts:346`) keys a group on
**(geometry object, material object, batch flags)**, through a `WeakMap` chained on the instances
themselves. Two meshes therefore batch only when they are the *same* `BufferGeometry` instance and
the *same* `Material` instance.

That key is `InstancedMesh`-shaped, and `InstancedMesh` is what
`projection-apply.ts` builds — one geometry, one material, many transforms.

Bayview's town is the opposite shape: **many distinct building geometries sharing a handful of
materials.** Every group holds one member, `predictDraws` returns `renderables`, and the
`WORTHWHILE_DRAW_RATIO` (0.75) test at `projection-plan.ts:525` declines.

**The threshold is not the bug and must not be touched.** Declining is arithmetically correct for
the mechanism the projection currently has. The missing mechanism is a second grouping.

## Measured population

Captured from the live scene in Chromium against the Vite dev server, by patching
`WebGPURenderer.prototype.render` on the app's own three module instance to capture the scene, then
walking it. Two populations are reported because they differ a lot and only the second one draws:

| | every mesh in the graph | **only meshes that actually draw** |
| --- | --- | --- |
| meshes | 818 | **480** |
| of which skinned | 40 | 40 |
| material **objects** | 485 | **147** |
| material **values** (see signature below) | 77 | **62** |
| geometry objects | 393 | **389** |
| distinct (geometry, material) pairs | 790 | **452** |
| distinct (geometry, material-value) pairs | 406 | **391** |
| `renderOrder !== 0` | 341 | 13 |
| `transparent` | 447 | 109 |
| material types | 380 Basic / 275 Standard / 163 StandardNode | 42 Basic / 275 Standard / 163 StandardNode |

The "every mesh" column is inflated by ~224 hidden decal slots
(`sandbox/fps-framework/src/render/decals.ts`, `settle()` hides unused slots). **Use the drawn
column.** An earlier read of this bug quoted 485/77 and over-stated the win; the honest numbers are
147 material objects, 62 values, over 480 drawn meshes.

Value signature used: `type, color, roughness, metalness, map.uuid, normalMap.uuid, emissive,
transparent, side, opacity, alphaTest, vertexColors, flatShading, depthWrite, blending, wireframe`.

### What the numbers rule in and out

- **Material de-duplication alone does not fix it.** Sharing value-equal materials takes the pair
  count only from 452 to 391 against 480 drawn meshes, so `predictedDraws` stays above
  `480 × 0.75 = 360` and the projection still declines. Geometry really is unique per building.
- **Material-keyed grouping does fix it.** `BatchedMesh` holds *many geometries* under *one*
  material, which is exactly this scene's shape. Grouping the drawn, batch-eligible meshes by
  material identity collapses them toward the material count rather than the mesh count.
- Subtract the meshes that must stay on the exact lane — 40 skinned, 109 transparent, 13
  `renderOrder` (sets overlap) — and roughly 320 of the 480 are candidates for a material-keyed
  batch, against ~147 material objects.

## Why it costs what it costs

From `docs/verification/prd-218-launch-stall-and-heat-2026-08-24.md`, on the physical Pixel 8:
835 per-frame draws hold `SDLThread` at 93.6–110 %, lift the GPU rail `S2S_VDD_G3D` from 2.2 mW
idle to 423.7 mW, take whole-device draw from −217 mA to −611 mA (peaks −1327 mA), and heat-soak
the phone 35.4 → 43.2 °C into thermal status 2 — past which every other measurement on the device
is unreliable.

Independently re-measured 2026-08-25 on the same phone, cool, with the fps-framework APK:

| resolution | fps | frame mean | render mean | update | substeps |
| --- | --- | --- | --- | --- | --- |
| 2400×1080 | 17.3 | 51.8 ms | 41.7 ms | 10.1 ms | 3.47 |
| 1200×540 (¼ the pixels) | 23.1 | 41.5 ms | 35.2 ms | 6.2 ms | 2.59 |

Quartering the pixel count cuts render time 15%. **It is draw-submission bound, not fill bound** —
consistent with PRD-214 Phase 0, which already recorded resolution/fill as refuted.

PRD-214 Phase 0 also measured the neighbouring half of the same 835 objects, at a fixed 830 visible
meshes: real materials 52.47 ms, sharing duplicate instances of the same class 37.77 ms, one shared
`MeshBasicMaterial` 27.21 ms.

## Reproduction, no phone needed

```sh
cd sandbox/fps-framework
pnpm dev --host 127.0.0.1 --port 4178 --strictPort
# in another shell, drive it headed and read the console
npx threenative-playtest doctor --url http://127.0.0.1:4178 --text
```

`doctor` reports `render 1342 draw calls · 1,034,573 triangles`. The
`TN_RENDER_PROJECTION` line above is emitted once to the browser console (`console.info`) by
`renderProjection.ts:242`. The game's own bridge sample also carries
`render: { drawCalls, triangles, invisibleMeshes }`.

## What the fix has to be

A **second grouping keyed on material across differing geometries**, emitting three's
`BatchedMesh`, sitting beside the existing `InstancedMesh` grouping rather than replacing it. A
mesh that can join an instanced group should keep doing so; the material group is for the ones that
cannot.

Sketch of where it lands:

- `projection-plan.ts` — a `groupsByMaterial` map beside `groupsByGeometry`; a mesh joins it when
  it is batch-eligible and its (geometry, material) group is below `MIN_BATCH_MEMBERS`.
  `predictDraws` counts a material group as one draw; `collectBelowFloor` releases material groups
  that are still too small.
- `projection-apply.ts` — build and reconcile a `BatchedMesh` per material group:
  `addGeometry` / `addInstance` / `setMatrixAt` / `setVisibleAt`, with vertex and index budgets
  sized from the group before anything is built, and a free list like the `InstancedMesh` path has.
- `renderProjection.ts` — report `batches` and a per-lane split so the decline reason stays
  debuggable.

## Constraints the fix must respect

These are the invariants the existing design is built on. Breaking one buys frame rate and returns
wrong frames, which this subsystem exists to prevent.

1. **Correct rendering is unconditional; optimization is opportunistic.** The authored scene is
   never consumed or mutated. When the mirror cannot reproduce something faithfully, the frame
   falls back to the authored scene. That is a correct slow path, not an error.
2. **Do not key on material *value*.** It is tempting — 147 objects collapse to 62 values — and it
   is unsafe here for two reasons. A plain property write such as `material.color.set(...)` does
   not bump `material.version`, so a value key cannot be invalidated cheaply and siblings would
   silently render with a stale representative. And 163 of the drawn materials are
   `MeshStandardNodeMaterial`, whose appearance comes from a TSL graph that no scalar signature can
   capture. Key on material **identity**; it already gives the win.
3. **Keep every existing `exactLaneReason`.** Skinned, morph, multi-material, `drawRange`,
   `renderOrder !== 0`, transparent, custom depth material, LOD, sprite, points, instanced, and any
   object carrying `onBeforeRender` / `onAfterRender` stay on the exact lane. `BatchedMesh` is one
   draw and therefore one place in the transparency sort, exactly as an instanced group is.
4. **Report, never decide silently.** The existing comment at `renderProjection.ts:233` states the
   reason: a game that had already merged its own scene was re-expanded into a thousand
   single-member draws and stalled, and the first person to know was the person holding the phone.
5. **Allocation-free steady state.** The scan is deliberately free of per-frame allocation
   (workspaces are pooled and reused, `releaseProjectionScanWorkspace`). A new grouping must reuse
   its own workspace the same way — see PRD-189 for why this is enforced.
6. **The kill switch applies.** If the material lane costs more code than it saves, it is deleted;
   `scripts/count-loc.ts` scores it.

## Acceptance

- Red first: a unit scenario of N meshes with distinct geometries and one shared material currently
  reports `batches: 0` and `resultDrawCandidates == sourceRenderables`. Paste that, then make it
  batch.
- `TN_RENDER_PROJECTION` on bayview reports `projecting: true` with `batches > 0` and
  `resultDrawCandidates` materially below `sourceRenderables`.
- A device run on the physical Pixel 8 with `observations.deviceMetrics` not thermally confounded,
  before and after, with fps and the `render` phase from `TN_FRAME_BUDGET`.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exit 0, and the projection's existing
  specs (`packages/core/__tests__/renderProjection.spec.ts`) stay green — they encode the
  correctness invariants above.

## Not the bug

- **The `WORTHWHILE_DRAW_RATIO` threshold.** Declining is correct for the current mechanism.
  Loosening it would batch nothing and cost the mirror's overhead on top.
- **`MIN_BATCH_MEMBERS`.** Groups here have exactly one member; no floor value helps.
- **The game's scene composition.** PRD-214 reviewed it: `src/render/` already merges facade and
  vehicle geometry, instances repeated props, carries one shadow-casting directional light and no
  post pass beyond tone mapping. The game is not written badly; the town is genuinely made of
  distinct solids.
- **Fill rate / resolution.** Refuted twice, most recently by the ¼-pixel run above.
- **Engine plumbing** — loop, physics dispatch, present wait. `hostGap` p50 0.94–5.00 ms and
  `residual` p50 ≤ 0.03 ms in every rung PRD-214 measured.

## Adjacent, separate, do not fold in

- The game's enemy AI costs real frame time on its own: the bridge sample reports
  `squad.canSee 15.7` and `squad.brain 13.5` alongside `render`. That is game-side and belongs in
  `sandbox/fps-framework`, not in this fix.
- `sandbox/fps-framework/src/render/decals.ts:173` clones a `MeshBasicMaterial` per slot, 224 of
  them, all value-identical and all sharing one `PlaneGeometry`. They are hidden after `settle()`
  so they are not part of the drawn cost, but the pool would be one instanced group if it shared
  its material. Game-side tidy-up, worth doing, not this bug.

## Reversal record (2026-08-26): the fold is gated back off — it draws broken pixels

The consumer game this filing used as its specimen (`sandbox/fps-framework`, the Bayview town
scene) rendered **visually broken** through the packed-copy lane on desktop Chrome/WebGPU
(Vulkan): from some vantages a whole street of houses drew as one giant flat untextured slab, a
shutter texture smeared across an enormous surface, and facade pieces floated free — starting a
few seconds after load, exactly when the projection flips on. The user report was "the right-side
house had the correct walls and texture, now it doesn't"; the same view rendered correctly the
day before the lane landed.

Evidence chain, all captured 2026-08-26:

- **Pixel A/B, same vantage, same inputs, headed Chromium:** with the projection declined
  (`minMeshes` forced past the scene size) the street renders correctly, textured, complete. With
  the projection engaged the slab is there. Reproduced on the PRD-223 staging install
  (`staging-263981b0`) *and* on a tarball built fresh from `main` (`d5f458f0`) — the fold is on
  main too, so this was never branch-local.
- **Live scene-graph audit, on screen, at the moment of the artifact:** every material batch
  pristine — instance matrices equal to their sources' `matrixWorld` (max element diff 0), no
  zombie instances, packed index ranges contiguous and every sampled packed index inside its own
  vertex reservation, `_multiDrawCount` equal to the visible instance count. The JS state the
  renderer is handed is *correct*; the pixels are not.
- **No device loss, no console errors** in the artifact runs (a separate, reproducible
  `mappedAtCreation` failure storm — Chromium Dawn's message after device loss — was triggered
  once by forcing all 835 renderables onto the exact lane, and does not occur in the
  artifact-producing runs).
- **Minimal three r185.1 reproduction cannot trigger it:** static packing, per-frame visibility
  churn, moving instances, an engine-style mid-run batch rebuild, and both Uint16/Uint32 index
  paths all render correctly in isolation — the break needs the game's real scene around it.

On the WebGPU backend the fold never saved a draw command: a `BatchedMesh` executes one
`drawIndexed` per visible member (`_multiDrawCount == instance count` in every audit), so the
−35 % frame win above was render-object count, not draw count — and it was bought with a render
path that breaks real scenes in ways the unit corpus cannot see (vitest runs node-stubbed; no
pixel assertion exists for packed copies).

**The fix (this record's resolution):** `predictDraws` no longer claims material groups or nets
their members out — members stay counted once by their own below-floor geometry groups, the
worthwhile ratio declines geometry-unique scenes onto the exact lane, and the reason is honest
(`notWorthwhile`). The packed-copy machinery in `projection-apply.ts` (stream watch, demotion,
negative-scale refusal) stays in place for a backend-aware prediction, but re-admitting the fold
requires a visual conformance proof — a playtest or conformance case that renders a geometry-
unique scene through the mirror and compares pixels against the authored scene — before it ships
again. Red/green: the "folds meshes that differ only in geometry" row was rewritten to assert the
decline (red against the fold, green after), the two packed-copy reconciliation rows were removed
with their lane's premise, and the "never make a scene worse" row kept its graph-snapshot
invariant. Gates at commit time: renderProjection spec 56/56, core suite 466/466, typecheck,
lint — all exit 0.
