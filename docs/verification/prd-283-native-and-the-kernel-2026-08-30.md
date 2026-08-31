# PRD-283 — the cut moves to the GPU and native runs it

Date: 2026-08-30. Subject: `examples/quarry`'s `virtual` arm on the packed Linux desktop host.
Phase 3 of the [virtual geometry batch](../PRDs/nanite-like/README.md).

**Verdict, in two parts.**

1. **Native runs it.** A packed Linux desktop executable of the quarry's `virtual` arm walks the
   whole route and renders the quarry correctly — cliff, boulders, gantry, grating and floor, no
   holes by eye. A feature that works on web only is unfinished, and this one does not.
2. **The kernel does not ship, and the reason is not the one PRD-283 expected.** AC3 asked whether
   a compute kernel beats the CPU walk. The walk costs 0.7 ms of `render` on browser and about
   1.1 ms on native. **It is not what the native arm loses on.** Native at 720p inverts the browser
   result: `virtual` costs **3.05 ms of GPU time against `decimated`'s 1.64**, and its `render.p95`
   is **649.6 ms** — one frame in the route builds every distance group and uploads tens of
   megabytes of index data at once. A kernel that removed the whole walk would leave both of those
   untouched.

## The native lane — executed

Packed with the host built from `main` at `7a664b02` (2026-08-30 13:44), which is this branch's
runtime-native source: no C++ changed in this batch. `SDL_VIDEODRIVER=x11`, 1280×720, three steady
windows per arm, window 1 discarded.

```sh
pnpm --filter quarry build:desktop
TN_QUARRY_NATIVE_HOST=<host> pnpm --filter quarry pack:native
pnpm --filter quarry measure -- --arm dense      --target desktop
pnpm --filter quarry measure -- --arm decimated  --target desktop
pnpm --filter quarry measure -- --arm virtual    --target desktop
```

| arm | `gpuMs` | `render.p50` | `render.p95` | fps | triangles/frame |
| --- | --- | --- | --- | --- | --- |
| `dense` | 6.36 | 0.72 | 1.09 | 42.09 | 104,472,681 |
| `decimated` | **1.64** | 0.71 | 1.07 | 42.05 | 19,717,963 |
| `virtual` | 3.05 | 1.82 | **649.6** | 39.05 | not recorded — see below |

`virtual`'s row was recovered from the run's `TN_FRAME_BUDGET` markers rather than from
`measurement.json`: the run failed the harness's no-console-errors policy, so `measure.ts` threw
before writing the file, and the draw and triangle counts it reads out of game state were not
captured. The frame-budget numbers above are the run's own.

**Browser at 1080p and native at 720p disagree about the ordering, and both are real.**

| | browser 1080p | native 720p |
| --- | --- | --- |
| `virtual` `gpuMs` | **1.28** | 3.05 |
| `decimated` `gpuMs` | 2.45 | **1.64** |
| `virtual` draws | 89 | 89 |
| `decimated` draws | 10 | 10 |

Two things move together. Fewer pixels at 720p shrink the fragment work the cut is saving, while
the 89 draws the distance grouping costs do not shrink at all — and on the native host every draw
is a record replayed out of the frame-op stream, which is more expensive per draw than the
browser's path. At 1080p the saved vertex and fragment work more than pays for the draws. At 720p it
does not.

## Two native defects this arm exposed

1. **`[WebGPU] Frame op stream replay failed: malformed record header`**, once over the route, in
   the `virtual` arm only — `dense` and `decimated` both run the same route on the same host with
   zero console errors. The check is
   `packages/runtime-native/src/webgpu/bindings_frame_stream.cpp:114`, which fails the frame when a
   record's opcode or length does not survive its own bounds test. The stream is produced by three's
   patched WebGPU backend through the drain hook at `bindings.cpp:2832`; what the `virtual` arm does
   differently is write far more, and far larger, per-frame buffer updates. **Not diagnosed further
   here.** It is a native runtime defect, not a virtual-geometry one, and it belongs in its own
   change rather than inside this batch.
2. **A 649.6 ms `render.p95`.** `ClusteredBatch` creates a distance group's geometry the first time
   a copy lands in it, and the route's opening frames populate every group at once — around 74
   geometries and tens of megabytes of index uploads inside one frame. The steady state is fine
   (0.7–1.8 ms) and the memory holds at about 46 MB over 79 index buffers, but the arrival is a
   hitch a walking camera would feel. Spreading group creation over frames is the obvious fix and
   was not done.

## Acceptance criteria

- [x] **AC4 — native runs it.** Above: a packed Linux desktop executable of the `virtual` arm walks
      the route and renders it. Android and iOS are **UNVERIFIED** and no device run was attempted.
- [x] **AC3 — the kernel beats the walk, or it is not kept.** It is not kept. The walk is 0.7 ms on
      browser and about 1.1 ms on native, and the native arm's problem is 89 draws and a 649 ms
      arrival hitch, neither of which a selection kernel touches. PRD-283 §3 pre-authorised this
      negative result; the number that produced it is the table above.
- [ ] **AC1 — parity with the oracle.** Moot: there is no kernel to grade.
- [ ] **AC2 — red-green, the cone test.** Moot for the same reason. The normal cones are baked and
      carried in the payload (`clusterCones`) and nothing reads them yet.
- [ ] **AC5 — one cold-agent build.** **Not done.** The `virtual` arm has not been built from packed
      tarballs in a sandbox outside this repository.
- [ ] **AC6 — warmup is honest.** Moot: no kernel to warm.
- [ ] **AC7 — read-back does not starve the frame.** Moot: no read-back.

## What this changes for the batch

The next problem is **not** where PRD-283 assumed. It is submission shape and arrival cost:

- 89 draws is the price of one cut per distance group. A single draw for the whole batch needs
  multi-draw indirect, which PRD-279 recorded as not portably available and this session's adapter
  confirms is a Chromium experiment with no native counterpart.
- The arrival hitch is a scheduling problem in `ClusteredBatch`, not a selection problem.

Both are cheaper to fix than a compute kernel, and both would move the native number that a kernel
would not.
