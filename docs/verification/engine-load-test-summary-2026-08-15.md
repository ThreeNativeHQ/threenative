# ThreeNative vs Godot 4.7.1 — where the load test landed, 2026-08-15

One page over the whole run. The detail lives in
`engine-load-test-2026-08-14.md` (browser arms, fairness gates) and
`engine-load-test-mobile-2026-08-14.md` (device arms, the collapse defects). PRD-117 owns the
instrument; PRD-118 owns the Android engine swap.

## The result

| Platform | ThreeNative | Godot 4.7.1 | Margin |
|---|---|---|---|
| Web, knee at ≤20 ms p95 | **16 384** cubes | 4 096 | **4×** |
| Desktop native, 16 384 | **35.86 ms** | 49.03 ms | **1.37×** |
| Android, 16 384 | **≤8.33 ms** (JS 5.25 ms) | 39.27 ms | **≥4.7×** |

ThreeNative is ahead on all three. Three things had to be true first, and none of them were at the
start of the run.

## What actually changed the numbers

1. **Android ran QuickJS.** It was the only platform ThreeNative shipped on a JIT-less engine, and
   the only one where it lost. Swapping in V8 cut script time per frame from **115.64 ms to
   5.25 ms — 22×**. Fourteen build blockers stood in the way (PRD-118 §2), including a preset that
   could never have produced an arm64 binary and an engine selection that silently ignored being
   overridden on the command line.
2. **`SceneCollapse` was freezing large scenes.** Two defects made it bake animated objects into a
   rigid group — `movingParts` read **1** for 4 096 moving cubes. Every measurement taken before the
   fix compared a frozen ThreeNative scene against an animated Godot one and was withdrawn.
3. **The desktop comparison was unfair.** Godot ran on the real display, ThreeNative under a virtual
   one that costs ~25 ms a frame. Put both on the same path and the result flips to ThreeNative.

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
- Give the native host an unthrottled present mode so desktop measures the engine rather than the
  display.
- Decide whether V8 becomes Android's default. It is opt-in today
  (`-PthreenativeJsEngine=v8`), costs ~30 MB of APK, and reverses a documented decision in
  `packages/runtime-native/AGENTS.md`. That is an owner call, and PRD-118 states the case rather than
  making it.
