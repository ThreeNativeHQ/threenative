# Resume presents again on Android, and `display.backgroundMode` goes back to `"pause"`

**Date:** 2026-08-23
**Branch:** `worktree-agent-a89d041585ddb56d7`
**Bug closed:** [`../bugs/resume-presents-nothing-2026-08-23.md`](../bugs/resume-presents-nothing-2026-08-23.md)
**Predecessor record:** [`prd-210-2026-08-23.md`](prd-210-2026-08-23.md) (rung 4, the failure this fixes)

**What this record claims:** the **physical Pixel 8** (`192.168.1.192:5555`, product `shiba`, Android
17, Wi-Fi ADB, discharging throughout), plus one **Android emulator** run that is labelled as the
emulator everywhere it appears and is corroboration, never a device result. iOS is not claimed.
Desktop is claimed only for what the desktop lane executed.

The rung the bug asked for — *background 12 s, resume, assert `presents` advances with `frames` and
a `screencap` is not blank* — ran red and green on the phone, from **one APK**, with **one
variable**.

---

## What landed

| Piece | Change | Files |
| --- | --- | --- |
| Lifecycle | Resume queues a surface revalidation, in **both** modes, instead of only clearing the paused flag | `include/mystral/platform/lifecycle.h`, `src/platform/lifecycle.cpp` |
| WebGPU context | `rebuildSurface()` swaps the `WGPUSurface` against the new native window and keeps the adapter, device and queue | `include/mystral/webgpu/context.h`, `src/webgpu/context.cpp` |
| Bindings | `detachSurfaceForRebuild()` / `republishSurface()`, because every present reads `g_surface` from here | `src/webgpu/bindings.cpp` |
| Loop | Rebuild + reconfigure + republish ahead of any frame work, and a named, loud stop when it cannot | `src/runtime.cpp` |
| Fail closed | `TN_SURFACE_ACQUIRE_FAILED` names a swapchain that hands out no texture; `TN_LIFECYCLE_SURFACE_FAILED` names a rebuild that failed | `src/webgpu/bindings.cpp`, `src/runtime.cpp` |
| Default | `display.backgroundMode` back to `"pause"`, on both sides of the JNI boundary | `src/platform/lifecycle.cpp`, `MystralActivity.java` |
| Control | `debug.threenative.skip_surface_revalidate=1` reinstates the pre-fix resume, in the same binary | `src/platform/lifecycle.cpp`, `src/runtime.cpp` |

The cause was what the bug named: Android destroys the `ANativeWindow` behind a backgrounded app
and hands back a **new** one. The green rung below prints both pointers and they differ, so this is
observed rather than assumed.

Startup already solved the same problem — wait for a valid `ANativeWindow`, check it with
`ANativeWindow_getWidth`, create the surface, configure it — and resume now runs that sequence.
Non-Android targets keep their window across a minimize, so `revalidateSurfaceAfterResume()`
reports success without touching anything there.

**Requested in both modes, deliberately.** Android destroys the window whatever this host decided
about pausing, so `"continue"` needs the same rebuild; a mode-dependent rebuild would have left the
override quietly broken.

---

## The guard suite, red then green

`tests/lifecycle-pause.test.mjs` with the fix sources stashed out of the tree — the assertions see
exactly what `c3ae3b26` ships:

```
 ❯ tests/lifecycle-pause.test.mjs (10 tests | 3 failed) 22ms
   × resume rebuilds the surface Android destroyed, and republishes it 11ms
   × a surface that cannot be revalidated fails loudly instead of going black 3ms
   × the background default is `pause` again, on both sides of the JNI boundary 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: resume must queue the rebuild, not just clear the paused flag
AssertionError: the failure must be nameable in a log
AssertionError: pausing is what this feature is for, and resume now revalidates the surface
 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

With the change in place:

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

The pinning test that PRD-210's retreat left behind — *"the background default is `continue` until
resume revalidates the surface"* — named itself as the thing to change back. It was changed back
here, deliberately, and only after the device rung below.

## The C++ policy proof, and a red on `main` that nothing was running

`tests/lifecycle_policy_test.cpp` drives the real transition table, the real audio registry and the
real SDL event watch with no window and no GPU. It gained the revalidation cases, and running it at
`c3ae3b26` first turned up a red that predates this lane:

```
FAIL backgrounding pauses the loop
FAIL the pause marker says the pause was applied
FAIL backgrounding suspends every live AudioContext
FAIL the host records that it owns the suspension
FAIL an event pushed through SDL reaches the watch synchronously, before any poll
native lifecycle policy contract failed:
  - backgrounding pauses the loop
  ...
```

The retreat changed `resetLifecycleForTesting()` to store `Continue` and left section 2 of the
proof — *"Pause and resume, in the default mode"* — asserting that backgrounding pauses. Under
`Continue` it does not, by design, so the executable proof had been failing since `c3ae3b26`. It
went unnoticed because this lane is opt-in (`pnpm native:verify:desktop`) and not part of
`pnpm test`. Restoring the default fixes it, and the new cases assert the revalidation explicitly
rather than relying on the default:

```
PASS the default background mode is pause
PASS a host that has not resumed has nothing to revalidate
PASS backgrounding alone does not queue a rebuild; the window is not back yet
PASS resuming queues the surface rebuild that resume never did
PASS the loop takes the request
PASS and it is taken exactly once, so one resume is not rebuilt on every later frame
PASS backgroundMode=continue still queues the surface rebuild
PASS startup can drop a request it raised against a surface it just built
PASS revalidation is on unless something explicitly asks for the pre-fix behaviour
PASS the documented control switch reinstates the pre-fix resume
PASS and anything but 1 leaves the fix in place
native lifecycle policy contract passed
```

The whole display-free lane, on this branch:

```
node scripts/verify-desktop-stability.mjs
native crash-handler policy contract passed
desktop stability proof passed: Android leaves crash signals to debuggerd
native wgpu NULL-handle contract passed
desktop stability proof passed: a NULL wgpu handle throws to JS instead of reaching the FFI
native lifecycle policy contract passed
desktop stability proof passed: backgrounding pauses the loop and foregrounding resumes it
```

---

## The device rung, physical Pixel 8

One APK (`app-debug.apk`, V8, arm64-v8a + x86_64, built from this branch), installed once. The
control is a `debug.` system property read at each resume, so red and green are the same binary,
the same scene and the same process shape — not a build-to-build comparison.

Both rungs: launch cold, let it present for 20 s, `KEYCODE_HOME`, wait 12 s, `am start` the same
activity, wait 12 s, then read the ticks and capture. `am start` reported *"Activity not started,
its current task has been brought to the front"* and **the pid was unchanged across the
background/resume in both rungs**, so each is a real resume rather than a relaunch.

### RED — `debug.threenative.skip_surface_revalidate=1` (the pre-fix resume). FAIL, as intended.

```
-- pid before=4898 after=4898
TN_LIFECYCLE:{"event":"paused","sdlEvent":259,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_LIFECYCLE:{"event":"resumed","sdlEvent":261,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_CONTROL_SKIP_SURFACE_REVALIDATE: resuming without revalidating the surface
TN_SURFACE_ACQUIRE_FAILED:{"status":5,"suppressed":0}

# before backgrounding
TN_PRESENTS_TICK:{"frames":1200,"presents":1200,"textureMB":39,"textures":3,"bufferMB":0}
# after resume
TN_PRESENTS_TICK:{"frames":43920,"presents":1304,...}
TN_PRESENTS_TICK:{"frames":48900,"presents":1304,...}
TN_PRESENTS_TICK:{"frames":56340,"presents":1304,...}
```

`frames` ran away — about 2 500/s here, nothing paces the loop once presenting stops — while
`presents` stayed frozen at 1304. The captures:

```
before.png  1080x2400  non-black 29.79%  mean luma 75.97   blank=false
after.png   1080x2400  non-black  0.00%  mean luma  0.00   blank=true
```

That is the defect from `docs/bugs/resume-presents-nothing-2026-08-23.md`, reproduced on the same
phone that first recorded it. The one thing that is new is the third line above:
`TN_SURFACE_ACQUIRE_FAILED:{"status":5}` — wgpu's own `Lost` status. The old code presented nothing
and said nothing; this fails by name even when the fix is switched off.

Battery 32 %, 28.5 °C, Thermal Status 0.

### GREEN — the property back to `0` (the shipped path). PASS.

```
-- pid before=5098 after=5098
TN_LIFECYCLE:{"event":"paused","sdlEvent":259,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_LIFECYCLE:{"event":"resumed","sdlEvent":261,"mode":"pause","applied":true,"droppedTimerFirings":0}
TN_LIFECYCLE_SURFACE:{"event":"revalidated","previousWindow":"0xb400007247678550","window":"0xb40000724766fe20","width":1080,"height":2400}

# after resume — presents advance with frames, at 60 Hz
TN_PRESENTS_TICK:{"frames":1560,"presents":1560,"textureMB":39,"textures":3,"bufferMB":0}
TN_PRESENTS_TICK:{"frames":1620,"presents":1620,...}
TN_PRESENTS_TICK:{"frames":1680,"presents":1680,...}
TN_PRESENTS_TICK:{"frames":1800,"presents":1800,...}
TN_PRESENTS_TICK:{"frames":1860,"presents":1860,...}
TN_PRESENTS_TICK:{"frames":1980,"presents":1980,...}
```

No `TN_SURFACE_ACQUIRE_FAILED` anywhere in the run. **`previousWindow` and `window` differ**, which
is the cause measured rather than argued: Android really did hand back a different
`ANativeWindow`, and the old surface really was pointing at a destroyed one.

The capture after resume, with the app confirmed foreground first
(`ResumedActivity: ... com.threenative.runtime.MystralActivity`, so this is not a blind capture of
somebody else's screen):

```
after.png   1080x2400  non-black 29.78%  mean luma 75.93  blank=false
```

It is the smoke scene: the blue cube and the magenta overlay square, the same content as the
pre-background capture.

### The new marker arrives in the same burst as the old ones, and a gate must expect that

PRD-210 recorded that no `TN_LIFECYCLE` marker is observable *while* the app is paused: the watch
sets the flag synchronously on SDL's sending thread, but the thread that writes markers is then
parked inside `Android_WaitLifecycleEvent`, so every marker lands at the instant of resume.
`TN_LIFECYCLE_SURFACE` behaves the same way, and the green rung's timestamps say so:

```
22:39:27.066  TN_PRESENTS_TICK:{"frames":1200,"presents":1200,...}   <- last tick before HOME
                                                                     (13 s of silence)
22:39:40.053  TN_LIFECYCLE:{"event":"paused",...}       \
22:39:40.053  TN_LIFECYCLE:{"event":"paused",...}        |  all seven, one millisecond
22:39:40.053  TN_LIFECYCLE:{"event":"resumed",...}       |  apart, at the moment of resume
22:39:40.053  TN_LIFECYCLE:{"event":"resumed",...}      /
22:39:40.074  TN_LIFECYCLE_SURFACE:{"event":"revalidated",...}
22:39:41.090  TN_PRESENTS_TICK:{"frames":1320,"presents":1320,...}
```

The pause marker and the resume marker share a timestamp because neither was written until the
thread was released. **Any playtest that waits for a live marker while the app is backgrounded
waits forever** — including one waiting for `TN_LIFECYCLE_SURFACE`. A re-run of this rung has to
background, resume, and *then* read the whole window at once, which is what the sequence above
does.

Battery 32 %, 28.8 °C, Thermal Status 0 at the end. The debug property was reset to `0` and the app
force-stopped before the device was handed back.

### First proof on the phone, in the same session — not obtained

`verify-android-first-proof.mjs` was run against the phone at 22:34 and failed for a reason that is
not this change: the phone was locked, the activity launched behind the keyguard and Android
stopped it 30 ms later, so `configureSurface` hit `ERROR_SURFACE_LOST_KHR` at startup.

```
V SDL     : surfaceDestroyed()
V SDL     : nativePause()
V SDL     : onStop()
E ThreeNativeWGPU: wgpu ERROR: get_physical_device_surface_capabilities: ERROR_SURFACE_LOST_KHR
E MystralRuntime: Failed to configure WebGPU surface
```

This is the same family as the runbook's "launching onto a dozing screen" trap and it reproduces on
the pre-fix path; it is recorded here so nobody reads it as a regression. Once the phone was
unlocked, both rungs above launched cold and reached 1 200 presented frames before backgrounding.

---

## Android emulator — corroboration, and named as the emulator

`emulator-5554` (`sdk_gphone64_x86_64`, x86_64). **A green here does not carry to the phone and no
number below is a device number.**

- `verify-android-first-proof.mjs --device emulator-5554 --expect-engine v8`:
  `PASS: 300 frames, clean logs, screenshot captured, and process 18469 remained alive for 3000 ms`,
  overlay pixels 4096.
- The same red rung: `frames` 4200 → 7440 against `presents` frozen at 276, `after.png` 0.00%
  non-black, `TN_SURFACE_ACQUIRE_FAILED:{"status":5,"suppressed":0}`.

The emulator was used to reproduce the defect while the phone was locked. The fix's green is the
phone's.

---

## Repository gates

```
pnpm typecheck   ok  (after pnpm build; @threenative/assets must exist as a built package first)
pnpm lint        ok  exit 0, 296 pre-existing complexity warnings, none in the files changed here
pnpm budgets     ok  85,724 / 100,000 native runtime LOC; the framework LOC line is a report trigger
pnpm census      **Total** 85,239 → 85,724, 5 cells rewritten
```

`pnpm test` **did not complete as one command**, for a reason outside this repository, and the parts
are reported separately rather than as a green:

```
packages/playtest test: bash __tests__/orphan-cleanup.sh
orphan processes remain:
393459 …/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell …
```

That process is not this suite's. Walking its parent:

```
$ ps -o pid,ppid -p 392752 →  392752  392647
$ ps -o pid,cmd  -p 392647 →  node /home/joao/projects/rpg-engine/rpg-client/node_modules/playwright/…
```

A different repository was running Playwright on this machine throughout, and the orphan gate
matches any Chromium it finds. `bash packages/playtest/__tests__/orphan-cleanup.sh` on its own,
between that project's runs, printed `no orphans` and exited 0. Because the gate runs inside
`pnpm -r … test`, its failure aborted the recursive run before the remaining packages, so the suite
was completed in its two phases:

```
pnpm -r --filter '!@threenative/playtest' test          exit 0
  packages/assets           Test Files  7 passed (7)     Tests   58 passed (58)
  packages/runtime-native   Test Files 57 passed (57)     Tests  405 passed | 30 skipped (435)
  packages/runtime-native   Test Files  1 passed (1)      Tests   28 passed (28)

pnpm exec vitest run                                     exit 0
  Test Files  200 passed (200)
        Tests  1941 passed (1941)
```

Nothing was skipped to make that pass, and no assertion in this change is carried by the phase that
did not run: `tests/lifecycle-pause.test.mjs` is in the `packages/runtime-native` 57 above.

## What this does not claim

- **iOS**: nothing. No physical lane exists, and the simulator was not run here.
- **Desktop minimize**: the desktop path of `revalidateSurfaceAfterResume()` is a deliberate no-op —
  a desktop window survives a minimize — and PRD-210's criterion 5 still needs a session with a
  window manager. The headless lane here has nothing that can minimize a window.
- **The screen-off variant** (`KEYCODE_SLEEP` / `KEYCODE_WAKEUP`): not run. It re-locks this phone
  behind its keyguard, which would have blocked the lanes queued behind this one. The
  `KEYCODE_HOME` + `am start` rung above destroys and recreates the `ANativeWindow` in exactly the
  same way — the marker proves the window changed — but the two are not the same event sequence and
  this record does not merge them.
- **`backgroundMode:"continue"` on device**: still open (PRD-210 criterion 3). The revalidation is
  requested in that mode too and is covered by the C++ policy proof, but no device rung has driven
  it.
