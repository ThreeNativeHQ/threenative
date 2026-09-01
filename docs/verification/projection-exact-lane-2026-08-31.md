<!-- schemaVersion: 1 -->

# The projection reports its exact lane per window — PRD-310 phase 1, 2026-08-31

The instrument Phase 2 needs exists. **The measurement it exists to take has not been taken**, and
this file says why rather than substituting a number from a scene that does not exercise the thing.

Base: `origin/main` at `a1a4021a`. Linux, Chromium through Playwright 1.62.1 under a private Xvfb.

## A correction the PRD already anticipated, confirmed against the code

The direction document says `SceneRenderProjection` *"today only covers meshes that never move"*.
That is not what the code does, and PRD-310 says so in its own opening. Reconciliation compares
each member's `matrixWorld` against its stored copy and writes `setMatrixAt` when it changed — **a
moved member is a matrix write, not an eviction.** What leaves the folding lanes is a *kind* of
object: sprites, points and lines, already-instanced or batched meshes, skinned meshes,
multi-material meshes, custom-depth meshes, and `LOD` subtrees. Each gets one draw, with an
enumerated reason.

So "cover what moves" almost certainly means "fold the skinned lane". Phase 1 exists to find out
which reason actually costs the draws before weeks are spent on the wrong one.

## What landed

`IRenderProjectionReport` gains `drawsPlanned` — one draw per batch plus one per exact-lane object,
and on a declined frame the authored renderable count rather than zero, because a declined frame
still costs a draw each and zero would read as "this frame was free".

A new marker, `TN_PROJECTION`, is printed **on every frame-budget window** rather than once at the
verdict, and carries what the projection cannot know on its own: the draw calls the renderer
counted. `TN_RENDER_PROJECTION` is unchanged and still answers "did the optimizer engage"; this one
answers "what is it still leaving on the table, and does the renderer agree with the plan".

The playtest `perf` command parses it and prints the exact lane ranked by cost:

```
scene projection: on (projected); 780 authored renderables, 118 draws planned,
  315 actual — the renderer and the plan disagree
  exact lane, 118 draw(s), by reason:
    skinned               96
    multiMaterial         12
    instanced             6
    lod                   4
```

That sample is the unit fixture, not a measurement. A real run prints the same shape.

**Planned and actual are two fields and are never aliased.** On WebGPU a `BatchedMesh` is one
render object that issues one `drawIndexed` per visible member, so "one draw per batch" is a claim
the backend need not honour, and a report that folded them into one number would be an optimizer
marking its own homework.

## What was not measured, and why

PRD-310's Phase 1 asks for the ranked lane **in a game that runs out of GPU with characters in
it**. No such subject is reachable from this repository:

- `examples/abyss-framework`, the largest in-repo scene, **declines**:
  `TN_RENDER_PROJECTION:{"projecting":false,"reasonCode":"belowMeshFloor","reason":"fewer than 200
  batchable meshes; the mirror would cost more than it saves",…}`. Its exact lane is empty because
  no mirror is built at all. Both its `draw-calls` and `frame-budget` scenarios pass and neither
  emits a single `TN_FRAME_BUDGET` window, so the per-window marker has nothing to attach to.
- `examples/engine-load-test` does exercise the projection, and has no characters — it is 65,536
  instanced anchors, which is the population already folded.
- The subject the direction document actually measured — Bayview, 780 → 315 draws — is a **sandbox
  game outside this repository**, and it was attempted. Its `node_modules/@threenative/*` symlinks
  all point at a path that no longer exists; repointing them at this lane's packages resolved the
  engine, and the run then failed one layer down:

  ```
  Error: Cannot find module '…/prd259-bayview-current-20260830/node_modules/vite/bin/vite.js'
  ```

  Its `vite` install is gone too, and its `@threenative/*` dependencies are declared `workspace:*`,
  which does not resolve outside a workspace — so restoring it means re-installing that project
  against a layout it no longer has. That is a mutation to a shared sandbox tree holding another
  session's uncommitted work in a sibling game, and this lane does not make it. **The symlinks were
  put back exactly as they were found.**

## Run 2026-09-01: the marker works in a real game, and every template declines

The `shooter` — the busiest template — was scaffolded, built and driven for 35 seconds. The marker
printed on **every one of six frame-budget windows**, and it declined every time:

```
TN_PROJECTION:{"drawsActual":116,"drawsPlanned":52,"exact":{},"exactObjects":0,
  "projecting":false,"reasonCode":"belowMeshFloor",
  "reason":"fewer than 200 batchable meshes; the mirror would cost more than it saves",
  "sourceRenderables":52,"window":1}
```

Two things this settles.

**The instrument works end to end.** Per-window, in a scaffolded game, with the decline and its
reason on every line — which is the shape Phase 2 needs and the shape `TN_RENDER_PROJECTION` alone
could not give.

**The exact lane is empty because nothing is folded at all.** 52 authored renderables against a
floor of 200. The shooter is the largest template scene, so *no* in-repo template can produce the
ranked table; that is now measured rather than assumed.

### And the divergence is not what it looks like

`drawsPlanned 52` against `drawsActual 116` is a 2.2× gap on a **declined** frame, where the plan is
simply "one draw per authored renderable". It is not a projection defect. The shooter's key light
casts shadows (`renderer.shadowMap.enabled = true`), so the renderer walks the same objects again
for the shadow map, and `info.render.drawCalls` counts every pass while the plan counts the colour
pass only.

That is worth stating plainly here, because the field was added precisely so a divergence would be
visible — and the first divergence it surfaced has an innocent explanation. **A reader comparing the
two numbers must know the plan is colour-pass draws and the measurement is all draws.**

The honest consequence: **Phase 2's target reason is still unchosen**, and this PRD stays PARTIAL
until a run produces the ranked table. The instrument is what makes that run a one-command read
instead of a rebuild-per-experiment, which was the whole point.

## Green

| Gate | Result |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` | pass |
| `pnpm exec vitest run` | 311 files, **3107 passed**, 1 skipped |
| `pnpm budgets` | pass |

The two new specs: `packages/core/__tests__/projection-marker.spec.ts` (6) and the projection
section of `packages/playtest/__tests__/perf.spec.ts` (6).

## Negative controls — every one observed red

```
### 1. drawsPlanned aliased to the measured count
× should report actual draws separately from planned draws
AssertionError: expected 41 to be 1

### 2. the marker suppressed on a declined frame
× should emit the marker with its reason when the projection declines
AssertionError: expected false to be true

### 3. the ranking sorted the wrong way
× should rank reasons by draw count
× should print the exact lane ranked, largest reason first
AssertionError: expected [ { count: 4, reason: 'lod' }, …(3) ] to deeply equal [ …(4) ]

### 4. a run with no marker reports nothing instead of saying so
× should say the projection was not reported rather than imply an empty lane
```

Control 4 is the one that matters most for a measurement instrument: a run that never emitted the
marker must say *not reported*, never print an empty table that a reader would take for a measured
zero.

## Not executed

- No device run, no Android, no native target.
- No draw-count or frame-rate claim is made anywhere in this lane. Nothing here changes what is
  drawn; it changes what is reported about it.
