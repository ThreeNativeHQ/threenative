# PRD-221 phase 3 — an observed 16 KB Android environment

Date: 2026-09-11. Branch `prd221/android-v8-16kb`, base `fbc161055`. Host: linux-x64,
Node v20.19.6. Every command below was executed.

## The hole this closes

The lane could run on Android and report a green result without ever recording the page size it
ran on. "We ran on Android 15" is not "we ran with 16 KB pages": an ordinary emulator image reports
4096 and passes every other check in this repository, so a 16 KB qualification was a claim rather
than a measurement. Neither `.github/workflows/native-platforms.yml` nor
`tests/native-platform-workflow.test.mjs` contained the string `PAGE_SIZE` before this phase.

## The observation, on real hardware-accelerated Android

The local AVD, booted on KVM, read directly from the device:

```
$ adb -s emulator-5554 shell getconf PAGE_SIZE
16384
$ adb -s emulator-5554 shell getprop ro.build.version.sdk      -> 36
$ adb -s emulator-5554 shell getprop ro.build.version.release  -> 16
$ adb -s emulator-5554 shell getprop ro.product.cpu.abi        -> x86_64
$ adb -s emulator-5554 shell getprop ro.build.fingerprint
google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys
```

AVD `threenative_ps16k`, image `system-images;android-36;google_apis_ps16k;x86_64`. The raw bytes
are `1 6 3 8 4 \n` (`od -c`), which is why the parser strips `\r` — adb's device shell hands back
CRLF on other paths and an unstripped carriage return turns `Number()` into `NaN`.

**This removes the assumption that 16 KB execution needed a developer image flashed onto a phone.**
It does not.

## What was built

`packages/runtime-native/scripts/check-android-page-size.mjs` — one function the workflow calls and
the tests call, rather than logic buried in a YAML step where nothing can execute it.

Fail closed, in the repository's sense: a **missing** observation is a failure, not a skip; empty,
non-integer, zero and negative values are failures; `4096` is a failure *for a 16 KB claim* and a
correct result for the 4 KB lane, which is why the expected size is an argument. The 4 KB mismatch
message names the image that would actually qualify instead of only saying the number is wrong.

Executed against the live device and against controls:

```
check-android-page-size.mjs <live observation>            observed page size: 16384 bytes   exit 0
check-android-page-size.mjs <4096 observation>            TN_ANDROID_PAGE_SIZE_MISMATCH     exit 1
check-android-page-size.mjs <path that does not exist>    TN_ANDROID_PAGE_SIZE_MISSING      exit 1
```

`.github/workflows/native-platforms.yml` now captures `getconf PAGE_SIZE` as the **first** thing
inside the emulator script — before anything can tear the device down, for the same reason the
logcat dump rides that folded line — and a following `if: always()` step runs the checker against
`TN_ANDROID_EXPECTED_PAGE_SIZE`. That expectation is job-level data set to `4096`, which is what
`api-level: 35` actually is. Pointing the hosted lane at the 16 KB image is then a change of two
values, not a change of code.

## Observed red, then green

The required test asserts the workflow records the page size. Written before the workflow was
touched, it failed on exactly that:

```
× the emulator lane records the page size it ran on
  AssertionError: The input did not match the regular expression /getconf PAGE_SIZE/u
  Tests  1 failed | 40 passed (41)
```

After wiring the capture and the verification step: `Tests 41 passed (41)`.

## Gates

```
packages/runtime-native  tests/native-platform-workflow.test.mjs        41 passed (6 new)
repo                     ci-structure + ci-needs + ci-efficiency specs  175 passed across 3 files
```

The full `packages/runtime-native/tests/` run reports **18 failures across 5 files**, all of the
form `build/tn-linux/<target> is not built` — `crash-handler-policy`, `pump-silence`,
`rg11b10-renderable`, `runtime-next-contract`, `timestamp-query`. This worktree has no compiled
C++ host (`build/tn-linux` does not exist), so they are environmental and untouched by this phase:
994 passed, 62 skipped.

## What is **not** proved here

The phase also asks for the default starter — React UI, physics and assets — launched on this
environment, with HUD and player interaction, a background/resume cycle and a linker-failure check
of the logs. **That was not run.** It needs a compiled native host and a packaged APK, which this
worktree does not have. The page size is observed; the game running on it is not.

The 4 KB result is kept separate, as the phase requires: the hosted lane asserts 4096 and says so.

## Follow-up, same day: a real game, and the aligned V8 still fails

The starter was not the only subject. `../sandbox/fps-framework` (`com.threenative.bayview`) was
built against a local runtime source checkout — `THREENATIVE_RUNTIME_SOURCE=<runtime-native>` —
because no `runtime-native` release exists to download (`prebuilt-lock.json` 404), and installed on
the same `threenative_ps16k` AVD (`getconf PAGE_SIZE` 16384).

Two builds, and the second is the finding:

| APK's `libv8android.so` | LOAD align | Result on 16384-byte pages |
| --- | --- | --- |
| primary checkout (4 KB V8) | — | `Check failed: 0 == mprotect(address, size, 0x1)` |
| this branch's receipted V8 | `0x4000` (16 KB) | **identical abort** |

The rebuilt APK's `libv8android.so` carries `LOAD align 0x4000` (read from the packaged `.so`), so
this is not the alignment defect phase 2 removed. It still dies at:

```
signal 5 (SIGTRAP)  SDLThread  com.threenative.bayview
#00 libv8android.so  v8::base::OS::Abort()
#01 libv8android.so  V8_Fatal(char const*, ...)
#02 libv8android.so  v8::base::OS::SetDataReadOnly(void*, unsigned long)
#04 libv8android.so  v8::V8::Initialize(int)
#05 libmystral-runtime.so  mystral::js::V8Engine::V8Engine()
```

`SetDataReadOnly` sizes its `mprotect` against V8's build-time page size; link-time alignment does
not change that. **The V8 build itself must target 16 KB pages** — the remaining work is a V8 build
configuration, not a packaging change.

Control that isolates it to the page size: the same game's native Linux build
(`dist-native/fps-framework`, built from the same runtime source) ran under `scripts/xvfb.sh` to 900
presented frames with `[V8] V8 initialized successfully` (13.1.201.22). The game is fine; the 16 KB
Android environment is not.

## The fix, and it runs on 16 KB

V8 11's `src/base/build_config.h` puts Android in the `else` branch of `kMinimumOSPageSize` (4 KB).
That constant aligns `v8_flags` and other static data, and `OS::SetDataReadOnly` then asks the kernel
to `mprotect` a 4 KB-aligned region on a 16 KB device: EINVAL, `V8_Fatal`. Upstream later added
Android to the 16 KB condition. `scripts/build-android-v8.mjs` now applies the same clause and bumps
the recipe to 6 so a stale cache rebuilds. Red-green on `android-16kb-alignment.test.mjs`: 33 passed
-> 2 failed -> 35 passed.

Then the V8 payload was rebuilt (`download-deps.mjs --android` -> recipe 6,
`build-receipt.json`: `recipe 6`, `loadAlignment 16384`), `../sandbox/fps-framework`
(`com.threenative.bayview`, APK sha256 `4764619f3ce1c518…`) was rebuilt against it, installed on
`threenative_ps16k` (16384-byte pages) and launched:

```
MystralStdio: [V8] Initializing V8 JavaScript engine...
MystralStdio: [V8] Using external startup snapshot (45421 bytes)
MystralStdio: [V8] V8 initialized successfully
MystralStdio: [V8] Version: 11.0.226.16
MystralColdStart: TN_COLD_START:{"segment":"first_playable","atMs":28671.006}
MystralRuntime: TN_SURFACE_FRAME:{"view":true,"present":28}
```

A screenshot at that point is 2400x1080 with 1857 distinct colours — a rendered frame, not a blank
one. V8 initializes and the game presents frames on a 16 KB environment; the crash is gone. HUD
interaction and a background/resume cycle were not separately exercised, and the in-repo Android
playtest target was not run here; the process stayed alive past first playable.

## Fresh run — the default starter itself, on 16 KB

The gap above (the default starter was never launched on the environment) was closed on the same
day by rebuilding the starter with this branch's packager against the recipe-6 V8 and running it
on `threenative_ps16k`. Candidate `prd221-16kb-starter.apk`, sha256
`6acd46affa374b022a88a506c9e173178c58b1b4abd45b740983a16376f14aab`; installed over the stale
pre-recipe-6 build, whose launch had died in the tombstone exactly as the V8 finding predicts.

```
$ adb shell getconf PAGE_SIZE
16384
$ adb logcat --pid=<starter>  |  [V8] Initializing V8 JavaScript engine...
[V8] Using external startup snapshot (45421 bytes)
[V8] V8 initialized successfully
[V8] Version: 11.0.226.16
TN_COLD_START:{"segment":"first_playable","atMs":…}
TN_SURFACE_FRAME:{"view":true,"present":64}     (250 frames counted across the session)
```

A screenshot at first playable is 2400×1080 with 1504 distinct colours. The HUD and menu render
(`ui.renderer: "web"`); a touch on the `pause` button was owned by the UI overlay
(`TN_UI_HITTEST:{"x":1490,"y":963,"w":2400,"h":1080,"regions":2,"owns":true}`), confirming the
native input host routes the gesture to the WebView rather than the game surface. The button's
visible label did **not** flip to `resume`, so the intent's effect was not observed — recorded as
a limitation, not asserted as working.

Background/resume was exercised: `KEYCODE_HOME` produced `SDL onPause()`,
`TN_LIFECYCLE:{"event":"observed","mode":"pause","applied":false}`, `surfaceDestroyed()` and an
audio suspend; `am start` returned the surface and frames continued (present 120 → 125). The
process stayed alive throughout with no linker failure and no `V8_Fatal`. HUD interaction and the
default starter are now both exercised; the one unobserved detail is the pause label change.

## Independent review

PENDING.
