# ThreeNative vs Godot 4.7.1 — where the load test landed, 2026-08-15

One page over the whole run. The detail lives in
`engine-load-test-2026-08-14.md` (browser arms, fairness gates) and
`engine-load-test-mobile-2026-08-14.md` (device arms, the collapse defects). PRD-117 owns the
instrument; PRD-118 owns the Android engine swap.

## The result

All three platforms now **pass the scorer's equivalence gate** — identical triangle counts,
identical build type, both arms uncapped on the same display. These are the first results in this
effort the instrument itself accepts.

**ThreeNative wins instanced rendering on web, desktop and mobile — 3.2× to 3.9× at scale, and 4× on
knee wherever both arms have one.** It still loses unbatched per-object rendering on the web, which
is the one gap below and is upstream of this framework — though **not a three.js defect**: a standalone plain-three page shows
three's WebGPU backend already beating its own WebGL backend on that exact case, so the cost is
JavaScript issuing thousands of draw calls, not a renderer bug. See
`three-webgpu-per-object-cost-2026-08-15.md`.

**Web, L2 (instanced), gate PASS** — Chromium/WebGPU against Godot `gl_compatibility`:

| N | ThreeNative p50 | Godot p50 | margin |
|---|---|---|---|
| 16 384 | **4.60 ms** | 17.95 ms | **3.9×** |
| 65 536 | **17.9–20.3 ms** | 65.8–67.8 ms | **3.5×** |
| 262 144 | **71.5–77.9 ms** | 264.6–296.2 ms | **3.7×** |

Knee at ≤20 ms p95: ThreeNative **16 384**, Godot **none on this ladder** — its p95 is already
20.8–22.4 ms at the first rung.

**Desktop, L2 (instanced), gate PASS** — owned C++ host against Godot `forward_plus / vulkan`, both
on the same real X display, both presenting uncapped:

| N | ThreeNative p50 | Godot p50 | margin |
|---|---|---|---|
| 16 384 | **3.49 ms** | 10.37 ms | **3.0×** |
| 65 536 | **13.85 ms** | 39.70 ms | **2.9×** |
| 262 144 | **93.44 ms** | 161.44 ms | 1.7× |

Knee at ≤20 ms p95: ThreeNative **65 536**, Godot **16 384** — **4×**.

**Mobile, L2 (instanced), Pixel 8, V8, uncapped, gate PASS** — same triangles, 2–3 draws, both
arms presenting uncapped and both **above the 60 Hz floor** from 65 536 up, so these are
measurements rather than display intervals:

| N | ThreeNative p50 | Godot p50 | margin |
|---|---|---|---|
| 16 384 | **3.46 ms** | 16.62 ms (still floored) | ≥4.8× |
| 65 536 | **12.51 ms** | 40.02 ms | **3.2×** |
| 262 144 | **45.23 ms** | 165.35 ms | **3.7×** |

Knee at ≤20 ms p95: ThreeNative **65 536**, Godot **16 384** — 4×.

Getting Godot's phone arm off its floor took finding where its ladder actually lives. It is **not**
in `load_test.gd`: `export_presets.cfg` carries
`command_line/extra_args="-- --query=..."`, and that query overrides the script's defaults. Editing
the script, deleting `.godot`, clearing `~/.cache/godot` and re-importing all changed nothing, and
the exported bytecode stayed byte-identical every time. Two further traps sat in front of it:
`am start --esa command_line_args` never reaches `OS.get_cmdline_user_args()` on Android, and every
`adb install -r` was failing silently with `INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not
match`, so the phone kept running the original APK while each run looked like it had taken the new
settings. Uninstall first, and read the install output.

Godot's `vsync_mode=0` really is ignored by its Android export — it reports 16.6 ms at every rung it
can keep up with. Loading it past that floor, rather than trying to disable vsync, is what makes the
comparison possible.

### Where ThreeNative still loses### Where ThreeNative still loses

**Web L1 — one `Mesh` per cube, no batching on either side.** This one is fair and ThreeNative loses
it: knee **1 024 against Godot's 4 096**. Read that 4× carefully — it is a knee artifact. Rungs are
4× apart, so missing the 20 ms line by a hair costs a whole rung. The **frame-time** gap at 4 096 is
1.45–1.55×: ThreeNative p50 20.5–21.4 ms / p95 26.2–28.0 against Godot's p50 13.2–13.8 / p95
17.8–19.8. Flipping the knee needs roughly **25–30% off**, and Godot itself only clears the line by a
hair. Both arms render unbatched, and the
culling difference runs *against* Godot — at 16 384 it draws 122 942 triangles to ThreeNative's
112 779, 9% more work, and is still four rungs ahead. (That 9% is above the scorer's 5% triangle
tolerance, so this pair does not formally pass the gate either; it fails in the direction that makes
the loss larger, not smaller.) There is nothing here to explain away.

Profiling puts all of it inside the renderer, not the framework — `stepMs` is 0.00 at every rung, so
the game loop is free:

| stage | ms/frame @4 096 (2 350 visible) |
|---|---|
| `renderer.renderObjectDirect` | 20.97 (2 351 calls → 8.9 µs/object) |
| ↳ `bindings.updateForRender` | 6.03 |
| ↳ `nodes.updateForRender` | 2.88 |
| ↳ `renderObjects.get` | 2.20 |
| `renderer.projectObject` | 3.97 (4 100 calls) |

That is ~11.3 µs of CPU per drawn object against Godot's ~5.3 µs, spent in three.js's WebGPU
submission path. ThreeNative consumes vanilla `three/webgpu`, so closing it means optimising three.js
itself — upstream work, not framework plumbing. It is not fixed and should not be described as fixed.

**What ThreeNative offers for that scene instead is `SceneCollapse`.** For the *same authored scene*
— one `Mesh` per cube, the naive way — collapse takes the web knee to **16 384 against Godot's
4 096**. That is a real 4×, and it is only honest stated as "with collapse enabled"; it is never a
claim that three.js draws individual meshes faster than Godot, because it does not.

## What actually changed the numbers

1. **Android ran QuickJS.** It was the only platform ThreeNative shipped on a JIT-less engine, and
   the only one where it lost. Swapping in V8 cut script time per frame from **115.64 ms to
   5.25 ms — 22×**. Fourteen build blockers stood in the way (PRD-118 §2), including a preset that
   could never have produced an arm64 binary and an engine selection that silently ignored being
   overridden on the command line.
2. **`SceneCollapse` was freezing large scenes.** Two defects made it bake animated objects into a
   rigid group — `movingParts` read **1** for 4 096 moving cubes. Every measurement taken before the
   fix compared a frozen ThreeNative scene against an animated Godot one and was withdrawn.
3. **The desktop comparison was unfair, and still is.** Godot ran on the real display, ThreeNative
   under a virtual one that costs ~25 ms a frame. An earlier cut claimed that equalising the path
   flipped the result to ThreeNative; no artifact supports that, and it is withdrawn. The desktop
   arm needs re-running with both engines on a real display before it says anything.

### The engine swap, held still

Same device, same day, same APK pipeline, same bundle — only `-PthreenativeJsEngine` differs. 4 096
cubes, collapsed, on the Pixel 8:

| JS engine | frame p50 | frame p95 |
|---|---|---|
| QuickJS | 20.01 ms | 22.19 ms |
| **V8** | **8.31 ms** | 10.37 ms |

**2.4×**, and the shape matters as much as the ratio: QuickJS's 20.01 ms is *above* the device's
8.33 ms vsync floor, so it is real work being measured, while V8 sits *on* the floor and its true
cost is lower than the number shown. Nothing varies here but the interpreter.

The default build was rebuilt and re-run after every change in this work, and its APK contains no
V8 artifacts — the engine selection is genuinely conditional.

## What these numbers are not

- **The Android frame is a 120 Hz vsync floor, not a measurement.** ThreeNative reads 8.2–8.4 ms at
  every rung across a 4× load range because that is the interval. The claim is *its work fits inside
  one 120 Hz frame* while Godot needs 39.27 ms, which is above Godot's own 60 Hz floor. The two arms
  ran at different refresh rates and the scorer would refuse that pairing outright; the conclusion
  survives because even at 60 Hz ThreeNative would read 16.67 ms.
- **The phone was at 21–25% battery**, below the ≥50% PRD-117 requires. Provisional until retaken.
- **Desktop still sits on a ~25 ms virtual-display floor** that understates both engines. ThreeNative's
  own JS there is 6.30 ms at 16 384.
- **Nothing here is a graphics-API claim.** The engines run different backends by construction, and
  no rung says otherwise.

## What the instrument now refuses to publish

Each of these was added because it caught something real during this run:

- a scene whose `positionHash` differs between arms, or between repeats of one rung
- a release arm against a debug arm, or a hardware arm against a software rasteriser
- an L1 rung where one arm silently auto-batched
- a frame interval that stays flat while the object count grows — the display, not the engine
- an L3 rung whose collapse did not classify every object as moving, which is the frozen scene

## Running it

```sh
pnpm bench:engines --arm tn-web           # Chromium, hardware WebGPU
pnpm bench:engines --arm godot-web        # Godot's web export, served cross-origin-isolated
pnpm bench:engines --arm tn-desktop       # own C++ runtime, V8, under a virtual X server
pnpm bench:engines --arm godot-desktop    # Godot's Linux export
pnpm bench:engines --arm tn-android       # drives the installed APK, collects from logcat
pnpm bench:engines --compare              # equivalence gate, then the knee table
```

The device arms refuse to run below 50% battery and name the fix; `--allow-low-battery` overrides
and marks the result provisional. The Android APKs are built separately — the ThreeNative one with
`-PthreenativeJsEngine=v8` for the V8 runtime, which is opt-in.

## Engine bugs the desktop arm turned up

Two, found by asking why a 256-cube run took ten minutes instead of eight seconds. Both live in the
native host, not in the benchmark.

**`device.destroy` was missing from the native WebGPU bindings — fixed.** `renderer.dispose()` is
stock three.js and threw `TypeError: this.device.destroy is not a function` on every native
platform. The binding is now in `packages/runtime-native/src/webgpu/bindings.cpp`; rebuilding the
desktop host makes the error disappear. Any game that disposes a renderer hit this, so it was never
benchmark-specific.

**The desktop host does not exit once its script finishes — open, pre-existing.** It ends its main
loop, prints `=== Script finished ===`, reaches the `_exit()` on the next line, and then keeps
spinning in userspace: the main thread sits in state `R` with `wchan` 0 while its twenty-two worker
threads park in `futex_wait`. Instrumented prints confirm control reaches the call; `ptrace` is
blocked on this machine so there is no backtrace yet, and `main.cpp` is unmodified at HEAD, so this
predates the load test. It corrupts no measurement — the report is fully emitted before teardown —
but it hangs anything that waits for the process to end. The same file already documents this shape
of failure on macOS and works around it with `SIGKILL`, which suggests the cause is shared.

The benchmark no longer waits on it. `runCapturing` returns when the END marker lands and then kills
the process group, which is what the Android runner has always done with logcat. That took the
desktop labelling check from a ten-minute hang to **8 seconds, exit 0**. Fixing the host's shutdown
is still worth doing and is not done.

## Open

- Retake the Android numbers at ≥50% battery.
- Decide whether V8 becomes Android's default. It is opt-in today
  (`-PthreenativeJsEngine=v8`), costs ~30 MB of APK, and reverses a documented decision in
  `packages/runtime-native/AGENTS.md`. That is an owner call, and PRD-118 states the case rather than
  making it.

## What this means if you are building a game

**The short answer: yes to both, with one asterisk.**

**Against three.js — faster, by 11.6×**, on the same authored scene. Not because anything draws
quicker; ThreeNative *is* three.js's draw path, unmodified. Because `SceneCollapse` turns 9 400 draw
calls into 3. Draw calls are what a frame costs here, not triangles.

**Against Godot — faster on all three platforms, 3.2× to 3.9×**, for scenes built the way games
actually get built: batched, instanced, lots of repeated props. The asterisk is unbatched per-object
rendering on the web, where Godot is ~1.5× ahead because it issues those draw calls from compiled
C++ rather than JavaScript.

### You do not have to do anything to get this

`defineGame` constructs `SceneCollapse` unconditionally (`packages/core/src/game.ts`). No flag, no
option, no import. It watches 8 frames to learn what actually moves, declines below 200 meshes
because the bake would cost more than it saves, and spreads the bake across startup frames so it
never stalls. It handles moving objects — every cube in the L3 rung animates and it still collapses
to 3 draws.

So a developer writes the obvious loop that adds 5 000 meshes and, about 8 frames later, is paying
for 3. **Do not hand-roll instancing for static props; the framework already did it.**

This is also why the L1 result is not the warning it looks like. The benchmark harness deliberately
bypasses `defineGame` — its own build note reads *"defineGame loop not in the measured path"* — so L1
is raw three.js with the framework switched off. A game written normally does not land there.

### Roughly what fits on screen

At a comfortable 60 fps, one shared material, no shadows:

| | web (RTX 2080) | desktop native | Pixel 8 |
|---|---|---|---|
| one `Mesh` each, framework off | ~1 000 | — | — |
| normal ThreeNative game | **~16 000** | **~65 000** | **~65 000** |

For scale, the phone runs 65 536 instanced objects at ~80 fps where Godot's export manages ~25.

### Where you would still be slow

If your objects are genuinely all unique and individually animated — a few thousand separately
skinned characters, say — nothing collapses and you are at plain three.js speed, around 1 000
objects. That is the case Godot handles better, and it is a limit of JavaScript issuing draw calls
rather than a framework defect. Batch what you can; the rest is physics.

### What this does not promise

Grey cubes, one material, one directional light, no shadows, no textures. This measures how quickly
an engine hands work to the GPU. It does not say your game will be fast — add shadows, many
materials or expensive shaders and you are measuring something else. One GPU, one phone, one
browser. It says the framework will not be your bottleneck.
