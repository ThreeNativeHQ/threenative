# Mobile and the collapse pass — what the Godot load test found, 2026-08-14

Execution record for the Android half of PRD-117, plus two `packages/core` defects the benchmark
uncovered and the fixes for them. Device: Pixel 8 (`37251FDJH0037Z`, shiba), Android 17,
Mali-G715. ThreeNative runs its own C++ runtime with QuickJS; Godot 4.7.1 runs its Android export
on OpenGL ES 3.2. Both APKs are **release**, signed, installed from this repo.

**Battery caveat, stated once and applying to every number here.** The device sat at 21–22% on USB
power for the whole run, below the ≥50% the PRD requires. Android throttles at low charge, so these
are provisional figures. Both arms were measured in the same session at the same charge, so the
comparison between them is meaningful even though the absolute values are not publishable device
evidence. **PRD-117's Android criterion is not satisfied by this document.**

---

## 0. Superseded on 2026-08-15 by the V8 runtime

Everything in §1–§3 below measures ThreeNative on **QuickJS**, which was Android's hardcoded engine
when those runs were taken. PRD-118 replaced it with V8, and the mobile result inverts:

| Pixel 8, 16 384 cubes | frame p50 | measured JS per frame |
|---|---|---|
| ThreeNative on QuickJS | 119.19 ms | 115.64 ms |
| **ThreeNative on V8** | **8.20 ms** | **5.25 ms** |
| Godot 4.7.1 | 39.27 ms | — |

**A 22x reduction in script time**, which is what §1.1 predicted from the interpreter attribution.

**Read the 8.20 ms correctly.** The Android host presents `fifo vsync=true` and this device runs at
120 Hz, so 8.33 ms is the frame interval, and ThreeNative is sitting *on* it at every rung
(8.34 / 8.35 / 8.37 / 8.20 across a 4x load range). That is a floor, not a measurement: the honest
statement is **ThreeNative's work fits inside one 120 Hz frame — ≤8.33 ms — while Godot needs
39.27 ms**, which is above its own 60 Hz floor and therefore real. The two arms also ran at
different refresh rates, which the scorer would refuse to compare directly; the claim survives
anyway, because even pinned to 60 Hz ThreeNative would read 16.67 ms against Godot's 39.27 ms.

**Desktop, re-run with both arms under xvfb.** The earlier desktop comparison was invalid: Godot ran
on the real display and ThreeNative under a virtual one, and that virtual display costs ~25 ms a
frame — to *both* engines, as the re-run shows. On the same display path:

| N | ThreeNative | Godot | ratio |
|---|---|---|---|
| 4 096, batched | 23.79 ms | 32.24 ms | **0.74x** |
| 4 096, naive+collapse vs naive | 31.23 ms | 29.72 ms | 1.05x |
| 16 384, naive+collapse vs naive | 35.86 ms | 49.03 ms | **0.73x** |
| 16 384, batched | 31.98 ms | 39.60 ms | **0.81x** |

Both are still dominated by the ~25 ms virtual-display floor, so these ratios understate the
engine difference in both directions. ThreeNative's own JS at 16 384 is **6.30 ms**.

---

## 1. The result (QuickJS era — superseded, retained as the record)

At 16 384 objects both engines are above the 60 Hz vsync floor, so neither is hidden by the display.
That rung is the only clean comparison on this device.

| Android, 16 384 cubes | frame p50 |
|---|---|
| Godot, one node per cube | **39.27 ms** |
| ThreeNative, same authoring + collapse | **119.19 ms** |

**ThreeNative is 3× slower.** At 4 096 the gap is ~1.35× (22.49 ms against a Godot frame pinned at
the 16.66 ms vsync floor, whose true cost is therefore ≤16.67 ms and unresolvable).

The frame splits almost exactly in half:

| ThreeNative @16 384 | ms | per object |
|---|---|---|
| framework — collapse refresh | 57.99 | 3.5 µs |
| game — the benchmark's own animation loop | 57.65 | 3.5 µs |
| renderer + GPU | ~3.5 | — |

Godot does the equivalent per-object work *and* renders in 39.27 ms — roughly 2.4 µs per object in
GDScript against about 7 µs in QuickJS.

### 1.1 The cause is the interpreter, and the evidence is direct

Three independent measurements agree:

1. **95% of the frame is script.** At 16 384, `step` was 101.62 ms of a 106.32 ms frame in the
   hand-instanced mode. The renderer is a rounding error.
2. **The GPU is idle.** The same 16 384-cube scene with nothing animating renders in **8.25 ms**,
   at 3 draw calls. The Mali-G715 has enormous headroom; nothing here is a graphics problem.
3. **The same loop is ~20× faster in V8.** On web it costs ~0.3 µs per instance; on the phone
   ~6 µs. `packages/runtime-native/CMakeLists.txt` selects V8 on desktop, JSC on iOS and **QuickJS
   on Android** — "simplest to integrate, no special runtime deps".

**Micro-optimising JavaScript cannot close a 3× gap.** Two real optimisations below took 22% off the
framework's share and moved the 4 096 gap from 1.7× to 1.35×; the remainder is the language.

---

## 2. Two engine defects the benchmark uncovered

Both made `SceneCollapse` render a **frozen scene at full speed** — no error, no warning, and a
frame time so good it read as a win. Both are fixed with regression tests that fail without the fix.

### 2.1 Motion was sampled from a matrix the renderer had not written yet

`#sample()` compared `object.matrix`. That is derived state: three.js only recomputes it inside
`updateMatrixWorld`, which runs during render. `defineGame` calls `collapse.frame()` **before**
`renderer.render()` (`packages/core/src/game.ts:498`), so the sampler compared matrices that were
one frame stale at best and never written at worst.

Effect: of 4 096 animated cubes, **`report.movingParts` was 1**. The other 4 095 were baked static
and stopped moving. Fixed by sampling the authored `position`/`quaternion`/`scale`, which are
current no matter when the pass runs.

### 2.2 Every independently-moving sibling resolved to the same owner

`#ownerOf` returned `object.parent ?? object`. On a rig that is correct — a mesh hanging off an
animated bone has that bone as its parent. On a **flat scene it is catastrophic**: all siblings share
one parent, so all of them resolved to it and were baked into a single rigid group. Thousands of
independently moving objects became one that did not move.

Fixed to return the nearest node at or above the object that is actually moving, which is the object
itself when the object is what moves.

### 2.3 Why nothing caught either one

Every shipped example and template sits under the pass's default `minMeshes: 200`, so the collapse
declines and neither defect fires. They only appear on large scenes — exactly the ones the pass
exists for. All 22 pre-existing collapse tests passed before and after the fix.

**The tell to remember:** `collapse.frame()` costing 0.08 ms at 16 384 moving parts does not mean it
is fast, it means it is refreshing nothing. Assert `report.movingParts` against the number of things
actually moving.

---

## 3. Two optimisations, measured on the device

Both are in `packages/core/src/collapse.ts` and both are on by default.

### 3.1 Alias the normal buffer onto the transform buffer when scales are uniform

A uniform-scale part's normal matrix *is* its transform's upper 3×3: the shader multiplies by
`vec4(normal, 0)`, so the translation column cannot reach the result, and `normalize()` cancels the
scale. The second buffer was a per-part copy and a whole-buffer upload every frame of numbers the
shader already had.

**−28% of the mobile frame** at 16 384 (72.19 → 52.29 ms).

### 3.2 Read a detached leaf's own matrix instead of routing it through `matrixWorld`

After the bake, a consumed part is parentless and childless, so its world matrix *is* its local
matrix. `updateMatrixWorld` was composing that matrix and then copying all sixteen floats into
`matrixWorld` so the refresh could copy them a second time.

**−36% of the framework's refresh** at 4 096 (15.38 → 9.79 ms; frame 28.68 → 23.07 ms).

The flag has to be decided **after** the bake detaches the parts — computed during the bake it is
always false, and the first cut of this change measured no improvement for exactly that reason.

Partitioning the refresh into leaf and nested loops instead of branching per part gained a further
3.8% (9.79 → 9.42 ms) — real, but at the edge of noise.

---

## 4. What would actually close the gap

| approach | expected | cost |
|---|---|---|
| **V8 or JSC on Android** | the gap is ~20× on this loop, so this is the fix | large — see below |
| Bulk transform ABI into the native runtime | removes the framework's ~50% share, not the game's | medium |
| Further JS micro-optimisation | tens of percent at best; two rounds already taken | small, nearly exhausted |

**Why the engine swap is not a small change.** `packages/runtime-native/scripts/package-android.mjs`
downloads a **prebuilt** `libmystral-runtime.so` rather than compiling one, so changing Android's JS
engine means cross-compiling the whole native runtime with the NDK. A prebuilt V8 for Android arm64
does exist (`Kudo/v8-android-buildscripts`, v11.1000.4), but the desktop backend is built against
V8 13.1, and `MYSTRAL_USE_JSC` is implemented in `jsc_engine.mm` — Objective-C++, iOS-only, so
reusing it on Android is a port to the JSC C API rather than a flag.

It is also a documented architecture decision: `packages/runtime-native/AGENTS.md` states
"Android QuickJS+wgpu-native". Reopening it is a charter-level call, not a tweak.

---

## 5. Instrument fixes made along the way

- **Android logcat truncates a line at ~1 KB**, which silently cut every run report both arms
  emitted. Both now emit `TNJSON:` chunks the collector rejoins.
- **Godot's Android export ignores `VSYNC_DISABLED`** and reported ~19 ms at every rung of a 16×
  ladder — the display, not the engine. The scorer now detects a frame interval that stays flat while
  the object count grows and refuses the comparison; the Godot arm also reports `TIME_PROCESS`.
- **The desktop and Android arms wrote the same bundle path**, so one arm's rebuild replaced the
  bundle the other was running. Bundles are now per-target.
- **A diagnostic run overwrote the published ladder artifact**; `--out` now names it.
- **The desktop and Android bundles shared one filename**, so each target's rebuild deleted the
  other's; they are per-target now.
- **The collapse settle loop rendered the un-collapsed scene every frame**, which at 16 384 meshes
  timed the desktop arm out entirely. It no longer draws while the pass bakes — but it must still
  **yield**: dropping the yield along with the render turned the loop into a synchronous spin that
  froze the app outright, which is how it was caught.
- **The native host presents FIFO/vsync**, so the desktop arm's frame interval is display-pinned in
  the same way Godot's Android export was. Desktop is now *runnable* and still not *comparable*;
  the host needs an unthrottled present mode before its numbers mean anything.

---

## 6. Standing

| platform | ThreeNative | Godot | verdict |
|---|---|---|---|
| Web | knee **16 384** (L2 and L3) | knee 4 096 | **ThreeNative 4×** |
| Desktop native | **display-pinned, not comparable** — 35.35 ms @4 096 vs 38.81 ms @16 384, only +10% for 4x the objects | 5.67 ms @4 096 | **unmeasurable as run** |
| Mobile @4 096 | 22.49 ms | ≤16.67 ms (vsync-floored) | **Godot ahead ~1.35×** |
| Mobile @16 384 | 119.19 ms | 39.27 ms | **Godot ahead 3×** |
| iOS | no Apple hardware | — | out of reach |

Every ThreeNative figure published before the §2 fixes compared a frozen scene against an animated
one and was withdrawn, including the earlier "31× faster on mobile" claim. Correcting the defects
moved ThreeNative's numbers *worse*, which is the direction honest corrections usually go.

The web ladder has since been re-run with the fixes in place **and** with a fail-closed guard that
refuses any L3 rung whose collapse did not classify every cube as moving. It passed at every rung,
so the 16 384 knee stands on a scene that demonstrably animates.

### 6.1 The gap, in one line

The same mode, the same object count, the same three draw calls, the same 196 611 triangles:

| L3 @ 16 384 | frame p95 | JS engine |
|---|---|---|
| Web (Chromium) | **11.45 ms** | V8 |
| Android (own runtime) | **119.19 ms** | QuickJS |

**10.4×**, on identical source. That is the whole mobile problem stated as one number, and it is why
§4 puts the engine swap above every other option.
