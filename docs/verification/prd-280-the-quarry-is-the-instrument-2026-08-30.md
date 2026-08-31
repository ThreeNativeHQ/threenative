# PRD-280 — the quarry is the instrument

Date: 2026-08-30. Subject: `examples/quarry` at `f7183c1f`, plus the instrument fixes that follow it.

**Verdict: OPEN the batch.** The `dense` arm costs **13.9 ms more GPU time per frame than
`decimated`** on browser WebGPU at 1080p, against a 2.0 ms threshold, and the same ordering
reproduces on the packed Linux desktop native host. The frame is bound on vertex and raster work,
not on submission — ten draw calls and half a millisecond of CPU — which is the case continuous
cluster LOD exists for.

**The threshold was met on a different meter than PRD-280 §4 named, and that is the one honest
caveat in this file.** §4 said `render.p50`. `render.p50` is the frame budget's *CPU render phase*:
the time the game spends issuing the frame. This scene issues ten draws and spends 0.5–0.6 ms doing
it **in both arms**, so that meter reads a difference of 0.0 ms between a 104-million-triangle frame
and a 20-million-triangle one. The number is not wrong; it is measuring submission, and this scene
is not bound on submission. `gpuMs` — a GPU timestamp query, resolved every frame by
`packages/core/src/game.ts` and reported in `TN_FRAME_BUDGET` — is the meter that reads what the
arms differ by. **The 2.0 ms value is unchanged; only the meter it is read on is corrected**, and
§4's own clause about naming *where the time went* is what forced the correction.

## What was measured

`examples/quarry`, generated from a seed, walked along one deterministic route:

| Body | Triangles | Notes |
| --- | --- | --- |
| Cliff face | 1,999,200 | the hero, approached to 0.40 m at the last frame |
| Six boulder sources | 151,380 – 397,620 | instanced 396 times |
| Quarry floor | 524,288 | the control surface; never simplified, one file, both arms |
| Gantry + grating | 314 | thin opaque, and alpha-cut |
| **Source total** | **3,919,410** | |

Per frame, the `dense` arm submits **104,472,681 triangles in 10 draw calls**; `decimated` submits
**19,717,963**. The pipeline's `simplify` was asked for 5% and its error tolerance stopped it at
**11.0%** — reported, not assumed, exactly as `packages/assets/src/report.ts` already does.

## Browser WebGPU, 1920×1080 — executed

Adapter: **nvidia / turing** (`artifacts/quarry/*/capture.json`), not a software rasteriser.

```sh
pnpm --filter quarry bake
pnpm --filter quarry dev --host 127.0.0.1 --port 5191 --strictPort
pnpm --filter @threenative/playtest build
pnpm --filter quarry measure -- --arm dense      --url http://127.0.0.1:5191
pnpm --filter quarry measure -- --arm decimated  --url http://127.0.0.1:5191
```

Three runs per arm, each a full 1,830-frame route, 13 steady frame-budget windows per run:

| Arm | `gpuMs` run 1 / 2 / 3 | median | `render.p50` | draw calls | triangles | fps |
| --- | --- | --- | --- | --- | --- | --- |
| `dense` | 22.99 / 23.94 / 21.00 | **22.99** | 0.5–0.6 ms | 10 | 104,472,681 | 11.0–11.7 |
| `decimated` | 7.10 / 10.09 / 9.71 | **9.71** | 0.5–0.6 ms | 10 | 19,717,963 | 11.7–13.2 |

- **Median difference: 13.28 ms. Paired per-run differences: 15.89, 13.85, 11.29 ms — median 13.85.**
- **Worst case across every pairing** (slowest `decimated` against fastest `dense`):
  21.00 − 10.09 = **10.91 ms**, still 5.5× the threshold.
- `render.p50` difference: **0.0 ms**. Below the threshold, on a meter that reads submission.

**`fps` and `presented` are not evidence on this lane.** Both arms sit at a presented p50 of
66–83 ms with a `hostGap` p50 of 77–89 ms — a floor the browser's presentation imposes under the
runner's private Xvfb, which swamps a 13 ms difference and even inverts it between runs. This is the
same throttle the desktop lane already has recorded against it in `runtime-perf-state`'s ledger; it
is an environment verdict, not a measurement of the game.

## Packed Linux desktop native, 1280×720 — executed

```sh
pnpm native:build
pnpm --filter quarry build:desktop && pnpm --filter quarry pack:native
pnpm --filter quarry measure -- --arm dense      --target desktop
pnpm --filter quarry measure -- --arm decimated  --target desktop
```

The arms are two self-contained executables built by `mystral compile`, each carrying its own
`.glb` payload, driven by `--target desktop` through the runner's local mailbox. Three steady
windows per run; 1280×720, which is the host's window default and is stated rather than corrected
for.

| Arm | `gpuMs` | `render.p50` | draw calls | triangles | fps |
| --- | --- | --- | --- | --- | --- |
| `dense` | **6.42** | 1.00 ms | 10 | 104,472,681 | 39.1 |
| `decimated` | **1.84** | 1.04 ms | 10 | 19,717,963 | 42.0 |

**Difference: 4.58 ms at 720p — 3.5× the arm it is compared against, and the same ordering as the
browser lane.** No attempt is made to scale it to 1080p; the number is what ran.

Android and iOS: **UNVERIFIED.** No device run was executed for this PRD.

## Where the time went

Both arms draw **ten times per frame** and spend **0.5–1.0 ms of CPU** issuing those draws. The
render projection declines to engage at all (`TN_RENDER_PROJECTION: belowMeshFloor`, 9 meshes
against a 200-mesh floor), so nothing is being spent on batching either. The 13 ms sits in vertex
and raster work on 104 million triangles at 4× MSAA.

That answers PRD-280 §4's second question in the direction that keeps the batch open: **the dense
arm is not bound at submission.** Had it been, the honest next PRD would have been about submission
— a different and much cheaper project — and this batch would have declined here.

## The quality difference the later phases are scored against

`decimated` is cheaper because it looks worse, so the batch's claim is *this detail, cheaper*, and
`dense`'s route frames are the reference every later arm is held to. Measured with
`pnpm --filter quarry compare`:

| Route frame | changed pixels | RMSE | max channel delta |
| --- | --- | --- | --- |
| rim | 20.61% | 5.77 | 93 |
| switchback | 22.96% | 6.13 | 96 |
| floor | 8.37% | 2.76 | 70 |
| approach | 44.42% | 11.66 | 99 |
| contact | 75.85% | 14.72 | 88 |
| nose | 80.86% | 9.40 | 69 |
| **mean** | **42.18%** | | |

**PRD-282's AC6 is now a number: `virtual` must beat `decimated` on `gpuMs` and come in under
42.18% mean changed pixels against `dense`. Both, or the phase fails.**

## Acceptance criteria

- [x] **AC1 — the geometry is the same everywhere.** `scripts/__tests__/quarry-instrument.spec.ts`
      holds all ten bodies' `positionHash` against committed constants.
- [x] **AC2 — red-green, the seed.** `CLIFF_SEED` 90271 → 90272:

      × should generate the same triangles on every machine 4472ms
      AssertionError: expected { cliff: 'd2ba7d9d', …(9) } to deeply equal { 'boulder-0': '5c75d9b8', …(9) }
      -   "cliff": "1eb7ccb8",
      +   "cliff": "d2ba7d9d",
      Tests  1 failed | 8 skipped (9)

- [x] **AC3 — the route is a function of the frame index.** The spec asserts five named poses to
      within 0.005 m and that two calls at the same frame are equal; the playtest asserts the same
      poses from the running build through `markX`/`markY`/`markZ`, and both lanes reached every
      mark in order.
- [x] **AC4 — both arms run on both targets.** Four results above: browser WebGPU with its adapter
      named, and packed Linux desktop native. Android `UNVERIFIED`.
- [x] **AC5 — the control surface does not move between arms.** The floor-only pose renders
      **0 changed pixels, 0 maximum channel delta, RMSE 0** between `dense` and `decimated`. It is
      the same `quarry-floor.glb` in both, and the boulder placements carry a twelve-metre keep-out
      around the pit centre so the frame holds nothing else.
- [x] **AC6 — the reference frames exist.** Six frames per arm under `artifacts/quarry/dense/`.
- [x] **AC7 — nothing binary is committed.** `public/assets/` is ignored and the spec asserts no
      `.glb`, `.gltf`, `.bin`, `.ktx2` or image file under `examples/quarry` is tracked.
- [x] **AC8 — a person can walk it.** `?mode=free`, documented in `examples/quarry/README.md` with
      the controls stated.
- [x] **AC9 — the gate is evaluated in writing.** Above: **open**, on `gpuMs`, with the meter
      correction stated and the literal `render.p50` reading recorded beside it.

## What the instrument's own walk found, and what it cost

Three defects, all caught by looking at the frames rather than at the numbers, and each of them
would have produced a confident wrong result:

1. **The hero face was wound backwards** and had been back-face culled through a complete
   measurement. The arms still differed, so the number looked plausible; two million triangles were
   being transformed and thrown away.
2. **The alpha cut was applied to the gantry's beams as well as its grating**, so the two hazards
   PRD-280 §1 asks for — thin opaque, and masked — were one hazard.
3. **Every body was smooth at the triangle scale.** The finest feature on a face whose quads are
   4.4 cm across was metres wide, which meant `decimated` looked identical to `dense` and the
   image-difference half of every later phase's gate would have passed for free. The grain octaves
   added to fix it moved the achieved simplify ratio from 7.1% to 11.0% — the simplifier's error
   tolerance now has something to refuse.

One engine bug was found and fixed on the way, in `packages/assets/src/passes/model.ts`: the model
pass registered the Meshopt decoder without awaiting its WebAssembly instantiation, so the first
model of a fresh process failed its own self-verify with `TN_ASSETS_MODEL_UNREADABLE` on a
well-formed file. Every bake script ever written loses that race. Red-green in
`packages/assets/__tests__/model-pass-decoder-race.spec.ts`, which runs out of process because the
race only exists in the first milliseconds after the codec is imported.

## One correction to PRD-279 §3

PRD-279's table says multi-draw indirect *"does not exist on this stack"*. This machine's adapter
reports `chromium-experimental-multi-draw-indirect` among its WebGPU features. It is a Chromium
experiment, not a WebGPU feature, and it has no counterpart on the owned native runtime, so **the
design decision it supports is unchanged**: the batch must produce one indirect draw per material
batch and win by not submitting geometry rather than by submitting it cheaply. The row is corrected
to say *not portably available*, which is what it always meant.
