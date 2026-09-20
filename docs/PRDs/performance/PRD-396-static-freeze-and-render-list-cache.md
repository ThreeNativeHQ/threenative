# PRD-396 — Static-transform freeze and cached render lists

**Status:** NOT STARTED
**Complexity:** 5
**Owner:** unassigned
**Depends on:** PRD-395 Phases 1–2 (span mechanism must exist to measure this; the full
attribution table is not required to start, but is required before Acceptance).
**PR:** (open as draft before Phase 1) — label `prd:0`

## Problem

Of the 5.22 ms of the render phase we can currently name, **3.71 ms is traversal**
(`_projectObject` 1.48, matrix walk 2.22) and **1.51 ms is per-draw bookkeeping keyed on JS
object identity** (`_objects.get`, `_nodes.needsRefresh`,
`_geometries`/`_bindings`/`_pipelines.updateForRender`).

The scene is 1,561 meshes. Cull considers 1,680 objects, culls 409, and exempts 856 as
shadow casters; the size threshold is already at 2 px, so there is nothing left to win by
tightening it. The shadow lane walks the graph a second time for 364 of the 573 draws.

Almost none of this work changes between consecutive frames. Island geometry, deck fittings,
static props and the terrain do not move; their world matrices are recomputed every frame,
re-projected every frame, and their geometry/binding/pipeline handles are re-resolved
through identity-keyed maps every frame. The camera moves, so the *visible set* can change —
but the *candidate set* and its world bounds do not.

Ranked estimate: **0.8–1.5 ms, ~zero risk, ~1 day, helps browser equally.** It is first
because it is the only lever that is both cheap and portable, and because it is the correct
place to build the divergence harness that any future line-crossing work will need.

## Scope / Non-goals

**In scope**
- Engine mechanism: a per-subtree transform version counter; `static` subtrees skip the
  `updateMatrixWorld` walk while their version is unchanged.
- Engine mechanism: split render-list construction into (a) a flat candidate array with
  cached world bounds, invalidated by graph/visibility/material version, and (b) a per-frame
  visibility filter over that flat array. The camera may move every frame without forcing
  a graph traversal.
- Engine mechanism: resolved `(geometry, bindings, pipeline)` handles cached on the render
  item and invalidated by version, replacing per-frame identity-map lookups.
- Reuse of the same cache for the **shadow** and **reflection** render lists.
- `TN_RENDERLIST_VALIDATE=1`: recompute the render list from scratch every frame and diff
  visible set, draw order, and per-object world matrices against the cached path; throw on
  first divergence. Runs in CI on a scripted scene.
- Game-side: `static` markers on midway's immobile subtrees, shipped as **generated game
  source**, not as engine heuristics.

**Non-goals — explicitly refused here**
- **Ranked option 3 (shadow lane) is not taken.** This PRD reuses the cache for shadow
  render lists because that is the same mechanism; it does **not** do per-light caster
  culling, cascade reduction, or update throttling for static lights. The 856
  shadow-caster-exempt objects stay exempt. That is a separate PRD after PRD-397, because
  its ms/risk ratio is worse and it interacts with whatever PRD-397 does to the object count.
- No runtime auto-detection of staticness ("this object hasn't moved in 60 frames, freeze
  it"). Staticness is authored, generated, and checkable. A heuristic that guesses wrong is
  a correctness bug with no reproduction.
- **Ranked option 2 (content pipeline)** is not touched. Object and draw counts are
  unchanged by this PRD: 1,561 meshes and 573 draws in, 1,561 and 573 out.
- **Ranked options 4, 5, 6, 7** are not taken and not prepared for. Nothing here creates a
  second renderer path.
- No web-only helper. Every cache path ships with a native number in the same commit.

## Phases

### Phase 1 — Transform version + static freeze + the divergence harness

- [ ] Files wired: `packages/<engine>/src/core/TransformVersion.ts` — monotonic per-object
      version, bumped on any local-matrix write, propagated lazily to subtree roots.
- [ ] Files wired: `Object3D.static` flag honoured by the matrix walk; a static subtree with
      unchanged version is skipped entirely.
- [ ] Files wired: `packages/<engine>/src/profiling/RenderListValidate.ts` behind
      `TN_RENDERLIST_VALIDATE=1` — recomputes and diffs visible set (by id), draw order
      (by index), and per-object `matrixWorld` (elementwise, 1e-6) every frame.
- [ ] Required test passing: `npm test -- freeze.moving-static-object` — an object marked
      static whose local matrix is written **must** still update (version bump is the
      contract, not the flag). Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- validate.detects-divergence` — a deliberately
      stale cache is detected and throws. Result: `<command>` → `<exit code>`
- [ ] Observed red: `validate.detects-divergence` passed vacuously before the diff compared
      matrices; forced a divergence at `<sha>` and observed `<msg>`. Paste output.
- [ ] User verification: reference game, native, `TN_RENDERLIST_VALIDATE=1`, 1800 frames,
      zero divergences. Result: `<command>` → `<exit code>`, divergences `<n>`

### Phase 2 — Flat candidate array + per-frame visibility filter

- [ ] Files wired: candidate array built once per invalidation, holding object ref, cached
      world bounding sphere, material/geometry handles, and shadow-caster flag.
- [ ] Files wired: per-frame filter is a linear pass over the flat array; no graph descent.
- [ ] Files wired: invalidation on add/remove/visibility-change/material-swap/geometry-swap.
- [ ] Required test passing: `npm test -- renderlist.invalidate-on-add` — adding a mesh
      mid-frame appears in the next frame's list. Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- renderlist.churn-stress` — a scene adding and
      removing 200 meshes/frame is never slower than the uncached path by more than 5%.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: `renderlist.invalidate-on-add` failed at `<sha>` with `<msg>`.
- [ ] User verification: `_projectObject` span on native desktop.
      Baseline 1.48 ms → result `<n>` ms
- [ ] User verification: matrix-walk span on native desktop.
      Baseline 2.22 ms → result `<n>` ms

### Phase 3 — Cached per-draw handles; shadow and reflection lists reuse the cache

- [ ] Files wired: resolved `(geometry, bindings, pipeline)` handles stored on the render
      item, invalidated by version; identity-map lookups removed from the per-frame path.
- [ ] Files wired: shadow render list and reflection render list built from the same
      candidate array.
- [ ] Required test passing: `npm test -- bookkeeping.invalidate-on-material-change` —
      swapping a material re-resolves the pipeline. Result: `<command>` → `<exit code>`
- [ ] Observed red: that test failed at `<sha>` with a stale pipeline and `<msg>`.
- [ ] User verification: per-draw bookkeeping span on native desktop.
      Baseline 1.51 ms → result `<n>` ms
- [ ] User verification: shadow-pass span on native desktop.
      Baseline from PRD-395 Phase 4 `<n>` ms → result `<n>` ms
- [ ] User verification: draw counts unchanged.
      Expected main 158 / shadow 364 / reflection 51 = 573. Result: `<n>`/`<n>`/`<n>`

### Phase 4 — Game-side static marking (generated source) and measurement

- [ ] Files wired: midway's generator emits `static` on terrain, island, deck fittings and
      other immobile subtrees; the marking is in generated game source, not in `packages/`.
- [ ] Files wired: count of objects marked static is printed by the generator.
      Result: `<n>` of 1,561 meshes marked static.
- [ ] Required test passing: `npm test -- midway.static-markers-golden` — the generated
      marker set is byte-stable across two runs. Result: `<command>` → `<exit code>`
- [ ] Observed red: golden test failed at `<sha>` due to nondeterministic ordering; `<msg>`.
- [ ] User verification: native desktop, 1280x720, 1800 frames, frame p50.
      Baseline 20.2 ms → result `<n>` ms
- [ ] User verification: native desktop render-phase p50.
      Baseline 16.1 ms → result `<n>` ms
- [ ] User verification: browser WebGPU render-phase p50 (same scene).
      Baseline `<record at Phase 1>` → result `<n>` ms
- [ ] User verification: CI runs `TN_RENDERLIST_VALIDATE=1` on the scripted scene and fails
      on divergence. Result: `<workflow>` → `<exit code>`
- [ ] User verification: Android hardware, render-phase p50.
      Blocker: Android hardware rows open on PR #275. Does not gate Acceptance.
- [ ] User verification: iOS hardware, render-phase p50.
      Blocker: same as Android.

## Acceptance criteria

- [ ] Native desktop render-phase p50 improves by **≥0.8 ms** against the 16.1 ms baseline.
- [ ] Browser WebGPU render-phase p50 improves by ≥0.8 ms against its own recorded baseline.
- [ ] Combined traversal spans (`_projectObject` + matrix walk) fall from 3.71 ms to ≤2.0 ms
      on native desktop.
- [ ] Per-draw bookkeeping span falls from 1.51 ms to ≤0.8 ms on native desktop.
- [ ] Draw counts are unchanged: main 158, shadow 364, reflection 51.
- [ ] Triangle count is unchanged at 1.04M.
- [ ] 1800 frames of the reference game with `TN_RENDERLIST_VALIDATE=1` report zero
      divergences in visible set.
- [ ] 1800 frames with `TN_RENDERLIST_VALIDATE=1` report zero divergences in draw order.
- [ ] 1800 frames with `TN_RENDERLIST_VALIDATE=1` report zero divergences in `matrixWorld`.
- [ ] The churn-stress scene is within 5% of the uncached path.
- [ ] Static markers ship as generated game source; no staticness heuristic exists in
      `packages/`.

## Verification boundary

**Proven here:** that repeated per-frame graph traversal and identity-keyed per-draw lookups
can be removed without changing the visible set, the draw order, or a single world matrix,
on native desktop and in the browser, over 1800 frames of the reference game.

**Not proven here:** that the cache is correct for scenes the reference game does not
contain — skinned hierarchies under a static root, LOD swaps, instanced attribute churn.
`TN_RENDERLIST_VALIDATE=1` is the instrument for those; it is a validation mode, not a proof.

**Not proven here:** anything about the 10.9 ms PRD-395 is chasing. If PRD-395 finds the
mass is per-draw encode cost, this PRD's ≥0.8 ms is real but small, and PRD-397 is the
answer. If PRD-395 finds it is per-object, this PRD's target is too conservative and should
be raised before Acceptance is ticked.

**Inherited obligation:** the visible-set / draw-order / matrix diff built in Phase 1 **is**
the parity oracle named by the review. Any future PRD that introduces a second path for
render-list construction (ranked options 4, 5, 7) must extend this harness to diff across
paths and must fail CI on divergence. No such path is introduced here.
