# PRD-227 — the frame is cadence-locked, not work-bound — 2026-08-27

**Result: the 60 fps problem is not a CPU-work problem.** Three measurements on the physical Pixel 8
and one on desktop, all taken this session. Two standing levers are refuted, one standing premise is
wrong, and the fps limiter is relocated to presentation cadence.

## Lane

| Field | Value |
| --- | --- |
| Device | Pixel 8 `shiba`, Wi-Fi adb `192.168.1.192:5555` |
| App | Bayview, `com.threenative.bayview`, installed `2026-08-27 18:08:27` |
| Build | engine at `19e96811` (Change 1 landed), game at `7e4f912` (appearance restored) |
| Battery / temp | 75% → 74%, 36.5 °C → 35.7 °C, **discharging** (owner waived the prerequisite) |
| Meter | `TN_FRAME_BUDGET`, 300-frame window, cross-checked against SurfaceFlinger `--timestats` |

The APK was built by the previous session at 18:08 and installed, but never measured — this record
supplies the measurement that PRD-227's Phase 3 was waiting on.

## Finding 1 — Change 1 halved the work and bought no frames

| | before (PRD-226 audit) | after Change 1 |
| --- | ---: | ---: |
| device fps | 20.39 | **20.02** |
| per-frame work | 43–48 ms | **25.27 ms** (`frame.p50`) |

**The work fell by roughly 40% and the frame rate did not move.** Every earlier lever that
"measured flat" measured flat for the same reason: work is not what sets the frame rate here.

## Finding 2 — the frame is pinned to a constant cadence regardless of workload

Same build, same session, resolution changed with `wm size` — a 2.25× reduction in rendered pixels
(1080×2400 → 720×1600, 2.59 → 1.15 Mpix):

| Arm | fps | frame.p50 | render.p50 | hostGap.p50 | presented.p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1080×2400 | **20.02** | 25.27 ms | 16.81 ms | 25.25 ms | 49.36 ms |
| 720×1600 | **19.89** | 33.56 ms | 24.76 ms | 14.18 ms | — |

**fps did not move.** The phases merely redistributed: `hostGap` fell 25.25 → 14.18 ms while
`render` *rose* 16.81 → 24.76 ms, and the wall-clock total stayed at ~48–50 ms in both arms. A
render phase that gets **slower** when it is given **less** to do is a blocking wait, not work.

SurfaceFlinger on the game's own `(BLAST)` layer agrees, and quantises hard:

```
present2present:  33ms=52   50ms=592   66ms=39     averageFPS = 19.974
```

**592 of ~685 intervals are exactly 50 ms.**

## Finding 3 — the panel is 60 Hz, and every prior document assumed 120 Hz

```
activeMode={id=0, hwcId=36, resolution=1080x2400, vsyncRate=60.00 Hz, ...}
```

`dumpsys display` reports both `fps=120.00001` and `fps=60.0` as *supported* modes; the **active**
mode is 60 Hz. The app never requests a higher one (no `Surface.setFrameRate` and no
`preferredDisplayModeId` in the Android host).

This invalidates the arithmetic in
[prd-226-device-meter-audited](prd-226-device-meter-audited-2026-08-27.md), which read a period of
8.333 ms, concluded "at 120 Hz the cells near 20 fps are 8.3 ms apart, not 16.7", and from that
concluded "uncapping the present buys ~23 fps, not 30". **At 60 Hz the cells are 16.67 ms apart**:

| periods | interval | fps |
| ---: | ---: | ---: |
| 1 | 16.67 ms | 60 |
| 2 | 33.33 ms | 30 |
| 3 | **50.00 ms** | **20 ← we are here** |

We sit exactly on the 3-period cell while doing 25.27 ms of work — work that **fits inside two
periods with 8 ms to spare**. Landing the cell we have already earned is worth 30 fps, immediately,
with no further work reduction.

## Finding 4 — GC is not the owner either

Refuted before it cost a device run. Desktop, `TN_V8_FLAGS=--trace-gc`, 600 frames, steady state
after 4 s:

```
285 GC events; 202 after the 4 s cutoff
median gap 319 ms | median cost 0.54 ms
total 339 ms of GC over a 179,497 ms window  =>  0.2% of wall clock
```

The 4–6 ms scavenges visible in the log are **load-time only**. V8's heap is never configured —
`ResourceConstraints` appears nowhere in the runtime and `Isolate::CreateParams` sets only
`array_buffer_allocator` — but on this evidence that costs nothing in steady state, so heap tuning
is **not** a performance lever. Recorded so nobody spends a night on it.

## What this refutes, and what it costs to have believed it

| Standing claim | Source | Status now |
| --- | --- | --- |
| "fill rate / resolution already refuted" | prd-222-2026-08-25 §Phase 0 decision, asserted with no citation | **confirmed by measurement** — the claim was right, and now it has evidence |
| "no hidden headroom from vsync quantisation" | prd-226-device-meter-audited | **wrong** — computed on a 120 Hz period the display was not running |
| "the seam owns 22.3 ms of the frame" | PATH-TO-60FPS | **not disproven, but not load-bearing** — the seam was cut and fps did not move |

## The next lever, and why it is this one

**The loop presents once every three vsyncs while doing two vsyncs of work.** Two candidate owners,
both in the host, both cheap to separate:

1. **Present mode / swapchain depth.** `--no-vsync` (immediate/mailbox) exists on the desktop CLI
   and has **no Android channel at all** — `grep -rniE vsync src/platform/ android/app/src/main/java/`
   returns nothing. An uncapped device run is the one-line experiment that says whether the cap is
   the pacing or the pipeline. Add it as a `debug.threenative.*` system property, matching the
   pattern already used by `crash_handlers.cpp` and `lifecycle.cpp`.
2. **The composited web UI layer.** Bayview runs its HUD through the web-view UI layer
   (`config.json` → `"ui": { "renderer": "web" }`, landed in `3152feb`). SurfaceFlinger's timestats
   show **several layers** in this app with independent frame rates (19.974, 8.024, 15.909, 62.500),
   and the budget's own `overlay` phase reads a flat 0 — it does not measure an Android-composited
   WebView. A second layer that SurfaceFlinger must compose is a standard cause of exactly this
   cadence lock.

Run 1 first; it is a property read and a rebuild. If the uncapped arm still reads ~20 fps, the
limiter is downstream of our present call and 2 becomes the prime suspect.

**Also worth one line of Android code regardless:** the host never asks for the 120 Hz mode the
panel supports.

## Commands, verbatim

```sh
ADB=~/Android/Sdk/platform-tools/adb
$ADB shell dumpsys SurfaceFlinger --timestats -clear -enable
$ADB shell am start -n com.threenative.bayview/com.threenative.runtime.MystralActivity
$ADB logcat -d | grep -o 'TN_FRAME_BUDGET.*' | tail -1
$ADB shell dumpsys SurfaceFlinger --timestats -dump
$ADB shell wm size 720x1600      # ... repeat ... then:
$ADB shell wm size reset

# desktop GC screen
cd <bayview>/.threenative/build
TN_V8_FLAGS="--trace-gc" SDL_VIDEODRIVER=x11 \
  sh scripts/xvfb.sh build/tn-linux/mystral run game.js --frames 600
```

## Not run, and named as not run

- No uncapped-present device arm — there is no channel to request one.
- No three-capture Phase 3 acceptance; these are single captures, diagnostic, not acceptance.
- No GPU-side timing on device. Every profile to date is CPU-side `simpleperf` on `SDLThread`.
- No Chrome-on-device attribution. Chrome's 59.99 fps remains a top-line number with no breakdown,
  and its CSS viewport is still unrecorded (a limitation prd-222-2026-08-25 names about itself).
