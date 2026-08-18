# PRD-152 — transparent scene optimization

Date: 2026-08-18

What this record proves and what it does not: the replacement optimizer is **semantically
transparent on web and on the native desktop host**, with executed evidence for both. The
performance half is **partially executed** — the cells that ran are below with their raw numbers,
and the cells that did not run are named rather than left to be assumed. No claim here covers
physical Android unless the Android section says it does.

## What changed

`SceneCollapse` consumed the scene it optimized: it merged what it judged static and lifted the
sources out of the graph, on the strength of eight startup frames. When that judgement was wrong the
game did not get a slow frame, it got a wrong one, and the pass still reported success.

`SceneRenderProjection` inverts the ownership. The authored scene is never modified; the renderer is
handed a private mirror. Eligible meshes reach it as instances of an `InstancedMesh`, everything else
as an exact stand-in, and when the mirror cannot reproduce something faithfully the frame is given
back to the authored scene. Fallback is a correct slow path, not an error, and nothing about it is
configurable.

## Semantic evidence — executed

The subject is `examples/prd140-picking`, expanded into the semantic stress scene: 250 batched props
sharing one geometry and material, beside an `InstancedMesh`, a `SkinnedMesh` with a real rig, a
morph-target mesh, a transparent mesh, an `LOD` with two levels, a sprite, a point cloud, a grouped
subtree, a mesh hidden before startup, a camera-parented overlay, and a prop that first moves on
frame 600. Nothing in it opts into or out of anything.

```sh
# web
node packages/playtest/dist/runner/cli.js \
  examples/prd140-picking/playtests/semantics.playtest.json \
  --url http://127.0.0.1:5351 \
  --server-command "pnpm --filter prd140-picking dev --host 127.0.0.1 --port 5351 --strictPort" \
  --browser-recipe webgpu

# desktop, against the packaged native host
pnpm --filter prd140-picking test
node packages/runtime-native/scripts/package-desktop.mjs \
  --bundle examples/prd140-picking/dist/prd140-picking-native.js \
  --runtime packages/runtime-native/build/tn-linux/mystral \
  --output /tmp/tn-prd152-desktop
node packages/playtest/dist/runner/cli.js \
  --project examples/prd140-picking --scenario playtests/semantics.playtest.json \
  --target desktop --executable /tmp/tn-prd152-desktop
```

| Assertion | web | desktop |
| --- | --- | --- |
| `framesRun` ≥ 1200 | 1200 | 1200 |
| `graphIntact` — authored graph byte-identical after 1,200 frames | 1 | 1 |
| `pickedTarget` — raycast returns the annotated mesh | 1 | 1 |
| `pickedUnannotated` — raycast returns an **unannotated** mesh | 1 | 1 |
| `semanticsIntact` — instances, skeleton, morph influence, transparency, LOD levels, grouping | 1 | 1 |
| `hiddenIntact` — hidden mesh still hidden and still in the scene | 1 | 1 |
| `lateMutationApplied` — prop moved on frame 600 is where the game put it | 1 | 1 |
| `overlayRides` — camera-parented overlay still parented to the camera | 1 | 1 |
| console errors / runtime diagnostics | 0 / 0 | 0 / 0 |
| exit code | **0** | **0** |

`graphIntact` is the assertion that matters most: it compares a fingerprint of every object's uuid,
name, type, parent and sibling index, taken once startup settles and again 1,200 frames later. The
optimizer is fully engaged throughout.

`pickedUnannotated` is the retirement of `userData`. The pass this replaces could only keep a mesh
pickable by declining to merge it, which is why it read `userData` at all; a game had no other way to
say "not this one". There is nothing to opt out of now.

## Unit evidence — executed

`packages/core/__tests__/renderProjection.spec.ts`, 37 tests. `pnpm test`: 146 files, 1,346 tests,
exit 0. `pnpm typecheck` and `pnpm lint` clean.

Negative controls, each observed red and isolating only its own gate:

| Control | Red |
| --- | --- |
| projection bypassed in `game.ts` | live-integration and goto rows |
| disposal omitted from `goto()` | goto disposal row only |
| sources detached like the incumbent | 7 graph-identity rows |
| transform reconcile omitted | 4 transform rows |
| visibility reconcile omitted | 2 visibility rows |
| ancestor visibility ignored | inherited-visibility row only |
| geometry dropped from the batch key | single-instanced-draw row only |
| hidden objects not collapsed | hidden-after-settling row only |
| shadow flags dropped from the batch key | 2 shadow rows |
| lane-switch release omitted | transparent double-draw row only |
| specialized state not copied to stand-ins | instanced and skinned rows |
| LOD levels not rebuilt on the stand-in | LOD row only |
| exact lane dropped entirely | 13 corpus rows |
| world matrices written to `matrixWorld` | 3 post-matrix-pass rows |

## Five bugs, and what found each

Recorded because four of the five were invisible to the layer above them.

| Bug | Found by | Would have shipped as |
| --- | --- | --- |
| `BoxGeometry` carries six groups, so a groups-based multi-material rejection matched every mesh | a negative control staying green | the optimizer silently disabled entirely |
| proxies wrote `matrixWorld`, which the renderer's own `updateMatrixWorld()` overwrites | asserting *after* the renderer's matrix pass | every exact-lane object and every light at the world origin |
| a `SkinnedMesh` stand-in reached the renderer before its skeleton was assigned | the web playtest, 158 console errors | no drawn character, a torrent of errors |
| `runtime-native` mapped no integer texture formats — `r32uint` fell through to `BGRA8Unorm` | the **desktop** playtest, 237 runtime errors | every batched draw invalid on native only |
| `BatchedMesh` does not reduce draw calls on WebGPU | the load-test benchmark | a correct optimizer that saved no draws |

The fourth is a C++ host bug, fixed in `packages/runtime-native/src/webgpu/bindings.cpp`, and is
exactly the web-works/native-silently-broken divergence the desktop gate exists to catch. The fifth
is why the batching primitive is `InstancedMesh`: three's WebGPU backend has no multi-draw path and
unrolls a `BatchedMesh` into one `drawIndexed` per sub-draw, so a thousand batched objects still cost
a thousand draw commands.

## Performance evidence — partially executed

Desktop host: Linux, NVIDIA RTX 2080, Chromium headed on `DISPLAY=:0`, adapter reported `hardware`
on every row. Headless runs are not usable here — Chromium's headless WebGPU throws
`Instance dropped in popErrorScope`, which this repo already documents.

Command:

```sh
DISPLAY=:0 pnpm profile:native-cpu -- \
  --objects 500,1000,2000,4000 \
  --render-mode independent,legacy-scene-collapse,scene-projection \
  --hierarchy flat,deep --dirty 0,10,100 --visibility all-visible,mostly-culled --passes 1,2 \
  --repeats 3 --samples 180 --headed --output-dir artifacts/prd152-matrix
```

### Cells that ran

Flat, dirty 0, all-visible, 3 repeats each. Frame times are the per-run means the profiler prints,
given as the range across the three repeats.

| objects | passes | `independent` | `legacy-scene-collapse` | `scene-projection` | draws (indep → proj) | vs `independent` | vs incumbent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | 1 | 0.730 | 0.332–0.430 | 0.427–0.437 | 501 → 2 | −41% | +6% |
| 500 | 2 | 1.225 | 0.442–0.530 | 0.737–0.962 | 1002 → 4 | **−30%** | +75% |
| 1,000 | 1 | 1.455–2.795 | 0.655–0.685 | 0.650–0.655 | 1001 → 2 | −55% | −2% |
| 1,000 | 2 | 2.360–2.795 | 0.650–0.850 | 0.665–0.750 | 2002 → 4 | −73% | +1% |
| 2,000 | 1 | 2.440–2.530 | 1.040–1.140 | 1.020–1.040 | 2001 → 2 | −58% | −4% |
| 4,000 | 1 | 5.500–5.960 | 2.020–2.280 | 1.960–2.060 | 4001 → 2 | **−65%** | **−6%** |

Draw reduction is 99.6–99.95% on every row, against §4.3's ≥90%.

The trend is the point. The projection pays a per-frame reconciliation the incumbent does not, and
that cost is fixed work amortised over a rising object count: it trails the incumbent at 500 objects,
draws level at 1,000–2,000, and is **ahead of it at 4,000** — 1.960–2.060 ms against 2.020–2.280 ms,
both at 2 draws, while unbatched Three.js needs 5.500–5.960 ms and 4,001 draws. It converges on and
then passes the pass it replaces exactly where an optimizer is worth having, and it does it without
consuming the scene.

**One cell misses the §4.3 speed floor and is not rounded away.** At 500 objects with two passes the
candidate is 30% faster than unbatched Three.js where the floor is 40%. Two things bear on it and
neither is an excuse: the `independent` arm is visibly noise-dominated at these scales — the same
1,000/passes=1 cell varies 1.455 to 2.795 ms across three repeats of an identical workload — and at
500 objects the whole frame is under a millisecond on an RTX 2080, so this desktop is not CPU-bound
at all. The optimizer exists for the case where interpreted JavaScript is the frame and the GPU is
idle, which is a phone, not this machine. §4.3 says noise-bound results take five repeats rather than
a wider threshold; that rerun has not happened.

### Cells that did not run

The full matrix is 4 object counts × 2 hierarchies × 3 dirty ratios × 2 visibilities × 2 pass counts
× 3 arms × 3 repeats = 864 runs, measuring at roughly one scenario per three minutes — many hours.
It was started, reached 35 scenarios, and was stopped so the Android arm could have an unloaded
machine; running both at once would corrupt both sets of timings.

Not yet run, and therefore not claimed: 2,000 and 4,000 objects, the highest stable rung, deep
hierarchies, 10% and 100% dirty ratios, mostly-culled visibility, the fox-scale subject, the
late-mutation pass through the profiler, and the 300-frame post-settlement stability window. The
platformer re-run required by §4.3 item 5 has also not happened.

## Android — physical Pixel 8

Phase 6 requires the full `L1,L2,L3` ladder on physical Pixel-class hardware, from an APK built at
the final candidate commit, with the device discharging and above 50% battery. No override was used:
`--allow-emulator`, `--allow-low-battery` and `--skip-baseline` were all left off, and each gate was
satisfied rather than bypassed.

### The APK is built from source, not from prebuilts

`packages/runtime-native/android/prebuilt/` does not exist on this machine, so Gradle's
`externalNativeBuild` path compiles the runtime with the NDK for `arm64-v8a` and `x86_64` from
`packages/runtime-native/src`. The integer-texture-format repair is therefore genuinely in the
binary that ran, rather than a prebuilt `.so` predating it.

```sh
TN_BENCH_TARGET=native TN_BENCH_PLATFORM=android \
TN_BENCH_LADDER=256,1024,4096,16384 TN_BENCH_MODES=L1,L2,L3 \
TN_BENCH_FRAMES=600 TN_BENCH_WARMUP=120 TN_BENCH_REPEATS=3 TN_BENCH_REFRESH_HZ=120 \
pnpm --filter threenative-engine-load-test build

JAVA_HOME=/usr/lib/jvm/java-17-openjdk node packages/runtime-native/scripts/package-android.mjs \
  --bundle examples/engine-load-test/dist/engine-load-test-android.js \
  --output artifacts/engine-load-test/tn-android-v8.apk --orientation landscape

pnpm bench:engines --arm tn-android --modes L1,L2,L3 \
  --ladder 256,1024,4096,16384 --frames 600 --warmup 120 --repeats 3 \
  --out prd152-tn-android-post-change
```

**`JAVA_HOME` is not incidental.** The system JDK here is 26.0.2, and the Kotlin compiler this AGP
version ships throws `java.lang.IllegalArgumentException: 26.0.2` out of `JavaVersion.parse` before
any project code is read. The build fails with the version string as its entire error message.
JDK 17 builds it.

### Device conditions

Reached over Wi-Fi ADB (`adb tcpip 5555`) so the phone could be unplugged and still driven — the
preflight requires a discharging device, which a USB-connected one is not.

| Condition | Required | Observed |
| --- | --- | --- |
| device | physical Pixel-class | Pixel 8 (`shiba`), arm64 |
| power | discharging | `USB powered: false`, status 3 |
| battery | ≥ 50% | 69–72% |
| thermal | `NONE` | `NONE` at launch |
| provisional overrides | none | none |

The thermal gate had to be waited out rather than overridden: installing a 254 MB APK pushes
`VIRTUAL-SKIN` past the Pixel's ~38 °C `LIGHT` threshold, and the aggregate status only returns to
`NONE` after the screen is blanked for a few minutes.

### Two gates fired before any number was published

Both were real mismatches between the incumbent's vocabulary and the projection's, and both would
have produced plausible-looking numbers under the wrong label. The rung refused to report instead.

- `TN_BENCH_COLLAPSE_PROJECTED` — the L3 gate accepted only the collapse's `applied` status. The
  projection's applied state is `projected`.
- `TN_BENCH_COLLAPSE_FROZE:257/256` — the gate asserted that the projected-object count equalled the
  rung's cube count. It is 257 because the scene also holds a ground plane. The old equality held
  only because the ground was static and so was never a "moving part"; the projection has no
  static/moving split to exclude it, which is exactly the change being measured.

### Result

`status=projected moving=257` on the device: the replacement engages on physical Android hardware,
and the L3 rung measures the shipping projection rather than an un-optimized scene.

All three modes at each rung, three repeats each, on the device. `L1` is unbatched Three.js, `L2` is
a hand-written `InstancedMesh` the benchmark maintains itself, `L3` is the shipping projection.

| objects | L1 (unbatched) | L2 (hand-instanced) | **L3 (projection)** | L3 reconcile p50 | projected |
| --- | --- | --- | --- | --- | --- |
| 256 | 16.63–16.73 | 16.64–16.82 | **16.65–16.70** | 1.53 / 1.57 / 2.00 | 257 |
| 1,024 | 16.47 | 16.79–16.81 | **16.63–16.74** | 3.52 / 3.53 / 3.54 | 1,025 |
| 4,096 | **59.05 / 59.08 / 66.40** | 16.67–16.75 | **16.56 / 16.82 / 16.70** | 6.27 / 5.53 / 6.22 | 4,097 |
| 16,384 | **267.39 / 272.67** | — | **22.61 / 21.86** | 15.63 / 14.22 | 16,385 |

At 16,384 objects unbatched Three.js is at 267–273 ms a frame, about 3.7 fps, and the projection is at
21.9–22.6 ms — a **12× frame-time improvement**, still reconciling all 16,385 objects (14.2–15.6 ms of
it) and still inside a frame a game could ship.

**The 4,096 rung is the result this PRD exists for.** Unbatched Three.js leaves the frame budget
entirely — 59 to 66 ms, about 16 fps — while the projection holds 16.6 to 16.8 ms, which is vsync.
That is a 3.5–4× frame-time improvement, and it lands *level with hand-written instancing*: L2 is the
ceiling for this workload and L3 matches it.

That is the whole product claim, measured rather than argued. The developer writes ordinary
Three.js — 4,096 separate `Mesh` objects, every one of them moved every frame by the game — and gets
hand-instanced performance without writing instancing, knowing it exists, or annotating anything. The
projection reconciles all 4,097 objects in 5.5–6.3 ms inside that budget and every one of them
remains an ordinary, mutable, pickable `Mesh` in the game's own scene.

At 256 and 1,024 all three modes sit at vsync, so those rungs measure the display and not the
optimizer; `reconcile p50` is the projection's own cost and is the number that scales — 1.5 ms at
257 objects, 3.5 ms at 1,025, 6.2 ms at 4,097, which is linear in object count as a per-object
reconcile must be.

### The report artifact needed a bigger log buffer

The first complete ladder produced every measurement above and then failed to hand back its
machine-readable report. The app emits the report through logcat between two markers; at 600 frames
across twelve rungs the payload is several megabytes, it is written in a single burst, and Android's
`main` ring buffer is **256 KiB** by default. logd dropped most of the JSON, including the
`ENGINE_LOAD_TEST_JSON_END` marker the collector waits for, so the run timed out with no artifact.

`adb logcat -G 256M` before the run fixes it. This changes nothing about what is measured — the
per-rung numbers above were read from the same log lines either way — but a rerun is required for the
artifact this PRD's acceptance criteria ask to be filed, and that rerun is in progress.

**No knee and no §4.3 Android verdict is claimed here** — only the measured rungs above.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean (warnings only) |
| `pnpm test` | 146 files, 1,346 tests, exit 0 |
| semantic playtest, web | exit 0 |
| semantic playtest, `--target desktop` | exit 0 |
| full §4.2 load-test matrix | **partial — see above** |
| physical Android ladder | see the Android section |
