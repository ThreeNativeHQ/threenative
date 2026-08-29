# The native frame is CPU-bound, and the pixel budget cannot reach it — 2026-08-28

**Status:** open, measured, unowned. PRD-228 closed the pixel budget and proved this is not it.
**Updated 2026-08-28:** `frameReplay` decomposed; lever 1 confirmed as the only route to its
number, lever 2b filed and killed with evidence.
**Severity:** high — it is the whole remaining gap between a real game and its target on the
decided 60 Hz baseline, and no amount of resolution scaling touches it
**Reported:** 2026-08-28, physical Pixel 8 (`shiba`), Bayview, five-arm ladder + decomposition
**Layer:** `packages/core` (the JS render phase and the projection) and
`packages/runtime-native` (the host's packed-frame replay). Not a game bug.

## The measurement

PRD-228's five-rung resolution ladder
([`runtime-perf-state.md` §1.3.5](../verification/runtime-perf-state.md)) fits:

```text
presented p50 = 9.94 ms/Mpx x pixels + 13.79 ms     R2 0.992, n=5, monotonic
```

The pixel term is real and the engine now owns it: `resolutionScale: "auto"` ships on, holds the
budget by itself, and a scaffolded template reaches 60 fps at full 2400x1080 (§1.3.8). **The 13.79
ms intercept is what is left, and it is 83 % of a 16.67 ms budget.**

The decomposition —
[`prd-228-fixed-frame-cost-2026-08-28.md`](../verification/prd-228-fixed-frame-cost-2026-08-28.md)
— fits every phase and host-gap segment against megapixels across the same five arms:

| term | meter | slope ms/Mpx | **intercept ms** | R² | share of 13.79 |
| --- | --- | ---: | ---: | ---: | ---: |
| `render` (JS phase) | `TN_FRAME_BUDGET` | 3.603 | **8.501** | 0.970 | 61.6 % |
| `frameReplay` (host) | `TN_HOST_GAP` | 0.713 | **4.026** | 0.819 | 29.2 % |
| `update`, per substep | derived | 0.116 | **1.878** | 0.233 | 13.6 % |
| `present` (GPU/display wait) | `TN_HOST_GAP` | 4.346 | **−1.798** | 0.965 | **−13.0 %** |

Read directly at the smallest rung rather than extrapolated, which is the part that matters:

```text
b032, 0.266 Mpx, presented p50 16.73 ms
  render 9.28   frameReplay 3.88   update 2.30   present 0.29   other host 0.11
  GPU-blocking share of the frame: 1.7 %
```

**At one tenth of the panel's pixels the frame still costs 16.73 ms and 0.29 ms of it is the host
waiting on the GPU.** Bayview is bound by the CPU cost of *issuing* draws, not by drawing them.

`present` is confirmed as a GPU-tail wait and therefore confirmed *out* of the intercept: it reads
9.74 → 4.03 → 0.44 → 0.36 → 0.29 ms down the ladder, the signature of `max(0, GPU − CPU)` switching
on somewhere between 0.78 and 1.34 Mpx. This also retires the memory-recorded "8 ms replay + 14 ms
GPU-tail wait" decomposition as a *high-resolution* reading rather than a general one.

## Why this is filed rather than fixed

PRD-228 says in its own scope section: *"It does not chase CPU. The device frame is CPU-clean at
9.3 ms p50 of a 16.7 ms budget. PRD-227 owns that ledger and it is closed."* That statement was
true of the arm it was measured on and is **not** true across the resolution ladder — which is
exactly what the ladder was built to find out. PRD-227 is closed, PRD-228 is closed, and nothing
owns this.

## What is left, ranked

### 1. Take the host replay off the JS critical path — predicted **−3.9 ms/frame**

The loop is strictly serial: JS rAF (`update` + `render`) → `endDawnFrame` (`frameDrain`,
`frameReplay`, `present`, `devicePoll`). `frameReplay` is host C++ replaying the packed stream
*after* JS finished producing it, and it overlaps nothing.

```text
predicted  = frameReplay intercept                        = 4.026 ms
cross-check, measured at b032 without extrapolation       = 3.88  ms
conservative (50 % overlap only)                          = 1.94  ms
```

Valid only while the GPU is not the limiter, which is the regime the acceptance bar lives in
(`present` 0.29–0.44 ms at scales 0.32–0.55). At full resolution it would be absorbed by `present`
and buy nothing — an arm must say which regime it ran in.

**2026-08-28, what is inside the 4.026 ms** —
[`replay-decomposition-2026-08-28.md`](../verification/replay-decomposition-2026-08-28.md), desktop
wgpu/Vulkan, 802 draw candidates, so shape and not device magnitude. `endRenderPass` and
`wgpuQueueSubmit` are **85 % of replay across four calls each**; the 1,472 per-draw calls between
them are 0.316 ms of 1.166. There is no host-bookkeeping term to delete — parser, registries and
the per-frame maps are inside the remaining 15 % — so **the cost can be moved and not removed,
which is what this lever proposes.** The lever stands on evidence now rather than on inference.

Both dominant terms carry a per-pass floor and a per-draw slope, `replay ≈ passes × ~120 µs +
draws × ~0.7 µs`. **A pass costs what ~170 draws cost**, which is a term §2's arithmetic does not
have and which makes Bayview's dynamic shadow map a first-class target.

An overlap arm has to solve two things this decomposition also surfaced, neither of them
scheduling. `replayPackedFrameOpStream` reads eight registries and mutates the upload staging and
the surface state, all of them written by JS binding calls on the main thread, and it reports
failure by calling `throwException` into V8 — replaying frame N beside frame N+1's JavaScript
races every one of them, and throwing into V8 off the JS thread is not allowed at all. A swapchain
image also cannot be acquired for N+1 before N presents, so the overlap cannot be "replay N while
JS runs N+1" without moving surface acquisition first.

### 2. Raise projection coverage past the `renderOrder` lane — predicted **−2.3 to −7.1 ms/frame**

The projection collapses 287 of 835 renderables into 15 batches and walks 548. The largest
exclusion is `renderOrder: 336` (`packages/core/src/projection-plan.ts:159`).

```text
measured ratio on what it already takes: 287 -> 15 batches = 19.1 : 1
if the 336 project at that ratio: candidates 563 -> 245 (-318)
fixed CPU per walked candidate: (8.501 + 4.026) / 563 = 22.2 us ceiling
                                 4.026 / 563          =  7.15 us floor
predicted = 318 x 22.2us = 7.06 ms ceiling; 318 x 7.15us = 2.27 ms floor
```

**Pre-registered falsifier:** `resultDrawCandidates` counts the scene the renderer walks, not the
draws it issues, and §1.3.1 records those 336 as *"mostly the decal pool's hidden slots"*. If they
are hidden, three.js already skips them. **If `resultDrawCandidates` falls by ≥300 and device
`render` p50 at scale 0.32 falls by <2 ms, the lever is dead.** Run lever 1 first — its basis has
no such ambiguity.

### 2b. Coalesce the frame's queue submissions — **dead, measured 2026-08-28**

A frame submits once per `renderer.render()`: world, shadow, overlay. Those 4 submits collapse into
2 runs that no queue-visible operation separates, in 2,855 of 2,865 frames, and a two-point fit
priced `wgpuQueueSubmit` at a fixed ~85 µs per call — predicted −0.17 ms/frame.

Implemented behind a red-then-green replay contract and measured on interleaved pairs: **the call
count halved exactly as designed, the per-call cost doubled (94 → 188 µs), and the total did not
move.** `wgpuQueueSubmit` is proportional to the command buffers handed to it; the apparent fixed
term is per-pass baking. Reverted. The fit that produced it is the warning: a floor read off two
points is not a fixed cost until something changes the call count and the total follows.

### 3. Split the flat town pass — now has an instrument, still unanswered

§1.3.2 attributes the flat town pass at 9–11 ms for ~232–315 draws by *ablation*, which gives a
total per object and never a cost per pass stage. `timestamp-query` now works on both engine builds
and `TN_FRAME_BUDGET` carries real `gpuMs` per window, so the pass split is finally measurable.
**Note the shape of the answer has changed:** with GPU wait at 1.7 % of the frame at low
resolution, the interesting question is no longer "binning or fragment" but "why does issuing these
draws cost 8.5 ms of CPU".

## Adjacent, smaller, also unowned

- **The tail.** 13 of 2,009 frames spiked, worst 74.72 ms, largest peak in `outside-game`
  (§1.3.3). PRD-228 excluded it deliberately so a throughput pass could not hide a hitch
  regression. Nothing owns it.
- **No valid `0.55` sampling pair.** §1.3.9's re-measured MSAA table has clean pairs at 0.32 and
  0.44 only; `0.55/1×` was refused for too few live windows. The `+7.47 ms` once recorded at that
  rung stays withdrawn and unreplaced.
- **Web device density.** Web deliberately renders at DPR 1 (`renderer.ts`: *"the default is
  intentional DPR 1"*). Native now reports the truth and compensates in the buffer arithmetic, so
  unifying web onto real device density is a live option for the first time — it is a 4× fill
  increase on a retina browser, needs its own `pnpm visuals` gate, and is an owner decision.
  `createRenderer`'s `pixelRatio` is where it would be made.
- **`pnpm visuals` is red** on `TN_VISUAL_SCORE_FLOOR: action-rpg scored 3; floor is 4` — a judged
  template-appearance score, unrelated to any of the above and unowned.

## Method notes that bind any arm here

- Method rule 9's live-window test (`update.mean ≥ 3 ms`) is **dead** — PRD-227 cut update to
  0.46 ms and it now rejects every live window. Use the §1.3.5 classifier and print the
  `update.mean` series so the classification is auditable.
- On a vsync-capped target `presented` measures the **panel** and `frame` measures the **game**.
  Any bar or trigger written against `presented` is measuring the display; that mistake was made
  twice today, once in a shipped controller and once in this repository's own acceptance bar.
- **A desktop pair cannot resolve 0.2 ms at 2 runs per arm.** The 2026-08-28 coalescing arm read
  a 0.185 ms `workNs` median improvement whose own candidate runs spanned 0.8 ms. Run more runs per
  arm than the difference being claimed, and print the per-run series, not just the median.
- Late-session drift is real and unattributed: `c055aa` read +35.6 % against its twin with
  `frameReplay` up 4.98 → 7.38 ms at 42 % battery. Scramble rung order and re-run endpoints.
