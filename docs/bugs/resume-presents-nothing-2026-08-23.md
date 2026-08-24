# Returning to a backgrounded native game leaves a black screen

**Status:** **fixed** — option 1 below landed on 2026-08-23; resume rebuilds and reconfigures the
surface against the window Android hands back, and `display.backgroundMode` is back to `"pause"`
**Severity:** was a blocker for the pause feature — the regression it caused was worse than the
battery drain it fixed, and the interim retreat to `"continue"` (`c3ae3b26`) is now reversed
**Reported:** 2026-08-23, physical Pixel 8 (`192.168.1.192:5555`, shiba, Android 17)
**Layer:** `packages/runtime-native`
**Evidence, reported:** [`../verification/prd-210-2026-08-23.md`](../verification/prd-210-2026-08-23.md)
**Evidence, fixed:** [`../verification/resume-presents-2026-08-23.md`](../verification/resume-presents-2026-08-23.md)
— red and green on the same phone, from one APK, with the pre-fix resume kept behind
`debug.threenative.skip_surface_revalidate=1` so the comparison has one variable. `previousWindow`
and `window` in the `TN_LIFECYCLE_SURFACE` marker differ, which measures the cause below rather than
assuming it.

## What happens

Background a native game (screen off, or switch away) and come back. The loop resumes — and
presents nothing. The player sees a black screen for as long as they keep looking.

Observed twice, on `examples/native-smoke` running the first-proof APK:

```
# before backgrounding — frames and presents move together, 60 Hz
TN_PRESENTS_TICK:{"frames":720,"presents":720,"textureMB":39,...}

# after 12 s off and 12 s back
TN_PRESENTS_TICK:{"frames":10080,"presents":781,"textureMB":39,...}
TN_PRESENTS_TICK:{"frames":10740,"presents":781,"textureMB":39,...}
```

`frames` runs away at roughly 600/s — nothing is pacing it, because presenting is what used to
block — while `presents` is frozen at the value it had when the app was backgrounded. A
`screencap` taken at that moment is uniformly black; one taken before backgrounding shows the
scene.

The `TN_LIFECYCLE` markers say the state machine did its job:

```
TN_LIFECYCLE:{"event":"paused","sdlEvent":259,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_LIFECYCLE:{"event":"paused","sdlEvent":260,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_LIFECYCLE:{"event":"resumed","sdlEvent":261,"mode":"pause","applied":true,"droppedTimerFirings":0}
```

## Cause

PRD-210 specified this and the implementation did not carry it: *"Surface revalidated like startup
does (`runtime.cpp:337-351` precedent)."* The resume path clears the paused flag and nothing else.

Android destroys the `ANativeWindow` when the app goes to the background — `SDL: surfaceDestroyed()`
is in the log — and hands back a **new** one on resume. The `WGPUSurface` built at startup still
points at the destroyed window, so every present after resume goes nowhere. Startup already solves
exactly this problem, by waiting for a valid `ANativeWindow` and validating it with
`ANativeWindow_getWidth` before creating the surface; resume needs the same treatment plus a
surface rebuild and reconfigure, and the new surface has to be published to
`webgpu::bindings`' `g_surface`.

Nothing logs an error on this path: the present silently does nothing rather than failing by name,
which is its own fail-closed violation. **Closed too** — `TN_SURFACE_ACQUIRE_FAILED:{"status":5,...}`
is what the same defect prints now, rate-limited to once a second so 600 failures a second stay
readable.

## Why it is worse than the bug it came from

Bug 9 was a battery complaint: the loop kept drawing with the screen off. The player never saw it.
This makes the game unusable after any interruption — a phone call, a notification tap, a screen
timeout — and it is the default (`display.backgroundMode: "pause"`).

## Two options, in order of preference — option 1 landed

1. **Revalidate the surface on resume.** The real fix, and what the PRD asked for. **Done**: resume
   queues a revalidation in both modes, the loop rebuilds the `WGPUSurface` against the window
   Android hands back, reconfigures it and republishes it to `webgpu::bindings`' `g_surface`,
   ahead of any frame work. A rebuild that fails names itself (`TN_LIFECYCLE_SURFACE_FAILED`) and
   stops the loop instead of running frames that present nothing, and a swapchain that hands out no
   texture now logs `TN_SURFACE_ACQUIRE_FAILED` with wgpu's own status — the fail-closed hole named
   below.
2. ~~**Until then, default `display.backgroundMode` to `"continue"`.**~~ Shipped as `c3ae3b26` and
   reversed by the fix. It bought exactly what it promised — off-screen presenting and wasted
   battery instead of a black screen — and it was incomplete in one way worth remembering: the
   packager's `DEFAULT_ANDROID_CONFIG` still wrote `TN_BACKGROUND_MODE=pause`, so only an APK
   carrying no metadata (the in-repo first proof) actually ran `continue`. Every scaffolded Android
   game kept the black screen. Both defaults are `pause` again and they now agree.

The proof was the rung this bug named: background 12 s, resume, assert `presents` advances with
`frames` and a screencap is not blank. Red: `frames` 43920 → 56340 against `presents` frozen at
1304, capture 0.00% non-black. Green: `frames` == `presents` at 60 Hz and the scene back on screen.

## A second finding from the same run

The debug APK is not 16 KB page-size compatible; Android's compatibility dialog names
`libSDL3.so`, `libmystral-runtime.so`, `libc++_shared.so` and `libv8android.so` as having
unaligned LOAD segments and uncompressed libraries. Unrelated to this bug and not investigated
here, but it is a real Android 15+ compatibility item and nothing in the repository mentions it.

## A third: launching onto a dozing screen hangs startup, or kills it

Still open, and it bit this lane too in a second form: with the phone **locked**, `am start` put the
activity behind the keyguard, Android stopped it 30 ms later, and startup died on
`get_physical_device_surface_capabilities: ERROR_SURFACE_LOST_KHR` rather than hanging. Same root —
a host that starts against a window the system is about to take away — and the same consequence for
an unattended lane: nothing usable comes out. Recorded in
[`../verification/resume-presents-2026-08-23.md`](../verification/resume-presents-2026-08-23.md).


Two rung attempts were void because `am start` on a device whose screen had gone off leaves the
host parked in `Waiting for valid ANativeWindow...` indefinitely — the app is alive, logs its
init lines, and never runs a frame or reaches any timeout. Startup's surface wait has
`maxWaitAttempts`, so the intent was bounded; the observed behaviour was not. Also unrelated to
the pause change — it reproduces the same way on the pre-fix control path — and worth a look,
because it makes any unattended device lane silently produce nothing.
