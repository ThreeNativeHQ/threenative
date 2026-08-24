# Returning to a backgrounded native game leaves a black screen

**Status:** open — introduced by PRD-210's pause, observed on a physical Pixel 8
**Severity:** blocker for the pause feature — the regression it causes is worse than the battery
drain it fixes, and the change is already on `main` (`5989e4a2`)
**Reported:** 2026-08-23, physical Pixel 8 (`192.168.1.192:5555`, shiba, Android 17)
**Layer:** `packages/runtime-native`
**Evidence:** [`../verification/prd-210-2026-08-23.md`](../verification/prd-210-2026-08-23.md)

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
which is its own fail-closed violation.

## Why it is worse than the bug it came from

Bug 9 was a battery complaint: the loop kept drawing with the screen off. The player never saw it.
This makes the game unusable after any interruption — a phone call, a notification tap, a screen
timeout — and it is the default (`display.backgroundMode: "pause"`).

## Two options, in order of preference

1. **Revalidate the surface on resume.** The real fix, and what the PRD asked for.
2. **Until then, default `display.backgroundMode` to `"continue"`.** One line. It restores exactly
   the pre-PRD-210 behaviour — off-screen presenting, wasted battery — while keeping the lifecycle
   markers flowing, and it removes the black screen. A soft battery cost is preferable to a hard
   "the game is gone" for every player who backgrounds the app.

Whichever lands, the proof is the same rung: background 12 s, resume, assert `presents` advances
with `frames` and a screencap is not blank.

## A second finding from the same run

The debug APK is not 16 KB page-size compatible; Android's compatibility dialog names
`libSDL3.so`, `libmystral-runtime.so`, `libc++_shared.so` and `libv8android.so` as having
unaligned LOAD segments and uncompressed libraries. Unrelated to this bug and not investigated
here, but it is a real Android 15+ compatibility item and nothing in the repository mentions it.

## A third: launching onto a dozing screen hangs startup

Two rung attempts were void because `am start` on a device whose screen had gone off leaves the
host parked in `Waiting for valid ANativeWindow...` indefinitely — the app is alive, logs its
init lines, and never runs a frame or reaches any timeout. Startup's surface wait has
`maxWaitAttempts`, so the intent was bounded; the observed behaviour was not. Also unrelated to
the pause change — it reproduces the same way on the pre-fix control path — and worth a look,
because it makes any unattended device lane silently produce nothing.
