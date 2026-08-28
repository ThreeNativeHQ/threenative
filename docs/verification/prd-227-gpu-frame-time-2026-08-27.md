# PRD-227 — 1080p GPU frame time selects Road B — 2026-08-27

Task 1 from
[HANDOVER-60fps-road-2026-08-27](HANDOVER-60fps-road-2026-08-27.md) is complete. A diagnostic-only
post-present device drain measured the full-resolution GPU frame on a physical Pixel 8. Both
present modes put it above 60 ms. The pre-registered fork is therefore **Road B: GPU work**. No
optimization is part of this change, and no row from the decomposition report's §4a graveyard was
rebuilt.

## 1. Diagnostic instrument

Commit `6502502c` adds `gpuDrain` to `TN_HOST_GAP`. In `endDawnFrame()`, after
`presentPendingSurface()` and `paceToPresentationCap()`, a build with
`TN_WEBGPU_GPU_DRAIN_PROFILE=ON` times:

```cpp
wgpuDevicePoll(state->device, true, nullptr);
```

The blocking poll is wgpu-native-only, compile-time gated, and **OFF by default**. The Android
diagnostic build enabled it with `-PthreenativeGpuDrainProfile=true`; the packaged arm64 library was
verified with `strings` for `gpuDrain` and `TN_HOST_GAP` before installation. The default-off gate
is the shipping safeguard: a normal build never executes the blocking wait measured here.

The source contract test was red before the implementation (2 failed assertions: no build flag and
no blocking-poll phase), then green:

```text
✓ packages/runtime-native/__tests__/host-gap-gpu-drain.spec.ts (2 tests)
Test Files  1 passed (1)
Tests       2 passed (2)
```

### Deliberate 5 ms control

At 1080p FIFO, a temporary `sleep_for(5ms)` immediately beside the blocking poll moved only the
new segment by the injected scale. It was removed before the recorded arms and is absent from
`6502502c`.

| Segment p50 (ms) | +5 ms control | Removed/final | Delta, final − control |
| --- | ---: | ---: | ---: |
| `gpuDrain` | 54.755 | 48.995 | **−5.760** |
| `frameReplay` | 9.520 | 10.430 | +0.910 |
| `present` | 0.312 | 0.371 | +0.059 |
| `timers` | 0.741 | 0.526 | −0.215 |
| `handles` | 0.380 | 0.247 | −0.133 |

Every remaining unlisted segment moved by at most 0.022 ms. The control's valid cold-launch marker
and the two compared meter lines were:

```text
LaunchState: COLD
+5ms:    gpuDrain.p50=54.755 frameReplay.p50=9.520 present.p50=0.312
removed: gpuDrain.p50=48.995 frameReplay.p50=10.430 present.p50=0.371
```

### Where the segment lands

The handover expected the diagnostic wait to add to period without entering `hostGap`. The runtime
measurement falsifies that accounting detail: FrameBudget closes inside the rAF callback, so work
after that callback is charged to the **following** callback's residual `hostGap`. `gpuDrain`
therefore adds to both callback period and next-frame `hostGap`.

The meter still cross-checks because `gpuDrain` is included exactly once:

| Arm | Σ `TN_HOST_GAP` segment p50s | FrameBudget `hostGap.p50` | Delta |
| --- | ---: | ---: | ---: |
| FIFO | 60.651 ms | 61.28 ms | −0.629 ms |
| mailbox | 60.524 ms | 61.08 ms | −0.556 ms |

## 2. Device pair

Both recorded arms ran in one session on physical Pixel 8 `shiba`, Android build 17, wgpu-native
over Vulkan on the hardware **Mali-G715** adapter. The surface was 2400×1080 landscape (the
device's 1080×2400 physical mode), with the same Bayview scene, camera, UI, assets, and workload.
The first two whole launches of the session were discarded. Each recorded arm used
`am force-stop`, verified an empty `pidof`, and reported `LaunchState: COLD`.

Preflight before the pair was 51% battery, discharging over Wi-Fi adb, 32.9 °C battery, 33.1 °C
skin, thermal status 0. Both arms ended at thermal status 0. Bayview was checked as
`mCurrentFocus` at the start and end of each window, and the notification shade was collapsed.
Both screenshots are nonblank gameplay and were visually inspected:
[FIFO](../../artifacts/gpu-drain/fifo-valid.png),
[mailbox](../../artifacts/gpu-drain/mailbox-valid.png).

Each meter window contains 300 frames and more than 30 seconds of wall-clock presentation. The
blocking diagnostic intentionally halves the already-slow frame rate; its FPS is not a production
performance claim.

| 1080p arm | period p50 | update p50 | JS render p50 | `gpuDrain` p50 | overlap estimate | GPU-frame estimate | FrameBudget FPS | SurfaceFlinger FPS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FIFO | 97.559 ms | 14.41 ms | 20.36 ms | **48.995 ms** | 13.794 ms | **62.789 ms** | 10.13 | 9.855 |
| mailbox | 98.135 ms | 13.49 ms | 20.62 ms | **48.792 ms** | 15.233 ms | **64.025 ms** | 10.13 | 9.861 |

The calculation follows the handover's pre-registered model:

```text
overlap ≈ period − update − JS render − gpuDrain
GPU frame ≈ gpuDrain + overlap

FIFO:    overlap = 97.559 − 14.41 − 20.36 − 48.995 = 13.794 ms
         GPU     = 48.995 + 13.794 = 62.789 ms
mailbox: overlap = 98.135 − 13.49 − 20.62 − 48.792 = 15.233 ms
         GPU     = 48.792 + 15.233 = 64.025 ms
```

Percentile algebra makes these estimates rather than timestamp-correlated GPU spans, but the fork
has more than 30 ms of margin: both estimates are about 63–64 ms, and `gpuDrain` alone is about
49 ms in both modes. Present mode changes neither conclusion.

## 3. Fork taken and next change pre-registered

The 1080p GPU frame is **≥30 ms**, so the handover's decision table selects **Road B — GPU work**.
A present-seam change cannot recover the roughly 46–47 ms needed for a 16.7 ms GPU budget. Road A
is not the next experiment.

Before any implementation, the next change is pre-registered as a **game-owned Bayview A/B
experiment**, not a framework change:

- Keep the diagnostic APK, 1080p mailbox mode, camera, scene, and device protocol fixed.
- Control: today's 224 frustum-culling-disabled decal materials, approximately 54% of draw calls.
- Treatment: disable only those 224 decal draws in Bayview game source; do not edit `packages/`.
- Prediction: removing 54% of draws reduces the approximately 63 ms GPU frame by **15 ms or more**;
  `gpuDrain.p50` should fall from about 49 ms to at most 34 ms. A result below 2 ms is refused as a
  lever under the PRD-226 binding rule.
- Decision: if the game-owned cut is material, price the separate render-scale feature decision;
  if it is not, profile GPU passes before proposing another lever. Do not sneak in render scale.

That experiment has not been written or run. Task 1 ends at this fork.
