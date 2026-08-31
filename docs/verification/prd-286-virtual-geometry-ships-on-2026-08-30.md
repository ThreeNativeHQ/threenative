# Virtual geometry ships on by default

Date: 2026-08-30. Subject: `assets.models.virtual` defaulting to on, the engine taking the cut, and
the threshold that decides which primitives are touched. Follows the
[virtual geometry batch](../PRDs/done/nanite-like/README.md).

**Verdict: on by default, above 65,536 triangles per primitive, with `assets.models.virtual: "none"`
to opt out.** A game that imports a body too dense for the screen now draws only what the camera
resolves without knowing the feature exists, and a game whose models are ordinary props compiles
byte-identically to before.

## The threshold, measured rather than guessed

One body, seven densities, compiled with and without the bake. The cut is taken at three distances,
where `r` is the body's radius — `5r` frames it across about a third of the screen height. Two pixel
budgets: a 1080p desktop drawing buffer, and a Pixel 8's (2400×1080 CSS at the template's
`android.resolutionScale: 0.44`).

| source triangles | file off | file on | growth | desktop draws @2r/5r/15r | Pixel 8 draws @2r/5r/15r |
| --- | --- | --- | --- | --- | --- |
| 2,048 | 0.01 MB | 0.03 MB | 2.80× | 100% / 100% / 100% | 100% / 100% / 100% |
| 8,192 | 0.03 MB | 0.10 MB | 3.22× | 100% / 100% / 100% | 100% / 100% / 53% |
| 32,768 | 0.11 MB | 0.40 MB | 3.63× | 100% / 92% / 42% | 94% / 57% / 23% |
| **65,536** | 0.21 MB | 0.81 MB | 3.85× | 96% / **69%** / 21% | 72% / **27%** / 13% |
| 131,072 | 0.42 MB | 1.21 MB | 2.88× | 85% / 35% / 13% | 44% / 16% / 10% |
| 262,088 | 0.82 MB | 3.51 MB | 4.29× | 51% / 21% / 9% | 25% / 11% / 6% |
| 524,288 | 1.58 MB | 5.32 MB | 3.37× | 28% / 13% / 6% | 15% / 8% / 5% |

Three things this settles:

1. **The payload costs 3–4× whatever the density.** It is not a tuning knob — the DAG stores every
   level and those sum to about twice the source triangles. So the threshold is the whole decision.
2. **Below 32k the cut is the whole mesh on desktop.** Baking there is payload for nothing, which is
   why the opt-in default of 4,096 was wrong for a convention that ships on.
3. **Mobile cuts harder than desktop at every density**, because the cut is measured in device
   pixels and a phone renders fewer of them. Virtual geometry helps a phone *more* — which is also
   where the bytes hurt most, so the same threshold serves both.

**65,536** is where a phone already draws a quarter of the triangles and a desktop a bit over two
thirds. It is also the density at which a mesh needs 32-bit indices, so the line falls where "this
is a big mesh" already meant something.

One file serves every target — `assets.targets` is budget assertions, not per-platform variants — so
this one number has to hold for the worst case, and the worst case is a phone's install size.

## What "on" had to mean before it could ship

Four changes, because a default that a game has to opt into is not a default:

1. **A clustered mesh draws in full until something cuts it.** It used to start invisible and wait
   for its first `update`. Shipping that on would have turned the default into a blank screen for
   any game that renders before the first cut. The worst case is now exactly an ordinary `Mesh`;
   `update` only ever takes detail away.
2. **The engine takes the cut**, once a frame, between the projection reconcile and
   `renderer.render`. Before the render because an empty cut has to skip its draw rather than submit
   a zero-count one; after the reconcile because that is when the scene is final. A scene holding no
   clustered geometry pays one traversal that finds nothing.
3. **`ClusteredBatch` is reachable from that walk.** Its root is a `ClusteredBatchRoot`, so instanced
   dense props — the common case — are cut without the game calling anything. The quarry's own
   `game.ts` now calls nothing at all, which is the proof.
4. **The batch got the hysteresis the mesh already had.** The engine cutting every batch every frame
   is what made this necessary: without it the quarry's `render.p50` went **0.9 ms → 13.45 ms** and
   the frame lost 7 fps. A camera that has not moved more than 1% of its distance to the nearest copy
   keeps its cut.

## The arrival hitch, fixed

PRD-283 measured a **649.6 ms `render.p95`** on the native host: the first frames of a route cut and
uploaded every distance band at once. A default-on feature cannot ship a stall that size to a game
that asked for nothing.

Bands are now built at most four per update. A copy whose own band is not built yet draws with the
nearest built one — a real cut of the same DAG, so watertight — and refines within a few frames.
Tests hold both halves: no update builds more than four, and every copy draws on every frame of the
arrival.

## The quarry, with the engine driving

Browser WebGPU, 1920×1080, nvidia/turing, same session, steady windows only:

| arm | `gpuMs` | `render.p50` | draws | triangles/frame | fps |
| --- | --- | --- | --- | --- | --- |
| `dense` | 6.97 | 0.2 | 10 | 104,472,681 | 59.95 |
| `decimated` | 2.45 | 0.3 | 10 | 19,717,963 | 59.95 |
| **`virtual`, engine-driven** | **1.92** | 0.95 | 94 | 7,543,621 | 59.95 |

Still 3.6× cheaper on the GPU than doing nothing and cheaper than a 5%-requested `simplify` pass,
with nothing in the game's source calling for it. It costs about 0.5 ms more GPU and 400k more
triangles than the hand-driven arm PRD-282 measured (1.28 ms, 7,145,671) — that is the price of
spreading band construction over frames, and it buys the 649 ms hitch going away.

## What is not proven

- **Native was not re-measured** after these four changes. PRD-283's native numbers stand for the
  hand-driven arm; the engine-driven one is browser-only here.
- **Android and iOS remain UNVERIFIED**, as they were throughout the batch. The threshold's mobile
  column is computed from the cut, not from a device run.
- **The 3–4× payload is unreduced.** 16-bit indices would halve it for meshes under 65,536 vertices,
  which is exactly the band just above the threshold.
