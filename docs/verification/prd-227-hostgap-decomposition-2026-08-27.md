# PRD-227 — hostGap decomposed; the 30 fps question now has a shape — 2026-08-27

Executes [HANDOVER-hostgap-2026-08-27](HANDOVER-hostgap-2026-08-27.md) task 1 (the instrument) and
goes past it: the first device runs that name what owns the frame. Two findings change the
problem: **the ~25 ms of hostGap is two named things — ~8 ms of real replay work and ~14 ms of a
GPU-coupled wait** — and **one arm combination the five historical arms never tried (mailbox +
720p) reaches 34.4 fps**, cross-confirmed by SurfaceFlinger, the first movement of the number since
the hunt began.

Full ledger of everything tried for this bug is §4; the model that now fits every measurement is
§6; the direction is §7.

## 1. The instrument (landed: `73e0baec`)

`TN_HOST_GAP` — one line per 300-frame window beside `TN_FRAME_BUDGET`, emitted by the host loop
(`packages/runtime-native/src/runtime.cpp`), with `endDawnFrame`'s interior timed in
`bindings.cpp`/`bindings_state.h`. Wall clock, ~a dozen `steady_clock` reads per frame; frames
whose rAF-to-rAF period exceeds FrameBudget's 2 s hitch threshold are dropped whole. Segments:
`events, io, audio, timers, microtasks, preFrame, frameDrain, frameReplay, present, devicePoll,
endFrameOther, handles, screenshot`.

**Red-green (desktop, Bayview bundle, Xvfb lane):** a deliberate 5 ms sleep inside the timers
segment moved `timers.p50` **0.001 → 5.060 ms** while every other segment held
(present 33.72 → 34.41, replay 1.98 → 2.06, poll 0.92 → 0.92); removed, timers returned to
0.001 ms.

**Cross-checks the meter must pass, and does:**

| Check | Desktop (Xvfb) | Device (1080p FIFO) |
| --- | ---: | ---: |
| Σ segment p50s vs `hostGap.p50` | 36.66 vs 36.71 | 23.02 vs 20.73–24.24 (arm-dependent) |
| `periodP50` vs `presented.p50` | 45.49 vs 45.4 | 48.75 vs 47.61 |

## 2. Device runs (Pixel 8 `shiba`, Wi-Fi adb, discharging 77 %, 26.0 °C, Bayview `com.threenative.bayview`)

Every arm a fresh cold launch (`am force-stop` → verified `pidof` empty → `am start -W` → 300-frame
window read from logcat). Engine at `73e0baec`+instrument; game at sandbox `d421330`.

| Arm | period p50 | frameReplay | present | devicePoll | Σ hostGap | fps | render.p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1080p FIFO (control) | 48.75 | 7.95 | 14.57 | 0.28 | 23.02 | 20.9 | 25.93 |
| 1080p mailbox | 48.42 | 8.03 | 14.20 | 0.25 | 22.68 | 20.55 | 16.61 |
| **720p mailbox** | **32.57** | **8.19** | **0.91** | 0.08 | **9.33** | **34.39** | 15.33 |
| 1080p mailbox latency=3 | 49.40 | 8.40 | 14.69 | 0.25 | 23.52 | ~19.5–20.5 | — |
| 1080p mailbox latency=1 | 49.85 | 8.48 | 14.72 | 0.25 | 23.5 | — | — |

(All values p50 ms from `TN_HOST_GAP`; fps from the matching `TN_FRAME_BUDGET` window.)

- **720p mailbox, independent cross-check:** `dumpsys SurfaceFlinger --timestats` on the same
  window reads **averageFPS = 34.217** against our 34.39. The number is real.
- **present mode genuinely changed in the mailbox arms** — the host logged
  `Present mode: mailbox (vsync=false)` in the same logcat as the measurements.
- **frame latency actually reached the compiler:** the sandbox CLI delegates android builds to the
  engine's `package-android.mjs:695`, which appends `THREENATIVE_GRADLE_ARGS` to `gradlew`, and
  `android/app/build.gradle.kts` chains `-PthreenativeFrameLatency` into
  `-DTN_WEBGPU_DESIRED_FRAME_LATENCY`. Latency 0/1/3 all rebuilt and measured — flat, so the knob
  is now falsified under **mailbox** as well (F10 falsified it under FIFO).
- Protocol catch worth keeping: the first latency=3 launch printed `Activity not started, intent
  has been delivered to currently running top-most instance` — an `am start` race. That arm was
  re-run from a verified-dead process before anything was concluded.
- Device restored after the runs: `debug.threenative.present_uncapped=0`, `wm size` 1080×2400.

## 3. What the runs say

1. **The handover's §2 suspicion is confirmed and quantified.** Change 1 moved the WebGPU command
   stream out of the JS callback into `endDawnFrame`'s C++ replay — and the replay costs
   **~8.0 ms of real CPU work per frame on device**, which lands in `hostGap`, not `frame`. The
   "work fell 40 %, fps didn't move" mystery of the cadence-lock session is this: part of the work
   left the instrument rather than the frame.
2. **The rest of hostGap is `present`, and it is not a vblank wait.** `wgpuSurfacePresent` blocks
   ~14.2–14.7 ms at 1080p under FIFO *and* under mailbox, and *regardless of* frame latency
   1/2/3. At 720p it collapses to **0.91 ms**. A wait that ignores present mode and image depth
   but scales with pixel count is a **wait on the GPU's remaining work** — the GPU tail left when
   the CPU finishes encoding — not a compositor cap.
3. **The phases redistribute around a pinned period.** FIFO→mailbox at 1080p moved ~9 ms from
   `render.p50` (25.93 → 16.61: the acquire inside the JS callback blocked less) into `present`
   and `hostGap`, total unchanged. This is the same redistribution the cadence-lock session saw
   between resolutions — it is what a serialized CPU/GPU pipeline does, and it is why single-meter
   arms kept reading "flat".
4. **Nothing else is real.** events/io/audio/timers/microtasks/handles/screenshot sum to < 1 ms.
   The libuv pump, the V8 microtask pump, timers, the file polls — all noise, at least in this
   game's steady state. §5's "prime suspect" list below microtasks is dead.

## 4. Everything tried for the 30 fps bug — the full ledger

Every row measured, not assumed. §4a moved no fps; §4b landed real wins that did not move fps;
§4c moved something.

### 4a. The lever graveyard (fps flat or worse)

| # | Lever | Measured | Record |
| --- | --- | --- | --- |
| 1 | F12 batched pass op stream (−1,900 crossings/frame) | +5 % (18.61 → 19.60) | prd-222 loop log F12 |
| 2 | F14 / PRD-224 per-class binding tables | 0.02 ms/frame | prd-224 pricing record |
| 3 | Lever A render-pass wrapper pooling | flat, removed | prd-222 loop log |
| 4 | Lever C projection/upload tuning | −0.31 ms, inside spread | prd-222 loop log |
| 5 | F10 swapchain frame latency 3 (FIFO) | flat | prd-222 F10 |
| 5b | Frame latency 1/3 under **mailbox** (this session) | flat, instrument-verified | §2 |
| 6 | A1 Dawn ↔ wgpu-native backend swap (**desktop only**) | flat 11.85 vs 11.51 | prd-226 A1 |
| 7 | A2 backend removed entirely (desktop) | only 1.95 ms of 11.21 | prd-226 A2 |
| 8 | Resolution 720×1600 under **FIFO** | flat 19.89 | cadence-lock finding 2 |
| 9 | GC / V8 heap tuning | 0.2 % of wall clock | cadence-lock finding 4 |
| 10 | FIFO → mailbox at 1080p | flat 19.77 | cadence-lock addendum |
| 11 | Composited web UI off (`ui.renderer: "native"`) | flat 20.67 | cadence-lock addendum 2 |
| 12 | PRD-227 P2 fixed-shape wrappers (+ borrowed values, specialized ids, bounded uploads) | **worse** than baseline (IC shares 15.58/13.03/11.84 % vs 10.42 baseline, gate 3 %) | prd-227-p2 |
| 13 | Change 1 packed frame stream, taken alone | work −40 %, fps flat (20.39 → 20.02) | prd-227-p1 + cadence-lock |
| 14 | Swapchain backend knob, `desiredMaximumFrameLatency` infrastructure | kept, never an fps lever | 47e4cc7e |
| 15 | Optimising three.js renderer internals inside the host | refused on ownership rule | HANDOVER-hostgap §5 |
| 16 | Cutting Bayview draw counts (Phase 4) | reverted; game code is experiment-only | HANDOVER-hostgap §5 |

Also closed by evidence: the node-system megamorphic IC population is a load-time compile burst,
not per-frame churn (perf bug hunt §Corrected record); the `clock_gettime` hotspot was the
profiling instrument itself; `FrameBudget.endFrame` allocates nothing on the heap (V8 scalar
replacement, pinned by spec); the ~20 fps figure is real (SurfaceFlinger agrees within 2 %).

### 4b. Landed real wins (correct and kept; no device fps movement)

- **Change 1 packed stream** (PRD-227 P1): desktop `bridgeNs` 9.31 → 0.81 ms; on device it moved
  the same work out of the JS meter (and this session found where it went — §3.1).
- **Upload staging** (PRD-222): desktop +12 % on the write-heavy rung; device pair +21 %
  (18.95 vs 15.70 fps, matched-warm — development-grade evidence, Tier-1 rerun still owed).
- Physics collision events from Rapier's own transitions (107.7 µs → 6.4 µs step at 128 bodies);
  picking exclusion parent-walk skip; two dead per-frame sweeps in the projection; canvas 2D
  dirty-tracking; bridge micro-fixes (`caa78a11`, desktop-only win).

### 4c. What has ever moved the device number

| Change | fps | Note |
| --- | ---: | --- |
| Upload staging ON vs OFF (matched-warm pair, 2026-08-26) | 18.95 vs 15.70 | real, dev-grade |
| **Mailbox + 720p (this session)** | **34.39** (SF: 34.2) vs ~20 | first >30 fps on the device, zero code change |

## 5. Dead as prime suspects after §3

The handover's shortlist: swapchain acquire/fence is **half-right** — a fence-family wait exists,
but it lives in `present` and tracks GPU work, not vblank; host loop pacing (`substeps.p50 = 3`)
is a symptom (three 16.7 ms substeps ≈ one 50 ms period); microtasks/message-loop pumping, event
pumping, audio, timers, files, UI drain, handles, screenshot — all measured ≈ 0 on device.

## 6. The model that now fits every measurement

```
loop period ≈ CPU-side work  +  GPU tail serialized at present
            ≈ (27 ms JS + 8 ms replay + ~1 ms misc)  +  (14 ms @1080p / ~1 ms @720p)
   1080p:   36 + 14 ≈ 50 ms  →  20 fps     (CPU and GPU serialize)
   720p:    36 + 1  ≈ 33 ms(ish) →  34 fps (CPU-bound; GPU no longer the binder)
```

- It explains the five flat arms: each flipped one variable, and every combination except
  mailbox+720p left one of the two binders in place.
- It explains why the backend swap was flat on desktop (the desktop lane's `present` is 33.7 ms of
  Xvfb FIFO throttle — hostGap there is throttled present, and desktop render.p50 never saw it).
- It explains Chrome's 59.99 fps on this phone: a pipeline that lets GPU work overlap the next
  frame's CPU work instead of draining its tail at present.
- It makes a testable GPU-frame-time prediction: at 1080p the GPU frame is roughly
  CPU-encode-overlap + 14 ms; **no GPU-side timing has ever been taken** (cadence-lock §Not run) —
  it is the one number the model still needs.

## 7. Direction, ranked

1. **Measure GPU frame time at 1080p** — the unmeasured half. Cheapest honest route: extend the
   meter with a post-present drain segment (`wgpuDevicePoll(device, true, …)` wall time after
   present, or a frame-fence timestamp). This single number decides between the two roads:
   - GPU frame ≳ 30 ms → the GPU owns the frame at full resolution; the road is GPU work
     (Bayview's 224 frustum-culling-disabled decal materials ≈ 54 % of draws is the parked,
     game-owned candidate) or a shippable render-scale.
   - GPU frame ≈ 16–24 ms → the present-path serialization is the whole defect; the road is the
     seam: why wgpu-native's present drains the GPU tail (patch/upgrade wgpu-native, or take
     **Dawn on Android** for a ride — A1 only ever ran on desktop, so the device backend swap is
     *untried*, not refuted).
2. **Profile the 8 ms replay on device** (`simpleperf` around `replayPackedFrameOpStream` — the
   segment is now isolated by `framePhaseReplayNs`). Desktop pays 3.2 ms for the same stream;
   the device's 8 ms is real CPU on the SDL thread either way.
3. **The 27 ms JS render is back on the table with clean attribution** — it is now provably *not*
   hiding a present/acquire wait (mailbox arm: render.p50 16.6 with hostGap accounted). Chrome
   runs the same three.js in 16.7 ms total. This is the old PRD-227 story with its excuse removed.
4. **Bank the 30 fps milestone now**: mailbox + reduced render resolution reached 34.4 fps with
   zero code. A game-facing render-scale knob (render <1×, present upscaled) ships that win
   without `wm size`. That is a feature decision — file it, don't sneak it.

## 8. Not run, named

- 720p **FIFO** with the instrument (historical uninstrumented arm exists: 19.89 fps).
- Dawn on Android (the device backend swap — §7.1's second road).
- Any GPU-side timing (§7.1's first road).
- Chrome on-device attribution (its 59.99 fps still has no breakdown).
- Three-capture Phase 3 acceptance for any arm above — all runs are single captures,
  diagnostic-grade, consistent with the handover's task-1 scope.
- Cross-engine QuickJS/JSC lanes (PRD-227's open criterion).
