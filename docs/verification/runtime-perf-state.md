# Runtime & core performance — the single state record

**Policy (owner, 2026-08-27):** this file is the one performance record for the native runtime and
`packages/core`. New performance findings **update this file in place**; they do not open a new
`docs/verification/prd-*-perf-*.md` file. (The one-file-per-run rule in `docs/PRDs/AGENTS.md`
keeps applying to everything that is not a runtime/core performance record.)

The 35 superseded performance reports were deleted 2026-08-27; their full text is recoverable from
git history (`git log --diff-filter=D --name-only -- docs/verification/` names the commit, then
`git show <commit>^:docs/verification/<file>`). §8 indexes what each one concluded. A claim whose
detail is not in this file exists only in git — quote it with the commit.

---

## Android: the GPU meter reports on a Pixel 8 — 2026-09-01

**First GPU reading taken from a phone by the instrument rather than by ablation arithmetic.**
Pixel 8 (`shiba`), adapter **Mali-G715**, Android first proof (`examples/native-smoke`), 300
frames, 1080x2400 at `resolutionScale 1`, `sampleCount 4`, over Wi-Fi adb.

| window | fps | gpuMs | render p50 | residual share |
| --- | ---: | ---: | ---: | ---: |
| 1 | 41.29 | **0.19** | 2.72 ms | 0.602 |
| 2 | 41.89 | **0.19** | 2.95 ms | — |

The device granted `timestamp-query`, and now says so on the path a game takes:

```
TN_WEBGPU_FEATURES:{"timestamp-query":true,"texture-compression-bc":false,
  "texture-compression-etc2":true,"texture-compression-astc":true,
  "indirect-first-instance":false,"rg11b10ufloat-renderable":false}
```

**Read 0.19 ms as "the meter works", not as a game's GPU cost.** The first proof is a near-empty
scene whose frame is 60 % `residual`; attributing a real game's GPU time on the phone is PRD-308,
which this unblocks. **The phone was on the charger** (level 65 → 72 %, battery 30.1 °C, thermal
status 0), so no fps figure here is comparable to the unplugged 59.99–60.02 fps template baseline
above, and none is claimed to be.

Full record, including the feature-array bound that could silently have dropped
`core-features-and-limits` on a device advertising all three compression formats:
[`gpu-meter-on-android-2026-09-01`](gpu-meter-on-android-2026-09-01.md).

---

## Browser WebGPU: a TSL post chain, and the scaler's fps signal — 2026-08-30

Lane: browser/WebGPU, `sandbox/lumen-hall` (gothic cathedral, five-stage TSL chain: SSGI +
denoise, godrays, SSR, bloom, AgX). Machine: Linux `7.1.4-1-cachyos`, NVIDIA RTX 2080 (Turing),
Chromium via Playwright with the repo's `webgpu` recipe plus `--disable-gpu-vsync
--disable-frame-rate-limit`, private Xvfb 1920x1080x24, viewport 1600x900. Adapter named in every
run: `nvidia` / `turing`.

**Fixture rule this round paid for.** The scene was measured against a `pnpm dev` server that three
other agents were editing at the same time; vite HMR reloaded the page mid-capture and the reload's
pipeline rebuild landed inside the window as a 174-texture, 117-pipeline burst. Every number below
comes instead from a static `vite build` of a source snapshot, served by a private
`python3 -m http.server`, with `renderer.resolutionScale` pinned to 1 in the snapshot's config so
the adaptive scaler cannot move the surface between arms. **A dev server that another agent can
edit is not an A/B fixture.**

### Per-stage attribution, by GPU time

`gpuMs` (three's `timestamp-query`, reported in every `TN_FRAME_BUDGET` window) is the honest
meter here and `render.p50` is not: the CPU render phase is ~5.5 ms while the GPU frame is
~14.7 ms, so the GPU is the limiter by 3x and the CPU only discovers it when `queue.submit` blocks.
Window 1 discarded; median and range over the remaining steady windows of two 40 s runs each.

| config | gpuMs median | gpuMs range | fps median | `queue.submit`/frame |
| --- | --- | --- | --- | --- |
| all stages | 14.7 | 13.4–17.5 | 56.8 | 48 |
| minus ssgi+denoise | 5.5 | 2.3–12.7 | 126.3 | 46 |
| minus ssr | 10.6 | 9.2–16.7 | 77.0 | 34 |
| minus godrays | 14.7 | 13.8–16.7 | 57.1 | 46 |
| minus bloom | 10.1 | 9.1–23.1 | 72.4 | 24 |
| minus denoise only | 12.8 | 12.0–14.3 | 60.3 | 48 |
| all stages off | 2.2 | 2.1–12.0 | 333.3 | 6 |

`minus denoise only` splits the largest stage: the two full-resolution denoise passes over the AO
and GI terms are ~1.9 ms and the SSGI gather itself is ~7.3 ms, at `medium` (2 slices x 8 steps).

Scene, shadow map and overlay together cost **2.2 ms** of GPU. The post chain costs **12.5 ms** —
SSGI+denoise ~9.2, bloom ~4.6, SSR ~4.1, godrays **~0.0** (the individual costs oversum because
removing SSGI also removes the denoise passes the later stages sample). Draw calls peak at 561 and
are not a factor. Two other agents were capturing on the same GPU throughout, which is what the
ranges are for; `submit`-per-frame and `writeBuffer`-per-frame were bit-identical across reps and
are the structural numbers to quote.

### The p99 tail is GPU back-pressure, not recompiles or reallocation

Per-frame instrumentation of `GPUDevice`/`GPUQueue` (injected before app boot) shows **zero**
pipeline, shader, texture, buffer or bind-group creation per frame at steady state. The tail is
48 `queue.submit` and 142 `queue.writeBuffer` calls a frame against a 14.7 ms GPU frame: the CPU
runs ahead, then one frame in ~71 blocks for 650–870 ms **inside `queue.submit`** (measured
`submitMs` 1300–1670 ms on those frames against 1.19 ms on ordinary ones) while the queue drains.
The stall period tracks `writeBuffer` volume — ~10,200 calls between stalls in both the all-stages
arm (71 frames x 142) and the all-off arm (147 frames x 70) — not frame count or submit count.
Separately, the first two windows carry 700–2800 ms stalls that *are* pipeline builds.

### The adaptive scaler over-corrected on a startup window — fixed

The second 300-frame window is where three finishes building pipelines for the chain. Four of its
300 frames took ~1.94 s each: **under the 2 s `hitchMs`**, so each stayed in the window and went
into the mean. The window reported **22.6 fps** beside a **presented p50 of 9.8 ms** (102 fps).
`ResolutionScaler` reads `fps`, which is `1000 / presented.mean`, computed a 2.6x deficit, took its
maximum four-rung jump, and the game then held 145 fps at **832x468** for the next forty seconds —
and climbs back at four windows a rung. The down-step is also the wrong medicine for this cause:
the resize reallocates every render target, which rebuilds pipelines.

Fix: `RESOLUTION_SCALER.stallP99Multiple = 10`. A window whose presented p99 is ten or more times
its p50 is measuring a stall, not a frame rate; the controller defers on it in both directions
rather than stepping or counting it clean. The regimes are far apart — a vsync-capped panel
dropping frames sits near 2, a simply-slow game near 1, this window at 200. Reported `fps` is
unchanged; only what the controller acts on changed.
Red/green: `packages/core/__tests__/resolution-scaler-outlier.spec.ts`. Deleting the
`if (this.#stalled(window))` guard from `observe()` fails two of its five cases (`expected 0.72 to
be undefined`, `expected 0.44 to be 0.61`); the other three, which prove a genuinely slow game and
a vsync-capped panel still step down, pass either way and are the mutation's control.

### Tried and not worth it: freezing the shadow map

The sun and the building are both static, so `sun.shadow.autoUpdate = false` should remove a
4096x4096 depth pass per frame. Three 30 s reps each of the baseline and the frozen variant yielded
only one and two steady windows respectively under concurrent GPU load — `gpuMs` 14.62 against
15.29–18.26, which is noise, not a win. It is not worth re-measuring: the entire scene, shadow and
overlay pass is 2.2 ms of a 14.7 ms GPU frame, so no shadow-map change can win more than 15% of the
frame even in principle, and the post chain holds the other 85%.

### Open, not fixed

- **`display.maxFps` caps nothing on web.** It is read only by `ResolutionScaler`
  (`packages/core/src/game.ts:800`); the loop renders every rAF. Native has a present cap
  (`capHz`), web has none, so a game declaring 60 runs at whatever the compositor allows and the
  GPU never idles. Design question, not filed.
- **`trackTimestamp` overruns three's query pool.** `renderer.resolveGpuFrame()` is called once per
  300-frame window (`game.ts:817`) while `trackTimestamp: true` (`renderer.ts:374`) writes two
  queries per pass every frame. With 48 passes the 2048-query pool fills in ~21 frames, three warns
  `Maximum number of queries exceeded`, and the reported `gpuMs` is one early frame of the window
  rather than a window statistic. The number is usable — it matched the ablation — but it is not
  what the field's doc comment says it is.

---

## PRD-230 pre-move desktop baseline — 2026-08-29

This is the comparison baseline for splitting `src/webgpu/bindings.cpp`, captured before the first
rename at clean source SHA `df797b7cac5e0a211f5d32c6cd522ecfc101d36e`. The external Bayview
sandbox used by earlier runtime work was not present on this machine, so this round uses the
in-repository `examples/native-smoke` bundle and shipping desktop host as its reproducible A/B
fixture. Later PRD-230 measurements must use this same fixture and command. This is desktop/Xvfb
evidence; fps is present-throttled and is not a verdict.

Machine state: Linux `7.1.4-1-cachyos`, AMD Ryzen 9 5900X (12 cores / 24 threads), NVIDIA GeForce
RTX 2080 TU104, Xvfb 1600×900×24 on `DISPLAY=:97`, SDL X11, Dawn FIFO present with vsync enabled.
The game surface reported 1280×720, resolution scale 1 pinned, and 4× samples.

```sh
DISPLAY=:97 SDL_VIDEODRIVER=x11 node packages/playtest/dist/runner/cli.js perf \
  --executable packages/runtime-native/build/tn-linux/mystral \
  --host-arg run --host-arg examples/native-smoke/dist/native-smoke.js \
  --require-windows 2 --timeout 900 --text
```

The harness captured three 300-frame windows and discarded window 1 as startup. Both steady
windows passed. Window 2/3 `render.p50` was **1.3 / 1.2 ms** (`render.p95` 1.8 / 1.7 ms), and
`hostGap.p50` was 30.4 / 29.9 ms. The last window reported GPU time 0.72 ms. The last host-gap
window is the fixed share baseline used by PRD-230's two-point guard:

| required sub-phase | p50 ms | share of the six required sub-phases |
| --- | ---: | ---: |
| `frameDrain` (`drain`) | 0.002 | 0.007% |
| `frameReplay` (`replay`) | 0.234 | 0.787% |
| `present` | 28.498 | 95.866% |
| `gpuDrain` | 0.000 | 0.000% |
| `devicePoll` (`poll`) | 0.992 | 3.337% |
| `endFrameOther` (`other`) | 0.001 | 0.003% |

The pre-split incremental compile measurement touched only `bindings.cpp` and rebuilt the shipping
`mystral` target. zsh reported **17.09 s** for compile plus archive/link:

```sh
touch packages/runtime-native/src/webgpu/bindings.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel
```

### PRD-230 Phase 1 — handler identifiers only

After all 87 numbered handler identifiers were renamed, the same command on the same machine
produced steady `render.p50` **1.3 / 1.2 ms**, unchanged from baseline. The last host-gap window
measured `frameDrain` 0.002 ms (0.007%), `frameReplay` 0.226 ms (0.761%), `present` 28.504 ms
(95.918%), `gpuDrain` 0.000 ms (0.000%), `devicePoll` 0.985 ms (3.315%), and `endFrameOther`
0.000 ms (0.000%). The largest share shift was **0.052 percentage points** (`present`), below the
two-point rejection threshold. The run captured three windows, discarded startup, and passed.

### PRD-230 Phase 2 — cohesive `BindingsState`

After the flat state became `ResourceRegistries`, `PresentationState`, `FrameProfiling`,
`ScreenshotCapture`, and `Canvas2DComposite`, the same command and machine produced steady
`render.p50` **1.2 / 1.2 ms**, no rise from the baseline's final steady window. The last host-gap
window measured `frameDrain` 0.002 ms (0.007%), `frameReplay` 0.226 ms (0.759%), `present` 28.571
ms (95.944%), `gpuDrain` 0.000 ms (0.000%), `devicePoll` 0.979 ms (3.288%), and `endFrameOther`
0.001 ms (0.003%). The largest share shift from the pre-move baseline was **0.078 percentage
points** (`present`), below the two-point rejection threshold. The run captured three windows,
discarded startup, and passed.

### PRD-230 Phase 3.1 — Canvas2D compositor translation unit

After `compositeCanvas2DToWebGPU` moved byte-for-byte into its own translation unit, the first
sample produced steady `render.p50` **1.5 / 1.5 ms**, outside the two-percent comparison guard, and
was rejected. That sample's last required host-gap values were `frameDrain` 0.003 ms,
`frameReplay` 0.306 ms, `present` 34.988 ms, `gpuDrain` 0.000 ms, `devicePoll` 1.035 ms and
`endFrameOther` 0.001 ms.

After the full parity workload completed and the machine returned idle, an immediate repeat with
the identical command produced steady `render.p50` **1.0 / 1.0 ms**, below the baseline. Its last
required host-gap window measured `frameDrain` 0.001 ms (0.004%), `frameReplay` 0.144 ms (0.561%),
`present` 24.629 ms (95.881%), `gpuDrain` 0.000 ms (0.000%), `devicePoll` 0.913 ms (3.554%) and
`endFrameOther` 0.000 ms (0.000%). The largest share shift from the pre-move baseline was **0.217
percentage points** (`devicePoll`), below the two-point rejection threshold. The accepted run
captured three windows, discarded startup, and passed.

Touching only `bindings_canvas2d_composite.cpp` and rebuilding serially measured **22.32 s** for
compile plus archive/link. That is slower than the 17.09 s monolith baseline, so this first surface
split has not yet demonstrated the PRD's incremental-compile payoff. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_canvas2d_composite.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.2 — screenshot translation unit

After screenshot accessors and `captureFrameScreenshot` moved into their own translation unit, the
same command and machine produced steady `render.p50` **1.0 / 1.0 ms**, below the baseline. The last
required host-gap window measured `frameDrain` 0.001 ms (0.004%), `frameReplay` 0.133 ms (0.523%),
`present` 24.400 ms (95.957%), `gpuDrain` 0.000 ms (0.000%), `devicePoll` 0.894 ms (3.516%) and
`endFrameOther` 0.000 ms (0.000%). The largest share shift from the pre-move baseline was **0.264
percentage points** (`frameReplay`), below the two-point rejection threshold. The run captured
three windows, discarded startup, and passed.

Touching only `bindings_screenshot.cpp` and rebuilding serially measured **5.04 s** for compile
plus archive/link, down 70.5% from the 17.09 s monolith baseline. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_screenshot.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.3 — presentation translation unit

After surface acquire, resize, sRGB bridge, presentation pacing and present reporting moved into
their own translation unit, the same command and machine produced steady `render.p50` **1.0 / 1.0
ms**, below the baseline. The last required host-gap window measured `frameDrain` 0.001 ms
(0.004%), `frameReplay` 0.121 ms (0.491%), `present` 23.619 ms (95.888%), `gpuDrain` 0.000 ms
(0.000%), `devicePoll` 0.891 ms (3.616%) and `endFrameOther` 0.000 ms (0.000%). The largest share
shift from the pre-move baseline was **0.296 percentage points** (`frameReplay`), below the
two-point rejection threshold. The run captured three windows, discarded startup, and passed.

Touching only `bindings_presentation.cpp` and rebuilding serially measured **6.05 s** for compile
plus archive/link, down 64.6% from the 17.09 s monolith baseline. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_presentation.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.4 — resource translation unit

After buffer, texture, texture-view and sampler bindings moved into their own translation unit,
the same command and machine produced steady `render.p50` **1.0 / 1.0 ms**, below the baseline.
The last required host-gap window measured `frameDrain` 0.001 ms (0.004%), `frameReplay` 0.132 ms
(0.522%), `present` 24.275 ms (95.949%), `gpuDrain` 0.000 ms (0.000%), `devicePoll` 0.892 ms
(3.526%) and `endFrameOther` 0.000 ms (0.000%). The largest share shift from the pre-move baseline
was **0.265 percentage points** (`frameReplay`), below the two-point rejection threshold. The run
captured three windows, discarded startup, and passed.

Touching only `bindings_resources.cpp` and rebuilding serially measured **5.83 s** for compile plus
archive/link, down 65.9% from the 17.09 s monolith baseline. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_resources.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.5 — pipeline translation unit

After shader modules, pipeline layouts, bind groups and compute/render pipelines moved into their
own translation unit, the same command and machine produced steady `render.p50` **1.0 / 1.0 ms**,
below the baseline. The last required host-gap window measured `frameDrain` 0.001 ms (0.004%),
`frameReplay` 0.132 ms (0.520%), `present` 24.348 ms (95.953%), `gpuDrain` 0.000 ms (0.000%),
`devicePoll` 0.893 ms (3.519%) and `endFrameOther` 0.000 ms (0.000%). The largest share shift from
the pre-move baseline was **0.267 percentage points** (`frameReplay`), below the two-point rejection
threshold. The run captured three windows, discarded startup, and passed.

Touching only `bindings_pipelines.cpp` and rebuilding serially measured **8.13 s** for compile plus
archive/link, down 52.4% from the 17.09 s monolith baseline. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_pipelines.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.6 — command translation unit

After render-bundle, query-set, command-encoder, render-pass and compute-pass bindings moved into
their own translation unit, the same command and machine produced steady `render.p50`
**0.7 / 0.9 ms**, below the baseline. The last required host-gap window measured `frameDrain`
0.002 ms (0.007%), `frameReplay` 0.216 ms (0.810%), `present` 25.855 ms (96.951%), `gpuDrain`
0.000 ms (0.000%), `devicePoll` 0.595 ms (2.231%) and `endFrameOther` 0.000 ms (0.000%). The
largest share shift from the pre-move baseline was **1.106 percentage points** (`devicePoll`),
below the two-point rejection threshold. The run captured three windows, discarded startup, and
passed.

Touching only `bindings_commands.cpp` and rebuilding serially measured **19.29 s** for compile plus
archive/link, 12.9% slower than the 17.09 s monolith baseline. This 1,681-line surface does not
show a compile-time payoff; the measurement is retained as the Phase 4 comparison input. The exact
command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_commands.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.7 — frame-stream translation unit

After packed frame-operation replay moved into its own translation unit, the first sample produced
steady `render.p50` **1.3 / 1.3 ms** and was rejected: an unrelated Playwright SwiftShader process
was consuming about 850% CPU and machine load was 28.81. After that workload exited, the same
command produced steady `render.p50` **1.2 / 1.2 ms**, no rise from the baseline's final steady
window. The accepted last required host-gap window measured `frameDrain` 0.002 ms (0.006%),
`frameReplay` 0.330 ms (1.012%), `present` 31.550 ms (96.741%), `gpuDrain` 0.000 ms (0.000%),
`devicePoll` 0.730 ms (2.238%) and `endFrameOther` 0.001 ms (0.003%). The largest share shift from
the pre-move baseline was **1.099 percentage points** (`devicePoll`), below the two-point rejection
threshold. The accepted run captured three windows, discarded startup, and passed.

Touching only `bindings_frame_stream.cpp` and rebuilding serially measured **8.04 s** for compile
plus archive/link, down 53.0% from the 17.09 s monolith baseline. The exact command was:

```sh
touch packages/runtime-native/src/webgpu/bindings_frame_stream.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

### PRD-230 Phase 3.8 and Phase 4 — retained bindings surface and final comparison

The retained `bindings.cpp` is 2,937 lines after all seven actual moves, down 4,933 lines (62.7%)
from the measured 7,870-line start. Touching only it and rebuilding serially measured **9.50 s**
for compile plus archive/link, down 44.4% from the 17.09 s baseline:

```sh
touch packages/runtime-native/src/webgpu/bindings.cpp
TIMEFMT='elapsed_seconds=%E'; time cmake --build \
  packages/runtime-native/build/tn-linux --target mystral --parallel 1
```

| final edit surface | compile plus archive/link | change from 17.09 s |
| --- | ---: | ---: |
| Canvas2D compositor | 22.32 s | +30.6% |
| screenshot | 5.04 s | -70.5% |
| presentation | 6.05 s | -64.6% |
| resources | 5.83 s | -65.9% |
| pipelines | 8.13 s | -52.4% |
| commands | 19.29 s | +12.9% |
| frame stream | 8.04 s | -53.0% |
| retained bindings | 9.50 s | -44.4% |

Final steady `render.p50` was **1.2 / 1.2 ms** versus **1.3 / 1.2 ms** before the refactor. The
largest required host-gap share shift was **1.099 percentage points**, below the two-point guard.
This remains desktop/Xvfb evidence; no physical Pixel 8 was connected, so **no device result is
claimed**.

### Post-merge reconciliation — 2026-08-29

After merging current `main` at `7f84b1a4`, the identical native-smoke meter on the rebuilt
shipping host produced steady `render.p50` **1.0 / 1.2 ms**. The final host-gap window measured
`frameDrain` 0.003 ms, `frameReplay` 0.345 ms, `present` 32.003 ms, `gpuDrain` 0.000 ms,
`devicePoll` 0.696 ms and `endFrameOther` 0.001 ms. The largest required share shift from the
pre-move baseline was **1.231 percentage points** (`devicePoll`), below the two-point guard. This
is desktop/Xvfb evidence; the physical-device result remains a separate row.

### PRD-230 physical Pixel 8 lane — 2026-08-29

The post-split V8 APK ran the 500-mesh native-smoke subject on a physical Pixel 8 (`shiba`) over
Wi-Fi ADB while unplugged. The accepted APK had application id `com.threenative.game` and SHA-256
`3a743288c670c0598d754554da0969f20d124ca44959a4122ddcfd3ffcc35271`. Before measurement, the
300-frame first proof passed with clean logs and a nonblank 1080x2400 screenshot (SHA-256
`3bafc84d930a5886a7fd04c8a20496490819960fb910582ea018773962293fc3`).

After clearing logcat and discarding the startup window, `playtest perf --logcat` accepted seven
300-frame windows: **59.77–59.99 fps**, frame p50 **6.0–6.6 ms**, render p50 **4.8–5.3 ms**, render
p95 **6.8–7.4 ms**, and zero hitches. Every window used scale 1, 1080x2400, and 4x samples. Device
doctor reported thermal status `NONE` before and after, skin 36.7 -> 38.5 °C, battery 97 -> 96%,
and discharging throughout.

```sh
node packages/runtime-native/scripts/verify-android-first-proof.mjs \
  --device 192.168.1.192:5555 --skip-build --settle-ms 0 \
  --apk packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk
adb -s 192.168.1.192:5555 logcat -c
node packages/playtest/dist/runner/cli.js perf \
  --logcat 192.168.1.192:5555 --require-windows 4 --timeout 120 --text
```

The first Android compile exposed a refactor regression: `bindings_frame_stream.cpp` and
`bindings_resources.cpp` used `wgpuDevicePoll` without the wgpu-native extension declaration.
Commit `4ac7b273` added a red translation-unit contract and the conditional extension includes;
Android and desktop then rebuilt and all 30 enabled CTests passed. The dependency downloader still
rejects the pinned V8 artifact for 16 KB Android page compatibility. This Pixel reports a 4 KB page
size, so the binary is valid for this run; the separate 16 KB compatibility blocker remains open.

---

## 0. Native CPU attribution experiment — 2026-08-29

**Decision: STOP the bounded native transform experiment for now.** The clean browser data does
not make transform propagation large enough to justify a native kernel, and no native/bridge
synchronization cost was measured. Re-open only with a bounded hardware/native comparison that
measures packing, crossing, result application and synchronization end to end.

This is a browser software-rendering diagnostic. Chromium classified the adapter as
`architecture=swiftshader`, `vendor=google`, so these complete-render timings establish harness
behavior and relative scaling only. They are not a shipping GPU, Android, native, or frame-rate
claim. The collector records this as
`timing-only-browser-software-diagnostic`, rejects software rendering unless `--allow-software` is
explicit, and CPU-only rows zero the renderer counters rather than pretending that no render was
measured.

### Contract and clean inputs

The implementation preserves the Three.js public API and renderer behavior. It adds only a shared
deterministic workload contract, a collector option for CPU preparation versus complete rendering,
and the standalone example that exercises the contract. No native scene mirror, native kernel,
`SceneCollapse`, instancing, or per-property bridge was introduced.

The complete-render runs started from clean source SHA
`4e03ed73f4f14cdf379624294f220a6ee8ea4d52`; the CPU-only runs started from clean source SHA
`4ca8d2107254e0050fb56060de24f211698194ba`. Every raw report records `source.dirty=false`, the
branch, host CPU, Node version, OS, adapter metadata, evidence class, workload, and the complete
effective collector configuration in `arguments` (including both warm-up controls, matrix
selections, repeat/sample counts, rendering, adapter policy, browser, output and evidence settings)
alongside raw samples; the original invocation is retained separately as `argv`. The seeded unit
test also compares repeated IDs, parents, transforms and dirty sets byte for byte; alternating
visibility is deterministic and shares the same workload generator as the browser example.

### Repair round 1 — deep hierarchy population — 2026-08-29

The historical reports named below retain their raw data, but every run with
`scenario.hierarchy=deep` is **invalidated**. The example applied each generated transform as a
local transform and then parented the mesh, so transforms accumulated through the generated
parent chain. Flat rows are unaffected. Repair commit
`e214300dc474ad71bf66a5e5160ca9f201996d2a` uses `parent.attach(mesh)`, which preserves the
generated world-space placement while retaining the declared parent topology.

`assertWorkloadVisibilityPopulation()` is a fail-closed harness guard: before a profile run it
compares the frustum population with the workload's declared visibility population. Against the
unrepaired code the guard failed with `deep/all-visible expected 500, observed 177`; after the
repair, flat and deep 500-object rows both observed 500. The same guard also verifies the explicit
far-away populations for `mostly-culled` and `alternating`.

The clean repair rerun used headless Chromium on `DISPLAY=:0`. Chromium reported
`architecture=swiftshader`, so its evidence class remains
`timing-only-browser-software-diagnostic`; unrelated host CPU activity was present during the
collection. These are population and CPU-preparation diagnostics only, not hardware, native,
shipping-GPU, or frame-rate results. No native kernel, bridge crossing, or synchronization cost
was measured.

The full complete-render rerun was not accepted: the 180-frame 500-object attempt and the 180-frame
4,000-object attempt both stopped with Chromium's `Instance dropped in popErrorScope`. The clean
12-sample smoke probes at 500 and 4,000 objects are retained below as smoke artifacts only; they
do not establish steady-state complete-render performance. The CPU-only replacement completed all
requested deep rows with raw samples and per-run summaries:

`artifacts/native-cpu-profile/exp001-20260829-repair/cpu-only-deep/profile-1787989405731.json`

It records `source.dirty=false`, the repair SHA above, 36 runs, 6,480 raw samples, and the
`timing-only-browser-software-diagnostic` evidence class. The table pools the three repeats to 540
samples per row; values are milliseconds, shown as p50/p95. `frame` is the measured callback, not
a presented-frame time.

| objects | deep visibility | visible population | matrix propagation | bounds/cull | mutation | preparation frame |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 500 | all-visible | 500/500 | 0.000/0.100 | 0.018/0.025 | 0.000/0.000 | 0.020/0.122 |
| 500 | mostly-culled | 50/50 | 0.000/0.100 | 0.010/0.020 | 0.000/0.000 | 0.015/0.118 |
| 500 | alternating | 250/250 | 0.000/0.100 | 0.013/0.022 | 0.000/0.000 | 0.015/0.120 |
| 1,000 | all-visible | 1,000/1,000 | 0.100/0.200 | 0.045/0.065 | 0.000/0.000 | 0.135/0.240 |
| 1,000 | mostly-culled | 100/100 | 0.100/0.200 | 0.025/0.045 | 0.000/0.000 | 0.120/0.220 |
| 1,000 | alternating | 500/500 | 0.100/0.200 | 0.030/0.055 | 0.000/0.000 | 0.125/0.225 |
| 2,000 | all-visible | 2,000/2,000 | 0.100/0.200 | 0.100/0.150 | 0.000/0.000 | 0.210/0.370 |
| 2,000 | mostly-culled | 200/200 | 0.100/0.200 | 0.070/0.110 | 0.000/0.000 | 0.170/0.300 |
| 2,000 | alternating | 1,000/1,000 | 0.100/0.300 | 0.080/0.130 | 0.000/0.000 | 0.190/0.380 |
| 4,000 | all-visible | 4,000/4,000 | 0.200/0.400 | 0.200/0.280 | 0.000/0.000 | 0.480/0.720 |
| 4,000 | mostly-culled | 400/400 | 0.300/0.400 | 0.160/0.240 | 0.000/0.000 | 0.400/0.680 |
| 4,000 | alternating | 2,000/2,000 | 0.300/0.400 | 0.140/0.220 | 0.000/0.000 | 0.420/0.620 |

Complete-render smoke artifacts, both clean at the repair SHA and software-only, are
`artifacts/native-cpu-profile/exp001-20260829-repair/complete-deep-500-probe/profile-1787989248437.json`
and
`artifacts/native-cpu-profile/exp001-20260829-repair/complete-deep-4000-probe/profile-1787989442170.json`.
The failed 180-frame output directories are
`artifacts/native-cpu-profile/exp001-20260829-repair/complete-deep-500/` and
`artifacts/native-cpu-profile/exp001-20260829-repair/complete-deep-4000/`; no complete-render
report was written, so those rows are unverified and not claimed.

The red-green unit-test observations were:

- Before implementation, alternating visibility, bundled render modes and the ordinary matrix
  failed the focused suite; 24 existing tests passed.
- After the contract-preserving implementation, the focused suite passed 27/27.
- Before the rendering split, `--rendering` failed as an unknown argument; after it, the focused
  suite passed 28/28.

### Matrix and artifacts

The historical complete-render matrix used flat/deep hierarchy, dirty ratios 0/10/100%,
all-visible and mostly-culled visibility, independent render mode, one pass, 120 warm-up frames,
180 measured frames and three repeats. Its deep rows are invalidated by the repair note above;
only its flat control rows remain usable as historical software diagnostics. Each 500/1k/2k report
contains 36 runs and 6,480 raw samples, with per-run summaries for every measured field:

| object count | raw report |
| ---: | --- |
| 500 | `artifacts/native-cpu-profile/exp001-20260828/objects-500/profile-1787985927586.json` |
| 1,000 | `artifacts/native-cpu-profile/exp001-20260828/objects-1000/profile-1787985997644.json` |
| 2,000 | `artifacts/native-cpu-profile/exp001-20260828/objects-2000/profile-1787986103714.json` |

The historical CPU-only matrix used the same dimensions and additionally included 4k objects. Its
deep rows are invalidated by the repair note above; only its flat control rows remain usable. It
contains 144 runs and 25,920 raw samples, including complete raw arrays and summaries for all four
object counts:

`artifacts/native-cpu-profile/exp001-20260828/cpu-only-clean/profile-1787986653357.json`

The representative rows below pool the three repeats (540 samples per row). Values are
milliseconds; each pair is p50/p95. `frame` is the measured frame callback, not a presented-frame
time.

#### CPU preparation only

| objects | topology / visibility / dirty | matrix propagation | bounds/cull | mutation | preparation frame |
| ---: | --- | ---: | ---: | ---: | ---: |
| 500 | flat / all / 0% | 0.000/0.100 | 0.017/0.025 | 0.000/0.000 | 0.020/0.123 |
| 1,000 | flat / all / 0% | 0.000/0.100 | 0.035/0.055 | 0.000/0.000 | 0.050/0.155 |
| 2,000 | flat / all / 0% | 0.100/0.300 | 0.100/0.180 | 0.000/0.000 | 0.200/0.510 |
| 4,000 | flat / all / 0% | 0.200/0.300 | 0.200/0.320 | 0.000/0.000 | 0.380/0.640 |
| 4,000 | flat / all / 10% | 0.200/0.400 | 0.200/0.300 | 0.100/0.200 | 0.480/0.860 |

The repaired CPU-only table above replaces the invalidated deep-row evidence. The browser still
initializes WebGPU for the same scene, but no renderer call is included in these measured frames;
this is not a no-GPU or native-runtime measurement.

#### Complete `WebGPURenderer.render()` — software fallback only

| objects | visibility | render p50/p95 | draw calls | frame p50/p95 |
| ---: | --- | ---: | ---: | ---: |
| 500 | all-visible | 0.900/2.900 | 501 | 1.025/3.040 |
| 500 | mostly-culled | 0.200/0.400 | 51 | 0.317/0.528 |
| 1,000 | all-visible | 1.500/3.200 | 1,001 | 1.660/3.560 |
| 1,000 | mostly-culled | 0.400/0.700 | 101 | 0.540/0.950 |
| 2,000 | all-visible | 6.100/12.100 | 2,001 | 6.740/13.270 |
| 2,000 | mostly-culled | 0.600/1.200 | 201 | 0.900/1.770 |

The historical complete-render table remains a flat-control record only. The repaired deep rows
have no accepted complete-render performance result: Chromium dropped the 180-frame complete lane,
including the 4k attempt, with `Instance dropped in popErrorScope`. The repaired CPU-only artifact
is the authoritative deep 4k preparation evidence for this round.

### Decision, synchronization and unknowns

The statistics contract computes
`synchronizedCandidateMedian = candidateMedian + synchronizationMs` and only marks a result
actionable when the synchronized gain is at least 10% and greater than baseline run-to-run noise.
The unit tests cover both conditions. This run measured no native kernel, packing, bridge crossing,
result application, or synchronization sample, so it proposes **no native-kernel threshold** and
does not infer one from browser CPU-only timings.

The next three targets are ranked as follows:

1. **Hardware complete-render attribution — high benefit, medium complexity, low compatibility
   risk.** Re-run the same 500/1k/2k/4k matrix on a named browser hardware adapter and correlate
   renderer stages before changing engine code.
2. **Native/bridge synchronization probe — high decision value, medium complexity, medium
   compatibility risk.** Measure packing, crossing and result application around a bounded transform
   candidate; reject it if the added cost erases the synchronized 10% gain.
3. **Transform or culling kernel — low current benefit, high compatibility risk.** The measured
   preparation rows do not justify a native scene mirror or public Three.js patch; only revisit
   after target 2 and a hardware/native crossover are proven.

Still unknown: Android QuickJS transform and culling cost, native bridge overhead, upload/submit/
present attribution, hardware-GPU behavior, GC/heap effects, material and geometry topology, and
mutation churn. The experiment therefore recommends **STOP** for a bounded transform experiment,
while preserving the harness for a later hardware/native run.

---

## 1. Native Android fps — every green in this section is a **120 Hz arm**

> **Baseline decided 2026-08-28 (PRD-228): acceptance runs on a 60 Hz panel at `maxFps: 60`, and
> accepts at presented p95 ≤ 14 ms.** Every result in §1.3.3 and §1.3.4 below was measured with the
> Pixel 8's Smooth Display on and the panel at physical 120 Hz. They remain true and they remain
> useful — as **high-refresh arms**. They are no longer the acceptance, and no gate may cite them.
>
> The same day, at `resolutionScale` 0.32 on a **60 Hz** panel (Smooth Display off,
> `peak_refresh_rate 60.0`, Battery Saver *off*), SurfaceFlinger measured **49.932 fps** over 2,943
> frames — 2,255 × 16 ms + 678 × 33 ms, **zero 8 ms intervals**. Render p95 was 15.5–17.8 ms in both
> configurations: the same frame, charged 33.3 ms on a 60 Hz panel and 25 ms on a 120 Hz one.
> **Under the decided baseline Bayview does not yet pass.** `device-preflight.mjs` now reads and can
> gate on the active panel mode (`requireRefreshHz`), so no later arm can repeat this ambiguity.

### 1.0 The 120 Hz arm (previously stated as acceptance)

**Goal (owner): 60 fps+ on a physical Pixel 8; 30 fps is a milestone, never a pass.** On 2026-08-28
Bayview reached the active 60 Hz display budget on the physical Pixel 8 while keeping the UI at the
full 2400×1080 presentation size. The game-owned 3D surface renders at scale 0.36 (864×389) and is
composited behind that full-resolution UI. The earlier claim that Chrome ran the scene at 59.99 fps
remains falsified; it is unrelated to this native measurement. A supported `display.maxFps: 120`
path now selects the Pixel's physical 120 Hz mode and uses mailbox presentation. The accepted run
held **63.45–72.52 fps across 11 steady windows / 3,300 frames**, with zero hitches and thermal
status 0 before and after. SurfaceFlinger independently measured 70.358 fps over 3,634 surface
frames at physical 120 Hz, with zero dropped frames. **On the 120 Hz arm the owner's 60+ fps goal is
met; on the decided 60 Hz baseline it is not — see the note opening §1.**

| Where it stands (2026-08-28, **120 Hz arm**) | value |
| --- | ---: |
| Pixel 8, Mali-G715/Vulkan, unplugged, active 120 Hz | **63.45–72.52 fps** |
| 11 steady 300-frame windows | **3,300 frames**, zero hitches, every window above 60 fps |
| Steady frame cadence | presented p50 13.41–15.32 ms; frame p95 at most 13.22 ms |
| SurfaceFlinger cross-check | **70.358 fps**, 3,634 frames, zero dropped frames |
| Presentation contract | UI 2400×1080; 3D 864×389, scaled by the compositor |
| Settled browser render budget | 232 draws; 665,531 triangles; diagnostics empty |
| High-refresh path | `display.maxFps: 120`; physical 120 Hz; mailbox (`vsync=false`) |

### 1.1 The model that fits every measurement

```text
Bayview submits about 818 draws: about 496 in the main pass + about 322 in the shadow pass.
1080p native adds expensive fragment work: the diagnostic estimates a ~63 ms GPU frame.
Chrome draws only 864×303 but is still ~30 fps: draw/pass count is load-bearing, not just pixels.
60 fps needs CPU ≤ 16.7 ms AND GPU ≤ 16.7 ms; 100 fps needs both ≤ 10 ms.
```

Native and Chrome therefore tell the same story at different pixel costs. The full-resolution native
surface makes the fragment-heavy town materials worse, but it is not the origin of the 20–30 fps
class. Bayview is already outside budget at one tenth of the native pixel count.

### 1.2 The fork already taken: Road B — GPU work

The diagnostic post-present drain (`TN_WEBGPU_GPU_DRAIN_PROFILE=ON`, blocking
`wgpuDevicePoll`, default-OFF and never shipped) measured the 1080p GPU frame on the
physical Pixel 8: **gpuDrain ≈ 49 ms in both FIFO and mailbox; GPU-frame estimate ≈ 63–64 ms in
both**. The pre-registered fork selects **Road B: the GPU owns the full-resolution frame**. A
present-seam fix cannot recover 46+ ms. Road A (Dawn on Android / wgpu-native present patch) is
*untried on device*, not refuted — it is parked behind Road B.

The pre-registered decal experiment was run and **falsified**. Hiding all 224 decal slots while
retaining allocation and placement changed gpuDrain 50.468 → 49.867 ms, only −0.601 ms and below
the 2 ms decision threshold. Source was restored.

The pass experiments then found two material costs:

| Diagnostic arm, 1080p native | period p50 | frameReplay p50 | gpuDrain p50 | verdict |
| --- | ---: | ---: | ---: | --- |
| Normal textured town + 2048² sun shadow | 110.898 ms | 12.711 ms | 50.468 ms | control |
| Sun shadow disabled only | 86.750 ms | 6.766 ms | 46.022 ms | material, but insufficient |
| Shadow disabled + flat-material bypass | 68.201 ms | 6.405 ms | 28.314 ms | town shader costs ~17.708 ms of GPU drain at 1080p |

The flat-material arm was diagnostic only. It did not become a proposed fix, and the original
textures, materials and shadows were restored immediately after measurement.

### 1.3 Owner and implementation history

**Layer verdict: the primary 20–30 fps defect is game-owned Bayview render construction.** The
secondary viewport-density and high-refresh-selection defects are engine-owned, but neither can
turn an 818-draw Chrome frame into a 100 fps frame.

Evidence gathered from the live Chrome game:

- Core calls one world render per game frame. Three.js adds exactly one shadow render because
  Bayview enables a dynamic 2048² directional shadow. There is no duplicate engine world render.
- A settled frame reports 804–818 draws and about 1.03–1.11 million submitted triangles. Disabling
  only the sun shadow reduces this to 496 draws and about 570,000 triangles; a warmed development
  sample reached 43.19 fps, still below 60.
- The authored scene has 830 meshes; 492 are effectively visible. The `town` root alone owns 363
  visible meshes and 215 of the scene's 287 shadow casters.
- Those 363 town meshes use 50 materials but **363 distinct geometry identities**. Runtime grouping
  found 295 meshes compatible with only 16 canonical topology/material/shadow-flag groups.
- Core's projection correctly reported `notWorthwhile`: it would draw 835 of 835 candidates and
  created zero batches. Identical material is insufficient on WebGPU because `BatchedMesh` still
  issues multidraw sub-draws; safe instancing needs shared geometry identity.

**2026-08-27 next fix (now landed):** change Bayview's generated render source to reuse canonical
primitive geometries and express dimensions through mesh transforms. Start with the 201
`BoxGeometry` objects, then the 84 cylinders and 22 planes. Preserve each authored mesh, material,
surface tag, transform, raycast and physics object; do not merge away gameplay identity. Once
geometry identity is shared, the existing core projection can instance compatible `(geometry,
material, castShadow, receiveShadow, layers)` groups in its private render mirror. The measured
grouping predicts the town's 363 render candidates can fall to about 84, which should remove roughly
279 main-pass candidates and many of the same shadow-pass candidates. This is a prediction, not a
measured fps result.

### 1.3.1 Geometry identity sharing — landed 2026-08-27 (late), web red-green + first device arms

Landed in `sandbox/fps-framework` (`1be75de`): every plain box/plane/straight-cylinder solid in
`town.ts` now shares one canonical unit geometry and expresses dimensions through `mesh.scale`
(pixel-identical for axis-aligned primitives); frustum cylinders (bollards, pier posts) cache by
shape like `roundedBox` already did. Materials, transforms, surface tags, colliders, raycast and
physics identity untouched; triangles hold at ~1.03M. The projection now reports `projecting:true`,
**11 instanced batches, 227 projected objects, 619 draw candidates (was 835)**, exact lane:
`renderOrder 336` (mostly the decal pool's hidden slots), `tooFewToBatch 140` (van/boat merged
parts, misc singletons), `transparent 75`, `skinned 40` (soldiers), `instanced 12` (palms).

Red-green, same scenario (`playtests/draw-budget.playtest.json`), same session, adapter turing,
headed (the runner's private Xvfb lane still lands on SwiftShader — adapter check in
`artifacts/playtest/capture.json`; capture lane must run `--headed` on `:0` here):

| Arm | settled drawCalls (render entity, in-frame capture) | triangles | verdict |
| --- | ---: | ---: | --- |
| geometry fix stashed (red) | 780 | 1,033,449 | FAIL `lte 550` |
| shared unit geometry (green) | 492 | 1,038,265 | PASS, exit 0 |

The scenario's `render` entity now captures `renderer.info` inside the frame callback — a
between-frames read sees zeros because `renderer.info` resets at each render, which silently
produced 0/0 in the first attempt. `performance.maxDrawCalls` (max over the whole bridge series)
is **unusable as a gate for this game**: the series includes the startup authored-scene phase
(~1345 draws for ~100 frames until startup readiness settles), so its max never goes below ~1370
in any arm. The steady entity gate replaced it.

Desktop native (Xvfb, 900 frames, post-fix): **render.p50 5.37 ms** (bug-hunt record: 10.83 after
`caa78a11`, 12.35 before) — the draw collapse halves desktop render cost. frameReplay p50 1.3 ms.
Desktop fps is not a verdict (present throttles); the render.p50 is.

Device, first arms of the session — **thermally confounded later in the session (battery 29.4 →
33.6 °C, status 0 → 1, phone charging at 50 % throughout; no clean cool-device A/B yet)**:

| Arm | pre-fix | post-fix | read |
| --- | ---: | ---: | --- |
| 1080p FIFO | 20.0–20.9 (doc) | 20.71 steady, JS frame p50 24.0 | flat — GPU/period-bound (period 48.1, present 16.3) |
| 720p mailbox | 34.39 (SF 34.2, doc) | 31.4–33.0 (SF cross-check 33.644) | inside session drift; phase split: render 14.9, hostGap 9.4 (replay 5.9, present 4.8), residual 4.4 |

Phase reading of the post-fix 720p mailbox frame: render p50 14.9 ms ≈ 492 draws × ~30 µs/draw of
three.js WebGPU submission; replay ~5.9 ms also scales with draw count. Reaching 60 fps needs the
JS frame + host ≈ 16.7 ms — the draw count must fall below ~300 or per-draw cost must fall, and
the 1080p arm additionally needs the fragment cost down (2048² shadow is a GPU constant across
viewport sizes).

### 1.3.2 Draw collapse completed + the GPU attribution (2026-08-28, ~01:00–02:00)

Second and third game commits (`d9dc879` and the material commit): ten targets share unit
primitives (60 → ~7 draws); every parked pool settles after the 2 s prewarm window — breakable
shards (27), muzzle-flash cards (7), and engine tracer streaks (28, `TracerPool3D.settle` landed
in core with a unit test, tarball `…tracer-settle-c73594118297`); `game.ts` now brackets the
projection reconcile inside the frame-budget render phase (its cost used to hide in `residual`);
town materials sample triplanar top-2 dominant-axis (`triTop2` in `townMaterials.ts`) and take the
1.618× breakup crossfade on the colour map only. Web settled draws: **780 → 492 → 403 → 315**,
triangles flat ~1.037M, pixel-diff of the spawn view against the 492-draw frame: **0 of 921,600
pixels differ by more than 8** — the material change is look-neutral.

Device, 720p mailbox (`wm size 720x1600` + `present_uncapped=1`), as the phone cooled through the
session: 34.6 → 37.1 → **47.2 → 53.1 → 50.9 fps steady** (presented 18.7, frame p50 9.3, render
8.8). The earlier 34–37 readings were thermally depressed (battery 33–34 °C after back-to-back
runs; the 29–31 °C windows read 47–53). **Best measured: 53 fps; 60 not reached.** The remaining
gap is the GPU frame (~18–19 ms at 720p against a 16.7 budget; the CPU chain is done at 9.3).

GPU attribution — the drain build (`-PthreenativeGpuDrainProfile=true`), 720p, ablations via
localStorage gates the host reads from `files/mystral/storage/<cwd-stem>.json` (push with
`run-as com.threenative.bayview cp /data/local/tmp/<f> files/mystral/storage/default.json`):

| Arm | gpuDrain p50 ms |
| --- | ---: |
| full scene, full materials, shadow on | 27.57 |
| shadow OFF | 27.89 (≈0 — the shadow is not a GPU cost) |
| shadow off + flat town materials | 24.22 (materials ≈ 3.3) |
| + town hidden | 13.55 (flat town pass ≈ 11.5) |
| + sky and soldiers hidden | 6.66 (soldiers + sky ≈ 6.9) |
| + `scene.environment` null | **0.35 — the IBL ablation is ~6.3 ms on a nearly-empty scene; this is an upper bound, not the bakeable frame cost** |
| full scene, IBL null | 22.24 (IBL ≈ 5.3 across the covered scene) |

Conclusion: the 720p GPU frame is spread per-pixel — the IBL ablation is ~5–6, the flat town pass ~9–11
(geometry/dispatch/PBR core, not the texture fetches: `triTop2` cut fetches 24 → 10 and moved
gpuDrain not at all), material graphs ~2.5, soldiers/sky ~7 — over a true floor of 0.35. The
1080p arm stays GPU-bound (present 14.4 of a 49 ms period; 20.2 fps, unchanged by the CPU wins).

Falsified this session (do not re-derive): 1024² shadow map (33.0 vs 34.6 — flat at 720p
mailbox); PCFSoft/shadow cost (~0); town texture fetches as the GPU cost (top-2 flat); the
hemisphere-fill IBL replacement (−5.3 ms GPU but visibly darker in shaded faces at two tuning
attempts — `TN_NO_IBL` gate ships off by default; the A/B screenshots are
`/tmp/draw-budget-tritop.png` (IBL) vs `/tmp/draw-budget-hemisphere*.png`).

### Environment attribution — PRD-307, 2026-09-01

The `scene.environment` ablation above removes both one-time PMREM work and per-fragment
environment sampling, so its ≈6.3 ms difference is an upper bound on what a build-time bake could
recover. A same-session five-arm control measured a set-once environment at 2.18 ms and no
environment at 2.55 ms; the −0.37 ms inversion is a lower-bound/noise observation, not a complete
resolution floor, and an independent positive resolution observation is required. Forcing PMREM every
frame measured 3.79 ms, or **+1.61 ms** over the static arm. Bayview assigns `scene.environment`
once and has no `ProbeVolume`, `CubeCamera`, or `needsPMREMUpdate` path, so the +1.61 ms control is
not its workload. The static bakeable benefit is unresolvable and below the standing 2 ms bar.

Full attribution record: [`environment-cost-attribution-2026-09-01`](environment-cost-attribution-2026-09-01.md).

The designed path to 60 (each measured, none yet a pass): the GPU needs −2 ms of the ~18.7
presented — candidates in order: a cheap single-fetch IBL approximation (TSL `pmremTexture` at a
fixed mip via `material.envNode`, keeping the look the hemisphere cannot), the flat town pass's
9–11 ms (three's PBR core + dispatch for ~315 draws — the GPU-side twin of the closed CPU
per-draw question, **not** covered by that evidence), and CPU is already inside budget. The named
next instrument (§1.5) remains GPU timestamps to split the town pass into dispatch vs fragment.

Red-green handoff (completed by §1.3.3):

1. Add a Bayview playtest that currently fails with a steady `maxDrawCalls` threshold and still
   asserts the town triangle floor/nonblank frame.
2. Share canonical geometry in `sandbox/fps-framework/src/render/`; do not change textures or
   materials.
3. Require `TN_RENDER_PROJECTION` to report `projecting:true`, a nonzero batch count and a materially
   lower renderer draw count before measuring fps.
4. Re-run web rAF + SurfaceFlinger and native `TN_FRAME_BUDGET` + SurfaceFlinger on a cool device;
   only then choose the next lever between the 2048² game shadow and native pixel density.

### 1.3.3 Bayview reaches the native 60 Hz budget without shrinking the UI (2026-08-28)

**Layer verdict:** the fix belongs to Bayview's generated render source, not an engine package. The
resolution is a decision about how this game looks, and the project rule puts appearance decisions
in generated `src/render/` or game source. Web, desktop and non-Android paths remain at scale 1.

Two sandbox commits close the central frame-budget gap:

- `f83103f` uses a fixed roughness-0.8 PMREM IBL node, keeps dominant town/truck/awning shadows,
  removes shadows from small moving targets and effects, and holds the settled browser scene to 232
  draws and 665,531 triangles.
- `95d8729` changes only Android native's 3D resolution scale from 0.44 to 0.36. The physical
  overlay/UI surface remains 2400×1080; SurfaceFlinger reports the game surface transform at about
  2.777×, consistent with an 864×389 3D buffer scaled to the display.

Red-green on the same physical Pixel 8:

| Arm | steady result | verdict |
| --- | ---: | --- |
| scale 0.44 | 56.31–58.28 fps | red |
| scale 0.40 | 58.51–59.31 fps | insufficient |
| scale 0.36 | last four windows 59.81–59.99 fps | 60 Hz frame budget reached |

Acceptance used the intended Mali-G715 Vulkan adapter, normal real-time ticks, an unplugged device,
and the active 60 Hz display mode. Before the run the battery was 73%, device temperature 32.8 °C,
and Android thermal status 0 (`NONE`). The measured workload stayed in `playing` with five live
enemies, AI, physics, audio, HUD, PBR materials and retained dominant shadows. A controlled clone
reset the steady-state accumulator after startup and collected 2,009 frames over about 33.5 s:

| Metric | Result |
| --- | ---: |
| presented frame time | p50 16.66 ms; p95 22.87 ms; p99 32.40 ms |
| p50-derived nominal rate | 60.02 fps |
| worst / spikes | 74.72 ms / 13 frames above the spike threshold |
| largest section peaks | outside-game 73.45 ms; enemies 62.42 ms; game frame 62.80 ms |
| section p99 | outside-game 30.86 ms; enemies 3.05 ms; game frame 3.58 ms |

This proves the nominal 60 Hz budget on the current display mode; it does **not** prove throughput
above 60 fps. The remaining defect is tail smoothness: central frame pacing is at budget, while 13
of 2,009 frames spiked and the worst frame reached 74.72 ms.

The temporary reset/logger used for the exact 2,009-frame aggregate was removed before the final
APK. The clean rebuild has SHA-256
`3d072453ee23932d5153678cc0d5e7900a44c0c890d7a8cc57586635812f8b95`; a clean open reported
Mali-G715/Vulkan, `TN_RENDER_SCALE` 0.36 (**the live tree has since moved to
`renderer.android.resolutionScale: 0.32`; this figure describes the accepted build, not HEAD**),
`TN_NATIVE_SMOKE_READY:webgpu`, and
`TN_NATIVE_SMOKE_FIRST_FRAME`. The physical Android input smoke then fired the weapon: its artifact
contains the muzzle flash and the HUD changed from 30 to 29 rounds.

Verification status: sandbox typecheck and Android build pass; all 23 behavior scenarios pass; the
settled draw-budget scenario passes at 232 draws with empty diagnostics. The aggregate `pnpm test`
still exits nonzero in its final scale audit because two pre-existing content checks fail (`door`
missing and a 1.000 m muzzle-flash quad above the 0.3 m limit). This Android-only branch cannot
affect that web content audit. The sandbox has no lint script.

### 1.3.4 Supported 120 Hz + mailbox — sustained >60 acceptance green (2026-08-28)

**Layer verdict:** the missing high-refresh contract was engine-owned. A game cannot portably tell
Android which display mode to prefer, so the public config, native packagers, runtime pacing and
Android surface lifecycle now carry one value:

```ts
export default {
  display: { maxFps: 120 },
} satisfies IThreeNativeConfig;
```

`display.maxFps` defaults to 60, accepts whole numbers from 0 through 1000, and uses 0 for uncapped.
The runtime applies it before the first frame. Android packages it as `TN_MAX_FPS`, passes the same
value to the native pacing cap, calls `Surface.setFrameRate()` on API 30+, and reapplies the request
on resume and whenever Android creates or replaces the surface. Every generated template states
the conservative 60 fps default; a game opts into 120 without changing its UI or render source.
Desktop and iOS carry the same software ceiling through their packaged config.

The first mode-selection report was wrong: it read the app's 120 Hz override rather than the
physical active SurfaceFlinger mode. A valid cool run exposed Android's
`PRIORITY_LOW_POWER_MODE_RENDER_RATE max=60` vote because Battery Saver was on. The app voted 120,
but the physical display stayed at 60 Hz; SurfaceFlinger measured 58.082 fps over 6,192 frames.
After Battery Saver was disabled, SurfaceFlinger genuinely reported active mode 1 at 120 Hz.

That exposed a second engine defect. FIFO presentation quantizes an 11–12 ms frame that misses one
8.33 ms interval to the 60 Hz divisor. With the physical display at 120 Hz, Bayview's first FIFO
steady window was still only 57.8 fps. The runtime keeps FIFO **below** the full-refresh target and
uses its already-supported mailbox/immediate path at 60, above 60 and uncapped — the code is
`config.vsync = config.maxFps != 0 && config.maxFps < 60`
(`packages/runtime-native/src/platform/android_main.cpp:221`), so **`maxFps: 60` selects mailbox,
not FIFO**. An earlier revision of this paragraph said FIFO covered "1–60" and was wrong at the
boundary. The software ceiling remains active in either mode.

Red-green proof in the engine tree:

| Gate | Result |
| --- | ---: |
| config validation/default and all generated templates | **311/311 passed** |
| focused Android presentation/packaging/lifecycle tests | **26/26 passed** |
| Android/iOS/desktop packaging and runtime contracts | **577 passed, 1 unrelated preflight failure** |
| Android arm64 host + Java activity build | **passed** |
| desktop runtime and CLI compile | **passed** |
| core typecheck | **passed** |
| root typecheck | max-fps path clean; blocked by 3 pre-existing tracer-test nullability errors |

The final Bayview APK has SHA-256
`a519e4043de40c532c29e53a9d0175952959160d36dd41d1de041d669084e0c4`. Its manifest contains
`TN_MAX_FPS=120`; the approved 2400×1080 overlay HTML, JavaScript and CSS hashes match the staged UI
bundle byte for byte. On the physical Pixel 8 the host reported `maxFps=120`, `vsync=false`, mailbox
presentation and an applied `TN_DISPLAY_FRAME_RATE_REQUEST`. SurfaceFlinger independently reported
physical active mode 1 at 120 Hz and a 120 Hz vote for the Bayview surface.

The first mailbox run started unplugged over Wi-Fi ADB at 51% battery, 38.3 °C battery temperature,
37.0 °C skin and thermal status 0. After discarding startup, its first 600 steady frames measured
66.84 and 63.01 fps with zero hitches. The device then crossed to thermal status 1 (39.5 °C skin):
later windows fell to 57.84, 54.47 and 53.25 fps. SurfaceFlinger measured 56.957 fps over the whole
2,542-frame surface lifetime and recorded 224 true 8 ms present intervals, confirming that mailbox
removed the 60 Hz divisor even though the warmed run did not sustain the target.

The accepted rerun started at 60% battery, discharging over Wi-Fi ADB, with battery temperature
33.4 °C, skin 33.7 °C and thermal status 0. Battery Saver re-enabled when the charger was removed;
the run explicitly disabled it and verified `low_power=0` before a cold launch. The formal command

```sh
threenative-playtest perf --logcat 192.168.1.192:5555 \
  --require-windows 4 --min-fps 60 --text
```

exited 0 / `PASS`. After discarding window 1, all 11 steady windows passed: **63.45–72.52 fps over
3,300 frames**, zero hitches, presented p50 13.41–15.32 ms, frame p95 at most 13.22 ms and render
p95 at most 11.15 ms. The post-run device remained at thermal status 0, 34.0 °C battery temperature,
38.7 °C skin, 60% and discharging.

SurfaceFlinger independently held physical 120 Hz and measured **70.358 fps over 3,634 frames**,
with zero dropped, late-acquire or bad-desired-present frames. Its histogram recorded 1,007 8 ms
and 2,511 16 ms present intervals. This closes the owner's sustained 60+ fps goal without changing
the approved UI or the game-owned 0.36 3D scale.

The first CLI read falsely exited 1 because Android mirrors each console marker through both
`MystralStdio` and `MystralJS`: it parsed windows as `[1,1,2,2,…]` and discarded only one startup
copy. A red-green parser regression now counts byte-equivalent frame-budget payloads once while
leaving differing observations visible. Its focused suite passes 16/16, the rebuilt CLI passes
`publint`, and the same unchanged logcat source produces the exit-0 result above.

### 1.3.5 The pixel ladder — PRD-228 Phase 0's falsification gate, PASSED (2026-08-28)

**Verdict: Change A stands as a performance contract.** Five rungs, monotonic in pixel count, and
a slope an order of magnitude above the 2 ms/Mpx floor the PRD pre-registered as its falsifier.

**This is a 120 Hz arm, and it is a slope arm, not an acceptance.** It has to be. On the decided
60 Hz baseline every rung at or under 16.7 ms reads exactly 16.7 ms — SurfaceFlinger's own
`present2present` histogram for the earlier 60 Hz 0.32 arm is 16 ms and 33 ms bins with nothing
between them. A panel cannot resolve a frame cost below its own vsync period, so the PRD's
"uncapped ladder" was run at 120 Hz with `debug.threenative.present_uncapped 1` and
`display.maxFps: 240`. Acceptance still runs at 60 Hz and no gate cites this table.

Same commit, same session, same scene; one APK per rung, sha256 recorded; cold launch per method
rule 4 with `pidof` proved empty; one discarded launch per arm plus two discarded whole runs at
session start per rule 1; the first two windows of every kept run dropped; `device-preflight.mjs`
run before each arm with `requireRefreshHz: 120`, `requireDischarging: true`, thermal NONE.

| arm | scale | drawing buffer | Mpx | presented p50 | presented p95 | render p50 | our fps | SurfaceFlinger fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `b100` | 1.00 | 2400×1080 | 2.592 | 39.14 | 42.92 | 17.43 | 25.43 | **26.54** |
| `b072` | 0.72 | 1728×778 | 1.344 | 28.48 | 34.49 | 14.38 | 35.15 | **37.01** |
| `b055` | 0.55 | 1320×594 | 0.784 | 21.00 | 28.72 | 11.11 | 46.62 | **47.35** |
| `b044` | 0.44 | 1056×475 | 0.502 | 18.16 | 25.85 | 10.08 | 53.50 | **54.28** |
| `b032` | 0.32 | 768×346 | 0.266 | 16.73 | 24.32 | 9.28 | 57.62 | **61.84** |

```text
presented p50 = 9.94 ms/Mpx x pixels + 13.79 ms     R2 0.992, n=5, monotonic
presented p95 = 8.14 ms/Mpx x pixels + 22.32 ms     R2 0.991
render    p50 = 3.60 ms/Mpx x pixels +  8.50 ms     R2 0.970
```

SurfaceFlinger cross-check on the endpoints, game `(BLAST)` layer, `present2present`:
`b100` = 33 ms×830 + 42 ms×826 (four and five vsyncs); `b032` = 16 ms×2810 + 8 ms×443. Both agree
with our own fps to within 0.5–4.2 fps and neither shows the clamped single-bin signature.

> **WITHDRAWN 2026-08-28, same day, pending a probe: the `(scale × samples)` result below.** The
> fixed-frame-cost analysis (`docs/verification/prd-228-fixed-frame-cost-2026-08-28.md` §5) found
> that `TN_GPU_TEXTURES` is **byte-identical** between each `antialias: true` arm and its
> `antialias: false` twin — same 310 MB / 73 textures / 19 buckets at 0.32, same 318 MB / 73 at
> 0.55 — with no multisampled attachment appearing anywhere. Either the `antialias` request never
> reached a sample count on the native path, or the census cannot see the attachment. **If the
> flag was inert, "MSAA is free below 0.5 Mpx" measures nothing**, and the `+7.47 ms at 0.55` that
> looked like a cliff is better explained by the same analysis's finding of late-session drift in
> that exact arm (`c055aa` vs `b055`: +35.6 % with `frameReplay` up 4.98 → 7.38 ms, a segment MSAA
> cannot touch). The arms were built before `surface.sampleCount` shipped, so those logs cannot
> answer it. **One arm with the current core settles it**, because every window now reports the
> sample count it actually drew at. Change C's default is not decided until then.

**Two results the PRD did not predict, and they matter more than the confirmation:**

1. **The pre-registered 5.51 ms/Mpx was low by 1.8×.** It came from two cap-clipped points inside
   a 0.09 Mpx span. Over a 2.33 Mpx span the slope is **9.94 ms/Mpx**, so Change A's predicted
   saving for an untuned game is **2.256 Mpx × 9.94 = 22.4 ms/frame**, not the 12.4 ms filed.
2. **The intercept is 13.79 ms of a 16.67 ms budget.** At zero pixels this scene would still cost
   13.8 ms. Resolution scaling therefore buys Bayview about **2.9 ms of pixel budget at 60 fps and
   0.2 ms against the decided 14 ms bar** — roughly 0.02 Mpx. Bayview cannot reach the accepted
   baseline by scaling alone, whatever the scaler does, and the remaining work is in that fixed
   term rather than in the fill rate. This is a measurement, not an inference from it.

**Machine notes, so the next session does not re-derive them.** Battery Saver auto-armed at
`low_power_trigger_level 75` the moment the charger came off at 56 % and had to be pinned off; the
phone idles at 34–37 °C screen-on and never returned to the 31.5 °C the device lane usually asks
for, so arms were gated on thermal status NONE with the temperature recorded at both ends instead,
and rung order was scrambled (1.00, 0.72, 0.44, 0.32, 0.55) so thermal drift could not correlate
with pixel count. Six arms cost 8 % of battery.

**Method rule 9 is now wrong and needs replacing.** Its live-window test is `update.mean ≥ 3 ms`.
PRD-227 cut the update phase to **0.46 ms** in steady state, so that threshold rejects every live
window and accepts nothing. The classifier used here is: not one of the two windows after launch,
`substeps.mean ≥ 1`, and `update.mean > 0.05` — with the whole `update.mean` series recorded per
arm so the classification is auditable rather than asserted.

Artifacts: `<bayview>/artifacts/prd228/<arm>/` — `apk.sha256`, `config.txt`, `preflight-before.json`,
`battery-before.txt`, `battery-after.txt`, `logcat-kept.txt`, `sf-kept.txt`, and the discarded run
beside each. Harness: `tools/prd228-arm.sh`, `tools/prd228-ladder.sh`, `tools/prd228-read.mjs`.

### 1.3.6 The adaptive scaler on the device — it works, and it reaches the floor (2026-08-28)

**First device run of `resolutionScale: "auto"`.** Bayview, `display.maxFps: 60`, 60 Hz panel,
FIFO, engine core built from this tree and installed as a tarball with the installed bytes
verified (`threenative-core-0.3.0-auto-scale-3242a17bf93a.tgz`; `dist/index.js` contains
`scaleSource`). APK sha256 `b898ed4c…`. **Caveat on the record: the phone was on AC** —
`preflight-before.json` says `"charging":true,"chargingSource":"AC"` — so this is a functional
verification of the loop, **not an acceptance arm**. Thermal NONE at start, LIGHT at the end.

The scaler walked every pre-registered rung by itself, one step per window plus its cooldown:

| window | scale | drawing buffer | fps | presented p50 | presented p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.00 | 2400×1080 | 28.99 | 33.55 | 38.46 |
| 4 | 0.72 | 1728×778 | 35.65 | 27.00 | 35.25 |
| 8 | 0.52 | 1248×562 | 43.35 | 22.07 | 30.62 |
| 10 | 0.44 | 1056×475 | 48.95 | 19.84 | 26.27 |
| 14 | 0.32 | 768×346 | 48.59 | 19.77 | 27.36 |
| 18 | 0.23 | 552×248 | **55.37** | 17.04 | 23.40 |

SurfaceFlinger, game `(BLAST)` layer, whole run including the descent: **41.123 fps** — lower than
the last window because it averages every rung walked through, which is the point of the next
paragraph. Every window carried `surface: {resolutionScale, scaleSource:"auto", sampleCount,
drawingBufferWidth, drawingBufferHeight}`; the reporting defect that let the record say 0.36 while
the tree said 0.32 is closed end to end on a physical device.

**Two results, both actionable:**

1. **It reached the floor and did not reach 60.** Exactly what §1.3.5's 13.79 ms intercept
   predicts: 83 % of Bayview's frame does not scale with pixels, so no resolution reaches the
   target. The window now reports `atFloor` and `perf --text` prints "AT FLOOR, budget not met",
   because a window reporting 0.23 and nothing else reads as a budget met at a low resolution.
   **Bayview's remaining work is in the fixed term, not the fill rate.**
2. **The descent cost about three minutes.** Falling one rung per window plus one cooldown window,
   at 300 frames per window and ~30 fps at the top of the ladder, is ~20 s per rung and ten rungs
   from the ceiling. A game that starts at DPR-1 physical therefore spends minutes visibly at
   29 fps before settling. That is the pre-registered controller behaving exactly as specified and
   it is still a bad first impression. **Open, not fixed here:** a first-window multi-rung jump —
   the slope in §1.3.5 predicts the landing rung from one window's presented p50 in closed form —
   would reach the settling point in one step instead of ten. It is a change to PRD-228's Phase 2
   table, so it is filed rather than tuned in.

### 1.3.7 A scaffolded template holds 60 fps at full resolution, and the bug that found (2026-08-28)

**PRD-228 Phase 4's headline criterion, met once — with two caveats stated below.** A platformer
template scaffolded by `pnpm sandbox` into `sandbox/prd228-accept`: never hand-tuned,
`display.maxFps: 60`, `renderer.resolutionScale: "auto"`, and **no resolution constant anywhere in
its source** (`grep -rn resolutionScale src/` is empty). Engine installed from tarballs like a
user's machine, installed bytes verified. APK sha256 `fd71c9c0…`.

| | |
| --- | ---: |
| Settled scale | **1.00 — full 2400×1080** |
| Windows held at that scale | **59 consecutive** (7–65), ~17,700 frames, ~5 minutes |
| fps | **59.99–60.02** |
| `frame` p95 (the game's own work) | **6.51–8.70 ms** of a 16.67 ms budget |
| `presented` p95 (the panel's cadence) | 17.23–18.87 ms |
| SurfaceFlinger, game `(BLAST)` layer | **61.734 fps**, 19,372 of 19,562 frames at 16 ms, **0 dropped, 0 janky** |
| `atFloor` | false throughout |

The scaler dipped to 0.85 on the cold-start window (51.52 fps while loading), then climbed back to
1.00 at window 7 and never moved again.

**Caveats, on the record:** the phone was on **AC** — `preflight-before.json` says
`"charging":true` — and the criterion asks for three captures; this is one. Thermal was LIGHT at
the start of the long run and LIGHT at the end.

#### The defect this arm found, which is the reason it was worth running

The **first** run of this template walked to the floor. Same game, same 60 fps, and the scaler
took it from 2400×1080 to **552×248** across 20 windows and then reported `atFloor: true` —
claiming the budget was not met while it was being met at 59.99 fps.

The cause: **under FIFO the presented interval is the panel's period, not the game's cost.** The
controller's pre-registered down-trigger was `presented p95 > 14 ms`; a game locked at 60 fps on a
60 Hz panel reports presented p95 around 17.5 ms, so that condition is true forever. The template
had `frame p95` of 7.99 ms out of 16.67 at full resolution — enormous headroom — and the
controller destroyed its image quality anyway. **This affected every shipped configuration**,
since `maxFps: 60` on a 60 Hz panel is the decided baseline.

Fixed in `6898e5ee`: the trigger is **fps against the configured target**, which is correct capped
and uncapped because it comes from the mean presented interval and dropped frames pull it down on
their own. `presented p95` survives only as the up-step's tail guard, where a capped panel's own
p95 floor near 1.05× budget sits inside the 1.15× bar.

**The same error was in PRD-228's acceptance bar** — "accept at presented p95 ≤ 14 ms" is
unreachable on the panel that same decision pins. Amended there to `frame p95 ≤ 14 ms` plus fps at
target plus SurfaceFlinger confirming no dropped frames. **The general lesson, worth carrying:**
on a vsync-capped target, `presented` measures the panel and `frame` measures the game. Any bar or
trigger written against `presented` is measuring the display.

### 1.3.8 Acceptance, three captures — and `renderer.antialias` proven inert (2026-08-28)

**PRD-228 Phase 4's headline criterion, met.** Same scaffolded platformer as §1.3.7, this time
**unplugged, discharging, thermal NONE before each capture**, 60 Hz panel, cold launch each time.

| capture | settled scale | windows held | fps | `frame` p95 | SurfaceFlinger |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **1.00 — 2400×1080** | 33 of 39 | 59.59–60.02 | 6.53–8.49 ms | 61.817 fps |
| 2 | **1.00 — 2400×1080** | 33 of 39 | 59.59–60.02 | 6.39–8.39 ms | 61.088 fps |
| 3 | **1.00 — 2400×1080** | 33 of 39 | 59.52–60.06 | 6.98–8.37 ms | 61.504 fps |

`atFloor` false throughout. Capture 3's `present2present`: 11,681 frames at 16 ms, 124 at 33 ms,
one 650 ms startup frame. Against the amended bar — `frame p95 ≤ 14 ms`, fps at target,
SurfaceFlinger confirming no dropped frames — all three pass, and the worst `frame` p95 across
every capture is 8.49 ms, a little over half the bar.

The scaler dips one rung on the cold-start window and climbs back to 1.00 by window 7 in all three.
**A game nobody tuned reaches its target at full native resolution and stays there.**

#### `renderer.antialias` does not reach the GPU — proven, and it invalidates the sampling table

The `(scale × samples)` ladder was withdrawn on suspicion the same day; this settles it. One more
arm, same template, same device, `renderer.antialias: true` in `threenative.config.ts`:

```
surface: {"resolutionScale":1,"scaleSource":"auto","sampleCount":1,
          "drawingBufferWidth":2400,"drawingBufferHeight":1080,"atFloor":false}
TN_GPU_TEXTURES: 2400x1080 rgba16float x2, 2400x1080 depth24plus x3, ... — no multisampled attachment
```

**RESOLVED the same day — root cause found and fixed (`d476ec36`); the paragraph below is kept as
the trail that led there.** three's WebGPU backend sets
`this.compatibilityMode = !device.features.has("core-features-and-limits")` and then
`if (this.compatibilityMode) renderer._samples = 0`. Our bindings had no entry for that feature
name, so three concluded it was driving a reduced-capability **compatibility** device and disabled
MSAA outright — along with switching its depth-texture, MRT-blending and shader texture-type paths,
for every native game since the bindings were written. Compatibility mode is a feature *level* a
caller opts into and this runtime never requests one, so the feature is now requested on the Dawn
branches and answered truthfully at both query sites. Measured on the same probe before and after:
`compatibilityMode true → false`, `hasCoreFeatures false → true`, `sampleCount 1 → 4`.
**The `(scale × samples)` ladder stays withdrawn** — it was run against the inert flag and must be
re-measured now that sampling actually reaches the GPU.

**`sampleCount: 1` with sampling requested**, and a texture census identical in shape to the
`antialias: false` runs. Traced as far as the evidence goes: the value is in the built bundle
(`renderer: { preferWebGPU: true, resolutionScale: "auto", antialias: true }`),
`resolveRendererAntialias` is in the bundle and returns the config value, `createRenderer` passes
`{ antialias: options.antialias ?? true }` into `WebGPURenderer`, and three's bundled constructor
reads `this._samples = samples || antialias === true ? 4 : 0` with `get samples()` returning
`_samples` directly. Every link reads correct and the delivered frame is single-sampled. **The
break is below the config seam and is not yet located.**

Consequences, both binding:

1. **Every `(scale × samples)` number is withdrawn.** "MSAA is free below 0.5 Mpx" compared an
   inert flag against itself. The `+7.47 ms at 0.55` that looked like a tile-memory cliff is
   better explained by the late-session drift the fixed-cost analysis found in that same arm
   (`frameReplay` 4.98 → 7.38 ms, which MSAA cannot touch). **Change C has no measured default.**
2. **`renderer.antialias` is a documented, shipped, accepted option that does nothing on native.**
   It is in every template's `AGENTS.md` as part of the pixel budget. That is worse than an absent
   feature: a game turns it on, sees no cost, and concludes sampling is free.

### 1.3.9 The sampling table, re-measured against a flag that works (2026-08-28)

The `(scale × samples)` ladder was withdrawn twice today — first on suspicion, then on proof that
`renderer.antialias` never reached the GPU. With the compatibility-mode fix in (`d476ec36`,
`b674c4cb`) and `surface.sampleCount` reading **4** on device, it was run again. Bayview, physical
Pixel 8, 120 Hz, uncapped present, `maxFps: 240`, pinned scales, cold launch per arm.

| scale | samples | presented p50 | presented p95 | render p50 | fps | live windows |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.32 | 1× | 18.24 | 24.42 | 10.37 | 53.40 | 8 |
| 0.32 | **4×** | 21.45 | 27.12 | 12.50 | 46.76 | 29 |
| 0.44 | 1× | 19.48 | 27.85 | 9.71 | 49.33 | 4 |
| 0.44 | **4×** | 24.30 | 27.21 | 14.05 | 41.63 | 25 |
| 0.55 | 4× | 30.91 | 45.90 | 16.67 | 32.77 | 4 |

```
scale 0.32: 4x MSAA costs +3.21 ms presented p50, -6.64 fps
scale 0.44: 4x MSAA costs +4.82 ms presented p50, -7.70 fps
```

**The withdrawn table said the opposite.** "MSAA is free below 0.5 Mpx" was the reading of an inert
flag compared against itself. Measured against a flag that works, **4× MSAA costs more than a full
resolution rung**: +3.21 ms at 0.27 Mpx is more than the 0.32 → 0.27 step buys back, and the cost
grows with pixels rather than sitting in tile memory for free. Mali-G715 resolving MSAA in tile
memory does not make it free on this scene.

**Change C's rule, from measurement: spend resolution before samples, and leave `antialias`
opt-in.** The scaler moves resolution only, which is now the measured-correct behaviour rather
than a placeholder. A game that wants sampling can afford it by pinning a lower scale, and the
per-window `sampleCount` beside the scale is what lets it see the trade it made.

**Two arms are thin and named as such.** `0.44/1×` and `0.55/4×` hold four live windows each; the
80-second arms did not fill three windows once MSAA slowed the frame, which is why the two 4× arms
were re-run at 220 seconds (29 and 25 live windows) and why the reader refused the short ones
rather than reporting them. `0.55/1×` was refused outright and there is **no valid 0.55 pair** —
the +7.47 ms once recorded at that rung stays withdrawn and is not replaced.

### 1.3.10 PRD-238 projection culling (2026-08-28)

This is an engine-owned projection measurement. The probe builds a source `Scene` with 2,048
same-geometry anchors and 4,096 unique-geometry members sharing one material, then calls
`new SceneRenderProjection(source).reconcile()`. It does not construct an
`IProjectionProjectPlan` or call `ProjectionMirror.apply`; the material batch is admitted by the
normal planner. The 4,096 unique members are 75% beyond the camera's far plane. It is separate
from the load game's hand-authored L2 `InstancedMesh`, which is deliberately not a projection batch.
The browser was desktop Chrome with the NVIDIA/Turing adapter, 1280×720, vsync off. The exact run
was:

```sh
TMPDIR=/dev/shm pnpm bench:engines --arm tn-web --frames 900 --warmup 225 --repeats 3 --ladder 256 --modes L2 --skip-baseline
```

The measured window was frames 226–899 (674 samples per arm); no whole-run average was used.

| culling arm | scene sub-draws | render.p50 per repeat (ms) | median render.p50 | render.p95 per repeat (ms) |
| --- | ---: | ---: | ---: | ---: |
| OFF | 4,097 | 1.60 / 1.60 / 1.60 | **1.60** | 2.40 / 2.40 / 2.50 |
| ON | 1,025 | 1.30 / 1.10 / 1.00 | **1.10** | 2.10 / 1.70 / 3.40 |

The raw `renderer.info.render.drawCalls` values were 4,098 → 1,026 because Three's default
framebuffer path adds one full-screen presentation draw. The harness removes that one presentation
draw from this table, so ON removed **3,072 scene sub-draws (75%)** and moved median desktop
`render.p50` **−0.50 ms** (1.60 → 1.10 ms). The live setting is
`PER_OBJECT_FRUSTUM_CULLED = true`; it is not a game-facing option.

Phase 3 was entered because the batched result won. The instanced probe used the same 900-frame,
three-pair window, moved its source scene each frame, and reported `mesh.count` plus renderer
triangles at the midpoint:

| members | submitted instances OFF → ON | triangles OFF → ON | median render.p50 OFF → ON (ms) |
| ---: | ---: | ---: | ---: |
| 128 | 192 → 192 | 2,305 → 2,305 | 0.90 → 0.90 |
| 256 | 384 → 384 | 4,609 → 4,609 | 0.90 → 0.90 |
| 512 | 768 → 768 | 9,217 → 9,217 | 1.00 → 0.90 |
| 1,024 | 1,536 → **256** | 18,433 → **3,073** | 0.70 → 0.80 |
| 4,096 | 6,144 → **1,024** | 73,729 → **12,289** | 0.30 → 0.60 |

Those numbers are a historical exploratory compaction arm, not an enabled default. The final repair
removed the losing compaction path entirely: the 1,024-member case regressed from 0.70 to 0.80 ms
and the 4,096-member case regressed from 0.30 to 0.60 ms (OFF → ON), so no floor is claimed and no
new winning measurement is being implied. The production instanced lane keeps `mesh.count` at the
active member count, has no compaction switch or scratch census, and retains the no-allocation
reconcile guard. No Phase 4 spatial index was added.

Core tests cover the dense-prefix/reconcile path, the forced-visible material split, the failed
render assertion, and the steady-state constructor guard. A static regression check rejects a
direct fabricated-plan or `ProjectionMirror.apply` shortcut in the load harness.

### 1.3.11 PRD-238 consumer conformance (2026-08-29)

The real browser fixture uses `SceneRenderProjection` as the consumer, renders its `root`, and
checks source/projected raycasts plus `projection.inspect()` reconciliation. An initial unheaded
run reached SwiftShader and exited 1 with Three's `OperationError: Instance dropped in
popErrorScope`; the final headed recipe reached NVIDIA/Turing and passed on the actual WebGPU
renderer. This is a browser/WebGPU result, not a native claim.

Projected WebGPU run (exit 0):

```sh
node packages/playtest/dist/runner/cli.js examples/engine-load-test/playtests/projection-conformance.playtest.json --url http://127.0.0.1:5203/projection-conformance.html --server-command "pnpm --filter threenative-engine-load-test exec vite --host 127.0.0.1 --port 5203" --browser-recipe webgpu --headed --artifacts artifacts/prd-238-repair-playtest-webgpu-headed-final
```

Source WebGPU control (exit 0):

```sh
node packages/playtest/dist/runner/cli.js examples/engine-load-test/playtests/projection-conformance.playtest.json --url "http://127.0.0.1:5204/projection-conformance.html?mode=source" --server-command "pnpm --filter threenative-engine-load-test exec vite --host 127.0.0.1 --port 5204" --browser-recipe webgpu --headed --artifacts artifacts/prd-238-repair-playtest-webgpu-source-final
```

Both reports observed `sourceRaycastHit=true`, `projectedRaycastHit=true`,
`sourceRaycastDistance=7.5`, `projectedRaycastDistance=7.5`, `reconciled=true`, and state
`raycast-match-reconciled`; both screenshots were nonblank at ratio `1`, with zero console,
network, and runtime errors. The captured files are
`artifacts/prd-238-repair-playtest-webgpu-headed-final/after.png` and
`artifacts/prd-238-repair-playtest-webgpu-source-final/after.png`. A byte comparison found
`921,600` pixels, `0` differing pixels, and maximum channel delta `0`; the projected screenshot
was inspected and showed the cyan world geometry plus the conformance readout. Native execution is
**UNVERIFIED**: no native device or desktop lane was available in this repair round.

The final repair reran both browser commands after the render-marker, allocation-guard, and
compaction removals. Both exited 0 on NVIDIA/Turing and reported `renderSucceeded=true`, the two
raycast distances `7.5`, `reconciled=true`, state `raycast-match-reconciled`, nonblank ratio `1`,
and zero console, network, and runtime errors. The projected and source `after.png` captures were
byte-identical: SHA-256
`79a7ca015073d50096e10f0a385215fe627030beaf6e741a3bc5d1336e322a75`; `cmp` exited 0. Native
execution remains **UNVERIFIED**.

### 1.3.12 PRD-258 Phase 0 stopped at an unavailable real consumer (2026-08-30)

PRD-258 requires the existing five-soldier Bayview subject and forbids substituting a synthetic
rig. An isolated detached consumer at sandbox commit `e265288930c07c9762ff8002cdfd62984ea0a3d8`
was installed from local tarballs built from engine `68b32a65`. Its diagnostic source prepared five
same-camera arms (`control`, `hidden`, `frozen`, `flat`, `shadow-off`), reported actor/skeleton/
skinned-mesh counts, and added frame-section p50/p95 observations. The consumer typecheck and web
build both passed.

The runtime measurement did not begin. The committed `threenative.config.ts` requests
`raw-assets.manifest.json`, while the committed `public/` tree contains `assets.manifest.json` and no
file at the requested path. Vite therefore returned `<!doctype ...` for the JSON request. Browser
diagnostics observed HTTP 200, `Unexpected token '<'`, body state `LOADING 9 / 28`, zero canvases,
and `globalThis.__THREENATIVE_PLAYTEST_BRIDGE__ === undefined`. The playtest failed closed with
`TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING`; the prescribed doctor independently failed with
`TN_PLAYTEST_BRIDGE_MISSING`.

Package provisioning first exposed absent ignored tarballs and then stale cache filenames; exact
local builds fixed that setup, and the consumer install, typecheck and web build became green. Three
launch/verification rounds still stopped before measurement: the runner first rejected an invalid
`eq` assertion key, the corrected scenario failed capture provenance, and the prescribed doctor
confirmed the missing bridge. The doubtful assumption was that committed Bayview `e2652889` was a
self-contained current-engine consumer, so the run stopped rather than adding a fourth workaround.
No frame, render, animation, draw, material or shadow timing is claimed;
browser, desktop, Android and iOS are all **UNVERIFIED**. PRD-258 is blocked, not declined, and no
product API or package source was added. The isolated consumer remains at
`/home/joao/projects/threenative/sandbox-runs/prd258-fps-20260830` for a repaired rerun.

### 1.3.13 PRD-253 browser load-all is bound; native checkpoint is blocked (2026-08-30)

A detached Niagara Bistro consumer pinned `zeux/niagara_bistro` at `2bdb6a4` and loaded the
authored graph through ordinary Three.js. On headed 1280×720 WebGPU with a named NVIDIA/Turing
adapter, the green run measured 1,266,447,212 delivered bytes, 2,339,481,722 decoded resident CPU
bytes, 3,087,422,245 estimated GPU bytes, 4,371,768 visible triangles and 745 steady draws. Its
settled timestamps reported frame p50 14.0 ms, p95 34.4 ms and hitch max 822.2 ms. The existing
Abyss control on the same adapter passed at 183,855 triangles, 22 draws and render p95 2.7 ms.

The screenshot was inspected and the semantic channel was mutation-tested: forcing only
`visibleTriangles` to zero made `resource.state.visibleTriangles` fail while the direct renderer
series continued to observe 4,371,768 triangles. Kill A is therefore false; there is a real
residency/triangle/hitch problem.

Native desktop is **UNVERIFIED**. `pnpm native:build` produced a V8+Dawn host, but the consumer's
root-relative `/bistro/bistro.gltf` URL resolved against filesystem root and emitted
`TN_NATIVE_START_FAILED` before the playtest bridge. Three repair attempts stopped under the
repository rule. The required incumbent `scripts/asset-cost-census.ts` is also absent at the
baseline despite the PRD instructing Phase 0 to extend it. PRD-253 is blocked with no product code;
the full source pins, methods, caveats and unblock list are in
`docs/verification/prd-253-residency-census-2026-08-30.md`.

### 1.4 Secondary engine defects, after draw collapse

- **Native CSS-pixel parity:** native still exposes physical window dimensions with DPR 1
  (`runtime.cpp:2980`, `:2612`). Since PRD-228 the engine owns the cost portably —
  `renderer.resolutionScale` with an `"auto"` loop, reported in every frame-budget window — so a
  game no longer pays it by hand in generated source. The ratio itself is still a lie and the
  engine-level CSS-pixel contract is still open; it is PRD-228 Phase 1's remaining item.
- **High-refresh selection (closed):** the supported `display.maxFps` contract, Android frame-rate
  request and high-refresh mailbox policy are implemented. With Battery Saver off, the Pixel 8
  selects physical 120 Hz and Bayview sustains 63.45–72.52 fps. The evidence is in
  `docs/bugs/android-high-refresh-not-selected-2026-08-27.md`.

### 1.4.1 The allocation-free frame contract was never actually measured (2026-08-29)

`packages/core/__tests__/frame-budget-steady-alloc.spec.ts` asserted that 1.2M steady frames
produce zero GC events. **That assertion could not fail.** V8 delivers GC entries to a
`PerformanceObserver` through the event loop, never at the moment of collection, and the test ran a
fully synchronous window then called `observer.disconnect()` before yielding — so `events` was `[]`
whatever the frame did. Proven three ways, all on 2026-08-29:

| Probe | Result |
| --- | --- |
| Push 1.2M **escaping** closures through the tween's per-tick path | test stayed **green** |
| 3M escaping objects, observer read synchronously (`takeRecords()`) | 0 events, green |
| Same 3M objects, one `setTimeout(…, 0)` before reading | **42 events** |
| Original 1.2M-frame window with the yield restored | **22–130 events** — the frame is *not* allocation-free |

**One source found and fixed.** `FrameBudget.endFrame` built a fresh `IFramePhaseSample` every
frame and `FixedStepLoop.stepFrame` discarded it whenever `collectMetrics` was false — the shipping
default. The old docstring claimed V8 scalar-replaced it; it cannot, because the object escapes
across the method boundary and `endFrame` is far too large to inline. `endFrame(nowMs, wantSample)`
now skips building it, the loop passes `this.#collectMetrics`, and every window meter is pushed
either way. Observed red: revert the loop's second argument and the loop-level guard reports 240
built samples across 240 frames. Measured effect on the 1.2M-frame window: 80 → 63 GC events.

**The remainder is open and is not the tween's.** Per-process measurement (1.2M frames each,
`control` = arithmetic-only spin of the same length):

| Arm | GC events |
| --- | --- |
| control spin | 10 |
| stepFrame, no budget | 67 |
| stepFrame, budget, no tween | 123 |
| stepFrame, budget, curved tween | 114 |

**The instrument does not survive repair, so do not rebuild a bar on it.** Two windows in one
process report ~135 for whichever runs **first** and ~70 for whichever runs **second**, regardless
of which configuration each holds — the count reads warm-up order, not allocation. A bar tight
enough to catch a regression flakes on ordering; a bar loose enough to be stable asserts nothing.
The spec file now pins the per-frame properties deterministically instead (curve evaluated exactly
once per tick; no phase sample built when the loop discards it) and states this in full.

This invalidates the green in `prd-189-core-frame-allocations-2026-08-22.md` for any claim that
rested on GC-event counting. The claim that the fixed-step frame allocates nothing per frame is
**not established**, and finding the remaining ~57 events' worth is unowned.

### 1.5 Untried, named

**Removed from this list 2026-08-28:** the panel-mode blind spot (now read and gateable by
`device-preflight.mjs`, `requireRefreshHz`); `renderer.resolutionScale` as a portable contract
(landed `696e86e3`), its `"auto"` loop and its per-window reporting (PRD-228, §1.3.5); and the
question of whether this scene is fill-bound at all, which §1.3.5 settled at 9.94 ms/Mpx.

Dawn on Android; any GPU-side timestamp timing (the drain is wall-clock algebra, not correlated
spans); matched native/Chrome logical-pixel capture after draw collapse; cross-engine QuickJS/JSC
lanes; a cheap-scene >100 presents/s ceiling arm; attribution and removal of the earlier 60 Hz
run's 13 steady-state tail spikes.

---

## 2. The ledger — do not rebuild any of this

### 2.1 The lever graveyard (measured flat or worse)

| # | Lever | Measured |
| --- | --- | --- |
| 1 | F12 batched pass op stream (−1,900 crossings/frame) | +5 % (18.61 → 19.60); per-crossing tax ~1 µs |
| 2 | F14 / PRD-224 per-class binding tables | 0.02–0.3 ms/frame; `createCommandEncoder` 30,746 → 928 ns, Chrome parity — a large per-call win is not a frame win |
| 3 | Lever A render-pass wrapper pooling | flat, removed (targeted 0.647 ms of a 22 ms frame) |
| 4 | Lever C projection/upload tuning | −0.31 ms, inside spread |
| 5 | F10 frame latency 3 (FIFO) and 1/3 (mailbox) | flat both modes |
| 6 | A1 Dawn ↔ wgpu-native backend swap (desktop) | flat (11.85 vs 11.51 ms render.p50) |
| 7 | A2 backend removed entirely (desktop) | backend presence = 1.95 ms of 11.21 (17 %) |
| 8 | 720×1600 under FIFO | flat 19.89 |
| 9 | GC / V8 heap tuning | GC is 0.2 % of wall clock; heap never configured, costs nothing steady |
| 10 | FIFO → mailbox at 1080p | flat 19.77 |
| 11 | Composited web UI off (`ui.renderer: "native"`) | flat 20.67 |
| 12 | PRD-227 P2 fixed-shape wrappers (+ borrowed values, specialized ids, bounded uploads) | **worse than baseline** (megamorphic shares 15.58/13.03/11.84 % vs 10.42 % baseline, gate 3 %) |
| 13 | Change 1 packed frame stream, alone | work −40 % (bridge 9.31 → 0.81 ms desktop), fps flat (20.39 → 20.02) |
| 14 | Swapchain `desiredMaximumFrameLatency` infrastructure | kept, never an fps lever |
| 15 | Optimising three.js renderer internals inside the host | refused on the ownership rule |
| 16 | Cutting Bayview draw counts in `packages/` | reverted; game code is experiment-only |
| 17 | PRD-307 set-once environment prefilter | **refuted for steady-state**: `dirty/1 − static` = **+1.61 ms**, while `static − none` = **−0.37 ms**, a lower-bound/noise observation; an independent positive resolution observation is required. Bayview has no per-frame dirty path |

Also closed by evidence: the node-system megamorphic IC population is a **load-time compile
burst**, not per-frame churn (0 `Node.build()` calls/frame steady state); the `clock_gettime`
hotspot was the profiling instrument (two `steady_clock::now()` per replayed op ≈ 0.7 ms);
`FrameBudget.endFrame` allocates nothing on the heap (V8 scalar replacement, spec-pinned); the
~20 fps figure is real (SurfaceFlinger agrees within 2 %; `dumpsys gfxinfo` is a 5× flattering
WRONG meter for this app — it reads the Skia view hierarchy, not the game's SurfaceView).

**The backend question is closed by two independent routes** (A1 swap, A2 removal): no further
work on backend choice, wgpu-native upstream, or command-recording cost is justified by this
evidence. The megamorphic-IC owner is **three.js's node-material graph** (IC-log: `Node.js` /
`NodeBuilder.js` sites dominate; no native wrapper site appears) — not the bridge.

### 2.2 Landed real wins (kept; none moved device fps alone)

- **Change 1 packed stream** (PRD-227 P1): desktop `bridgeNs` 9.31 → 0.81 ms; work 23.19 → 14.32 ms.
  On device the same work left the JS meter into `frameReplay` (~8 ms).
- **Upload staging** (PRD-222): desktop +12 % write-heavy rung; device pair +21 % (18.95 vs
  15.70 fps, matched-warm — development-grade; Tier-1 rerun on a cool phone still owed).
- **Physics collision events** from Rapier's own transitions: 107.7 → 6.4 µs step at 128 bodies
  (was O(n²) pair polling); conformance row `native-physics-collision-events`.
- **Bug-hunt fixes** (2026-08-27): picking exclusion parent-walk skip (raycast A/B 12–16 → 5–9 ms
  @1,000 meshes); two dead per-frame sweeps in the projection; scan-internal classification pinned
  to `exactLaneReason`; canvas 2D dirty-tracking (upload gated on `hasDirtyPixels()`); bridge
  micro-fixes `caa78a11` (desktop render.p50 12.35 → 10.83).
- `platform::presentUncapped()` (`b3dc53d2`) — the Android present-mode channel; made two
  refutations possible.

### 2.3 What has ever moved the device number

| Change | fps |
| --- | --- |
| Upload staging ON vs OFF (matched-warm pair) | 18.95 vs 15.70 |
| **Mailbox + 720p** | **34.39 vs ~20** — zero code change |

### 2.4 Non-findings proven (do not "fix" these)

`FrameBudget.endFrame` sample object (scalar-replaced); `input.tick`, `scheduler.tick`, state
store, `Registry.sweep`, `TracerPool3D.update`, `GPUParticles3D.process`, viewport/canvas-layer,
loop `stepFrame`, physics plugin bulk writes, idle pumps, staging uploads — all measured clean.
Physics hot-path allocations (PRD-170) landed as hygiene, below instrument noise; string
contact-pair keys stay (BigInt alternative allocates more — do not re-derive). Core ordinary-frame
allocation-free contract (PRD-189) and template allocation probe (PRD-193) are standing tests,
kept green; their records were evidence, not open work.

---

## 3. Method rules — paid for in wasted sessions, binding

1. **Every A/B a same-session pair.** Discard the first TWO whole runs of a session, not just
   window 1 (run 1 measured 26.05 vs 11.4–12.0 ms after, same binary).
2. **Desktop is never an fps verdict.** Xvfb/`:0` throttles presents (present reads ~33 ms there);
   judge desktop by `render.p50` / `work = threadCpu − present`. Warmed, within-arm spread is
   0.6 ms. The device owns fps.
3. **Cross-check every fps claim** against `dumpsys SurfaceFlinger --timestats`; never `gfxinfo`.
4. **Cold launches verified:** `am force-stop` → `pidof` empty → `am start -W`. An `am start`
   race once nearly measured a stale process.
5. **Verify the binary carries the change** (`strings` the packaged `.so` for your marker) before
   trusting a number. Never trust a binary you did not watch being linked; sha256 and revision-name
   every artifact.
6. **Pre-register any lever**: `predicted ms/frame = calls/frame × (our ns/call − Chrome ns/call)`
   from `TN_BRIDGE_BY_NAME` on the actual scene; refuse anything predicting < 2 ms. This rule
   retroactively refuses half the graveyard.
7. **An ablation arm removes a complete recording path or none of it** — half-ablations return
   plausible wrong numbers instead of crashing.
8. **A GC-observer window that never yields measures nothing.** V8 queues GC entries to the event
   loop; a synchronous window that disconnects before yielding always reads `[]`, and the green is
   vacuous. Yield once (`await setTimeout(…, 0)`) before reading, and prove the observer is live in
   the same file. Even repaired, the count is dominated by warm-up order — first window ~135, second
   ~70, same configurations — so it cannot carry a pass/fail bar. See §1.4.1.
9. **No cross-session absolutes.** The 22.2 ms desktop baseline does not reproduce (machine state
   ~2.3×, bundle drift). Device pixel counts vs desktop differ 2.8×; never state a desktop
   millisecond as a device one. Profiled builds inflate absolutes — use ratios.
10. **Live windows only** on device, or an end-screen idle reads as a 174 fps "win". Classify
    windows before comparing. **The old test — `update.mean ≥ 3 ms` — is dead:** PRD-227 cut the
    update phase to 0.46 ms in steady state, so it now rejects every live window (§1.3.5). Use: not
    one of the two windows after launch, `substeps.mean ≥ 1`, `update.mean > 0.05`, and record the
    `update.mean` series so the classification can be checked rather than taken on trust.
11. Red-green with named mutations; never claim a gate you did not run; paste output. Device
    preflight (thermal/battery) per `packages/runtime-native/AGENTS.md`. Commit path-limited as
    you go — another lane may hold this tree.

---

## 4. Instruments

| Meter | Where | What it gives |
| --- | --- | --- |
| `TN_FRAME_BUDGET:{json}` | JS-side (web + native), 300-frame windows | fps, presented/frame/substeps p50–p99, phases `hostGap/update/render/overlay/residual`, hitches. Emitted `packages/core/src/frame-budget.ts`; on by default (`frameBudget: false` silences the marker, not the measurement). |
| `TN_HOST_GAP:{json}` | native host loop only (`packages/runtime-native/src/runtime.cpp`) | Between-callback truth: period p50 + segments `events, io, audio, timers, microtasks, preFrame, frameDrain, frameReplay, present, gpuDrain, devicePoll, endFrameOther, handles, screenshot` (each p50/mean). `gpuDrain` is diagnostic-build-only. Σ segments ≈ hostGap must hold (±0.6 ms). |
| `TN_ANDROID_JS_NATIVE` | profiled host (`-DTN_ANDROID_JS_PROFILE=ON`) | `bridgeNs`, `bridgeOverheadNs`, `bindingNs`, `commandNs`, `bridgeCalls`, `bridgeArgs`, `threadCpuNs` per frame. |
| `TN_FRAME_HITCH` / `TN_COLD_START` / `stall_budget.h` | host | hitches; launch-phase attribution (PRD-218). |
| `gpubench.js` probe | desktop + Chrome | per-call ns: `writeBuffer` ~1.1–1.2 µs native vs 431 ns Chrome; `buffer.size` 5 ns (faster than Chrome's 21 — proves the cost is call-path-only). Versioned: `docs/verification/artifacts/prd-224-gpubench-2026-08-28.js`. |
| simpleperf + `TN_ANDROID_JS_PROFILE` | device | CPU attribution; symbolize against unstripped `libv8android.so` (embedded builtins = the unsymbolized 1.6 MB; JIT code = the `unknown` DSO). |
| SurfaceFlinger `--timestats` / `--latency` | device | independent fps + present-interval histogram on the game's `(BLAST)` layer. |
| `device-preflight.mjs` / `doctor --device` | device | thermal/battery gate (shared battery floor 50 %, hot-start 40 °C). |

### 2026-08-30 — stale host-gap lane adjudication

`codex/hostgap-instrumentation` is not a missing feature. Its seven commits predate and are
superseded by the broader host meter on `main` (`73e0baec`, extended by `6502502c`). The stale
lane's `TN_HOST_GAP_V2` owns nine coarse phases through TypeScript lifecycle hooks. The shipping
`TN_HOST_GAP` meter owns fourteen host-side phases, including the frame drain/replay, present,
device-poll and diagnostic GPU-drain boundaries, while current `FrameBudget` also reports surface
state and GPU milliseconds. Replaying the stale branch would replace newer evidence and regress
that reporting, so no stale code or old verification record was landed.

The current code was rebuilt and executed from the isolated
`feature-mining-prd254-hostgap-audit-20260830` worktree. Focused tests passed **33/33** (15 frame
budget, 2 GPU-drain wiring, 16 playtest perf parser). The Linux V8+Dawn host then rendered 300
frames at 1280×720 with a visibly nonblank screenshot and emitted adjacent real-runtime markers:
`presented.p50` 28.27 ms, `render.p50` 0.86 ms, `hostGap.p50` 25.19 ms, and host period p50
28.265 ms. `threenative-playtest perf --file ... --require-windows 1 --text` passed and attributed
the host-gap p50 chiefly to `present` (24.901 ms), with `frameReplay` 0.085 ms. The named negative
control changed the shipping `gpuDrain` phase label to `gpuDrainRemoved`: the focused test turned
red at `/kGpuDrain[\\s\\S]*"gpuDrain"/`, then returned **2/2 green** after restoration.

`SDL_AUDIODRIVER=dummy pnpm native:verify:desktop` passed audio, stability, the 300-frame core
gate, physics, and every later native contract except the pre-existing
`threenative-bindings-creation-test` (`proof: creation-refusal`); that unrelated failure also
appeared in the preceding PRD-254 V8 control run. The detached tarball sandbox protocol does not
apply: this is internal instrumentation with no public capability or game-authored behavior to
install. The real native host plus the playtest perf consumer are the observable proof boundary.

### 2026-08-30 — stale frame-budget lane adjudication

`worktree-agent-a15fb02a370974a26` is not missing work. Its four-commit tree and main's squash
`31cba321` differ only in a later two-line correction to `native-runtime-census-2026-08-16.md`;
the frame budget, public capability, generated instructions, scenario, and fail-closed playtest
performance gate are identical. Replaying the stale history would add no behavior. PRD-214 stays
PARTIAL because its optimization phases 1–2 remain open, not because this Phase 0 instrument is
absent.

The isolated repo audit passed **81/81** focused assertions: 72 core frame-budget/game/playtest
tests and 9 playtest performance-gate tests. The template suite passed 29 unrelated contracts, then
its minimal-scaffold typecheck passed after the fresh worktree's physics package was built; no
product assertion failed. Three attempts to run the in-repo scenario through a managed package
script stopped before assertions because Vite did not receive the runner's host/port flags. That
path was stopped after the third setup failure rather than treated as evidence.

The detached packed-tarball sandbox at
`/home/joao/projects/threenative/sandbox-runs/prd254-frame-budget-20260830/prd254-frame-budget`
contained zero readable framework-source lines. Its typecheck passed, then a real NVIDIA Turing
WebGPU run observed 180 frames, clean diagnostics, a nonblank 1280×720 capture, and populated
`hostGap/update/render/overlay/residual` phase samples; the latest budget windows reported
`render.p95` 2.8 and 6.6 ms. The game-owned scenario required `render` p95 ≤33 ms, frame p95
≤66 ms, and fps ≥15 and passed. Its named mutation changed only the `render` ceiling to 0 ms;
the same run failed `TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED` with observed 3.7 ms, then returned
green after restoration. The generated `pnpm test` then passed all four sandbox scenarios together.
The sandbox README maps the feature to PRD-214 and this proof. Mobile was not re-executed in this
audit; PRD-214 retains its original physical-Pixel evidence and its open optimization phases.

### 2026-08-30 — stale GPU-memory guidance lane adjudication

`worktree-agent-a868a44e113b83123` is not missing work. Its PRD-213 Pixel 8 attribution, generated
memory recipe, template pointer and instruction-budget allowance are already on main at
`b378e67f`. Every lane path is byte-identical at that commit except
`instruction-budgets-2026-08-23.md`, where main also preserves the concurrently integrated PRD-209
and PRD-214 measurements. Replaying the stale commit would erase those measurements and add no
product behavior. PRD-213 remains PARTIAL for its queued Phase 2 physical-device before/after, not
for this already-shipped Phase 1/3 guidance.

The isolated contract baseline passed the bounded-reference scaffold assertion and generated
instruction audit. A named mutation changed `agent-docs/mobile-memory-budget.md` to the nonexistent
`agent-docs/mobile-memory-budget-removed.md` in the performance fragment; the instruction contract
turned red with `MIRROR_DRIFT`, then returned green after exact restoration. The fresh-worktree
minimal-scaffold typecheck was stopped after three dependency-build attempts still failed; the
doubtful assumption was that only missing workspace build outputs caused that unrelated fixture
failure.

The detached packed-tarball sandbox at
`/home/joao/projects/threenative/sandbox-runs/prd254-gpu-memory-20260830/prd254-gpu-memory`
contained zero readable framework-source lines. Its generated `AGENTS.md` names the measured
`~500MiB` Pixel 8 driver floor and `48MiB` dual-use equirect cost, resolves the shipped
`agent-docs/mobile-memory-budget.md` recipe, and mirrors the pointer in `CLAUDE.md`. The project
typechecked, then all three generated headed WebGPU scenarios passed on a named NVIDIA Turing
adapter with clean diagnostics. The inspected 1280x720 atmosphere capture visibly contained the
HUD, player, platform and lighting. This audit made no new Android measurement or physical-device
claim; it accepts the recorded Pixel 8 evidence already on main.

**Desktop reading recipe** (render.p50, never fps):

```sh
cd <bayview>/.threenative/build
SDL_VIDEODRIVER=x11 sh <engine>/scripts/xvfb.sh \
  <engine>/packages/runtime-native/build/tn-linux/mystral run game.js --frames 900
# parse TN_FRAME_BUDGET + TN_HOST_GAP lines; window 1 discarded
```

**Device reading recipe** (fps with cross-check):

```sh
adb shell am force-stop com.threenative.bayview && adb logcat -c
adb shell am start -W -n com.threenative.bayview/com.threenative.runtime.MystralActivity
adb logcat -d | grep -o 'TN_FRAME_BUDGET.*' | tail -1
adb logcat -d | grep -o 'TN_HOST_GAP.*'  | tail -1
adb shell dumpsys SurfaceFlinger --timestats -dump   # cross-check
```

Building a device APK: `THREENATIVE_RUNTIME_SOURCE=<engine>/packages/runtime-native` +
`THREENATIVE_GRADLE_ARGS` (engine `package-android.mjs`) — see
`packages/runtime-native/AGENTS.md`. Controls: `debug.threenative.present_uncapped=1` (mailbox),
`-PthreenativeFrameLatency`, `-PthreenativeGpuDrainProfile=true` (diagnostic drain).

---

## 5. Closed questions, one line each

| Question | Verdict |
| --- | --- |
| Is the meter lying? | No — SurfaceFlinger agrees within 2 %; audited 2026-08-27. (`gfxinfo` is the wrong meter.) |
| Backend (wgpu-native vs Dawn)? | Closed — flat swap on desktop; removal = 17 % of frame. A1 on **device** is untried but parked. |
| Binding-table install tax? | Real per call, fixed for two classes, ≈0.3 ms of a frame. Phase 3 bounded before writing. |
| Wrapper shapes / megamorphic ICs? | Falsified as our defect — owner is three.js node-material graph; P2 made it worse. |
| Crossing count? | ~1 µs/crossing; F12's −1,900 bought +5 %. Per-value cost is the real seam term. |
| GC / V8 heap? | 0.2 % of wall clock steady. Not a lever. |
| Fill rate / resolution? | Material at 1080p: GPU-frame-time ≈63 ms and native draws 9.9× Chrome's landscape pixels. Not sufficient: Chrome is still ~30 fps at 864×303. |
| Present mode / swapchain depth? | Not the limiter (mailbox arm flat at 1080p; latency flat everywhere). |
| Composited web UI overlay? | Measured free twice. Not the owner. |
| Host-loop segments (events/audio/timers/microtasks/handles/screenshot)? | All < 1 ms on device steady state. Dead. |
| Is native slower than Chrome because of Android? | No matched parity claim remains. Chrome is ~30 fps at 864×303; native is ~20 fps at 2400×1080. The shared draw workload is primary and native's physical-pixel viewport compounds it. |
| Is native fast enough in principle? | Yes — fox platformer, 2026-08-11: ~106 fps median uncapped vs Godot 53.7–59.5 (unfair comparison, different games — see §6). |

---

## 5a. The async pipeline entry, per backend — PRD-327 Phase 0, 2026-09-03

The mechanism question PRD-327 refused to assume: does `wgpuDeviceCreateRenderPipelineAsync`
actually leave the calling thread? Measured by `tests/async_pipeline_thread_test.cpp`
(`threenative-async-pipeline-thread-test`), which times a synchronous compile of a deliberately
heavy shader against the async entry's own call, on a differently-salted shader so the second arm
cannot be timing a cache hit, and destroys the descriptor the instant the call returns.

| backend | `syncMs` | async entry usable | main thread inside the call | callback at | verdict |
| --- | ---: | --- | ---: | ---: | --- |
| Dawn (desktop) | 73.4 ms | **yes** | **0.33 ms** (0.45 %) | 244 ms | leaves the thread; snapshots the descriptor |
| wgpu-native (Android, iOS) | 4.2 ms | **no** | — | — | **`unimplemented!()`; aborts the process** |

An earlier Dawn run on a colder shader cache read `syncMs 363.79`, `callMs 0.115` — 0.03 %. Both
runs clear the pre-registered `Tcall < 0.25 × Tsync` bar by more than two orders of magnitude.

**wgpu-native v25.0.2.2 does not implement it at all.** It does not return an error; it panics
non-unwinding and takes the process with it:

```
thread '<unnamed>' panicked at src/unimplemented.rs:81:5:
not implemented
  19: wgpuDeviceCreateRenderPipelineAsync
thread caused non-unwinding panic. aborting.
```

which is why the probe runs in a forked child — otherwise the contract test cannot report the very
thing it exists to find out, and "this backend cannot" would be a fact hardcoded from the day
someone first tried it rather than a measurement taken on every run.

### The mechanism decision

**Branch (b) — a host compile thread pool calling the synchronous entry — for both backends.**

Branch (a) is available on Dawn and measured excellent there, and it is still the wrong choice:
the platform with the defect is Android, whose backend has no async entry to call, so the pool has
to exist regardless. Shipping (a) on desktop as well would mean two mechanisms, two completion
paths and two sets of lifetime rules for one feature, on the platform whose launch is already
524 ms. Dawn's async entry is recorded here as measured-and-available so a later change has the
number without re-running the probe.

`syncMs` differs 17× between the backends on the same shader because Tint and naga are different
compilers and wgpu-native defers more work to first use. That makes the ratio the comparable
quantity, never the absolute — do not quote 4.2 ms as "wgpu compiles faster".

### A side effect worth keeping

No contract test could be linked in a wgpu build directory at all before this: wgpu-native and SWC
are both Rust staticlibs and each carries its own `rust_eh_personality`, so every target linking
`mystral-runtime` there died at

```
libswc.a(std-...rcgu.o): in function `rust_eh_personality':
multiple definition of `rust_eh_personality'; libwgpu_native.a(std-...rcgu.o): first defined here
```

The `mystral` executable had already named that exact pairing and opted out of the error; the
runtime had not, and gated its own opt-out on V8, which a wgpu preset does not use. The gate now
names the pairing instead of the engine, and `threenative-timestamp-query-test` links there too.
This is what made wgpu-native — the backend Android ships — the one backend no contract test could
be run against.

---

## 5b. Launch under V8 — PRD-328, 2026-09-03

Until this date the launch instrument could not run on the engine that ships. The compile and
execute markers existed only in `quickjs_engine.cpp`, which has not been the shipped engine on any
platform since 2026-08-16, and the desktop CLI emitted no launch markers at all. Every quotable
JavaScript parse-and-compile number was therefore the QuickJS one from 2026-08-11 (230 ms, 8.0 %).

**Phase 0 red, desktop**, `build/tn-linux/mystral` at `6cbb2c7d`, native-smoke, 300 frames — the
entire launch, one line:

```
TN_COLD_START:{"segment":"first_frame","atMs":86.243}
```

and the new marker contract run against that same pre-change binary:

```
desktop core gate failed:
TN_COLD_START_MARKER_MISSING:process
TN_COLD_START_MARKER_MISSING:runtime_created
TN_COLD_START_MARKER_MISSING:game_eval_begin
TN_COLD_START_MARKER_MISSING:compile_begin
TN_COLD_START_MARKER_MISSING:compile_complete
TN_COLD_START_MARKER_MISSING:execute_begin
TN_COLD_START_MARKER_MISSING:execute_complete
```

**Phase 2 green, desktop.** V8 13.1, Dawn, `CMAKE_BUILD_TYPE=Release` (-O2) read from the binary's
own CMake cache, five launches, `examples/native-smoke`:

```
node packages/runtime-native/scripts/measure-cold-start.mjs --desktop --launches 5
```

| segment | median | share |
| --- | ---: | ---: |
| host bring-up (`process` → `runtime_created`) | 328 ms | 62.5 % |
| pre-eval setup | 0 ms | 0.0 % |
| eval entry (read + transpile) | 12 ms | 2.4 % |
| **JavaScript parse and compile** | **51 ms** | **9.7 %** |
| post-compile setup | 0 ms | 0.0 % |
| bundle top-level execution | 45 ms | 8.6 % |
| first rendered frame | 88 ms | 16.8 % |
| **total** | **524 ms** (p95 600, range 503–600) | |

`residualMs` in `TN_STALL_SEGMENTS` fell from 65.5 ms to 64.7 ms on the same scene because the JS
span now sits *before* the stall budget's window rather than inside its unattributed remainder;
the 96 ms of compile-plus-execute that used to be invisible is now named.

**Phone: UNVERIFIED at time of writing.** The Pixel 8 (`shiba`, `192.168.1.192:5555`) is attached
over Wi-Fi ADB and thermally clean (status 0 NONE, 28 °C) but sat at 36 % battery and charging,
under the 50 %-and-discharging bar `device-preflight.mjs` enforces. No phone number is claimed
here. The desktop half is what this section reports.

**Engine versions** are pinned by `packages/runtime-native/tests/js-engine-version-skew.test.mjs`;
the desktop archive is V8 13.1 and the Android prebuilt is V8 11.0, so the two are not the same
compiler and the desktop share above may not be read as the phone's.

### The code-cache decision — PRD-328 Phase 3

The pre-registered rule, quoted verbatim from the PRD before any number existed:

> If `compile + execute` on the phone is **≥ 300 ms median** or **≥ 10 % of launch**, file
> `PRD-33X — the bundle is not parsed as source twice` […] Otherwise write the graveyard row.

The rule names **the phone**, and the phone lane did not run. The decision is therefore **deferred,
not taken**, and the desktop numbers are recorded as what they are: 51 ms compile (9.7 %) and 45 ms
top-level execution (8.6 %) on a 524 ms launch of a small bundle. Two things must be true before
anyone reads the desktop share as a verdict:

1. **The bundle is not representative.** `native-smoke` is a smoke scene; Bayview's bundle is
   roughly 4 MB and parse time scales with bytes. A 51 ms figure on native-smoke predicts nothing
   about the game whose launch is 14 s.
2. **The engines differ.** Desktop is V8 13.1, Android is V8 11.0.

What is settled is that the question is now *askable*: the instrument runs on the engine that
ships, on both lanes, and `pnpm native:verify:desktop` fails when a marker goes missing. Re-run
`--desktop` against a Bayview-class bundle and `--device` against the phone at ≥ 50 % battery, then
apply the rule unchanged.

---

## 6. Older results still worth quoting

- **Engine load test (PRD-117, 2026-08-15), scorer-equivalence-gated:** ThreeNative wins
  instanced rendering on web/desktop/mobile, 3.2–3.9× vs Godot 4.7.1 at scale (web 16,384 cubes:
  4.60 vs 17.95 ms p50), 4× on the knee. Loses unbatched per-object on web — that path is plain
  three.js, and a standalone plain-three page shows three's WebGPU backend already beating its own
  WebGL backend there: the cost is JS issuing thousands of draws, not a renderer defect.
- **ThreeNative vs plain three.js (SceneCollapse):** 11.6× on the 2026-08-15 workload — by
  removing draws, not by drawing faster. `defineGame` constructs collapse unconditionally.
- **Fox platformer on Pixel 8 (2026-08-11):** 60 fps sustained while played (253 windows, zero
  below 60; median 106 uncapped) after folding camera-parented HUD draws. Beats Chrome and Godot
  on *its* scene; must not be quoted as an engine comparison.
- **Launch stall (PRD-218, 2026-08-24):** the 12–14 s post-asset-load stall is first-frame
  pipeline compilation, now self-reporting via `stall_budget.h`; heat session attributed to
  sustained render + compile, with two runs thermal-confound-flagged.
- **Mobile perf probe (2026-08-24):** loading screen 15–20 s to playable on device, dominated by
  that one stall; wrong-package control incident is why every arm now verifies package id.

<a id="prd-117-browser-comparison-2026-08-14"></a>
### PRD-117 browser comparison — 2026-08-14

Product-to-product: each arm is what its engine actually ships to a browser surface. The arms use
different rendering backends by construction — ThreeNative WebGPU and Godot 4.7.1 WebGL2 — so no
line below is a graphics-API claim.

The knee is the largest object count at or below 20 ms p95. The run used 1280×720, 60 Hz, vsync
off, three repeats per rung, and 480 samples per repeat after 120 discarded warm-up frames.

| mode | knee — ThreeNative | knee — Godot 4.7.1 |
|---|---:|---:|
| L1 | 1,024 | 4,096 |
| L2 | 16,384 | 4,096 |

| mode | N | ThreeNative p95 ms | Godot p95 ms | ratio |
|---|---:|---:|---:|---:|
| L1 | 256 | 2.60 | 1.84 | 1.41× |
| L1 | 1,024 | 9.30 | 5.94 | 1.57× |
| L1 | 4,096 | 34.10 | 19.29 | 1.77× |
| L1 | 16,384 | 116.40 | 63.69 | 1.83× |
| L2 | 256 | 2.30 | 1.03 | 2.22× |
| L2 | 1,024 | 2.70 | 2.72 | 0.99× |
| L2 | 4,096 | 2.00 | 7.14 | 0.28× |
| L2 | 16,384 | 8.10 | 27.36 | 0.30× |

#### Arm `tn-web`

- engine: ThreeNative workspace
- build: release Vite dev build, `three/webgpu` render path; the `defineGame` loop was not measured
- driver: `three/webgpu` `WebGPURenderer`
- adapter: `nvidia / turing`
- device: desktop Chromium on Linux, 1280×720 @ 60 Hz, vsync off

| mode | N | p50 ms | p95 ms | draws | triangles | visible | repeats × samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| L1 | 256 | 1.50 | 2.60 | 164 | 1,947 | 163 | 3 × 480 |
| L1 | 1,024 | 5.20 | 9.30 | 629 | 7,527 | 628 | 3 × 480 |
| L1 | 4,096 | 21.90 | 34.10 | 2,469 | 29,607 | 2,468 | 3 × 480 |
| L1 | 16,384 | 96.40 | 116.40 | 9,809 | 117,687 | 9,808 | 3 × 480 |
| L2 | 256 | 1.20 | 2.30 | 3 | 3,075 | 256 | 3 × 480 |
| L2 | 1,024 | 1.30 | 2.70 | 3 | 12,291 | 1,024 | 3 × 480 |
| L2 | 4,096 | 1.20 | 2.00 | 3 | 49,155 | 4,096 | 3 × 480 |
| L2 | 16,384 | 5.20 | 8.10 | 3 | 196,611 | 16,384 | 3 × 480 |

Knees at ≤20 ms p95: L1 1,024 and L2 16,384.

#### Arm `godot-web`

- engine: Godot 4.7.1-stable (official)
- build: release Godot export; rendering method read from the engine at runtime
- driver: `gl_compatibility / opengl3`
- adapter: WebKit WebGL / OpenGL ES 3.0 (WebGL 2.0, OpenGL ES 3.0 Chromium)
- device: Web GenericDevice, 1280×720 @ 60 Hz, vsync off

| mode | N | p50 ms | p95 ms | draws | triangles | visible | repeats × samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| L1 | 256 | 1.29 | 1.84 | 171 | 2,042 | 171 | 3 × 480 |
| L1 | 1,024 | 3.66 | 5.94 | 658 | 7,886 | 658 | 3 × 480 |
| L1 | 4,096 | 13.37 | 19.29 | 2,582 | 30,974 | 2,582 | 3 × 480 |
| L1 | 16,384 | 54.20 | 63.69 | 10,246 | 122,942 | 10,246 | 3 × 480 |
| L2 | 256 | 0.70 | 1.03 | 2 | 3,074 | 2 | 3 × 480 |
| L2 | 1,024 | 1.70 | 2.72 | 2 | 12,290 | 2 | 3 × 480 |
| L2 | 4,096 | 5.08 | 7.14 | 2 | 49,154 | 2 | 3 × 480 |
| L2 | 16,384 | 19.49 | 27.36 | 2 | 196,610 | 2 | 3 × 480 |

Knees at ≤20 ms p95: L1 4,096 and L2 4,096.

<a id="prd-117-browser-detail-2026-08-14"></a>
### PRD-117 browser detail — 2026-08-14

This is the detailed execution record for the browser half of PRD-117. Two of four arms ran on one
machine on this date; both Android arms did not. Raw run reports were under the engine-load-test
artifact directory. The product-to-product comparison above is intentionally not a graphics-API
comparison: ThreeNative uses WebGPU and Godot's 4.7.1 web export uses WebGL2.

#### Result and scope

The knee definition and experimental controls are the ones recorded above: largest object count at
or below 20 ms p95, 1280×720, three repeats, 480 samples per repeat, 120 warm-up frames. The L1/L2
p50/p95 table, arm metadata, counts, and ratios are consolidated in the browser-comparison record.
L3 is the L1 source file unchanged with `SceneCollapse` enabled, not a third authoring mode; Godot
has no equivalent and its same-source answer is L1. L3 holds 16,384 where Godot L1 holds 4,096.

An extended L2-only ladder found the ThreeNative knee beyond the original ladder:

| N | ThreeNative L2 p95 | Godot L2 p95 | ratio |
|---:|---:|---:|---:|
| 16,384 | 7.00 ms | 22.12 ms | 0.32× |
| 65,536 | 25.50 ms | 73.86 ms | 0.35× |
| 262,144 | 129.30 ms | 332.48 ms | 0.39× |

The publishable browser statement is: on this desktop browser, a per-cube node sustains about 1,000
cubes on ThreeNative and 4,000 on Godot at 50 fps; batching sustains about 16,000 on ThreeNative
and 4,000 on Godot. The ratio remains stable across the 16× ladder in both modes.

#### Findings and controls

- At 16,384, ThreeNative issued fewer draws than Godot (9,809 vs 10,246) but cost 1.8× the frame
  time, about 11.9 µs vs 6.2 µs per visible draw. This is vanilla `three/webgpu` bookkeeping and
  V8, not a `packages/` defect; the per-draw attribution is an inference, not a profile. L2 shows
  the GPU and batched path are healthy, while `SceneCollapse` is an unmeasured opportunity.
- The measured arm drives `three/webgpu` directly and excludes `defineGame`, the framework loop,
  scene system, and plugins. Every ThreeNative number is therefore a floor for a game.
- `WEBGPU_BROWSER_ARGS` begins with `--ozone-platform=x11`; with that flag the adapter is
  `google / swiftshader` (software) in bundled and system Chromium, while without it the adapter is
  `nvidia / turing`. Earlier evidence made under those flags may describe SwiftShader, not the GPU;
  whether screenshot gates using those flags are affected was left unanswered.
- Three.js resets `renderer.info` on its own rAF. The first benchmark read zero draws and zero
  triangles, which would have disabled the draw-call half of the equivalence gate while reporting
  pass. Setting `info.autoReset = false` and reading before yielding fixed it.
- The first equivalence gate kept only the last repeat, hiding a divergent `positionHash`. Grouping
  all repeats and requiring one hash within and across arms fixed the hole; the hand-edited refusal
  proof and regression test remain part of the record.
- Repeating the tn-web ladder about 15 minutes later produced the same knees but this variance:

  | rung | run 1 p95 | run 2 p95 | drift |
  |---|---:|---:|---:|
  | L1 @ 1,024 | 6.40 ms | 9.30 ms | +45% |
  | L1 @ 4,096 | 26.20 ms | 34.10 ms | +30% |
  | L1 @ 16,384 | 107.20 ms | 116.40 ms | +9% |
  | L2 @ 16,384 | 5.80 ms | 8.10 ms | +40% |

  The knee is stable (L1 1,024, L2 16,384), individual values should be treated as ±30%, and the
  published second run was not taken while the desktop was otherwise idle.
- The original PRD contradicted its 60 Hz/vsync requirement and its instruction to disable vsync.
  Both arms therefore used `--disable-gpu-vsync --disable-frame-rate-limit` for Chromium and
  `VSYNC_DISABLED` for Godot; `display.vsync` was added and the gate rejects disagreement.
- Godot's desktop Forward+ Vulkan arm on an RTX 2080 auto-batches an L1 rung (2 draws for 2,340
  visible at 4,096), while its web arm reports 2,582 draws for 2,582 visible. The fair comparison
  is Godot L1 against ThreeNative L3, not ThreeNative L1.
- L3 and L2 had identical draw and triangle counts at every rung:

  | N | L1 p95 | L3 p95 | L2 p95 | L3 draws | L3 triangles |
  |---:|---:|---:|---:|---:|---:|
  | 256 | 2.20 ms | 2.00 ms | 2.20 ms | 3 | 3,075 |
  | 1,024 | 6.70 ms | 2.20 ms | 1.80 ms | 3 | 12,291 |
  | 4,096 | 24.40 ms | 2.00 ms | 1.70 ms | 3 | 49,155 |
  | 16,384 | 95.90 ms | 8.50 ms | 5.60 ms | 3 | 196,611 |

  L3 was 12× faster than L1 at 4,096 and 11× at 16,384, crossed 20 ms at 65,536 (29.5 ms), and
  held 10.0 ms at 16,384 on the extended run. It cost 8.5 ms versus L2's 5.6 ms because of
  per-frame transform refresh. The pass is a capability, not a default: the load test constructs
  it, while a `defineGame` game does not yet receive it.
- `visibleObjects` is engine-specific; the gate compares draws and triangles instead.

#### Why the comparison is fair

The same integer LCG is written in `examples/engine-load-test/src/workload.ts` and
`benchmark/godot-load-test/load_test.gd`; each arm hashes the first eight positions after
millimetre quantisation:

| rung | ThreeNative | Godot |
|---|---|---|
| N = 256 | `94e73aef` | `94e73aef` |
| N = 1,024 | `78812d31` | `78812d31` |
| N = 4,096 | `e9a32f01` | `e9a32f01` |
| N = 16,384 | `3acfd9c3` | `3acfd9c3` |

The camera is a pure function of frame index, so frame 317 frames the same cubes on the slow and
fast arm. Runtime backend/build reporting was:

| arm | driver | adapter | build |
|---|---|---|---|
| `tn-web` | `three/webgpu WebGPURenderer` | `nvidia / turing` | release |
| `godot-web` | `gl_compatibility / opengl3` | WebKit WebGL / OpenGL ES 3.0 (WebGL 2.0, OpenGL ES 3.0 Chromium) | release |

Both exports ran release; PRD-066 measured the release-export trap as 5.5× on the same phone and
source. Chromium masks the Godot WebGL renderer string, so its software status is evidence rather
than proof.

The N=0 floor was 1.50/2.50 ms for tn-web L1/L2 and 0.91/0.71 ms for Godot L1/L2. Every 4× ladder
step raised p95 in both modes and arms, showing the ladder reached the renderer rather than only
measuring the driver loop. Four intentionally edited reports refused with exit 1:

```text
TN_BENCH_NOT_EQUIVALENT: L2@256 positionHash (repeats disagree within an arm): tn-web=94e73aef,deadbeef godot-web=94e73aef
TN_BENCH_NOT_EQUIVALENT: - display.refreshHz: tn-web=120 godot-web=60
TN_BENCH_NOT_EQUIVALENT: - build.type: tn-web=debug godot-web=release
TN_BENCH_NOT_EQUIVALENT: L1@4096 drawCalls (left arm auto-batched L1): tn-web=1 godot-web=2582
```

The unedited pair exited 0 and published; fourteen scorer tests cover empty series, missing driver,
and repeat-divergence cases.

#### Unmeasured and reproduction status

Android was unmeasured: the ThreeNative arm needed the Android runtime built and the Godot arm
needed a release APK export plus on-device transport. The attached Pixel 8 and installed NDK did
not change that. iOS was not attempted because there was no Apple hardware. Desktop native was
conditional and not run. The `defineGame` loop and `SceneCollapse` default were excluded from the
browser claim. The historical gate record marked typecheck, lint, and budgets green for its then
benchmark setup; this statement is retained as historical evidence, not a current gate result.

```sh
pnpm bench:engines --arm tn-web        # artifacts/engine-load-test/tn-web.json
pnpm bench:engines --arm godot-web
pnpm bench:engines:report
```

Both arms need a display, system Chromium with hardware WebGPU, and `BENCH_BROWSER_BIN` may select
the binary. `--out <name>` prevents diagnostic runs from overwriting the published ladder. Godot
needs `godot` on `PATH` with 4.7.1 export templates. Artifacts include the two ladder JSON files,
floor and L2-extension JSON files, and full stdout logs.

<a id="prd-117-android-quickjs-era-record-2026-08-14"></a>
### PRD-117 Android / QuickJS-era record — 2026-08-14

This historical Android record covers a Pixel 8 (`37251FDJH0037Z`, shiba), Android 17, Mali-G715.
ThreeNative used its C++ runtime with QuickJS; Godot 4.7.1 used an Android export on OpenGL ES 3.2.
Both signed APKs were release builds installed from this repository. Battery was 21–22% on USB
power, below the PRD's ≥50% requirement, so every figure is provisional; same-session comparison
is meaningful but absolute device evidence is not publishable, and the Android criterion remains
unsatisfied.

#### Superseded V8 result and desktop rerun

The QuickJS result was superseded on 2026-08-15 by V8:

| Pixel 8, 16,384 cubes | frame p50 | measured JS/frame |
|---|---:|---:|
| ThreeNative QuickJS | 119.19 ms | 115.64 ms |
| **ThreeNative V8** | **8.20 ms** | **5.25 ms** |
| Godot 4.7.1 | 39.27 ms | — |

That is a 22× reduction in script time. The V8 rung series was 8.34 / 8.35 / 8.37 / 8.20 ms across
the 4× load range. At 120 Hz, 8.33 ms is the frame interval, so the honest result is ≤8.33 ms
work inside one 120 Hz frame, not a free-running measurement. The arms used different refresh rates;
the scorer would reject that pairing, but at a 60 Hz counterfactual ThreeNative would be 16.67 ms
against Godot's 39.27 ms.

The same-display desktop rerun corrected an invalid earlier comparison (Godot had used the real
display while ThreeNative used xvfb):

| N / mode | ThreeNative | Godot | ratio |
|---|---:|---:|---:|
| 4,096 batched | 23.79 ms | 32.24 ms | 0.74× |
| 4,096 naive+collapse vs naive | 31.23 ms | 29.72 ms | 1.05× |
| 16,384 naive+collapse vs naive | 35.86 ms | 49.03 ms | 0.73× |
| 16,384 batched | 31.98 ms | 39.60 ms | 0.81× |

Both were dominated by a ~25 ms virtual-display floor, which understates engine differences; the
ThreeNative JS time at 16,384 was 6.30 ms.

#### QuickJS result, defects, and measured optimisations

At 16,384, Godot was 39.27 ms and ThreeNative was 119.19 ms; ThreeNative was 3× slower. At 4,096
the gap was ~1.35× (22.49 ms versus a Godot frame pinned at a ≤16.67 ms vsync floor). The ThreeNative
frame split was 57.99 ms framework collapse refresh, 57.65 ms benchmark animation, and ~3.5 ms
renderer/GPU; Godot's equivalent was roughly 2.4 µs per object versus ~7 µs in QuickJS. The direct
attribution measurements were 101.62 ms `step` of a 106.32 ms frame, ~0.3 µs per instance on web,
~6 µs on the phone, and ~2.4 µs for Godot. The idle 16,384-cube scene rendered in 8.25 ms at three
draws, proving the GPU was idle. Android selected QuickJS in `CMakeLists.txt`; desktop selected V8
and iOS JSC. Micro-optimisation could not close the language gap.

The two defects both produced a frozen scene at full speed. Sampling `object.matrix` before render
left 4,095 of 4,096 moving cubes baked static; flat siblings also shared one parent owner. The
default `minMeshes: 200` meant examples never exercised the pass. The diagnostic evidence was
`report.movingParts = 1` for 4,096 animated cubes and a misleading 0.08 ms `collapse.frame()`;
assert moving parts, not only refresh time. The fixes sample authored transforms and choose the
nearest actually moving owner; all 22 existing collapse tests passed before and after.

Two measured optimisations were retained. For uniform scales the shader's normal transform is the
transform upper 3×3, so aliasing the normal buffer saved 28% (72.19 → 52.29 ms). After baking,
detached leaves already held their world matrix, so reading that local matrix reduced refresh
15.38 → 9.79 ms and frame 28.68 → 23.07 ms; the post-bake flag was required. Loop partitioning
added 9.79 → 9.42 ms, 3.8%, at the edge of noise.

The proposed gap-closing approaches remain historical:

| approach | expected | cost |
|---|---|---|
| V8 or JSC on Android | ~20× loop gap; the fix | large |
| bulk transform ABI | removes the framework's ~50% share, not the game's | medium |
| further JavaScript micro-optimisation | tens of percent at best; nearly exhausted | small |

Android packaging downloaded a prebuilt runtime, so an engine swap required NDK cross-compilation;
V8/JSC version and API constraints made it a large change. `packages/runtime-native/AGENTS.md`
records the architecture decision “Android QuickJS+wgpu-native”; reopening it is a charter-level
decision, not a tweak.

#### Instrument fixes and standing

- Android logcat truncated lines at ~1 KB; `TNJSON` chunks are rejoined.
- Godot ignored `VSYNC_DISABLED`, producing a flat ~19 ms result over a 16× ladder; the scorer
  refuses that display-pinned shape and the arm reports `TIME_PROCESS`.
- Desktop and Android bundles are per-target; an `--out` name protects published ladders.
- The collapse settle loop no longer draws while baking but still yields; removing the yield caused
  a synchronous spin. The native FIFO/vsync desktop path remains runnable but incomparable.

| platform | ThreeNative | Godot | verdict |
|---|---|---|---|
| Web | knee 16,384 (L2/L3) | knee 4,096 | ThreeNative 4× |
| Desktop native | display-pinned, not comparable — 35.35 ms @4,096 vs 38.81 ms @16,384, only +10% for 4× objects | 5.67 ms @4,096 | unmeasurable as run |
| Mobile @4,096 | 22.49 ms | ≤16.67 ms, vsync-floored | Godot ~1.35× |
| Mobile @16,384 | 119.19 ms | 39.27 ms | Godot 3× |
| iOS | no Apple hardware | — | out of reach |

Earlier figures comparing a frozen scene were withdrawn, including the “31× faster on mobile” claim;
correcting the defects made ThreeNative's numbers worse. The repaired web ladder used a moving-parts
guard and passed at every rung. On the same mode, count, three draws, and 196,611 triangles:

| arm | frame p95 | JS engine |
|---|---:|---|
| Web (Chromium) | 11.45 ms | V8 |
| Android (own runtime) | 119.19 ms | QuickJS |

The final result is 10.4× on identical source.

---

## 7. Harness status

`assert.performance` (playtest scenarios) bounds `maxFrameMsP95`, `minFps`, `maxPhaseMsP95`,
`maxDrawCalls`, `maxTriangles` from the bridge's `performanceSeries` — fail-closed on missing
samples. The `perf` subcommand of the playtest CLI (landed 2026-08-27) parses both markers from
a captured log, a spawned desktop host, or device logcat, reports p50/p95 per window and per
host-gap segment, discards window 1, and fails closed on missing evidence — the recipes in §4
remain the protocol for what it does not cover (SurfaceFlinger cross-check, device builds).

## 8. Deleted-record index (evidence lives in git history)

| Deleted record | What it carried that this file does not |
| --- | --- |
| `prd-222-2026-08-25.md` | Phase 0's Chrome 59.99 vs native 19.15 claim, now falsified by rAF + SurfaceFlinger; thermal-validity table |
| `prd-222-2026-08-26.md` | F8 crossing attribution; writeBuffer handler anatomy; paired arm logs |
| `prd-222-fix-plan.md` | The F13 lever list and the `threadCpuNs` desktop meter recipe |
| `prd-222-loop-log.md` | F1–F16 full text, iteration-cycle costs, device-arm tables, protocol traps |
| `prd-222-reassessment-2026-08-26.md` | The per-call pricing search that found the binding-table mechanism (its root-cause claim is refuted; mechanism stands) |
| `round-222-prd-222-2026-08-25.md` | Round ledger entry (round ledgers otherwise remain per-run files) |
| `perf-bug-hunt-2026-08-27.md` | Fix table with red-green commits (`17bfd794…b5021ce5`); gate-status ledger |
| `PATH-TO-60FPS-2026-08-27.md` | The 22.3 ms seam model (superseded as load-bearing; kept as the Change 1/2 rationale) |
| `HANDOVER-native-60fps-2026-08-27.md` | Rebuild commands (desktop + device), A3/A4 arm designs, open-caveat list |
| `HANDOVER-hostgap-2026-08-27.md`, `HANDOVER-60fps-road-2026-08-27.md` | The instrument tasks (both done) and the gpuDrain task 1 spec |
| `prd-224-frame-pricing-and-device-arm-2026-08-27.md` | Phase 1a same-binary A/B pricing tables; device 20.44 fps arm |
| `prd-224-binding-tables-once-per-class-2026-08-27.md`, `prd-224-phase1-pricing-2026-08-28.md` | The conversion record and its NO-MOVE frame pricing (baseline-drift forensic) |
| `prd-226-a1-backend-swap-2026-08-27.md` | A1 interleave protocol; warm-up discovery (F15) |
| `prd-226-a2-null-backend-2026-08-27.md`, `prd-226-budget-a0-a2-a5-2026-08-27.md` | A2 arm detail; A0/A2/A5 tables + validity checks + disclosure ledger |
| `prd-226-device-meter-audited-2026-08-27.md` | SurfaceFlinger `--latency` audit transcript (its 120 Hz inference is corrected in §1) |
| `prd-227-cadence-lock-2026-08-27.md` | The five-arm invariance tables; addenda refuting present cadence and overlay |
| `prd-227-hostgap-decomposition-2026-08-27.md` | TN_HOST_GAP design + cross-check tables; device arm matrix |
| `prd-227-gpu-frame-time-2026-08-27.md` | gpuDrain red-green control tables; the Road B fork arithmetic |
| `prd-227-p1-2026-08-27.md` | P1 acceptance: sha256s, eligibility windows, mutation names |
| `prd-227-p2-2026-08-27.md` | P2 falsification: symbol-share tables, IC-log site list, artifacts sha256s |
| `native-performance-benchmarks-2026-08-11.md` | The three-engine Pixel 8 afternoon table + its unfairness caveats |
| `native-gameplay-frame-rate-2026-08-11.md` | HUD-draw fold (93 → 11) closure; half-resolution probe incident |
| `native-cpu-profile-fox-scale-2026-08-11.md`, `native-cpu-webgpu-presentation-hardening-2026-08-11.md` | profile:native-cpu baseline + presentation fail-close hardening |
| `three-webgpu-per-object-cost-2026-08-15.md` (+ `.html` repro) | L1/L2/L3 rung tables behind §6 |
| `engine-load-test-summary-2026-08-15.md` | Full gate-PASS tables behind §6 (detail file `engine-load-test-2026-08-14.md` predates and remains) |
| `fps-framework-mobile-perf-2026-08-24.md` | Launch timeline tables; loading-stall discovery |
| `prd-218-launch-stall-and-heat-2026-08-24.md` | Stall-segment attribution; thermal confound ledger |
| `prd-189-core-frame-allocations-2026-08-22.md` | Negative-control table for the allocation-free contract |
| `prd-170-physics-allocations-2026-08-22.md` | Physics hygiene changes + BigInt key derivation |
| `prd-193-template-frame-allocations-2026-08-23.md` | Template probe design (`PathFollow3D` identity contract) |
