# Verification — fps-framework mobile perf probe, 2026-08-24

One run, one device. Everything below executed 2026-08-24 19:49–20:17 UTC+2 unless stated.

## Lane

- Device: physical Pixel 8 (`shiba`, serial `37251FDJH0037Z`), Wi-Fi adb `192.168.1.192:5555`,
  Android 15+, Mali-G715, 1080×2400 @ 120 Hz.
- Battery during session: 84→90→86 % (Wi-Fi adb does not charge this phone), battery temp
  37.6–38.7 °C, thermal status 0 (nominal) throughout. No thermal throttle confound.
- Game: `sandbox/fps-framework` ("bayview", coastal-town 5v5). APK
  `sandbox/fps-framework/dist-native/fps-framework.apk`, 379,285,298 bytes, rebuilt
  2026-08-24 19:36 and reinstalled 20:10 as package **`com.threenative.bayview`**
  (applicationId confirmed via `aapt dump badging`).
- Runtime: WebGPU via Dawn on **Vulkan**, adapter Mali-G715; V8 **11.0.226.16**; SDL3 window
  1080×2400; present mode fifo (vsync).

## What executed

1. Cold launch via `am start -W -n com.threenative.bayview/com.threenative.runtime.MystralActivity`,
   three times (20:11, 20:15, 20:17). `logcat -G 16M` before each; full logcat captured.
2. Screencaps at t = 2/5/10/15/20/30/40/55 s per launch.
3. `top -H` sampled ~1/s across launch + stall + gameplay (run 3).
4. `dumpsys SurfaceFlinger --timestats` window during gameplay (run 1).
5. Wrong-package control: the stale `com.threenative.game` install (340,878,404-byte APK,
   2026-08-23 22:44) was launched first by mistake — see §5.

## Findings

### F1 — Loading screen: ~15–20 s to playable, dominated by one 12–14 s main-loop stall AFTER assets load

Timeline of run 2 (20:15:56 cold start), all from logcat:

| t (wall) | marker |
| --- | --- |
| +0.00 s | `TN_COLD_START process` |
| +0.15 s | `runtime_created` |
| +4.9 s | `TN_FPS_BOOT_MS {"load":2168,"town":1258,"soldiers":821,"effects":329,"enterTotal":2412}` |
| +4.9 s | `TN_NATIVE_SMOKE_FIRST_FRAME` |
| **+19.1 s** | `TN_COLD_START first_frame atMs:19147` |
| +19.3 s | `TN_FRAME_HITCH {"gapMs":14145.14}` — ONE frame gap |
| +22.7 s | presents resume; 60 frames/3.4 s ≈ **18.5 FPS** |

Run 1 (20:11) measured the same shape smaller: boot done at 2.4 s
(`TN_FPS_BOOT_MS enterTotal:1048`), then `TN_FRAME_HITCH gapMs:12332.06`, overlay dismiss
between the 15 s and 20 s screencap. The loading overlay ("BAYVIEW … PREPARING", no progress
detail) stays up through the whole gap.

Thread attribution during the gap (run 3 `top -H`): **SDLThread pegged 87–112 %**, plus
`mali-compiler` threads (Mali shader/pipeline compilation on CPU) and `V8 DefaultWorker`
threads active during the load phase. No other thread is the bottleneck; the work is
synchronous on the main loop.

So: real asset/world load is 1.0–2.4 s. The other ~12–14 s is a single synchronous stall
between first frame and steady rendering — consistent with first-use WebGPU pipeline
compilation + 346 MB texture upload + first-tick JS warmup, all serialized on SDLThread.
The user-reported "30 s" is this plus install/extract and a hotter device.

### F2 — Steady state: ~19 FPS, main-thread CPU-bound, zero batching

- Presents tick: 60 frames per ~3.15–3.4 s ⇒ **18.5–19 FPS** sustained, both runs.
- `top -H` steady state: **SDLThread alone at ~87–120 %**; RenderThread, GPU threads,
  mali-compiler all idle. The GPU is not the limiter; one CPU thread is saturated.
- `TN_RENDER_PROJECTION {"projecting":false,"reasonCode":"notWorthwhile","reason":"projecting
  would draw 835 of 835 candidates, which is not worth its own cost","sourceRenderables":835,
  "batches":0}` — 835 renderables submitted as individual draws; the batching/projection
  heuristic declined and ran nothing. (fox-native proved the same class of fix worth
  21.8→59.7 FPS at 2,358 meshes — see `docs/PRDs/native-performance-fixes/HANDOFF-native-visual-parity-2026-08-10.md`.)
- Web comparison is the user's report ("web looks fine"), not measured in this run.

### F3 — Heating: uncapped presentation + permanently pegged main thread

- The stale conformance build (§5) presented **120 FPS sustained on a static dark screen**
  (3 textures, 39 MB) — the runtime has no frame cap when content is cheap; fifo vsync at
  120 Hz is the only limit.
- In-game: SDLThread pegged ~100 % indefinitely at 19 FPS — sustained SoC draw with nothing
  idle. Battery temp rose 37.6→38.7 °C across ~15 min of probing; longer play compounds
  (prior lane memory records heat-soak to ~38–40 °C and thermal-LIGHT trips).

### F4 — Native loading overlay has no progress detail

Web shows per-asset progress; native shows only the static label "PREPARING" for the entire
15–20 s. The overlay is the only thing on screen through the F1 stall, so the game reads as
hung.

### F5 — Wrong-package trap (resolved, worth a guard)

`com.threenative.game` on this device is a **conformance harness build** (2026-08-23 22:44,
340 MB; logs `TN_CONFORMANCE_READY:31-hud-readout-updates`; dark screen, yellow "SCORE 0000"
HUD, 120 FPS). `fps-framework.apk` installs as `com.threenative.bayview`. Launching the wrong
package produces a plausible-looking but meaningless probe. The user deleted the bayview
install mid-session; `com.threenative.game` is still installed.

### F6 — Engine nits observed in the same logs

- `[Storage] Failed to create directory "/data/.local/share/mystral/storage": Permission
  denied` — storage path is not app-scoped on Android; localStorage then points at a
  directory that cannot be created.
- `THREE.Material: parameter 'map' has value of undefined` — 30+ warnings during town load.
- APK is 379 MB; size breakdown investigated separately (see PRD).

## What did NOT execute

- No web-lane FPS measurement this session (user states web is fine; unverified here).
- No iOS claim (no Apple hardware; xcrun absent).
- No profiler capture (simpleperf present at `/system/bin/simpleperf` but not run; thread
  attribution is from `top -H` sampling).
- SurfaceFlinger `--timestats` window returned splash/VRI layers only; the game's
  SurfaceView BLAST layer row was not captured — FPS numbers above are the runtime's own
  `TN_PRESENTS_TICK` counters, cross-checked against wall-clock screencaps.
