# PRD-130 — the conformance row under V8: attempted, not obtained — 2026-08-17

PRD-130 closed on 2026-08-16 with six phases executed and one gap named in its own text:

> **`conformance/run-conformance.mjs` was not run under V8.** Phase 5 proved the first-proof gate
> and multitouch. A conformance row that was not run is not a passing row.

This is the record of trying to close that gap on the physical Pixel 8 (`37251FDJH0037Z`), and of
why it is **still open**. No conformance result under V8 is claimed here. Two defects in the
Android parity lane were found and fixed on the way, and they are the substance of this file.

## What ran

| Step | Result |
| --- | --- |
| `pnpm native:build` | **failed** — the Android SDK ships CMake 3.22.1 and `CMakePresets.json` is version 6, which needs ≥3.25. Installed CMake 4.4.2; the desktop runtime then built clean, 382/382 |
| `node scripts/download-deps.mjs --android` | needed and not implied by `native:build`, which fetches the desktop set only. `sdl3-android`, `wgpu-android`, `quiche-android`, `v8-android` all OK |
| `run-conformance.mjs --target web` | **67/67 pass** — this is the browser reference set the device lane compares against |
| `run-conformance.mjs --target android-hardware` | run four times; **no usable comparison obtained**. See below |

The four device attempts: 67 blocked on missing Android deps; 66 blocked on a relative
`--reference` path resolved against the wrong cwd; 1 pass / 50 fail / 16 blocked; and finally
0 pass / 67 fail. **Every failing row reported `pixelMismatchRatio: 1.000`** — every pixel
different, on every scene.

## Defect 1 — the lane left a physical device mutated, and the restore was told the wrong target

The lane pins the display to `1280x720` so device captures match the browser reference, and each
row restores it afterwards. The restore target was computed like this:

```js
displayRestore = /^Override size:\s*(\d+x\d+)$/mu.exec(originalSize)?.[1] || "reset";
```

Each row read the override currently in force and promised to put *that* back. **So once any run
left `1280x720` behind, every later row read it as the operator's own setting and restored it
faithfully.** Self-perpetuating: 67 rows, 67 restores that reported success, no error anywhere in
the report — and the operator's phone stayed letterboxed into 1280x720 on a 1080x2400 panel, which
is how the defect was found. It was noticed by the person holding the phone, not by the gate.

Three changes, each closing a path the others do not:

1. `androidDisplayRestoreTarget()` — an observed override **equal to the lane's own capture size**
   is this lane's leak, not the operator's setting, and resets. An override at any other size is
   preserved. This is what breaks the perpetuation loop.
2. `armAndroidDisplayGuard()` — process-level `exit`, `SIGINT` and `SIGTERM` handlers that reset
   size and density. A per-row `try/finally` cannot survive a signal or a crash, and this lane
   mutates global state on hardware somebody is holding.
3. A **read-back** after the restore: re-read `wm size`, and fail the row with
   `TN_ANDROID_DISPLAY_LEAKED` if an override survives. Exit status is what the command claims;
   the read-back is what the device is.

**Verified:** a full 67-row run afterwards left the phone reporting `Physical size: 1080x2400` with
no size or density override.

One existing test asserted the buggy line verbatim — `assert.match(source, /displayRestore = \/\^Override size:/u)` —
so the defect was pinned in place by its own suite. Replaced with a test of the leak case itself.

## Defect 2 — the lane photographed the wrong surface and blamed the pixels

The 1.000 mismatch survived the display fix, so it was never the override. Reading one capture
answered it immediately: **the frame is the phone's home screen, behind Android's *"…app which is
currently being tested"* prompt**, with a notification shade above it. That dialog is raised by
installing a debug APK with `adb install -t`.

The lane did check for system dialogs, before and after capture:

```js
/(?:Application Not Responding|Application Error):\s*[^\r\n}]+/u
```

**Two strings. Every other system window is invisible to it.** `dumpsys window` reported
`mCurrentFocus=Window{f453d09 u0 android}` — a system window owning focus — while `mFocusedApp`
was still the game, so the lane saw a live app, captured the display, compared a photograph of the
launcher against a rendered reference, and produced 67 rows of `pixelMismatchRatio: 1.000`.

Enumerating dialog titles cannot work; the next one has a title nobody listed. `androidForegroundBlocker()`
asserts the **positive** condition instead: the focused window must belong to `com.threenative.game`.
Anything else fails closed naming what had focus (`TN_ANDROID_FOREGROUND_WINDOW`), and a dump with
no `mCurrentFocus` line at all is `TN_ANDROID_FOCUS_UNKNOWN` rather than a pass.

**A red row that names the wrong cause is worse than a blocked row.** These 67 read as a
catastrophic rendering regression under V8; the app was never on screen.

## Why the row is still open

The test-app dialog is still up on the device and needs one physical tap to dismiss. Until then no
capture on that phone shows the app, and with the new guard the lane will refuse to capture rather
than produce another 67 misattributed reds — which is the correct behaviour and also means the
conformance row cannot be obtained in this session.

**PRD-130 stays out of `done/`.** Its own text is the standard being applied: a conformance row
that was not run is not a passing row.

## What this does not claim

No conformance result under V8, on any platform. No mobile-readiness — one Android phone is not
mobile. The web arm's 67/67 is a browser result and says nothing about the device. The two lane
fixes are unit-tested (39/39 in `tests/conformance-runner.test.mjs`) and the display fix is
verified on hardware; **the foreground guard has not yet refused a real run**, because the run it
would refuse has not been attempted since it landed.
