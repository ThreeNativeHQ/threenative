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

## 1. The open defect: native Android fps

**Goal (owner): 60 fps+ on a physical Pixel 8; 30 fps is a milestone, never a pass.** Chrome runs
the same Bayview scene at **59.99 fps** on the same phone, so it is physically reachable. The
panel is **60 Hz** (active mode; the 120 Hz assumption in older records is wrong — cells are
16.67 ms apart).

| Where it stands (2026-08-27 evening) | value |
| --- | ---: |
| Best known arm: **720p mailbox** (`wm size 720×1600` + `present_uncapped=1`) | **34.39 fps** (SurfaceFlinger: 34.2) |
| 1080p, any present mode / frame latency | 20.0–20.9 fps, invariant |
| CPU side of the frame (JS render + replay + misc) | ~36 ms (render ~27 after Change 1 moved work out of the meter; replay ~8; misc ~1) |
| GPU tail at present, 1080p | ~14 ms — but see §1.2: the GPU frame itself is ~63 ms |
| GPU tail at present, 720p | 0.91 ms |

### 1.1 The model that fits every measurement

```
period ≈ CPU-side work + GPU work, serialized at present
1080p:  36 + GPU ≈ 63 ms GPU frame  →  ~20 fps  (blocking drain in the diagnostic)
720p:   36 + ~1  ≈ 33 ms           →  34 fps  (CPU-bound)
60 fps needs CPU ≤ 16.7 AND GPU ≤ 16.7 AND real pipelining (frames in flight)
```

### 1.2 The fork already taken: Road B — GPU work

The diagnostic post-present drain (`TN_WEBGPU_GPU_DRAIN_PROFILE=ON`, blocking
`wgpuDevicePoll`, default-OFF and never shipped) measured the 1080p GPU frame on the
physical Pixel 8: **gpuDrain ≈ 49 ms in both FIFO and mailbox; GPU-frame estimate ≈ 63–64 ms in
both**. The pre-registered fork selects **Road B: the GPU owns the full-resolution frame**. A
present-seam fix cannot recover 46+ ms. Road A (Dawn on Android / wgpu-native present patch) is
*untried on device*, not refuted — it is parked behind Road B.

**Next change, pre-registered and not yet run** — a game-owned Bayview A/B, not a framework
change: disable only the **224 frustum-culling-disabled decal materials (~54 % of draws)** in
Bayview game source; prediction: gpuDrain 49 → ≤ 34 ms (≥ 15 ms GPU-frame cut). Decision rule:
material cut → price a shippable render-scale feature; immaterial → profile GPU passes. Do not
sneak render scale in. Separate feature decision on file: a game-facing render-scale knob banks
the 34 fps 720p/mailbox win without `wm size`.

### 1.3 Untried, named

Dawn on Android; any GPU-side timestamp timing (the drain is wall-clock algebra, not correlated
spans); Chrome-on-device attribution (its 59.99 fps has no breakdown, CSS viewport unrecorded);
cross-engine QuickJS/JSC lanes; 720p FIFO with the instrument; three-capture acceptance for any
arm above (all runs to date are single captures, diagnostic grade).

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
8. **No cross-session absolutes.** The 22.2 ms desktop baseline does not reproduce (machine state
   ~2.3×, bundle drift). Device pixel counts vs desktop differ 2.8×; never state a desktop
   millisecond as a device one. Profiled builds inflate absolutes — use ratios.
9. **Live windows only** on device (`update.mean ≥ 3 ms`), or an end-screen idle reads as a
   174 fps "win". Classify windows before comparing.
10. Red-green with named mutations; never claim a gate you did not run; paste output. Device
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
| Fill rate / resolution? | GPU-frame-time at 1080p ≈ 63 ms — the GPU owns the full-res frame (Road B). |
| Present mode / swapchain depth? | Not the limiter (mailbox arm flat at 1080p; latency flat everywhere). |
| Composited web UI overlay? | Measured free twice. Not the owner. |
| Host-loop segments (events/audio/timers/microtasks/handles/screenshot)? | All < 1 ms on device steady state. Dead. |
| Is native slower than Chrome because of Android? | No — desktop native ≈ Android native per-frame; Android just has no budget to hide it. |
| Is native fast enough in principle? | Yes — fox platformer, 2026-08-11: ~106 fps median uncapped vs Godot 53.7–59.5 (unfair comparison, different games — see §6). |

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

---

## 7. Harness status

`assert.performance` (playtest scenarios) bounds `maxFrameMsP95`, `minFps`, `maxPhaseMsP95`,
`maxDrawCalls`, `maxTriangles` from the bridge's `performanceSeries` — fail-closed on missing
samples. `TN_HOST_GAP` has **no code parser anywhere**: every number in §1–§2 was read from logs
by hand. A `perf` subcommand in the playtest CLI (parse both markers from captured console/logcat,
report p50/p95 per segment, fail closed, name the GPU adapter) is the agreed next harness change;
until it lands, the recipes in §4 are the protocol.

## 8. Deleted-record index (evidence lives in git history)

| Deleted record | What it carried that this file does not |
| --- | --- |
| `prd-222-2026-08-25.md` | Phase 0 parity protocol: Chrome 59.99 vs native 19.15 fps same build 32 s apart; thermal-validity table |
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
