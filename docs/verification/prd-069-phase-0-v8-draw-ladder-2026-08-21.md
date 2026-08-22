# PRD-069 Phase 0 — V8 draw/object ladder on the Pixel 8, and two instrument corrections

Date: 2026-08-21
Source base: `96fd6445` plus this session's tooling fixes
Device: Pixel 8 `shiba`, serial `37251FDJH0037Z`, arm64-v8a, Android 17, Mali-G715
Engine: **V8** (`libv8android.so` packaged; `--expected-engine V8` asserted by the gate)
Transport: Wi-Fi ADB (`adb tcpip 5555` → `192.168.1.192:5555`), device **discharging**,
thermal status NONE at every accepted preflight, screen forced on (`svc power stayon true`).
No `--allow-low-battery`, no `--allow-emulator-development`; every run acceptance-eligible.

## Why this run exists

PRD-069's §2.2 draw-count sweep (the "knee": marginal cost 13.5 → 76.4 → 36.9 µs/mesh across
500/1,000/2,000 draws) was measured on 2026-08-10 under **QuickJS**, before:

1. **PRD-130** made V8 the Android default (2026-08-16), and
2. this session discovered the sweep's subject was **frustum-culled**: at 250 scene meshes the
   render path submits **4** `drawIndexed` per frame, not 250 (camera z=3, portrait aspect 0.45,
   lattice half-extent ≈ 2 units). The historical sweep therefore varied *scene object count*
   (matrix updates, culling, render-list push), not submitted draws. Its per-mesh costs are
   real per-*object* costs under QuickJS; its label was wrong.

This run re-measures the same subject under the shipped engine, with per-submit instrumentation,
so the knee question gets an answer that matches today's binary.

## Instrument corrections landed this session

Both are engine-side, both red-green tested where testable:

1. **Wireless transport identity.** `measure-android-js-engine.mjs` compared the adb transport
   string against the USB serial, so over Wi-Fi adb it always failed
   `TN_ANDROID_JS_WRONG_DEVICE` while over USB it always failed the discharging preflight —
   the physical lane was unrunnable in both transports. Device identity is now resolved from
   `ro.serialno` (`resolveMeasurementSerial`); empty reads fall back to the transport string and
   fail exactly as before. Red: `resolveMeasurementSerial is not a function`. Green:
   `tests/android-js-engine-measurement.test.mjs` 12/12.

2. **Logcat ring wrap.** V8 emits ~20 `TN_ANDROID_JS_NATIVE` lines per submit; the default
   256 KB main buffer evicted the early `SUBJECT` and `WINDOW_START` markers mid-run
   (observed: 7,030 native lines captured, both early markers gone, analysis failed
   `TN_ANDROID_JS_MISSING_MARKER`). The launch path now sizes the buffer to 16 MB before
   clearing (`MEASUREMENT_LOGBUFFER_BYTES`). Verified by the successful runs below.

### Known-open instrument defect found during analysis (not yet fixed)

`emitAndroidJsNativeProfile` reports `presentNs` (the previous frame's present time) **once per
submit**, and a frame submits ~4×; the report's `nativeSubmitPresentMsPerFrame` therefore counts
present ~4.3×. Corrected per-frame figures below are computed from the raw per-submit logcat
lines. At m250: submit+poll mean 0.129 ms × 4.3 submits ≈ 0.55 ms/frame; present mean 0.706 ms
counted once ≈ 0.71 ms/frame — against a reported `nativeSubmitPresentMsPerFrame` of 3.37 ms.

## Ladder results

Subject `examples/native-smoke`, shared BoxGeometry(0.08) + shared MeshBasicMaterial, 60 warmup
frames then a 300-frame window, uncapped present mode. `jsAndUninstr` is the report's
`javascriptAndUninstrumentedMsPerFrame`; `native*` columns are corrected from raw logcat
(submit+poll summed per submit; present counted once per frame).

| meshes | submitted draws/frame | ms/frame | fps | jsAndUninstr | native submit+poll | present (1×) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 51 | 3.899 | 256.4 | 0.353 | 0.523 | 0.754 |
| 250 | 4 | 4.027 | 248.3 | 0.617† | 0.517 | 0.706 |
| 1000 | n/a‡ | 4.013 | 249.2 | 2.586 | — | — |
| 2000 | n/a‡ | 4.711 | 212.3 | 3.482 | — | — |

† pre-fix binary: `jsAndUninstr` carries the inflated present; corrected ≈ 2.77 via
`analyze-corrected.js`.
‡ these rungs ran on the post-fix binary where the report's native split is truthful; their
native share reads directly as `total − jsAndUninstr − boundary` ≈ 1.40 / 1.20 ms.

## Verdict on the knee

**No QuickJS-style knee exists under the shipped engine up to 2,000 scene objects.** Frame time
is flat at ~4.0 ms from 100 through 1,000 objects (the 250→1000 marginal is indistinguishable
from zero), then rises with a marginal cost of ≈ **0.70 µs per additional scene object** into
2,000 (4.71 ms). Nothing resembling the historical step — a fixed ~20 ms/frame engaging between
500 and 1,000 draws at 13.5→76.4 µs/mesh marginals — survives the engine swap. The §2.2 knee is
an artifact of two things at once: it was measured under an interpreter that PRD-130 replaced,
and its subject was frustum-culled so its x-axis was never draws.

Where the shipped frame goes instead (Pixel 8, uncapped, shared-material boxes): a ~2.6–3.5 ms
JavaScript term that scales with scene objects, plus a ~1.2–1.4 ms true native floor
(~0.52 ms submit+poll across ~4 submits/frame, ~0.7 ms one present), plus ≤0.08 ms inside the
six instrumented bindings. Pure-JS matrix control: 0.233–0.380 µs/object under V8.

The remaining rungs are recorded **UNMEASURED**: 500 and 4000 exhausted their cooled retries —
4000 against thermal LIGHT trips and a cooldown target the phone stopped reaching (idle battery
temp settled at 32.0–32.3 °C late in the session, above the 31.5 °C margin the launch heat
needs), 500 the same. The tooling reruns them in one command when the device is cooler
(`sweep.sh "500 4000"`).

<!-- LADDER_ROWS -->

## Regression baselines captured alongside

| Arm | Artifact |
| --- | --- |
| tn-web (desktop Chrome, nvidia turing) | `artifacts/engine-load-test/knee-baseline-tn-web-2026-08-21.json` |
| tn-desktop (native host, Dawn) | `artifacts/engine-load-test/knee-baseline-tn-desktop-2026-08-21.json` |

Both ladders completed exit 0; the desktop-native run also exercises the rebuilt host binary
containing the present-counting fix (profile off there). L1 scales smoothly on desktop web
(256→1.10 ms … 16384→70.60 ms p50, ~7 µs/draw at the top rung) with no knee-shaped step;
L2/L3 stay flat.

## Thermal discipline

First full-ladder attempt burned every rung after m250 on `TN_DEVICE_PREFLIGHT_CONDITION_FAILED:
thermal: expected <= NONE, observed LIGHT`: the flow launches the first-proof game *before*
`assertDeviceReady`, and that launch heats a warm phone past LIGHT between the sweep's own
cooldown check and the gate. The paced sweep now waits for thermal status 0 **and**
battery temp ≤ 31.5 °C before each rung (headroom for the launch's heat) and passes
`--cold-start-runs 0` (five launches of pure heat this ladder does not consume).

## Side finding — PRD-069 §3.1's BundleGroup gates, measured on desktop WebGPU hardware

While the device ladder waited on power, the two gates §3.1 left unverified were measured in
`examples/native-cpu-load-test` (new `bundled` / `bundled-dynamic` arms, commit `f95bcbb7`),
on browser WebGPU hardware (nvidia turing, headed Chromium under Xvfb, three 0.185.1):

| Gate | Result |
| --- | --- |
| Does a moved bundled object reach the screen? | **No.** With defaults (`static=true`),
`NodeMaterialObserver.needsRefresh` returns false for every object in the bundle — meshes
teleported 60 units never appeared. With `static=false`, the per-frame `renderId` check fires
for only the first render object per shared material observer, so at most one mesh per material
refreshes per frame; at 4,096 same-material meshes the teleport still never reached the screen
(`TN_BUNDLE_FROZEN`, reproduced twice). |
| What does the cached path cost? | 1,024 all-moving meshes rendered in **0.10 ms vs 3.60 ms**
independent (`draws=1` vs `1025`) — an order of magnitude less render-side work, wasted on a
wrong picture whenever children move. |

**Consequence for §3.1:** the lever is dead as a general mechanism on this three version.
It stands only as a static-scenery optimisation with a correctness cliff, which is a game-side
decision (`src/render/`), not a framework feature. The framework's share reduces to what §3.1
already named separately: `renderer.info` exposure and a conformance row if static bundles are
ever adopted.

Instrument note for whoever reuses the gate: sub-pixel drift cannot be told apart from a frozen
scene — a first gate version reported FROZEN from 30 frames of 0.001 rad/frame drift and then
"passed" under visible ambient motion without isolating the probe. The shipped gate teleports
three meshes between same-task captures with a same-frame control pair; nothing animates between
the two captures, so a difference is attributable to the probes alone.
