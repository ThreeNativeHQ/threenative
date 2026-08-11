# Cold start and hitches on the phone — 2026-08-11

**PRD-070 is executed: an instrument, a device number that retires the PRD's own Phases 1 and 2, a
halved collapse bake, and a loading screen that cut launch-to-first-frame from 2,877 ms to
1,051 ms.** Launch on a physical Pixel 8 is **2,882 ms median / 3,031 ms p95** over
five cold launches, and **86.8% of it is the first rendered frame**. The JavaScript parse and
compile that precompiled bytecode would attack is **230 ms — 8.0%**.

Separately, the largest single stall in the session was not in launch at all: `SceneCollapse` froze
one frame for **3,608 ms**. It is now **1,845 ms**, from one change, with the picture unchanged.

Device: Pixel 8 (`shiba`, serial `37251FDJH0037Z`, arm64-v8a, Android 17). Native runtime at
`-O2`, profiler off. Nothing here is an emulator or iOS result.

## Phase 0 — the instrument

`packages/runtime-native/scripts/measure-cold-start.mjs` is new, and
`include/mystral/cold_start.h` gives every launch boundary one monotonic clock and one greppable
marker shape:

```
TN_COLD_START:{"segment":"compile_begin","atMs":1234.567}
```

It reports a breakdown, never one number, because "launch is slow" cannot choose between
precompiled bytecode, a faster engine, and first-frame cost. Fail-closed, each verified by running
it:

| Control | Observed |
|---|---|
| `emulator-*` serial | `TN_COLD_START_EMULATOR_BLOCKED`, exit 2, before any measurement |
| one launch | `TN_COLD_START_LAUNCHES_INVALID` — a single sample is malformed input, not a result |
| build type not `-O0`/`-O2` | `TN_COLD_START_OPTIMIZATION_INVALID`; the two differ ~4× on this metric |
| a missing segment marker | `TN_COLD_START_MARKER_MISSING:<name>`, never a partial total |
| a malformed marker | `TN_COLD_START_MARKER_MALFORMED:<line>` |
| time running backwards | `TN_COLD_START_SEGMENT_NEGATIVE:<from>-><to>` |

**The last control fired for real on the first device run, and it was right to.** The host
evaluates two bootstrap scripts through the same `evalScript` path before the game bundle, so the
engine's compile markers fire three times a launch. Taking the first occurrence measured a 0.1 ms
bootstrap as though it were a 4 MB game. `game_eval_begin` now brackets the real one. An instrument
that had merely averaged them would have reported a launch that parses in under a millisecond.

## Phase 0 — the number

Five cold launches, `fox-native`, `-O2`:

| Segment | Median | Share |
|---|---|---|
| host bring-up | 0 ms | 0.0% |
| bundle read from APK | 13 ms | 0.4% |
| runtime creation | 34 ms | 1.2% |
| pre-eval setup + eval entry | 0 ms | 0.0% |
| **JavaScript parse and compile** | **230 ms** | **8.0%** |
| post-compile setup | 0 ms | 0.0% |
| bundle top-level execution | 43 ms | 1.5% |
| **first rendered frame** | **2,500 ms** | **86.8%** |
| **total** | **2,882 ms** (p95 3,031 ms, range 2,652–3,031) | |

## What that does to PRD-070's own plan

The PRD scheduled a bytecode-precompilation spike (Phase 1) and its implementation (Phase 2) as
the main line of work, and asked in §2 whether launch cost is dominated by parse, host bring-up or
surface creation. **It is none of them.**

- **Phase 1 — QuickJS bytecode precompilation: RECOMMEND-AGAINST, on this subject.** It targets the
  230 ms compile segment, 8.0% of launch. Precompiled bytecode does not make that segment free —
  it still reads and links a serialized object — so the realistic saving is a fraction of 8%,
  against a packaging change, a `qjsc` toolchain to pin and reconstruct, a script-versus-module
  bytecode mismatch that must fail closed, and a bundle that stops being human-readable. The seam
  is genuinely in the right place (`quickjs_engine.cpp` already compiles and evaluates in two
  steps), so this is a verdict about value, not difficulty. **Revisit if a subject ever shows the
  compile segment above ~30% of launch** — that is the falsifier, and it is cheap to re-check now
  that the instrument exists.
- **Phase 2 is not reached**, because Phase 1 does not recommend it.
- **The 2,500 ms first-frame segment is where launch actually lives**, and it is Phase 3's subject:
  TSL and node materials building WGSL in JavaScript, and pipelines compiled on demand the first
  time each material is drawn.

The PRD's §2 also flagged a suspicious row — a 2-mesh scene taking about as long as a 2,358-mesh
game to reach its marker. **It survives instrumentation**: launch is dominated by per-material
first-draw cost and host bring-up, not by scene size, so mesh count is a red herring for launch.

## Phase 4 — persisted pipeline cache: not reachable, and it is a finding, not a task

The PRD suspected this and the code confirms it. `wgpuDeviceCreateRenderPipeline` takes a
descriptor and nothing else; `third_party/dawn/dawn-headers/include/webgpu/webgpu.h` contains zero
occurrences of `PipelineCache`. Vulkan's `VkPipelineCache` and Metal's binary archives live *below*
wgpu-native and Dawn, not in the surface this host calls. **A persisted pipeline cache is not a
fix this repository can write today**; it would need a wgpu-native change or a private path. The
reachable lever on the same cost is a warm-up pass, which remains Phase 3's.

## The hitch that was larger than launch

`SceneCollapse` does its work inside one frame. Measured on the device, that frame was **3,608 ms**
— longer than the entire launch that preceded it, and the "started a little bit laggy then
stabilised" the operator reported. It is now reported rather than left to be discovered:
`SceneCollapseReport.bakeMs` carries it, so a regression shows up in the same marker every device
run already prints.

Breaking the bake down on the device pointed at one line:

| Sub-step | Cost |
|---|---|
| `toNonIndexed()` / `clone()` | 778 ms |
| **`BufferGeometry.applyMatrix4`** | **1,418 ms** |
| vertex-colour build | 191 ms |
| `mergeGeometries` | 138 ms |

596,502 vertices reached through `getX`/`setXYZ` accessors is not something an interpreter can make
cheap. Reading the two typed arrays directly and inlining the multiply does the identical
arithmetic without the per-vertex dispatch, and dropping non-canonical attributes *before* the
transform rather than after means the loop never walks an attribute that is about to be deleted.

| | Before | After |
|---|---|---|
| `bakeMs` | 3,608 ms | **1,798–1,845 ms** |
| Driven frame rate | 104–117 fps | 102–117 fps |
| Hue distance from baseline | — | **0.0078** (threshold 0.18) |

Correctness is checked against three.js rather than asserted: a test builds ten meshes with
distinct rotations and non-uniform scales, computes what `applyMatrix4` produces for each, and
requires the collapsed bounding box to match to four decimal places and every merged normal to be
unit length.

### One thing measured and thrown away

Keeping indices instead of expanding to non-indexed geometry looked like the obvious next win —
it removes the 778 ms expansion and cuts a unit box from 36 vertices to 24. **On the device it was
worse: `bakeMs` rose from 1,798 ms to 2,658 ms** and the driven frame rate dropped from 104–117 to
94–115, because `mergeGeometries` pays more to concatenate and offset indices than the expansion
cost in the first place. Reverted. Recorded because the next person will have the same idea.

## Phase 3 — the hitch instrument, and a warm-up that did not pay

`FrameHitchRecorder` in `include/mystral/cold_start.h` records the first 300 presented frames and
reports the distribution once, because a hitch is a distribution claim and a mean cannot see one:

```
TN_FRAME_HITCH:{"window":300,"maxMs":3474.362,"maxAtFrame":43,"p99Ms":118.404,"p50Ms":9.098}
```

It allocates once, logs once, and does nothing per frame beyond storing a double — an instrument
that becomes the hitch it measures is worthless. Its window logic is covered off-device: 300 calls
stay silent, the 301st reports, and further calls never report again.

**What it found, and it names the operator's report exactly.** The reported symptom was "a
slowdown and partially the map loaded for like 5–7 seconds, then everything suddenly loads fine":

| | Measured |
|---|---|
| launch to first frame | 2,547–2,877 ms |
| median frame thereafter | ~9.1 ms |
| p99 frame | ~118 ms — the map appearing in pieces as each shader compiles on first draw |
| **worst frame, always at frame 43** | **3,178–3,474 ms** — the collapse, and the "suddenly loads fine" |

Frame 43 is the collapse's observation window closing. The stall is larger than `bakeMs`, so the
frame also pays to build pipelines for merged geometry the renderer has never drawn.

**`compileAsync` warm-up: measured, and it does not pay.** Three configurations, one launch each:

| Config | first frame | `bakeMs` | worst frame |
|---|---|---|---|
| warm-up off | 2,877 ms | 2,050 ms | 3,474 ms |
| warm-up on, in game source | 2,675 ms | 1,847 ms | 3,259 ms |
| plus a framework warm-up after the collapse | 2,547 ms | 1,779 ms | 3,178 ms |

Every number moves the right way and **none of it is a result**: `bakeMs` varies 1,779–2,050 ms
between identical builds, so a ~5% shift across single runs sits inside that spread. The reason is
structural rather than statistical — warming the scene compiles pipelines for the geometry that
exists *before* the collapse, and the stall belongs to the merged geometry that exists after it.
The framework-side call added after the collapse was **removed rather than kept**; unpaid code is
what the kill switch exists for.

**What did land from Phase 3:** the instrument, and `compileAsync` on `RendererLike`. The PRD
required the second explicitly — the wrapper exposed no warm-up, so a game had to cast through
`.raw`, and a game that cannot warm up without a cast will not warm up. It forwards to the renderer
and resolves quietly where there is none, so one call works on WebGPU and WebGL2 alike.

## The fix: a loading screen, and hiding the world is what made it fast

The warm-up did not pay, but the reason it did not pointed at the fix. The shaders being compiled
during those 2.5 s belong to geometry the collapse is about to merge away. **Geometry that is not
drawn is not compiled**, so covering the launch does not merely hide the mess — it removes most of
the work.

`Ctx.startup` is the framework half: `phase`, a real `progress` across the observation window, and
`whenReady()` which resolves on every path, including a scene too small to collapse — a signal that
could hang is a loading screen that never lifts. The bar itself is generated user source in
`templates/*/src/render/loading.ts`, because anything a screenshot shows is the game's.

Measured on the phone, same subject, launch to a complete picture:

| | Before | After |
|---|---|---|
| launch to first frame | 2,877 ms | **1,051–1,188 ms** |
| worst frame | 3,474 ms | **2,712–2,788 ms** |
| p99 frame | 118 ms | **82–85 ms** |
| what the player sees | a map assembling itself in pieces, then a freeze | a progress bar, then the finished world |

**Two bugs found by looking at the screen rather than the log, both worth writing down.**

1. **The collapse ate the loading screen.** `overlayMeshes` went 76 → 79 and `overlayDraws` 11 → 14:
   the three quads were folded into a merged overlay draw, so removing them from the camera left
   the merged copy on screen and the player stared at a full progress bar forever. The collapse
   tracks each part's `visible`, so `finish()` hides rather than removes. **Any transient
   camera-parented UI has this hazard** — the pass merges what exists when it runs.
2. **Creating the screen before the world meant it hid nothing.** It snapshots `scene.children` at
   construction, so built-later geometry drew uncovered. Moving the call to after the scene is
   populated is also what produced the 2.9 s → 1.1 s first frame, because only then is the world
   actually hidden during startup.
3. **The HUD and the touch controls floated over the loading screen.** They are parented to the
   camera, not the scene, and their transparent materials sort after every opaque object whatever
   the render order. Hiding the camera's existing children as well is what covers them; fighting
   render order was the wrong fix.
4. **Objects rendered solid black for about a second after the reveal.** Their pipelines were
   compiling in the frames the player was already watching. This is the one place `compileAsync`
   pays and the earlier A/B could not show it: awaited *behind* the loading screen, on the
   collapsed scene, it moves that second to where nobody sees it. Warming the pre-collapse scene
   was worthless; warming the post-collapse scene before revealing is not.

The screen now takes itself down — a scene writes `createLoadingScreen(ctx)` after building its
world and `loading.update()` in its frame function, and the sequencing of settle, compile and
reveal lives in one place instead of in every game.

## Still open

- **The collapse still stalls one frame for ~1.7 s**, now behind the loading screen rather than in
  front of the player. Spreading the bake across frames is the next real reduction.
- **`compileAsync` warm-up remains unproven.** The surface ships; nothing in the repo relies on it.
- **1,845 ms is still a freeze.** Halving it was one change; removing it needs the bake spread
  across frames, which trades one stall for a longer degraded period and needs its own decision.
- **Occasional 37–47 ms frames** during play, unattributed.
- **No threshold is set here.** PRD-058 owns thresholds; this produces the numbers one would need.
- **Desktop and iOS are unmeasured** by this instrument. It is Android-only today, and no Apple
  hardware is attached.

## Reproduce

```sh
node packages/runtime-native/scripts/measure-cold-start.mjs \
  --device 37251FDJH0037Z --launches 5 --optimization -O2 \
  --report packages/runtime-native/artifacts/android/cold-start/fox-native-O2.json
```

Exit 0 with a breakdown; any missing marker exits non-zero naming it. `bakeMs` comes from
`TN_SCENE_COLLAPSE` in logcat. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm budgets` all
exit 0; the collapse carries 11 tests.
