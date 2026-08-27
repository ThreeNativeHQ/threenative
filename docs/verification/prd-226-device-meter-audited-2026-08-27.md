# Is the device fps real? — auditing the meter against SurfaceFlinger, 2026-08-27

**Question asked of this lane:** whether the ~20 fps device figure is an artefact of our own
instrumentation, a vsync quantisation cell, or something else that makes the phone look worse than
it is.

**Answer: the number is real, and it is slightly *generous* to us.** An independent OS-level meter
agrees within 2%, and removing the vsync cap would buy roughly 3 fps, not 10.

## The cross-check

`dumpsys SurfaceFlinger --latency` reads the compositor's own present timestamps for the game's
buffer-producing layer — `…SurfaceView[com.threenative.bayview/…](BLAST)#2364`. It knows nothing
about `TN_FRAME_BUDGET` and cannot be influenced by it.

```
refresh period 8.333 ms  => 120.0 Hz
frames 63  intervals 62
present interval  median 50.03 ms  min 41.71  max 66.69
=> presented FPS  median 19.99   mean 19.07
vsync cells (n periods -> count): 5x=1  6x=43  7x=17  8x=1
```

Our own meter, same session, same launch: **20.39 fps median**, `render.p50` 32.93 ms.

| Meter | fps | Source |
| --- | ---: | --- |
| `TN_FRAME_BUDGET` (ours) | **20.39** | in the game loop |
| SurfaceFlinger present timestamps | **19.99** | the OS compositor |

**Agreement within 2%, and ours reads slightly high.** The meter is not nerfing the phone; if
anything it flatters it.

## What the vsync cells rule out

The panel runs at **120 Hz**, not 60. That matters for the quantisation question: FIFO snaps each
frame to a multiple of 8.333 ms, so the cells near 20 fps are 41.7 / 50.0 / 58.3 ms — **8.3 ms
apart, not 16.7**. The distribution is 43 frames at 6 periods, 17 at 7, one at 5.

So the true per-frame work sits just above 41.7 ms and mostly below 50 ms — call it **43–48 ms**.
Uncapping the present would yield roughly **23 fps**, not the 30 a coarse-quantisation story would
have implied. **There is no hidden headroom.** The 20 fps reading is what the frame actually costs.

## The bar, restated

The display's cells are 120/n. To present at **60 fps the whole frame must fit in 16.67 ms**, and
the frame currently costs ~43–48 ms.

**That is a ~3× reduction — roughly 28–33 ms per frame to remove.** Not a lever; a rebuild of where
the frame's time goes. The measured budget ([A0/A2/A5](prd-226-budget-a0-a2-a5-2026-08-27.md)) says
83% of the desktop frame is JavaScript and bridge, which is where a 3× has to come from.

## Two traps recorded so the next lane does not fall in

1. **`dumpsys gfxinfo` is the wrong meter for this app.** It reports the Android View/Skia pipeline
   — `Pipeline=Skia (Vulkan)`, 50th percentile **8 ms**, 359 frames — which is the Activity's view
   hierarchy, not the game. The game renders into its own `SurfaceView` and bypasses Skia entirely.
   Reading 8 ms off gfxinfo and calling it the frame would have been a 5× error in the flattering
   direction.
2. **Desktop and device pixel counts are not comparable.** The device renders at its full native
   **2400×1080 (2.59 Mpix)**; the desktop arms ran **1280×720 (0.92 Mpix)** — 2.8× fewer pixels.
   Absolute ms are therefore not transferable between the lanes. This does not change the
   attribution — the Mali driver is 2.3 ms of the frame, so the cost is not pixel-bound — but it
   forbids stating a desktop millisecond as if it were a device millisecond.

## Method

- Device: physical Pixel 8 `37251FDJH0037Z`, 30.1 °C, battery 98%, USB-powered.
- Same HEAD profiled arm64 APK installed this morning; cold launch, ~75 s capture.
- Layer name obtained from `dumpsys SurfaceFlinger --list`; the `(BLAST)#2364` child is the buffer
  producer — the plain `#2363` SurfaceView row returns only the refresh period and no frame rows,
  which is what "wrong layer" looks like.
- Present intervals are consecutive differences of the second column (actual present time),
  sorted, with the sentinel rows dropped.
