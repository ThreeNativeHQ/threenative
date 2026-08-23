# Verification — PRD-166 camera-parented-overlay on the Android emulator (2026-08-22)

Lane: lane-core (PRD-166). Device lane: Android **emulator only** — `emulator-5554`,
AVD `threenative-prd050`, image `system-images/android-35/google_apis/x86_64`, API 35,
x86_64, JS engine V8, Three.js 0.185.1. Launched headless with
`emulator -avd threenative-prd050 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot`
(the recipe recorded in `docs/verification/unblocked-2026-08-09-android-touch.md`); booted in ~25 s.
**The emulator proves the emulator. No physical-device, arm64, iOS, driver, frame-rate or
mobile-readiness claim is made anywhere in this file.**

## Phase 0 — slow vs stuck

Executed command (the only difference from the PRD-160 rerun recipe is `TN_ANDROID_TIMEOUT_MS`
and the output directory):

```sh
ANDROID_SDK_ROOT=/home/joao/Android/Sdk ANDROID_HOME=/home/joao/Android/Sdk \
TN_ANDROID_TIMEOUT_MS=180000 node packages/runtime-native/conformance/run-conformance.mjs \
  --target android --device emulator-5554 \
  --only-tests 25-camera-parented-overlay --out .runtime/prd166/phase0-raised-timeout
```

Exit `1`; summary `{ "pass": 0, "fail": 1, "blocked": 66 }`. The row's recorded error is
identical to the 45-second default runs:

```json
{ "id": "25-camera-parented-overlay", "status": "fail",
  "native": { "completed": false,
              "error": "Android process exited before the conformance marker." } }
```

Report: `packages/runtime-native/.runtime/prd166/phase0-raised-timeout/report.json`.
Full unfiltered logcat was captured in parallel (`adb logcat -v threadtime` for the whole run)
and is the source of every line quoted below.

### Verdict: STUCK — the process dies, it is not slow

Raising the marker timeout fourfold changed nothing, because the app never lives long enough
for any timeout to matter. Timeline from the unfiltered capture (all times device-local):

```text
14:13:08.424  ActivityManager: Force stopping com.threenative.game … from pid 3723   (harness pre-launch)
14:13:08.663  Start proc 3758:com.threenative.game/u0a547                            (conformance launch)
14:13:10.299  MystralRuntime: Configuring surface: 1280x720                          (lane's wm size override active)
14:13:10.307  MystralRuntime: JS engine created: V8
14:13:10.609  MystralRuntime: About to call evalScript...
14:13:10.609  MystralColdStart: TN_COLD_START:{"segment":"game_eval_begin","atMs":833.915}
14:13:11.106  ActivityManager: Process com.threenative.game (pid 3758) has died: fg TOP
14:13:11.108  Zygote: Process 3758 exited due to signal 6 (Aborted)
```

**Signal 6 — SIGABRT — 497 ms after script evaluation began.** No JS output of any kind between
`evalScript` and the abort: no `MystralJS` console line, no scene instrumentation, no marker.
No ANR, no GPU validation line, and no external `force-stop` participates in *this* run's death.

This corrects the 2026-08-19 ledger's premise. `android-parity-2026-08-19.md` §"The one row
that still fails" states "there is no ANR, no `libc` fatal signal" and reads the kill as purely
external. That reading came from the harness-filtered app log: `filterAppLog` keeps only lines
naming the app id/markers/pid pattern, and the Zygote signal-6 line comes from pid 395, so it
never survived filtering. The unfiltered capture shows the abort. The 2026-08-19 logcat's
`Force stopping … from pid 14233` lines remain real but were downstream cleanup, not the cause;
in this Phase 0 run the corresponding lines are absent entirely and the death is the same.

### What the death is not

Not scheduling, not load, not a concurrent lane: the run was isolated (`--only-tests`), the
emulator had just booted idle, and the interleaved second app visible in the same capture
(pid 3879, first-proof-shaped 300-frame smoke at 1080x2400, launched 14:13:24) is this same
harness invocation's own multitouch supplemental, which starts only after the row already
failed at 14:13:11–12 and whose install (`installPackageLI`, 14:13:24.480) therefore postdates
the death. Its 300 frames rendered fine on the same emulator minutes later, so the box, the
GPU stack and the emulator were healthy throughout.

### Consequence for the phases

Timeout eliminated as the defect (PRD §2's third reading is dead). Phase 1 attribution is
between engine and scene, with the deciding question now sharpened: what aborts natively
within half a second of `evalScript` — before or inside this scene's viewport loop.
