# HANDOVER — fix the native 20 fps. Read this, do task 1, nothing else first.

**2026-08-27.** Written to be executed. Supersedes the "next steps" in
[HANDOVER-native-60fps](HANDOVER-native-60fps-2026-08-27.md) and
[PATH-TO-60FPS](PATH-TO-60FPS-2026-08-27.md), both of which are diagnosis on a model that has now
mispredicted three times.

**Do not take "execute PRD-227" as your task.** Its two named changes are finished — Change 1 landed,
Change 2 was falsified — so an agent told to execute it invents lever ten. Your task is task 1 below.

---

## 1. Where it stands, in one table

Physical Pixel 8 `shiba`, Bayview, all measured 2026-08-27:

| Arm | what it changed | fps |
| --- | --- | ---: |
| baseline | — | 20.39 |
| Change 1 landed | ~40% less measured per-frame work | 20.02 |
| 720×1600 | 2.25× fewer pixels | 19.89 |
| `present_uncapped=1` | FIFO → mailbox, no vblank wait | 19.77 |
| `ui.renderer: "native"` | no composited WebView layer | 20.67 |

**Nothing moves it.** `hostGap` reads **21–25 ms in every single arm** — invariant to CPU work,
pixel count, present mode and the overlay. Total wall clock stays at ~48–50 ms.

Chrome runs this same scene at **59.99 fps on this same phone**. The panel is **60 Hz** (not the
120 Hz every older document assumed), so the cells are 16.67 / 33.33 / **50.00 ← we are here**.

Full evidence: [prd-227-cadence-lock-2026-08-27](prd-227-cadence-lock-2026-08-27.md).

---

## 2. The lead — and it may mean Change 1's win is partly an accounting artifact

`hostGap` is defined in `packages/core/src/frame-budget.ts` as **"the time before the callback —
present wait plus whatever the host did between callbacks."** Everything `update`/`render` measures
happens *inside* `executeAnimationFrameCallbacks()`. Everything else in the loop is `hostGap`.

Now look at what Change 1 did. In `packages/runtime-native/src/runtime.cpp` around **line 1088**:

```cpp
jsEngine_->beginFrame();
webgpu::beginDawnFrame(bindingsState_);

executeAnimationFrameCallbacks();      // <-- measured as update + render

webgpu::endDawnFrame(bindingsState_);  // <-- packed stream replay + submit + present
jsEngine_->clearFrameHandles();
```

**Change 1 moved the entire WebGPU command stream out of the JS callback and into
`endDawnFrame()` — which is outside the measured region.** The frame's work did not necessarily
fall from 43–48 ms to 25.27 ms. Some of it may simply have **left the instrument** and landed in
`hostGap`, which is exactly the number that never moves.

That single possibility explains the whole session: work "fell" 40%, fps didn't budge, and
`hostGap` stayed pinned.

**Verify or kill this first. It is the cheapest and highest-value thing on the list.**

---

## 3. TASK 1 — split `hostGap` into named sub-phases (this is the whole job)

Instrumentation, not optimisation. Time each segment of the loop body in
`packages/runtime-native/src/runtime.cpp` and emit them beside the existing budget.

The segments, in order, all in the same loop body (~lines 1055–1105) plus `pollEvents()` at ~823:

| Segment | Call | Why it is a suspect |
| --- | --- | --- |
| `events` | `pollEvents()` / `platform::pollEvents()` (~823, ~980) | SDL event pump can block |
| `audio` | `audio::processAudioEvents()` (~1056) | — |
| `timers` | `executeTimerCallbacks()` (~1065) | — |
| `files` | `processPendingFileCallbacks()` (~1068) | — |
| `ui` | `drainUiMessages()` (~1072) | overlay refuted, but time it anyway |
| `microtasks` | `processMicrotasks()` (~1075) → `PumpMessageLoop` + `PerformMicrotaskCheckpoint` | drains **all** pending platform tasks in a `while` loop |
| **`replay`** | **`webgpu::endDawnFrame()` (~1094)** | **PRIME SUSPECT — §2. Replay + submit + present + any fence wait** |
| `handles` | `jsEngine_->clearFrameHandles()` (~1096) | — |
| `screenshot` | `processPlaytestScreenshotRequest()` (~1100) | file polling every frame |

Use the same clock the budget already uses, report through the existing `TN_FRAME_BUDGET` marker (or
a sibling `TN_HOST_GAP` marker if extending the schema is fussy), and **make the sub-phases sum to
`hostGap`** — if they don't, the residual is itself the finding.

**Acceptance for task 1:** one device run whose output names which segment owns the ~25 ms. That is
the deliverable. Do not fix anything in the same commit.

**Red-green:** insert a deliberate `usleep(5000)` in one segment, confirm that segment's number rises
by 5 ms and the others do not, then remove it and paste both.

---

## 4. Then, and only then

Two hypotheses to test **after** task 1 says where the time is. Both would be invariant exactly the
way the data is:

1. **Swapchain acquire / GPU fence.** A blocking `getCurrentTexture` or an implicit wait on submitted
   work serialises CPU and GPU into one 50 ms interval and ignores present mode.
   *Counter-evidence to weigh:* at 720×1600 the GPU had 2.25× less to do and the total did not fall.
2. **Host loop pacing.** `substeps.p50` is **3** in every arm — the fixed-step update catches up
   three times per rendered frame. Symptom or cause has never been separated.

---

## 5. Dead. Do not re-spend on these.

Nine levers. Each was measured, not assumed.

| Lever | Result |
| --- | --- |
| F12 batched pass | +5% |
| F14 / PRD-224 binding tables | 0.02 ms |
| Lever A wrapper pooling | flat |
| A1 Dawn↔wgpu backend swap | flat |
| P2 fixed-shape wrappers | **worse than baseline**; owner is three.js's node graph, not our wrappers |
| Resolution / fill rate | 2.25× fewer pixels, fps flat |
| GC / V8 heap tuning | 0.2% of wall clock |
| FIFO present cadence | uncapped mailbox, fps flat |
| Composited web UI layer | `ui.renderer: "native"`, fps flat |

Also closed: **optimising three.js renderer internals inside the host** — it violates the ownership
rule (`runtime-native` owns the seam, three.js stays the renderer). And **Phase 4 / cutting Bayview's
draw counts** — the owner's ruling is that game code is experiment-only unless profiling proves the
game owns the cost, and it does not.

---

## 6. Everything you need to run it

```sh
ADB=~/Android/Sdk/platform-tools/adb          # on disk, off PATH
# device: Pixel 8 shiba, Wi-Fi adb 192.168.1.192:5555 (keeps it discharging, which the gate wants)

# rebuild the game against YOUR edited engine source — no tarball repack needed
cd /home/joao/projects/threenative/sandbox/fps-framework
JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
ANDROID_HOME=~/Android/Sdk \
THREENATIVE_RUNTIME_SOURCE=/home/joao/projects/threenative/threenative-engine/packages/runtime-native \
  pnpm build:android                          # ~40 s incremental

# confirm the .so actually carries your change before trusting any number
unzip -p dist-native/fps-framework.apk lib/arm64-v8a/libmystral-runtime.so | strings | grep <your-marker>

$ADB install -r -d dist-native/fps-framework.apk
$ADB shell am force-stop com.threenative.bayview
$ADB logcat -c
$ADB shell am start -n com.threenative.bayview/com.threenative.runtime.MystralActivity
# wait ~55 s for a 300-frame window
$ADB logcat -d | grep -o 'TN_FRAME_BUDGET.*' | tail -1

# cross-check any fps claim — gfxinfo is INVALID here, it reads ~5x flattering
$ADB shell dumpsys SurfaceFlinger --timestats -clear -enable   # ... run ... then -dump

# the uncapped-present control, added this session, no rebuild needed
$ADB shell setprop debug.threenative.present_uncapped 1   # 0 = fifo control
```

Desktop screen for anything that doesn't need the phone (read `render.p50`, **never** fps — Xvfb
throttles presents):

```sh
cd /home/joao/projects/threenative/sandbox/fps-framework/.threenative/build
TN_V8_FLAGS="--trace-gc" SDL_VIDEODRIVER=x11 \
  sh /home/joao/projects/threenative/threenative-engine/scripts/xvfb.sh \
  /home/joao/projects/threenative/threenative-engine/packages/runtime-native/build/tn-linux/mystral \
  run game.js --frames 600
```

## Tree state

| Tree | Path | HEAD |
| --- | --- | --- |
| engine | `threenative-engine` | `a9a05bca` on `main` |
| game | `sandbox/fps-framework` (Bayview) | `7e4f912`, appearance restored, config clean |

**Do not sweep the engine tree's uncommitted files** — `packages/core/src/picking.ts` and the
untracked `scratch-*` / `projection-hot-path.spec.ts` under `packages/core` belong to another lane.

Another agent may be in this tree at the same time. Commit as you go.
