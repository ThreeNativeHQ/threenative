# Android games select 120 Hz and sustain above 60 fps — 2026-08-27

**Status:** Bayview acceptance green — the Pixel 8 selects physical 120 Hz and sustains
63.45–72.52 fps through supported config; a separate cheap-scene >100 ceiling arm remains pending
**Severity:** medium — it does not explain a game that misses 60 fps, but it prevents a cheap game
from reaching 90/120 Hz through any supported ThreeNative contract
**Reported:** 2026-08-27, physical Pixel 8 (`shiba`), Bayview
**Layer:** `packages/runtime-native`, with the public configuration and discoverability seam in
`packages/create-threenative`

## Original red and current green

The original Pixel 8 red allowed 120 Hz but left Bayview at 60 Hz:

```text
settings peak_refresh_rate = 120
settings min_refresh_rate  = 0
activeMode={..., vsyncRate=60.00 Hz, ...}
```

`dumpsys display` reports both 60 and 120 Hz modes. The active mode remains 60 Hz while Bayview is
foregrounded. The full same-device cadence record is
[`runtime-perf-state.md`](../verification/runtime-perf-state.md): its
SurfaceFlinger evidence shows Bayview presenting at about 20 fps on three 60 Hz intervals.

The first claimed green was a misread: the 120 Hz value was the app override, not the physical
active SurfaceFlinger mode. A valid cool run showed why: Battery Saver contributed
`PRIORITY_LOW_POWER_MODE_RENDER_RATE max=60`, so the app voted 120 while the display stayed at 60.
With Battery Saver off, the supported request genuinely selects physical active mode 1 at 120 Hz.

A second red then remained: FIFO presentation forced an 11–12 ms Bayview frame that missed one
8.33 ms interval down to the 60 Hz divisor. The supported green now packages
`display.maxFps: 120`, selects mailbox for a high-refresh opt-in, and leaves the 1–60 fps default
range on FIFO. The accepted Wi-Fi run holds 63.45–72.52 fps for 11 steady windows / 3,300 frames,
with zero hitches and thermal status 0 before and after.

## Causes — fixed

The runtime implemented only half of a maximum-frame-rate contract:

1. The presentation cap was hard-coded to 60 and its only override was a private diagnostic global.
2. Project config, native package metadata and `RuntimeConfig` carried no maximum frame rate.
3. The Android host never made a surface frame-rate request or reapplied one after surface changes.
4. Android Battery Saver could cap the physical display at 60 Hz even while the app override read
   120 Hz.
5. FIFO presentation quantized a missed 120 Hz interval to its 60 Hz divisor.

Android treats refresh selection as a surface negotiation, not as a consequence of presenting
quickly. Its official [frame-rate guidance](https://developer.android.com/media/optimize/performance/frame-rate)
says an app should call `setFrameRate()` with the rate it prefers; the platform considers that
request with other policy and may decline it. The API is available directly on
[`Surface`](https://developer.android.com/reference/android/view/Surface#setFrameRate(float,%20int))
and on the native window through
[`ANativeWindow_setFrameRate`](https://developer.android.com/ndk/reference/group/a-native-window#anativewindow_setframerate).
For engines that need broader Vulkan pacing machinery, Android's official
[Frame Pacing library (Swappy)](https://developer.android.com/games/sdk/frame-pacing) handles
multiple refresh rates and presentation timing. Swappy is an option, not required evidence that
the smaller surface API is insufficient here.

## Implemented public contract

The 60 Hz default is intentional, not the bug. It is a conservative industry default for battery,
thermal stability, and games authored around a 16.67 ms budget. High refresh should be an explicit,
portable choice:

```ts
import type { IThreeNativeConfig } from "@threenative/core";

export default {
  display: { maxFps: 120 },
} satisfies IThreeNativeConfig;
```

`display.maxFps` defaults to `60`; `0` retains the existing meaning of uncapped. The
name is camelCase and borrows Godot's `max_fps` vocabulary rather than inventing a second concept.
One value drives all parts of the contract:

- the host's presentation ceiling on every platform; and
- Android's preferred surface frame rate, reapplied whenever Android creates or replaces the
  `ANativeWindow`; and
- Android's presentation policy: FIFO through 60 fps, mailbox/immediate above 60 or uncapped.

There is no universal industry rule that 120 Hz must be the default. A 60 fps default is a common,
conservative baseline for battery, thermal stability, and a 16.67 ms authored frame budget; modern
high-refresh games expose an explicit preference. On Android versions or devices that cannot honor
the display request, the software ceiling still applies and the game must continue correctly.
`maxFps: 120` is a preference and maximum, not a promise that the device, power policy, workload,
or compositor will deliver 120 fps.

## Acceptance state

1. **Contract red-green — done:** validation, 60 default, 0 uncapped, 120 configured, native
   packaging and runtime pacing are pinned by tests. The private `__tnPresentationCap` remains only
   a diagnostic seam; all generated configs show the supported field.
2. **Android lifecycle — done:** API 30+ uses `Surface.setFrameRate` after creation, resume and
   replacement; structured logs report applied, unsupported, invalid-surface and exception cases.
3. **Physical mode selection — done:** with Battery Saver off, the supported Bayview APK records
   the 120 request and the Pixel 8 selects its physical 120 Hz mode.
4. **Above-60 presentation — done:** mailbox is selected and the first 600 steady frames measure
   66.84 and 63.01 fps; SurfaceFlinger records real 8 ms intervals.
5. **Sustained throughput — done:** 11 steady windows / 3,300 frames all pass 60 fps at
   63.45–72.52. SurfaceFlinger independently reports 70.358 fps over 3,634 frames at physical
   120 Hz, with zero dropped frames. The device stays at thermal status 0.
6. **Cheap-scene ceiling — pending after Bayview:** a cheap scene must exceed 100 presents/s to
   prove the new path is not merely a mode-selection signal.

## Accepted physical evidence

APK `a519e4043de40c532c29e53a9d0175952959160d36dd41d1de041d669084e0c4` kept the approved
2400×1080 UI and 0.36 3D scale. The run started at 60%, discharging, 33.4 °C battery, 33.7 °C skin
and thermal status 0; Battery Saver was disabled after unplug and verified with `low_power=0`.
`threenative-playtest perf --require-windows 4 --min-fps 60` exits 0 / `PASS` on the 11 steady
windows. The post-run device remained at status 0, 34.0 °C battery and 38.7 °C skin.

The remaining cheap-scene arm is not part of the owner's Bayview 60+ goal. It should use the same
physical-mode, Battery Saver and SurfaceFlinger checks and exceed 100 presents/s before this broader
host-ceiling filing is archived.
