# Android games have no supported way to select a 120 Hz display mode — 2026-08-27

**Status:** open — named Android host defect, separate from Bayview's current ~20 fps workload
issue
**Severity:** medium — it does not explain a game that misses 60 fps, but it prevents a cheap game
from reaching 90/120 Hz through any supported ThreeNative contract
**Reported:** 2026-08-27, physical Pixel 8 (`shiba`), Bayview
**Layer:** `packages/runtime-native`, with the public configuration and discoverability seam in
`packages/create-threenative`

## What happens

The Pixel 8 is allowed to run its display at 120 Hz, but Bayview leaves the display at 60 Hz:

```text
settings peak_refresh_rate = 120
settings min_refresh_rate  = 0
activeMode={..., vsyncRate=60.00 Hz, ...}
```

`dumpsys display` reports both 60 and 120 Hz modes. The active mode remains 60 Hz while Bayview is
foregrounded. The full same-device cadence record is
[`runtime-perf-state.md`](../verification/runtime-perf-state.md): its
SurfaceFlinger evidence shows Bayview presenting at about 20 fps on three 60 Hz intervals.

This is **not the cause of that 20 fps result**. Bayview currently takes about 50 ms wall time per
present even with mailbox presentation, so selecting 120 Hz cannot turn it into a 120 fps game.
The refresh-selection defect remains independently reproducible with a cheap scene whose work fits
inside an 8.33 ms interval.

## Cause

The runtime implements only half of a maximum-frame-rate contract:

1. `packages/runtime-native/src/webgpu/bindings.cpp:128` initializes
   `g_presentationCapHz = 60`, and `paceToPresentationCap()` sleeps after a successful present.
2. The only override is the private host global `__tnPresentationCap`; it is installed in the same
   file at lines 6561–6564. There is no `@threenative/core` wrapper despite the handler's comment
   claiming one, and there is no capability-manifest entry. A game cannot discover or use the
   override through supported framework vocabulary.
3. The Android host never calls `Surface.setFrameRate`, `ANativeWindow_setFrameRate`,
   `preferredDisplayModeId`, or Swappy. Setting the private software cap to 120 or 0 therefore
   removes a host sleep but does not tell Android to select a high-refresh display mode.

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

## Expected public contract

The 60 Hz default is intentional, not the bug. It is a conservative industry default for battery,
thermal stability, and games authored around a 16.67 ms budget. High refresh should be an explicit,
portable choice:

```ts
import type { IThreeNativeConfig } from "@threenative/core";

export default {
  display: { maxFps: 120 },
} satisfies IThreeNativeConfig;
```

`display.maxFps` should default to `60`; `0` should retain the existing meaning of uncapped. The
name is camelCase and borrows Godot's `max_fps` vocabulary rather than inventing a second concept.
One value must drive both halves of the contract:

- the host's presentation ceiling on every platform; and
- Android's preferred surface frame rate, reapplied whenever Android creates or replaces the
  `ANativeWindow`.

There is no universal industry rule that 120 Hz must be the default. A 60 fps default is a common,
conservative baseline for battery, thermal stability, and a 16.67 ms authored frame budget; modern
high-refresh games expose an explicit preference. On Android versions or devices that cannot honor
the display request, the software ceiling still applies and the game must continue correctly.
`maxFps: 120` is a preference and maximum, not a promise that the device, power policy, workload,
or compositor will deliver 120 fps.

## Likely acceptance

1. **Red contract tests:** `display.maxFps` is rejected or ignored today, and no supported symbol
   reaches `g_presentationCapHz` or the Android surface. Preserve that failure before the fix.
2. **One public path:** config schema, generated native config, runtime pacing, docs, and
   `capabilities.json` expose `display.maxFps` with `60` default and `0` uncapped. Remove or correct
   the false core-wrapper comment; do not publish `__tnPresentationCap` as the user API.
3. **Android host proof:** on API 30+ call `ANativeWindow_setFrameRate` or the equivalent Java
   `Surface.setFrameRate` after surface creation and again after resume/surface replacement. A
   failure or platform refusal is reported honestly rather than silently claimed as 120 Hz.
4. **Physical Pixel 8 red/green:** with the phone cool and its peak setting at 120, run the same
   cheap native scene twice. `maxFps: 60` keeps the active mode and presents at no more than 60;
   `maxFps: 120` records a 120 request, selects the 120 Hz active mode when Android honors it, and
   sustains more than 100 presents/s. Record `dumpsys display`, SurfaceFlinger cadence, and
   `TN_PRESENTS_TICK` for both arms.
5. **Keep workload acceptance separate:** Bayview's 60 fps performance gate remains unchanged and
   cannot be closed by a successful mode switch. This filing closes when supported configuration
   can request and prove high refresh, even if Bayview still renders below 60 fps.

## Next reproduction

Add a temporary internal call equivalent to `display.maxFps: 120`, use a static cheap scene, then
capture the active mode before and after launch. The red is `capHz:120` with the display still at
60 Hz; the green is a recorded 120 Hz surface request plus the Pixel 8 active at 120 Hz and more
than 100 presents/s.
