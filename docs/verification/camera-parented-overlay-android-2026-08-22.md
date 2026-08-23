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

## Phase 1 — attribution

Method: the scene (`conformance/scenes/shared/camera-parented-overlay.js`) grew a trace ladder —
`console.info` lines at module load, scene entry, build entry, and per viewport iteration
(begin / passed) — bundled and run in isolation on the same emulator three times:

| Run | Scene state | Harness-recorded error | Report |
| --- | --- | --- | --- |
| A | instrumented | `Android process exited before the conformance marker.` | `.runtime/prd166/phase1-instrumented/report.json` |
| B | + deliberate throw at viewport 1 | `Android timed out waiting for TN_CONFORMANCE_READY:25-camera-parented-overlay.` | `.runtime/prd166/phase1-throw-probe-r2/report.json` |
| C | + `set-size-returned`/`render-returned` call split | `Android process exited before the conformance marker.` | `.runtime/prd166/phase1-pinpoint-r2/report.json` |

### Attribution 1 — the row's death is an ENGINE-layer abort, home `packages/runtime-native/`

Run A's unfiltered logcat, the deciding observation:

```text
14:19:55.156  MystralJS: [info] TN_PRD166_TRACE:{"stage":"viewport-passed","index":0,"width":1280,"height":720}
14:19:55.156  MystralJS: [info] TN_PRD166_TRACE:{"stage":"viewport-begin","index":1,"width":1024,"height":768}
14:19:55.260  ActivityManager: Process com.threenative.game (pid 4788) has died: fg TOP
14:19:55.263  Zygote: Process 4788 exited due to signal 6 (Aborted)
```

The scene fully completed viewport 0 — a real `renderer.setSize`, a real render, and both
assertions (`assertRenderedSize`, `assertAnchorHeld`) passed on it. It then aborted with
SIGABRT 104 ms into viewport 1, whose only distinction is being the **first resize to a
different size** (1024x768 after the surface was configured at 1280x720). Between the
`viewport-begin` line and Zygote's signal-6 line the app process itself logged nothing at all:
no JS exception text, no wgpu panic, no validation message, no tombstone in logcat.

Run C splits the two native calls inside the dying iteration and names the exact one:

```text
14:40:58.341  TN_PRD166_TRACE:{"stage":"viewport-begin","index":1,"width":1024,"height":768}
14:40:58.341  TN_PRD166_TRACE:{"stage":"set-size-returned","index":1,"width":1024,"height":768}
14:40:58.450  Zygote: Process 8771 exited due to signal 6 (Aborted)
```

`renderer.setSize(1024, 768)` **returned**; the abort is ~109 ms later, before
`render-returned` — i.e. inside `renderer.render(scene, camera)`, the first draw against the
reconfigured swapchain. The pure-JS layout between the two calls takes microseconds, not
109 ms.

The scene layer is exonerated by construction plus run B: a JavaScript throw inside this loop
cannot kill the process — run B threw deliberately inside the same loop and the process stayed
alive to the timeout (see attribution 2). No assertion ran at the death point that could have
thrown. The abort is engine-side, in the Android render path against a swapchain that changed
size after first configure, under swiftshader_indirect on API 35 x86_64. This matches the
scene's desktop history: the same row failed tier-1 day on GPU validation ("mismatched depth
and colour attachment sizes after resize") before passing there on 2026-08-15.

**Named change for the owning lane** (not executed here — `packages/runtime-native/src` is
outside this wave's ownership; filed as PRD-183): root-cause the silent SIGABRT in the render
path when the swapchain has been reconfigured to a different size — `setSize` itself returns
cleanly, so the defect is between the wgpu surface reconfiguration taking effect and the first
present against it. The repro is this row in isolation; the trace ladder names the dying
iteration and the aborting call in logcat.

### Attribution 2 — a failing assertion reports as a TIMEOUT, never as itself: HARNESS layer

Run B (probe): the scene threw `Error: TN_PRD166_PROBE_THROW: deliberate probe failure` at
viewport 1. The generated native entry catches scene throws and prints them
(`run-conformance.mjs` `makeEntry`: `console.error('[ThreeNative conformance] failed:', …)`),
so the line reached logcat verbatim and the process stayed alive:

```text
14:27:13.002  MystralJS: [info] TN_PRD166_TRACE:{"stage":"viewport-begin","index":1,...}
14:27:13.005  MystralJS: [error] [ThreeNative conformance] failed: Error: TN_PRD166_PROBE_THROW: deliberate probe failure
```

The harness then polled for sixty seconds and recorded
`Android timed out waiting for TN_CONFORMANCE_READY:25-camera-parented-overlay.` The failure
line was on the wire the whole time: `analyzeAppLog`'s matchers
(`scripts/verify-android-first-proof.mjs` `failureMatchers`) look for `Uncaught`,
`Unhandled promise rejection`, named error constructors, fatal signals and WebGPU strings — a
caught-and-logged `Error:` carrying a `TN_CONFORMANCE_*` code matches none of them. So:

| What actually happens | What the harness records |
| --- | --- |
| Native abort mid-scene (real defect) | "process exited before the marker" |
| Scene assertion fails (any defect) | generic timeout, after burning the full window |

Neither shape names the failure. An assertion that fails is invisible as an assertion — exactly
the defect class PRD §3 phase 1 warns about — and every future failure in every scene that
reports through `[ThreeNative conformance] failed:` will die the same way.

**Named change for the owning lane** (not executed here — `run-conformance.mjs` /
`verify-android-first-proof.mjs` are outside this wave's ownership and PRD-179 is actively
editing the runner): teach the Android wait loop to treat a
`[ThreeNative conformance] failed:` logcat line as an immediate row failure carrying the
logged stack — one `failureMatchers` pattern (plus, optionally, a `TN_CONFORMANCE_` catch-all)
and a regression fixture in `tests/conformance-runner.test.mjs`. With that in place, run B's
probe would have reported the probe message instead of a timeout.

### Concurrent-edit note

Run C's first attempt (14:33) died at runner startup: `run-conformance.mjs` carried uncommitted
PRD-179 changes importing a `gate-records` module that did not resolve yet
(`ERR_MODULE_NOT_FOUND`). The PRD-179 lane landed `ecf5f413` minutes later, the runner loaded
again, and run C completed as `phase1-pinpoint-r2`. No conclusion above rests on the window in
between.

## Phase 2 — the harness reporting fix (commit `abaae6d5`, refined in `556eecc6`)

With the coordinator's GO after PRD-179 landed, two changes closed criterion 3:

1. **`failureMatchers` gains `scene-failure`** (`scripts/verify-android-first-proof.mjs`):
   `/\[ThreeNative conformance\]\s*failed:/i`. The generated native entry catches every scene
   throw and logs that shape before staying alive; without the pattern the harness burned its
   whole timeout window and recorded a generic timeout.
2. **Pre-marker deaths carry their last diagnostics** (`conformance/run-conformance.mjs`,
   `androidDeathExcerpt`): the "process exited" error appends the app's own last `TN_*`
   diagnostic lines — for this row, the viewport ladder naming the aborting iteration. A raw
   tail slice was tried first and rejected by fixture: post-death Window Manager chatter
   (lines merely naming the app id) crowded out the trace.

Red-green-mutation, pasted from scoped runs:

```text
RED   (fixture against current matcher set):  2 failed | 14 passed
      - scene-failure was not classified: [ThreeNative conformance] failed: Error: assertion exploded
      - the caught-and-logged scene failure was not classified
GREEN (pattern added):                        16 passed (16)
MUTATION (pattern line reverted):             2 failed | 14 passed — same two assertions
RESTORED:                                     android-first-proof-gate + conformance-runner 56/56
(excerpt refinement) RED:                     'death chatter must not crowd out diagnostics'
                      GREEN/MUTATION/RESTORE: same cycle → 57/57
```

## Phase 3 — full Android lane re-run (2026-08-22 ~15:05–15:25)

Fresh web reference set captured first on this machine at the same tree (the 2026-08-19 set did
not survive): web target `67 / 0 / 0`, exit `0`, 67 PNGs
(`.runtime/prd166/reference-web/report.json`). Then the full lane:

```sh
ANDROID_SDK_ROOT=/home/joao/Android/Sdk ANDROID_HOME=/home/joao/Android/Sdk \
  node packages/runtime-native/conformance/run-conformance.mjs --target android \
  --device emulator-5554 --reference .runtime/prd166/reference-web \
  --out .runtime/prd166/android-full-rerun
```

Summary `{ "pass": 66, "fail": 1, "blocked": 0 }`, exit `1`. The one failing row is the known
engine defect, now reporting with named diagnostics instead of a bare death:

```json
{ "id": "25-camera-parented-overlay", "status": "fail",
  "native": { "completed": false,
    "error": "Android process exited before the conformance marker. Last app output: …
              TN_PRD166_TRACE:{\"stage\":\"viewport-passed\",\"index\":0,…}
              | TN_PRD166_TRACE:{\"stage\":\"viewport-begin\",\"index\":1,\"width\":1024,…}
              | TN_PRD166_TRACE:{\"stage\":\"set-size-returned\",\"index\":1,…}" } }
```

The other 66 rows reached real pixel comparison against today's reference set; worst mismatch is
`61-offscreen-screenshot` at `pixelMismatchRatio` `0.0038216` against tolerance `0.01`.

**Criterion 3 proven end-to-end on device.** With the matcher live, the identical probe throw
that produced `Android timed out waiting for TN_CONFORMANCE_READY:…` at 14:27 now produces the
row failing as itself within milliseconds of the throw (isolated run
`.runtime/prd166/phase3-probe-verified/report.json`):

```text
error: … I MystralJS: [error] [ThreeNative conformance] failed: Error: TN_PRD166_PROBE_THROW: deliberate probe failure
```

The probe was reverted afterwards; the scene file matches its committed state.

## Disposition

| PRD-166 check | Result |
| --- | --- |
| §4.1 raised timeout | died again at 4× deadline — stuck (phase 0) |
| §4.2 attribution in writing | engine abort + harness blind spot, with deciding observations (phase 1) |
| §4.3 throw reaches harness as a failure | proven end-to-end on device after `abaae6d5` |
| §4.4 regression test red-unfixed/green-fixed | pasted above, mutation-proofed twice |
| §4.5 Android lane re-run | `66 / 1 / 0`, the one failure a NAMED defect — the PRD-183 engine abort carrying its own stage ladder — never a timeout |
| §4.6 full workspace gates | coordinator-owned between waves; scoped suites green (57/57) |

The row itself goes green only when the native lane lands PRD-183; every harness-side defect
this PRD owned is fixed, tested, and mutation-proven.


