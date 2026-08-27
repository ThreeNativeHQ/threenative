# Handover — the native 60 fps problem, 2026-08-27

> **UPDATE, same day: the path was found.** Read
> [PATH-TO-60FPS-2026-08-27.md](PATH-TO-60FPS-2026-08-27.md) first — it supersedes section 6's
> "next steps" with a decided answer. Arm A3's fork was resolved from the profiled counters without
> a new run, and the A2 backend term was independently cross-checked to 0.09 ms, which also closes
> what arm A4 was scheduled to do. This document remains the reference for method rules, the
> graveyard, rebuild commands and open caveats.

Written for the next agent. Read this before touching anything performance-related in
`packages/runtime-native`. It supersedes nothing; it tells you which of the existing records are
still load-bearing and which are void.

---

## 1. The goal, stated exactly

**Bayview must run at 60 fps or better in the native host on a physical Pixel 8. 30 fps is not
acceptable** (owner, 2026-08-27). Earlier records treat 30 fps as an acceptance "floor" — it is
demoted to a progress milestone and is never a pass.

The panel is **120 Hz**, so presented frame rate quantises to 120/n. Sixty fps means **the whole
frame must fit in 16.67 ms**.

| | value |
| --- | --- |
| Where the device is | **20 fps**, true per-frame work **43–48 ms** |
| Where it must be | **60 fps**, frame ≤ **16.67 ms** |
| What that requires | **~3× reduction — 28 to 33 ms per frame removed** |
| Is it reachable | Yes. Chrome runs the same scene at **59.99 fps on the same phone**. |

**No single lever does this.** Five have been tried and all five failed. Section 4 has the graveyard.

---

## 2. The measurement is trustworthy — this was audited, do not re-litigate it

The ~20 fps figure was challenged as a possible instrumentation artefact. It is not.

`dumpsys SurfaceFlinger --latency` on the game's own buffer-producing layer
(`…SurfaceView[com.threenative.bayview/…](BLAST)#2364`), which knows nothing about our meter:

```
refresh period 8.333 ms  => 120.0 Hz
present interval  median 50.03 ms   min 41.71   max 66.69
presented FPS     median 19.99      mean 19.07
vsync cells: 5x=1  6x=43  7x=17  8x=1
```

Our `TN_FRAME_BUDGET` read **20.39 fps** in the same launch. **Agreement within 2%, and ours reads
slightly high.**

**There is no hidden headroom from vsync quantisation.** At 120 Hz the cells near 20 fps are 8.3 ms
apart, not 16.7. Six-period frames dominate and exactly one frame reached five periods, so true work
is just above 41.7 ms and mostly under 50. Uncapping the present buys ~23 fps, not 30.

Full record: `docs/verification/prd-226-device-meter-audited-2026-08-27.md`.

### Two meter traps

1. **`dumpsys gfxinfo` is the WRONG meter for this app.** It reports the Android View/Skia pipeline
   (`Pipeline=Skia (Vulkan)`, 50th percentile **8 ms**) — the Activity's view hierarchy, not the
   game, which renders into its own `SurfaceView` and bypasses Skia. Quoting it is a **5× error in
   the flattering direction**.
2. **Desktop and device pixel counts differ 2.8×.** Device renders full native **2400×1080
   (2.59 Mpix)**; desktop arms ran **1280×720 (0.92 Mpix)**. Never state a desktop millisecond as if
   it were a device millisecond. (It does not change the attribution — the Mali driver is 2.3 ms of
   the frame, so the cost is not pixel-bound.)

---

## 3. Where the frame actually goes — the measured budget

Three arms, one session, one meter (`TN_FRAME_BUDGET.phases.render.p50`), same scene, desktop:

| Arm | What | `render.p50` |
| --- | --- | ---: |
| **A0** | native control | **11.21 ms** |
| **A2** | native, backend command entry points no-oped | **9.26 ms** |
| **A5** | the same scene in Chrome, same machine | **4.05 ms** |

```
backend command recording + the GPU work it causes   T0 − A2  =  1.95 ms   (17%)
JavaScript + bridge                                       A2  =  9.26 ms   (83%)
Chrome, all of it                                         A5  =  4.05 ms
```

**Native's JavaScript-and-bridge term alone is 2.3× Chrome's entire render phase.** Of the 7.16 ms
excess over Chrome, at most 1.95 ms can be backend and GPU — and Chrome pays part of that too — so
**≥5.2 ms (73%) of the excess is JS/bridge**.

Record: `docs/verification/prd-226-budget-a0-a2-a5-2026-08-27.md`.

### The last measurement taken, not yet written up anywhere else

Parsing the profiled control run's per-frame instrumentation (`TN_ANDROID_JS_NATIVE`, 619 eligible
frames, Xvfb lane, `work = threadCpu − present` = 23.919 ms/frame in that lane):

```
bridgeNs         9.147 ms   (38% of the frame's CPU work)
bridgeOverheadNs 3.788 ms   (the trampoline: getting from JS into C++)
bindingNs        2.037 ms   (in-handler work)
commandNs        2.037 ms
bridgeCalls      5713 per frame
bridgeArgs      15005 per frame
```

**This is the strongest single clue in the whole investigation and it has not been acted on.**
5,713 crossings and 15,005 marshalled arguments per frame, costing 9.15 ms — 38% of the frame's CPU
— of which the trampoline alone is 3.79 ms.

Caveat that matters: the profiled build inflates absolutes. **Use the ratios, not the milliseconds.**

---

## 4. The graveyard — do not rebuild any of these

Each was predicted to win and measured flat. Rebuilding one is the single most likely way to waste
the next session.

| # | Lever | Predicted | Measured | Why it failed |
| --- | --- | --- | --- | --- |
| Lever A | render-pass wrapper pooling | fewer megamorphic ICs | flat, removed | targeted 0.647 ms of a 22 ms frame |
| Lever C | projection/upload tuning | ≥2 ms | −0.31 ms | inside the meter's spread |
| F10 | swapchain `desiredMaximumFrameLatency=3` | device fps | flat on device | desktop-only effect |
| F12 | batched pass encoding (−1,900 crossings) | crossings own the frame | +5% | per-crossing tax ~1 µs; crossings were ~2 ms of 40 |
| F14 / PRD-224 | per-call binding-table install | ≥2 ms | **0.02 ms** | only ~6 calls/frame use those classes |
| **A1** | swap wgpu-native → **Dawn** (Chrome's own backend) | backend is the defect | **flat** (11.85 vs 11.51) | the backend implementation is irrelevant |
| **A2** | remove the backend entirely | — | **1.95 ms of 11.21** | the backend's *presence* is only 17% |

**The backend question is closed by two independent routes.** No further work on backend choice,
wgpu-native upstream, or command-recording cost is justified.

Also note: PRD-224's conversion is *correct and kept* — `createCommandEncoder` went 30,746 → 928 ns,
**Chrome parity**. It just does not move the frame. **A large per-call win is not a frame win.**

---

## 5. Method rules — these were paid for in wasted sessions

1. **Discard the first TWO WHOLE runs of a session**, not merely window 1 of each run. Run 1 measured
   26.05 ms against 11.4–12.0 ms for every run after — same binary, same bundle, load ruled out.
   Keeping run 1 is what produced the ±100% spreads that made Levers A and C undecidable. (F15)
2. **`fps` is not a desktop meter.** Both arms sit at 59.6–59.8, vsync-capped. Judge `render.p50`.
   Warmed, the within-arm spread is 0.6 ms, so the lane resolves a ~1 ms lever.
3. **No cross-session absolute comparisons.** The recorded 22.2 ms desktop baseline does not
   reproduce: the same host revision priced ~2.3× cheaper the next day, and the bundle was rebuilt by
   another lane. **Every A/B must be a same-session control pair.**
4. **The sanctioned desktop lane is Xvfb** (`sh scripts/xvfb.sh …`), not `:0`. A sibling lane's `:0`
   pass was voided by the night lead at `d42d1a3d`. **See section 8 — this affects the numbers above.**
5. **Interleave arms, stamp load per run, sha256 every binary.** A failed compile leaves the stale
   binary in place; copy artifacts with names encoding the revision.
6. **An ablation arm removes a complete recording path or none of it.** Half-ablating render bundles
   (no-op `setPipeline`, live `Draw`) made wgpu abort on `Render pipeline must be set`. A subtler
   half-ablation would have returned a *plausible wrong number* instead of crashing.
7. **Pre-registration rule (PRD-226, binding):** before writing a lever, publish
   `predicted ms/frame = calls per frame × (measured ns/call − Chrome ns/call)` with the call count
   from `TN_BRIDGE_BY_NAME` on the actual scene. **Refuse anything predicting < 2 ms/frame.**
   Retroactively this refuses Lever A, Lever C, F10 and PRD-224 Phase 3.

---

## 6. What to do next, in order

### Step 1 — arm A3: split the 9.26 ms into JavaScript vs bridge. **This is the fork.**

Everything downstream depends on this one number, and it is the only thing standing between the
project and a decision.

The clean way: **ablate on the JavaScript side, not in C++.** Replace the hot WebGPU methods with
pure-JS no-ops so three.js runs identically but never crosses into C++ at all. Then:

- `A3` = JavaScript executing three.js, with zero crossings
- `A2 − A3` = the **entire** bridge cost (trampoline + marshalling + wrapper handling)

The C++-flag alternative (`TN_ABLATE_BRIDGE`, return at handler entry) is easier to build but leaves
the trampoline in, so it only isolates in-handler marshalling. If you build it, follow the
`TN_ABLATE_BACKEND` pattern in `packages/runtime-native/src/webgpu/ablation.h` exactly, and extend
`scripts/__tests__/ablation-flags-never-ship.spec.ts` (its `ABLATION_FLAGS` array) so the new flag
can never ship.

**What each outcome means:**

| A3 says | The path to 60 fps |
| --- | --- |
| mostly **bridge** | Stop crossing per WebGPU call. Three.js records the frame's command stream once; C++ submits it. The op-stream already exists behind `TN_WEBGPU_BATCHED_PASS`. |
| mostly **JavaScript** | The embedded V8 runs the same three.js that Chrome's V8 runs at 60 fps. The lever is V8's build configuration — tiering, builtins, pointer compression, snapshot — not the bindings. |

### Step 2 — arm A4: the independent second route to the backend term

Replay one recorded frame's command stream from C++ with zero JS per frame. Until this runs,
`T0 − A2 = 1.95 ms` holds **by construction, not by cross-check** — A2 and `T0 − A2` add to `T0`
because that is how they were defined. A4 is what makes 1.95 ms a measurement.

### Step 3 — the arithmetic that says a single fix will not be enough

Be honest with the owner about this early. On the device the frame is 43–48 ms and must reach
16.67 ms. If the bridge is ~38% of CPU work, **removing the entire bridge leaves ~28 ms — still
under 40 fps.**

**So 60 fps almost certainly needs both**: the per-call bridge eliminated *and* the JavaScript side
cut. Chrome proves the same three.js can hit 60 on this phone, so the JS side is not fundamentally
too slow — which points at the embedded V8's configuration, or at three.js being handed
dynamically-shaped objects that wreck its inline caches (F13's hypothesis, still untested for the
classes that matter).

Plan for a **compound** fix from the start. Do not promise 60 fps from any one change.

---

## 7. Assets left in place

**Code, committed:**

| Thing | Where |
| --- | --- |
| `TN_ABLATE_BACKEND` flag + ablation macros | `packages/runtime-native/src/webgpu/ablation.h`, `CMakeLists.txt` |
| Guard: ablation flags can never ship (red-green) | `scripts/__tests__/ablation-flags-never-ship.spec.ts` |
| PRD | `docs/PRDs/PRD-226-native-frame-budget-attributed-by-ablation.md` |
| A5 Chrome probe | `docs/verification/artifacts/prd-226-a5-chrome-2026-08-27.mjs` (force-added; `artifacts` is gitignored) |

**Commits this session:** `97a4c808` (PRD-224 priced, device 20.44 fps) · `d17de550` (PRD-226 filed)
· `9781b6ae` (A1) · `dfa05228` (Phase 0 harness) · `a468986c` (mis-wired arm fix) · `a3c27b34` (A2
not-measured record) · `44a5ac06` (the budget) · `bbf4574d` (meter audit + 60 fps bar).

**Binaries** were staged in a session scratchpad that will not survive. Rebuild:

```sh
# control (A0)
cd packages/runtime-native/build/tn-linux-wgpu
~/.local/bin/cmake -DTN_ABLATE_BACKEND=OFF -DTN_ANDROID_JS_PROFILE=OFF . && \
  ~/Android/Sdk/cmake/3.22.1/bin/ninja mystral
# A2: same dir, -DTN_ABLATE_BACKEND=ON
# profiled (for the bridge read): -DTN_ANDROID_JS_PROFILE=ON

# run one arm (SANCTIONED LANE — Xvfb, not :0)
cd ~/projects/threenative/sandbox/fps-framework/.threenative/build
env -u WAYLAND_DISPLAY SDL_VIDEODRIVER=x11 sh <engine>/scripts/xvfb.sh \
  <engine>/packages/runtime-native/build/tn-linux-wgpu/mystral run game.js \
  --screenshot /tmp/shot.png --frames 900
```

**Device lane** (Pixel 8 `37251FDJH0037Z`, was USB-attached and cool at 30 °C):

```sh
cd ~/projects/threenative/sandbox/fps-framework
JAVA_HOME=<jdk17> ANDROID_HOME=$HOME/Android/Sdk \
THREENATIVE_RUNTIME_SOURCE=<engine>/packages/runtime-native \
THREENATIVE_GRADLE_ARGS="-PthreenativeAbis=arm64-v8a -PthreenativeJsProfile=true" \
pnpm build:android
adb -s <serial> uninstall com.threenative.bayview   # fresh install, not upgrade
adb -s <serial> install dist-native/fps-framework.apk
adb -s <serial> shell am start -n com.threenative.bayview/com.threenative.runtime.MystralActivity
# then cross-check fps against SurfaceFlinger, per section 2
```

---

## 8. Open caveats — carry these forward, do not quietly drop them

1. **The A0/A2/A5 arms in section 3 ran on `:0`, and `:0` was voided as a lane** by the night lead at
   `d42d1a3d` in favour of Xvfb. The **ratio** (83% JS+bridge) comes from a paired, interleaved,
   same-lane A/B and is robust to lane choice; the **absolutes** are not. The sibling lane's Xvfb
   Chrome arm reads 3.3–3.5 ms against my `:0` 4.05 ms, and its native band is 12.33–13.04 ms against
   my 11.21 ms. **Re-run A0/A2/A5 on Xvfb before quoting any absolute from section 3.**
2. **A4 has not run**, so the backend term is a definition, not a cross-check (section 6 step 2).
3. **The Chrome arm used a stale bundle.** Native ran `.threenative/build/game.js` (rebuilt
   2026-08-27 00:52); Chrome ran `dist/` from 2026-08-26 13:41. `src/` is byte-unchanged between them
   and `update.mean` matches on both sides, but the installed framework package versions differ. A
   same-moment rebuild of both is owed.
4. **A5 is one session**, not six interleaved runs.
5. **The device arm is unpaired and was USB-powered** with no charger waiver recorded.
6. **`pnpm lint` is red on main** — 14 pre-existing `noExcessiveCognitiveComplexity` findings in
   `examples/` and `packages/assets`, unrelated to any of this work.
7. **Another agent lane works in this tree concurrently.** Check `git status` and file mtimes before
   attributing a red gate; commit by explicit path (`git commit --only -- <paths>`); never bare-pop
   the stash. A sibling lane's untracked `PENDING` verification file means someone is already
   measuring the thing you are about to measure — take the other half of the question or wait, and
   disclose machine contention in your own record.
