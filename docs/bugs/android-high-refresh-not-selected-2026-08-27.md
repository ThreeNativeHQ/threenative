# Android games can select 120 Hz; sustained-throughput acceptance is pending — 2026-08-27

**Status:** implementation green — the Pixel 8 selects 120 Hz through supported config; cool
sustained-throughput acceptance remains open
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

The supported green now packages `display.maxFps: 120`, logs an applied Android surface request,
sets the native presentation ceiling to 120, and makes the Pixel report active mode 2 at 120 Hz,
`renderFrameRate=120.00001`, and a 120 Hz frame-rate override for Bayview's UID. This closes display
mode selection. It does not yet close throughput: the first post-fix smoke was USB-powered and at
thermal status 1 (`LIGHT`), so its 31.85 fps hot window is invalid for acceptance.

## Original cause — fixed

The runtime implemented only half of a maximum-frame-rate contract:

1. The presentation cap was hard-coded to 60 and its only override was a private diagnostic global.
2. Project config, native package metadata and `RuntimeConfig` carried no maximum frame rate.
3. The Android host never made a surface frame-rate request or reapplied one after surface changes.

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
One value drives both halves of the contract:

- the host's presentation ceiling on every platform; and
- Android's preferred surface frame rate, reapplied whenever Android creates or replaces the
  `ANativeWindow`.

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
3. **Physical mode selection — done:** the supported Bayview APK records the 120 request and the
   Pixel 8 selects its 120 Hz mode.
4. **Sustained throughput — pending:** cool and unplug the Pixel, collect at least 1,000 real-time
   frames, confirm the mode remains 120 Hz, and cross-check the game meter with SurfaceFlinger.
5. **Cheap-scene ceiling — pending after Bayview:** a cheap scene must exceed 100 presents/s to
   prove the new path is not merely a mode-selection signal.

## Next measurement

Run the already-built Bayview APK on the cool, unplugged Pixel over Wi-Fi ADB. Keep the approved
2400×1080 UI and 0.36 3D scale, collect at least 1,000 steady frames, and capture active display
mode, `TN_FRAME_BUDGET`, `TN_PRESENTS_TICK`, and SurfaceFlinger cadence. More than 60 sustained fps
closes the owner's immediate goal; the cheap-scene >100 presents/s arm then closes this filing.
