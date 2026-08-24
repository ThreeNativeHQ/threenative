# Mobile stability investigation — Bayview on Pixel 8 — 2026-08-23

Device: Pixel 8 (`37251FDJH0037Z`), Wi-Fi adb `192.168.1.192:5555`, Mali-G715, Vulkan backend,
V8 engine, display refresh **60 Hz** (`16666667` ns). Game: `sandbox/fps-framework` (Bayview),
`com.threenative.bayview`.

Reported symptoms: "UI is not rendering", "loading screen also not loading", "it's also freezing".

Every number below was executed on the physical device. Nothing here is inferred from a
simulator, an emulator, or a desktop run.

---

## Summary

| # | Finding | Status |
| --- | --- | --- |
| 1 | Landscape orientation | **Not a bug** |
| 2 | HUD and loading screen absent on native | **Confirmed, architectural** |
| 3 | Asset health report kills any build using `EXT_texture_webp` | **Fixed** `36831d96` |
| 4 | Runtime had no GPU memory accounting | **Fixed** `d6e21511` |
| 5 | 18.3 FPS, evenly paced | **Confirmed by two independent instruments** |
| 6 | Frame is CPU-bound in JS, not GPU-bound | **Measured** |
| 7 | 393 MB of GPU resources requested, 849 MB held by the driver | **Measured** |
| 8 | SIGSEGV ×3 | **Intermittent, not reproducible on demand** |
| 9 | Android APK is not reproducible from the repo | **Confirmed** |
| 10 | A published install cannot build for Android at all | **Confirmed** |
| 11 | Render loop keeps running with the screen off | **Confirmed** |

---

## 1. Orientation — not a bug

`threenative.config.ts` declares `display.orientation: "landscape"`. The APK manifest carries
`android:screenOrientation=0` (`SCREEN_ORIENTATION_LANDSCAPE`) plus `TN_ORIENTATION` metadata, and
a live screencap while the activity was resumed came back **2400×1080 landscape** with the scene
rendering correctly.

The first capture I took was black and portrait. That was my error, not the app's: it was taken
before the surface had presented. Ruled out.

## 2. The HUD and loading screen genuinely are not in the native build

Verified against the APK actually installed on the phone (pulled from
`/data/app/…/base.apk`, not a stale local artifact — `dist-native/bayview.apk` was from 11:27
while the phone ran the 18:08 `fps-framework.apk`):

```
LOADING occurrences:    0
createRoot occurrences: 0
```

Cause is structural, not a regression. `threenative.config.ts` sets `nativeEntry: "src/game.ts"`,
while every UI piece — `Hud`, `DebugOverlay`, `GameCanvas`, `Minimap`, `TouchOverlay` — mounts from
`src/main.ts` through React DOM, which the native host never executes. The loading readout is
`Hud.tsx:243` (`LOADING ${assetsLoaded} / ${assetsTotal}`), so it disappears for the same reason.

This is a decided position, not an accident:

- `PRD-051` chose candidate **D**: `@threenative/ui` stays web-only, the framework ships no native
  HUD abstraction.
- `PRD-055` reopened it with a real game's evidence and sits in
  `docs/PRDs/BLOCKED/requires-touch-evidence/`. It recommends "**G now, E next**" — G is generated
  `src/render/hud.ts` template source, E is the framework shipping portable screen-space text and
  nothing else.
- Only the `minimal` template ships a `src/render/hud.ts` today (69 lines, a 5×7 bitmap font drawn
  as an `InstancedMesh` of quads — portable because it is geometry).
- Conformance rows `25-camera-parented-overlay`, `30-screen-space-text` and `31-hud-readout-updates`
  are all marked `implemented` and `required` in `conformance/registry.json`.

**Decision taken this session (João):** reopen as framework work in `packages/`, not as a per-game
workaround. That maps to PRD-055 candidate **E**.

## 3. Asset health report killed the Android build — FIXED

`packages/assets/src/health.ts` built its reader with a bare `new NodeIO()`, while
`packages/assets/src/passes/model.ts` registers `ALL_EXTENSIONS` via `createIo()`. glTF-Transform
refuses any document whose `extensionsRequired` names an extension the reader was not told about,
so an ordinary `EXT_texture_webp` export threw:

```
TN_ASSETS_MODEL_UNREADABLE: could not parse 'models/enemy-terrorist.glb' for the health report:
Missing required extension, "EXT_texture_webp".
```

The consequence was a dead build lane, not a bad report: `threenative build --target android`
compressed every texture and then exited 1 before Gradle ran. A report that only *measures* was
deciding whether builds run.

Fix: register `ALL_EXTENSIONS`. Red test added at `packages/assets/__tests__/health.spec.ts:378`,
then green — 13/13, including the existing "refuse an unreadable model" case, so genuinely broken
files still fail closed. Commit `36831d96`.

## 4. The runtime now reports GPU memory — NEW CAPABILITY

Nothing in `runtime-native` had ever reported how much GPU memory a game holds, so "the process is
using 1.6 GB" had no answer inside the engine. Every texture and buffer the WebGPU bindings create
is now measured and emitted beside the present tick, bucketed by dimensions/format and usage bits.
Commit `d6e21511`. Package suite after the change: **356 passed, 31 skipped, 0 failed**.

That commit also repairs one pre-existing red: `runtime-next-contract.test.mjs` asserted the exact
`androidDeps` array, which `62fac4d5` changed by adding `'webp-source'` without updating the test.

## 5. 18.3 FPS — confirmed, and evenly paced

Two independent instruments agree:

| Instrument | Reading |
| --- | --- |
| `TN_PRESENTS_TICK` (engine) | 60 frames per 3.27 s → **18.3 fps** |
| `dumpsys SurfaceFlinger --timestats` (compositor) | `totalFrames = 366` over ~20 s → **18.3 fps** |

The compositor also reports `droppedFrames = 0`, `jankyFrames = 0`. **This is why it does not look
like 18 fps on the device** — it is evenly paced, not stuttering, and an even 18 fps on a
slow-moving scene reads as "soft" rather than "broken". The display ceiling is 60, not 120.

`frames` and `presents` match exactly at every tick (600/600, 660/660, …) under `fifo` vsync, so
every counted frame really reaches the screen.

## 6. The frame is CPU-bound in JavaScript, not GPU-bound

From a build with `-PthreenativeJsProfile=true` (`TN_ANDROID_JS_NATIVE`), at 54.6 ms/frame:

| Component | ms | share |
| --- | --- | --- |
| JS→native WebGPU bindings | ~5.5 | 10% |
| Submit poll | ~0.7 | 1% |
| Present wait (GPU) | ~10.9 | 20% |
| **Unaccounted — JS/CPU outside the render bindings** | **~37** | **68%** |

The game's own `src/perf.ts` sections, logged on device for the first time
(`TN_FRAME_STATS`, 1799 frames):

```json
{"frames":1799,"p50":3.72,"p95":65.75,"p99":75.68,"worstMs":27489.89,
 "spikes":395,"playSpikes":376,"playFrames":1709,
 "peaks":{"effects":1.01,"audio":0.23,"player":0.32,"enemies":87.87,"state":0.22,
          "outsideGame":135.77,"gameFrame":88.22,"physics":3.67},
 "sectionP99":{"effects":0.21,"audio":0.11,"player":0.12,"enemies":5.13,"state":0.07,
               "gameFrame":5.72,"physics":1.25,"outsideGame":65.87}}
```

Two things stand out:

1. **`outsideGame` p99 = 65.87 ms against `gameFrame` p99 = 5.72 ms.** The game's own code is not
   the problem by an order of magnitude. `outsideGame` is everything between frame callbacks —
   the physics step, the scene projection and the draw — i.e. the engine side.
2. **The distribution is bimodal**: p50 = 3.72 ms but p95 = 65.75 ms, with 376 spikes in 1709 play
   frames (**22%**). It is not uniformly heavy work; it is mostly-fast frames punctuated by very
   slow ones, averaging out to 18 fps.

Caveat, stated rather than glossed: `p50 = 3.72 ms` is below the 16.67 ms vsync floor, which means
`markFrame` is being called more often than once per presented frame — most likely once per
fixed-step simulation step (`maxSteps` defaults to 5). So the percentiles are per-callback, not
per-presented-frame, and the *ratio* between sections is trustworthy while the absolute p50 is not
a frame time. `worstMs: 27489.89` (a 27-second sample) also needs explaining before it is trusted.

**This is the open thread.** The next measurement is a CPU profile of `outsideGame`, not more
texture work.

## 7. GPU memory — 393 MB requested, 849 MB held

From `TN_GPU_TEXTURES` / `TN_GPU_BUFFERS` on device:

| Source | Amount |
| --- | --- |
| Textures (72) | **379 MB** |
| Buffers (2,976) | **14 MB** |
| Game total | **393 MB** |
| `GL mtrack` (driver) | **849 MB** |
| `Graphics` total / process RSS | 911 MB / 1.5–1.6 GB |

Top texture buckets:

| Bucket | n | MB |
| --- | --- | --- |
| `1536x1536x6 rgba8unorm-srgb` | 1 | 54 |
| `1536x2048 rgba16float` | 2 | 48 |
| `2048x2048 rgba8unorm-srgb mips12` | 2 | 42 |
| `1024x1024 rgba8unorm mips11` | 8 | 42 |
| `1024x1024 rgba8unorm-srgb mips11` | 7 | 37 |
| `3072x1536 rgba8unorm-srgb mips12` | 1 | 23 |
| `2400x1080 depth24plus` | 2 | 19 |
| `2400x1080 rgba16float` | 1 | 19 |
| `2048x2048 depth24plus` | 1 | 16 |
| `512x512 rgba8unorm mips10` | 12 | 15 |

Buffers are a non-issue: 14 MB across 2,976 allocations, 12 MB of it vertex data.

Two separate problems here:

- **The game asks for too much.** `src/render/sky.ts` assigns the 3072×1536 equirect JPEG to both
  `scene.background` and `scene.environment`. That produces the 54 MB cubemap (background
  conversion) *and* 48 MB of `rgba16float` PMREM scratch (IBL). Beyond that, ~146 MB sits in
  uncompressed 1024²/2048²/512² textures that would be roughly 18 MB as ETC2/ASTC.
- **The driver more than doubles it**, 393 MB → 849 MB. That amplification is a wgpu/Mali
  allocation behaviour and deserves its own investigation.

### Measured experiment — IBL off

Commenting out `scene.environment = environment` alone:

| | baseline | IBL off |
| --- | --- | --- |
| FPS | 18.3 | **24.8** (+38%) |
| Textures | 379 MB | 331 MB |
| `GL mtrack` | 849 MB | 738 MB |

This corrected an inference of mine: the 54 MB `1536x1536x6` cubemap **survives** with IBL off, so
it is the background equirect→cubemap conversion, not PMREM. IBL's own cost is the 48 MB of
`rgba16float` scratch plus per-pixel environment sampling in every PBR material.

Real, but secondary given finding 6.

## 8. The SIGSEGV — intermittent, not on demand

`dumpsys activity exit-info` recorded three crashes, all `reason=2 (SIGNALED) status=11` (SIGSEGV):

```
18:32:41  pid 22109
18:37:31  pid 22737   (49 s after launch)
18:40:03  pid 23011   (93 s after launch)
```

A fourth exit at 18:34:56 was `reason=10 (USER REQUESTED)` with **`rss=2.3GB`**.

Hypotheses tested and **rejected**:

- *Screen-off / surface destroyed* — the app survived a full 60 s with the screen off via
  `KEYCODE_SLEEP`, no crash, no death evidence in `logcat -b all`.
- *A growing leak* — `GL mtrack` is bit-identical across samples (`848124` KB), so the allocation
  is one-time, not per-frame.
- *Round-clock restart* — the round is 1:45; the app later ran clean well past several rounds.

An unattended run then survived **10 min 44 s** and died only to my own `am force-stop` (signal 9).
No tombstone was written for any of the three crashes.

Best current reading: all three happened while relaunching on top of a still-winding-down 1.5 GB
instance. An unchecked native allocation failure under memory pressure produces exactly
`SIGNALED/11` with no tombstone. **Not proven** — stated as the leading hypothesis, not a
conclusion.

## 9. The Android APK is not reproducible from this repo

The `.ogg` files inside the working installed APK begin `52494646` — **`RIFF`**, i.e. WAV data
under an `.ogg` extension. The repo's `public/` files begin `4f676753` — **`OggS`**, genuine Ogg.
Someone hand-transcoded a staging copy that is not in the repository.

`packages/runtime-native/scripts/asset-preflight.mjs` states outright that it "does not transcode"
— it detects and prints `ffmpeg`/`gltf-transform` commands. So a working Android build depends on a
manual out-of-band step nobody recorded. Building with the repo's real assets produces:

```
TN_NATIVE_START_FAILED: decodeAudioData could not decode the supplied audio.
```

I reproduced the staging copy by hand (`ffmpeg` over 30 files) to get instrumentation onto the
device at all.

Related: preflight rejects webp for Android claiming "the android runtime is built without
libwebp", while the device logs `[Mystral] WebP format support: YES`. That check is stale relative
to `62fac4d5`.

## 10. A published install cannot build for Android

Two independent blockers:

1. The sandbox's installed `@threenative/runtime-native@0.2.0` contains **zero** occurrences of
   `THREENATIVE_RUNTIME_SOURCE`, so the PRD-196 source-checkout escape hatch is unreachable. The
   build falls through to downloading a GitHub release that has never been published:
   `Prebuilt release manifest fetch failed for 'android-arm64-v8a-runtime': HTTP 404`.
2. Packing the current `0.3.0` from the engine and installing it fails because `catalog:` protocol
   specifiers leak into the published tarball. npm itself reports: *"This is likely a bug in the
   publishing automation of this package."*

Working around both is what made this session's device builds possible: drive the engine's own
`package-android.mjs` directly with `THREENATIVE_RUNTIME_SOURCE` pointed at `packages/runtime-native`.

## 11. The render loop runs with the screen off

`packages/runtime-native/src/` handles `SDL_EVENT_WINDOW_FOCUS_GAINED`, `WINDOW_RESIZED`,
`WINDOW_RESTORED` and `WINDOW_SHOWN` — only the resume half. There is no handling of
`WINDOW_HIDDEN`, `WINDOW_MINIMIZED`, `FOCUS_LOST`, `DID_ENTER_BACKGROUND` or `WINDOW_DESTROYED`.

Confirmed on device: frames kept being presented for the full 60 s the screen was off. A battery
bug, independent of the crash.

---

## Commits from this session

| Commit | Change |
| --- | --- |
| `36831d96` | `fix(assets)` — health report reads models requiring a glTF extension |
| `d6e21511` | `feat(runtime-native)` — GPU texture/buffer accounting on the present tick; stale `androidDeps` assertion repaired |

## Instrumentation added

- `packages/runtime-native/src/webgpu/bindings.cpp` — `TN_GPU_TEXTURES`, `TN_GPU_BUFFERS`, and
  `textureMB`/`bufferMB` on `TN_PRESENTS_TICK`. Committed; permanent.
- `sandbox/fps-framework/src/gpuMemoryProbe.ts` — scene texture walk plus `TN_FRAME_STATS`.
  **Temporary; delete when this closes.** Registered in `src/game.ts`.

## What is NOT yet done

- The 18.3 FPS is **diagnosed, not fixed**. `outsideGame` p99 = 65.87 ms needs a CPU profile.
- The native HUD (PRD-055 candidate E) is **decided, not started**.
- The SIGSEGV root cause is a leading hypothesis, **not proven**.
- Findings 9, 10 and 11 are **recorded, not fixed**.

## Device lane notes

- Wi-Fi adb requires `adb tcpip 5555` over USB first; the cable can then be pulled.
- `adb logcat -G 16M` before any session, or early markers evict.
- A `WAKEUP` keyevent every few seconds keeps the screen from dozing mid-measurement.
- `dumpsys activity exit-info <pkg>` gives the signal for a process that vanished; it beats hunting
  for a tombstone that may never have been written.
- `dumpsys SurfaceFlinger --timestats -enable` / `-dump` is an FPS source independent of the engine.
