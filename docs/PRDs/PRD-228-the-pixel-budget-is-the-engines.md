---
prd_contract: v1
---

# PRD-228 — the pixel budget is the engine's, not the game's

**Status:** PARTIAL — **Phases 0, 1 (bar the DPR item), 2 and 3's bindings are done and on
`main`; Phase 3's first use and Phase 4's acceptance are open.** Start at "What is left", below
Phase 4.
Filed 2026-08-28 from
[runtime-perf-state §1.3.3, §1.4, §1.5](../verification/runtime-perf-state.md). PRD-227 owned the
CPU seam and closed it: the device frame is now CPU-clean (frame p50 9.3 ms of a 16.7 ms budget).
This PRD owns what is left, which is pixels and the missing instrument to price them.

**Goal: any game reaches its `display.maxFps` target on a physical Pixel 8 without hand-authoring a
resolution constant, and the GPU frame is measured rather than inferred.** Bayview already hits 60+;
it hits it because a human picked `0.36` and typed it into game source. The next game starts at
20 fps again.

**Complexity:** +1 for a public config value crossing web and three native packagers, +1 for a new
WebGPU binding surface, +1 for the device acceptance lane = **HIGH mode**.

**Session handoff (2026-08-28) — the tree is ready; start at Phase 0.**

Landed here already, all path-limited and each with its gate run:

| Commit | What |
| --- | --- |
| `de750dee` | projection reconcile bracketed into the render phase |
| `696e86e3` | `renderer.resolutionScale` + Android override (2/2, 57/57) |
| `a2a7ac7c` | the baseline decision, above |
| `3a68715b` | `tracers.spec.ts` fails closed on absent slots — **`pnpm typecheck` now exits 0**, first green of the session |
| `5b3ec150` | preflight reads the panel's active mode and can gate on it (11/11, red-green, device-verified) |

Gate state, measured not assumed:

- `pnpm typecheck` — **exit 0**.
- `pnpm lint` — red on **20 pre-existing** `noExcessiveCognitiveComplexity` findings across
  `examples/` and `packages/assets`, none in any file this work touched.
- `pnpm test` — red on **one pre-existing assertion**, `suppressPlayProtectOnAdbInstalls` "wired
  before the install in every lane that installs an APK". It has been failing for all six listed
  lanes since the guard landed. One was fixed here; five remain, each needing its own adb adapter
  and a real install to verify, so they were not attempted blind — they are named in that commit
  message. Everything else passes.

None of these three is PRD-228's to clear, and none blocks Phase 0.

Uncommitted and deliberately untouched: `sandbox/fps-framework` holds another lane's live arm —
`maxFps: 60`, `renderer.android.resolutionScale: 0.32`, plus `package.json`/`pnpm-lock.yaml`
mid-reinstall. That lane owns those files; do not sweep them. Phase 0's first item is to commit or
revert them, because an arm whose config is not in git is not an arm.

## Layer verdict

**Engine-owned, both changes.**

A game cannot portably discover the physical/logical pixel relationship on Android, cannot read its
own presented frame time before the runtime reports it, and cannot ask wgpu-native for a GPU
timestamp the bindings refuse to expose. That is the platform seam in rule 1(a): the framework owns
it at any size. Neither change decides how anything looks — a resolution *scale* is mechanism, the
same mechanism `renderer.setPixelRatio` already is on web, and the game keeps every material,
shadow and post effect it authored. Rule 1(b) is not triggered.

The counter-argument is on the record and rejected: §1.3.3 assigned Bayview's own 0.36 to game
source, correctly, because *that specific number* was a decision about how *that game* looks at
*that* moment. The contract for expressing such a number, and the loop that finds it, is not.

## The problem, measured

### Defect 1 — the scale is a hand-found constant, unreported, on a lying DPR

**Correction to this PRD's first draft, recorded rather than quietly fixed:** the transport exists.
When this PRD was filed it was uncommitted work in a concurrent lane; it landed at `696e86e3`
during the same session, with its tests (2/2 and 57/57) green. `packages/core/src/config.ts:114–121` carries `renderer.resolutionScale` plus an
Android-only `renderer.android.resolutionScale`; `packages/core/src/renderer-config.ts:12` selects
between them by platform; `renderer.ts:240` applies it to the drawing buffer while leaving CSS and
UI dimensions alone. The perf record's `TN_RENDER_SCALE` is the host-side echo of that field, not a
separate mechanism. Bayview's live value is `renderer.android.resolutionScale` — **0.32 in the
working tree, not the 0.36 §1.3.3 accepted**, alongside `maxFps` moved back to 60. Both edits are
uncommitted in `sandbox/fps-framework`, so the perf record and the tree already disagree.

What is missing is everything around the field:

1. **No auto mode.** The value is a number a human finds by building, flashing, measuring and
   rebuilding. Bayview's took an afternoon and three ladder rungs. The next game repeats it.
2. **No reporting.** Nothing in `TN_FRAME_BUDGET` says what scale produced a measurement. Every fps
   number in §1 is therefore only as trustworthy as the prose beside it — which is exactly how the
   record came to say 0.36 while the tree says 0.32.
3. **`devicePixelRatio` still lies.** `packages/runtime-native/src/runtime.cpp:2980` sets it to the
   literal `1.0` and `runtime.cpp:2612` reports `canvas.width`/`canvas.height` as the physical
   surface. On a Pixel 8 that hands three.js 2400×1080 = **2,592,000 pixels** as though they were
   CSS pixels. `resolutionScale` is the game paying that back by hand; the ratio itself is still
   wrong, and §1.4 still lists it open.
4. **The Android override block carries `resolutionScale` and nothing else** — see Defect 3.

The measured ladder, same build, same physical Pixel 8, 60 Hz FIFO (§1.3.3):

| 3D scale | drawing buffer | pixels | steady fps | presented p50 |
| ---: | ---: | ---: | ---: | ---: |
| 0.44 | 1056×475 | 501,600 | 56.31–58.28 | ~17.45 ms |
| 0.40 | 960×432 | 414,720 | 58.51–59.31 | ~16.98 ms |
| 0.36 | 864×389 | 336,096 | 59.81–59.99 | cap-clipped, not a slope point |

Two clean points give **5.51 ms per megapixel** on this scene and this GPU. **This is a two-point
slope inside a 0.09 Mpx span, and Phase 0 must widen it before it carries any weight** — it is
quoted here as the pre-registration, not as a result.

### Defect 2 — every GPU number in the ledger is wall-clock algebra

`packages/runtime-native/src/webgpu/bindings.cpp:2118` and `:5041` both refuse the feature by name:

```
// timestamp-query is NOT supported yet - bindings not implemented
if (featureName == "timestamp-query") { ... }
```

So the entire GPU attribution in §1.3.2 — IBL ≈ 5–6 ms, flat town pass ≈ 9–11 ms, materials ≈ 2.5,
soldiers + sky ≈ 7, floor 0.35 — was obtained by ablating scene content and differencing a blocking
`wgpuDevicePoll` in a diagnostic build that is default-OFF and never ships. Ablation gives totals
per *object*. It cannot give cost per *pass stage*.

The consequence is live and blocking: the largest single unattributed term is the flat town pass at
9–11 ms for ~232–315 draws, and nobody knows whether that is vertex/binning work or fragment work.
Mali-G715 is a tile-based deferred renderer, so those two answers point at **opposite levers** —
binning cost says cut draws and vertices further, fragment cost says cut overdraw and shader ALU.
§1.5 already names GPU timestamps as the next instrument. It is named and not built.

### Defect 3 — sampling has no platform override, and it is off in the only tuned game

`sandbox/fps-framework/src/game.ts:86` reads `renderer: { antialias: false }`. It was introduced on
**2026-08-18** by `8e23418 "feat: add profiling and debugging tools for performance analysis"` — a
profiling knob, turned off to isolate a measurement, never turned back on. It has been off for ten
days and through every perf commit since.

That was invisible while the 3D buffer was the full 2400×1080. At `resolutionScale: 0.32` the buffer
is 768×346 and the compositor upscales it **3.1×**, so every aliased edge is now three device pixels
wide. **The scale did not turn antialiasing off; it magnified the consequence of antialiasing having
been off.** This is the "crisp, as if AA is turned off" report, and it is exactly what an
unreported, unbounded scale is expected to produce.

The engine half of the defect: `config.ts:118–120` gives the Android override block
`resolutionScale` and nothing else. A game that trades resolution for frame budget therefore cannot
portably buy quality back with sampling on the same platform, even though a tile-based GPU like
Mali-G715 resolves MSAA in tile memory and prices it very differently from a desktop GPU. The
bindings already carry the plumbing — `multisample.count` is parsed at `bindings.cpp:4728` and
`resolveTarget` is replayed in the op stream — so nothing is missing below the config seam.

## Solution (decision recorded here)

Two changes. Change A is the fix and ships value alone. Change B is the instrument and unblocks
everything after this PRD. They are independent; B does not gate A.

### Change A — `resolutionScale: "auto"`, on the field that already exists

Extend `renderer.resolutionScale` rather than invent a second one. The field, its Android override
and its platform seam already ship; this widens its type and gives it a loop, which is strictly less
code than a parallel `renderer.resolutionScale` would be.

```ts
export default {
  renderer: {
    resolutionScale: "auto",              // portable default
    android: { resolutionScale: "auto" }, // or a pinned number, as today
  },
} satisfies IThreeNativeConfig;
```

- **`"auto"` becomes the default**, per the conventions rule: the framework reads the presented
  frame time it already emits in `TN_FRAME_BUDGET` and moves the drawing-buffer scale toward the
  largest value that holds the `display.maxFps` budget. Hysteresis and settle window are fixed in
  Phase 2, before the code, so it cannot oscillate on a thermal edge.
- **A number in `(0, 1]` pins it** and turns the loop off — today's exact behaviour, unchanged, and
  what Bayview's `0.32` stays.
- **Turning the convention off does not turn its measurement off.** `TN_FRAME_BUDGET` reports the
  active scale, the drawing-buffer dimensions and `scaleSource: "pinned" | "auto"` in every window
  in both modes. This is the fix for a record that says 0.36 while the tree says 0.32.
- **The overlay/UI surface is never scaled.** Only the 3D drawing buffer moves — the arrangement
  §1.3.3 accepted and proved.
- **Web, desktop and iOS carry the same contract**, or the feature is unfinished by the framework's
  own rule.

Underneath it, `devicePixelRatio` stops being a lie: native reports the real ratio and exposes the
canvas in logical pixels, which is what web already does and what §1.4 still lists open.

### Change B — `timestamp-query` in the WebGPU bindings

Implement `QuerySet`, `timestampWrites` on render/compute pass descriptors, `resolveQuerySet`, and
the feature advertisement the two refusal sites currently reject. wgpu-native exposes it; three.js
consumes it; Chrome has it behind the same feature name, so the same scene can be measured on both
sides with one code path. It ships as a normal optional feature, requested only when the adapter
advertises it — not as an ablation flag, so `ablation-flags-never-ship.spec.ts` stays green.

### Change C — sampling is part of the pixel budget, not a separate one

- `antialias` joins `resolutionScale` in the Android override block, so a platform that scales down
  can buy quality back on the same platform.
- The active sample count is reported in `TN_FRAME_BUDGET` beside the scale. A resolution number
  without its sample count does not describe an image.
- The auto scaler treats scale and samples as **one budget**: Phase 2 states which it spends first
  and why, from measurement, rather than leaving the interaction implicit.
- No default is changed on the strength of argument. Phase 0 measures `(scale × samples)` on device
  and the pairing is chosen from that table.

**Bayview's own `antialias: false` is a game fix, not this PRD's** — one line, game-owned by rule 2,
and it should be reverted and re-measured independently of anything here. What this PRD owns is that
the framework let a profiling knob survive ten days and four perf commits without one report naming
it.

### Pre-registered arithmetic, per PRD-226's binding rule

| Change | Predicted device saving | Threshold |
| --- | ---: | --- |
| A, for a game that has not hand-tuned a scale | 2.256 Mpx × 5.51 ms/Mpx = **12.4 ms/frame** | ≥2 ms ✓ |
| B | **none claimed — it is an instrument** | exempt |

The 12.4 ms is the distance between DPR-1 physical (2.592 Mpx) and the budget Bayview had to find by
hand (0.336 Mpx), at the measured slope. It is an extrapolation well outside the 0.41–0.50 Mpx span
that produced the slope, and **Phase 0 refuses to let it stand unmeasured**.

**Falsification, stated before implementation:** if Phase 0's five-point uncapped ladder is not
monotonic in pixel count, or its slope lands below 2 ms/Mpx, then this scene is not fill-bound, the
0.36 constant worked for some other reason, and Change A is a convenience rather than a performance
contract. Stop, re-derive, and re-file. Change B proceeds either way.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | `resolutionScale` widened to `number \| "auto"` | `config.ts:114–121`, `renderer-config.ts:12`, `renderer.ts:254`, `game.ts:573` | a number-only field with no auto mode | delete the `"auto"` branch → the type/range unit test fails and the scaler never runs |
| 2 | `"auto"` as the shipped default in generated templates | `create-threenative` templates, all three packagers' default configs | templates that ship no scale at all, so every game starts at DPR-1 physical | set a template default back to `1` → the template device gate misses its `minFps` |
| 3 | Honest `devicePixelRatio` + logical-pixel canvas | `runtime.cpp:2980`, `runtime.cpp:2612` | hardcoded `1.0` and physical `canvas.width` | revert line 2980 to `1.0` → the DPR conformance case reads 1.0 against a known physical/logical pair and fails |
| 4 | Adaptive scaler driven by presented frame time | `packages/core/src/frame-budget.ts` consumer in `game.ts` | nothing | pin `resolutionScale` to a number → the scaler must not move, asserted; disable the downward step → the over-budget playtest misses `minFps` |
| 5 | Active scale **and sample count** reported every window even when pinned | `TN_FRAME_BUDGET` payload | a payload that cannot tell you what resolution or sampling produced it — how the record came to say 0.36 while the tree says 0.32 | pin both and assert the fields are still present and correct |
| 5b | `antialias` in the Android override block | `config.ts:118–120`, `renderer-config.ts` | a block carrying `resolutionScale` alone | remove the key → a game cannot request per-platform sampling; the override unit test fails |
| 6 | `timestamp-query` feature + `QuerySet` bindings | `bindings.cpp:2118`, `:5041`, three.js `TimestampQuery` path | two `if (featureName == "timestamp-query")` refusals | re-add the refusal → the bindings test that resolves a two-write query set fails |

## The baseline — DECIDED 2026-08-28: 60 Hz panel, 60 fps, p95 ≤ 14 ms

**Decision: acceptance runs on a 60 Hz panel at `maxFps: 60`, and a frame is accepted at
`frame p95 ≤ 14 ms` — amended from `presented p95` on 2026-08-28, see immediately below — not at
16.6.** 120 Hz remains a real arm, reported separately, and is
never the gate. Rationale below; it was an open question for one session and this settles it.** It caused a real confusion on 2026-08-28 and one wrong action (this author restored the
phone's 120 Hz mode mid-investigation, which invalidated the comparison rather than repairing it;
the device was returned to 60 Hz).

The facts, not the preference:

- Bayview ships `display.maxFps: 60`.
- The Pixel 8 was found with Smooth Display **off** — `system/peak_refresh_rate 60.0`,
  `mActiveSfDisplayMode` mode 0 @ 60 Hz, `appRequest=physical: (0.0 60.0)` — so the app's
  `Surface.setFrameRate` vote was clamped away, not declined. Battery Saver was off (`low_power 0`),
  so this is a **different cause** from the one §1.3.4 records.
- The 0.32 arm read **49.93 fps** on that 60 Hz panel: 2,255 × 16 ms + 678 × 33 ms, **zero 8 ms
  intervals**. §1.3.4's accepted **70.358 fps** was on 120 Hz: 1,007 × 8 ms + 2,511 × 16 ms.
- Render p95 was 15.5–17.8 ms in both. At 60 Hz a 17.8 ms frame is charged 33.3 ms; at 120 Hz it is
  charged 25 ms. **Same frame, different penalty.**

Both runs are valid measurements of *different machines*. Neither is an error. The error is that
neither run stated which machine it was on, which is what Change A's reporting item fixes.

### Amended 2026-08-28, from the device: the 14 ms bar may not be read off `presented`

**`presented p95 ≤ 14 ms` is unreachable on the very panel this baseline pins.** Under FIFO the
presented interval is the panel's period: a game locked perfectly at 60 fps on a 60 Hz panel
reports presented p50 16.67 ms and p95 around 17.6–18.4 ms, and no amount of headroom moves it.
This is the same error as the Phase 2 trigger amended below, found the same way and on the same
run — the bar was written as though `presented` measured the game's cost, and it measures the
panel's cadence.

**The bar keeps its meaning and changes its meter: `frame p95 ≤ 14 ms`** — the frame callback's
own duration, which is the work — **plus fps at the configured target, plus SurfaceFlinger
confirming no dropped frames.** 14 ms remains ~84 % of the 16.67 ms budget and still refuses a
frame with zero headroom; what changes is that it is measured on the thing that can vary.

Evidence, §1.3.7: a scaffolded platformer holding 60 fps at full 2400×1080 read `frame p95`
6.51–8.70 ms against `presented p95` 17.2–18.9 ms across 65 windows, with SurfaceFlinger
reporting 19,372 of 19,562 frames at 16 ms, **zero dropped and zero janky**. Under the old wording
that run fails; under this one it passes, and the second reading is the one that describes the
game.

### Why 60 Hz, and why 14 ms

**1. Test the config the templates ship.** Every generated template ships `display.maxFps: 60`. A
gate run at 120 Hz tests a configuration no template ships. That is the whole argument by itself;
the rest is supporting.

**2. 60 Hz is the floor of the device population, and the floor is what a baseline means.** Holding
60 fps on a 60 Hz panel implies holding it on a 120 Hz one. The converse is false, and this session
measured exactly that false direction: 70.358 fps at 120 Hz, 49.93 fps at 60 Hz, *smaller* buffer.
This phone's factory default is in fact the 120 Hz mode (`defaultMode 2`) — which is precisely why
the baseline cannot be "whatever the phone happens to be set to." It must be pinned and stated.

**3. It removes the confound permanently.** At 60 Hz there is one present interval and an fps
reading is unambiguous. A 60 fps cap on a 120 Hz panel produces a mixed 8/16 ms histogram whose
mean flatters a frame that is genuinely over budget — the finer granularity hides missed frames
instead of reporting them.

**4. Industry practice is a stable 60 with high-refresh as an opt-in mode.** Mobile titles that
support 90/120 ship it as a performance toggle gated on device tier and thermals, not as the
certification target. Consistency is the shipped property; peak rate is a setting.

**5. The 14 ms bar is the part that actually matters.** Accepting at 16.6 ms accepts a frame with
zero headroom, which fails minutes later as the device warms — §1.3.3's own accepted run already
showed 13 spikes and a 74.72 ms worst frame. **14 ms is ~84 % of the 16.67 ms budget**, leaving
room for thermal drift, GC, and a scene busier than the measured spot. A game that needs all
16.6 ms is not a 60 fps game; it is a game that reads 60 fps once.

### What this decision costs, stated plainly

Under it, **Bayview at `resolutionScale` 0.32 fails.** Render p95 was 15.5–17.8 ms — over the 14 ms
bar and straddling the 16.67 cliff, which is what produced 678 frames at 33 ms. That is a real
result, not an artifact, and the resolution ladder the concurrent lane was walking
(0.36 → 0.32 → 0.28) is a legitimate response to it. Nothing about that work is invalidated; it was
only ever missing the statement of which panel each rung ran on.

It also means §1.3.3 and §1.3.4's greens were obtained on an easier machine than the shipped
default. They stay in the record as **120 Hz arms**, correctly labelled, and stop being quoted as
the acceptance.

### The gap that let this happen

`packages/runtime-native/scripts/device-preflight.mjs` gates battery percent, charging state,
thermal status and screen-on. It did **not** read the display mode, `peak_refresh_rate`,
`min_refresh_rate` or `low_power` — so an arm could run on a silently-downclocked panel and report a
number that looks like a fill regression. (An earlier line here said the script had "no tests at
all". That was wrong: `packages/runtime-native/tests/device-preflight.test.mjs` exists and
`vitest.config.ts` picks it up via `tests/**/*.test.{ts,mjs}`. It had no *display* coverage.)

**Closed 2026-08-28 (`5b3ec150`), ahead of the rest of the PRD.** Capture is unconditional and the
gate is opt-in via `requireRefreshHz`; 11/11 tests, red-green mutation named, verified against the
physical Pixel 8. Phase 0's protocol below runs it before every arm.

## Execution Phases

### Phase 0 — earn the slope, before writing the contract

**Falsification gate. Run this first. It is a measurement phase and lands no product code.**

Pin the machine before the first arm — the gate that makes this repeatable now exists:

```sh
# panel to the decided baseline, then prove it rather than assume it
adb shell settings put system peak_refresh_rate 60.0
node -e 'import("./packages/runtime-native/scripts/device-preflight.mjs").then(async (m) => {
  const c = await m.assertDeviceReady(process.env.TN_SERIAL, {
    minBatteryPercent: 50, requireDischarging: true, maxThermalStatus: "NONE",
    allowOverride: false, requireRefreshHz: 60,           // <- refuses the wrong panel
  });
  console.log(JSON.stringify(c));
})'
```

Its output — `activeRefreshHz`, `supportedRefreshHz`, `peakRefreshRateSetting`,
`minRefreshRateSetting`, `lowPower` — is pasted into the run record for **every** arm. An arm
without it is not an arm. Verified on the phone 2026-08-28; it returns, for example:

```json
{"serial":"…","batteryPercent":55,"charging":false,"chargingSource":"NONE","thermalStatus":"NONE",
 "thermalStatusCode":0,"screenOn":true,"activeRefreshHz":60,
 "supportedRefreshHz":[120,60,40,30,24,20],"peakRefreshRateSetting":60,
 "minRefreshRateSetting":60,"lowPower":false,"provisional":[]}
```

**Charge the phone on a real charger before starting.** It was at 55 % on 2026-08-28, barely over
the 50 % floor, and this phase is **ten arms** — five scale rungs plus five `(scale × samples)`
rungs. The adb cable does not charge this device. Expect the battery floor, not thermal, to end the
session first.

Then, per rung, cold launch and read both meters:

```sh
adb shell am force-stop com.threenative.bayview && adb shell pidof com.threenative.bayview   # must be empty
adb logcat -c && adb shell dumpsys SurfaceFlinger --timestats -clear -enable
adb shell am start -W -n com.threenative.bayview/com.threenative.runtime.MystralActivity
threenative-playtest perf --logcat "$TN_SERIAL" --require-windows 4 --min-fps 60 --text
adb shell dumpsys SurfaceFlinger --timestats -dump    # cross-check, per method rule 3
```

- [x] Baseline is **decided** (60 Hz panel, `maxFps: 60`, accept at presented p95 ≤ 14 ms). Pin and
      prove it with the preflight above before the first arm.
- [x] Five-point scale ladder — 1.0, 0.72, 0.55, 0.44, 0.32. **Correction, recorded:** run on the
      **120 Hz** panel, not the 60 Hz one. A panel cannot resolve a frame cost below its own vsync
      period, so every rung at or under 16.7 ms reads exactly 16.7 ms on a 60 Hz panel and the
      "uncapped ladder" this phase's own falsification clause demands is impossible there. It is a
      slope arm, reported separately, and no acceptance cites it. Recorded in §1.3.5.
- [x] Same build, same session, same commit, cold launch per method rule 4, first **two** runs
      discarded per rule 1, live windows only, thermal status and battery at both ends. **Method
      rule 9's `update.mean ≥ 3 ms` liveness test is dead** — PRD-227 cut update to 0.46 ms, so it
      now rejects every live window. Replaced in §3 and the replacement is recorded in §1.3.5.
- [x] SurfaceFlinger `--timestats` cross-check on at least the endpoints, per rule 3, with the
      present-interval histogram. Both endpoints agree with our own fps to within 0.5–4.2 fps and
      neither shows the clamped single-bin signature.
- [x] **Slope published and fitted. PASSED:** presented p50 = **9.94 ms/Mpx** × pixels + 13.79 ms,
      R² 0.992, n=5, monotonic — five times the 2 ms/Mpx floor. The pre-registered 5.51 ms/Mpx was
      **low by 1.8×** (it came from two cap-clipped points in a 0.09 Mpx span), so Change A's
      predicted saving for an untuned game is **22.4 ms/frame**, not 12.4.
- [ ] **Second ladder, `(scale × samples)`:** at minimum 0.32/1×, 0.32/4×, 0.44/1×, 0.44/4×,
      0.55/4×. Mali-G715 resolves MSAA in tile memory, so the cost is not the naive 4× and the
      pairing must be measured, never assumed. This table chooses Change C's defaults.
      **RUN, THEN WITHDRAWN THE SAME DAY.** The arms read +0.07 ms at 0.32, −0.40 ms at 0.44 and
      +7.47 ms at 0.55, which looked like a tile-memory cliff. It is not safe to use:
      `TN_GPU_TEXTURES` is byte-identical between every `antialias: true` arm and its `false` twin,
      so **the flag may never have reached a sample count on the native path** — in which case the
      "free" readings measure nothing and the 0.55 outlier is better explained by the late-session
      drift found in that same arm (`frameReplay` up 4.98 → 7.38 ms, which MSAA cannot touch). The
      arms predate `surface.sampleCount`, so their logs cannot answer it. **One arm on the current
      core settles it**, because every window now reports the sample count it actually drew at.
      Change C has no measured default until then.
- [x] **Record reconciled with the tree first**, committed in the sandbox as `7be81eb` before the
      first arm. The live value was 0.28, not the 0.32 the record claimed.
- [x] Recorded in `runtime-perf-state.md` §1.3.5 in place, per the owner's consolidation
      exception; the device scaler arm is §1.3.6.

### Phase 1 — the contract, without the loop

- [x] `resolutionScale?: number | "auto"` at both levels in `config.ts`, validated. **Landed
      `3dd0415e`**, and the *scaffold's* validator was widened to the same rule in `573d8f2e` — it
      had rejected exactly what the templates now ship, caught by the scaffold build gate.
- [x] `antialias` added to the Android override block and resolved on the same seam. **Landed
      `ca121bf8`.**
- [ ] **OPEN — the last Phase 1 item, and larger than it looks.** Scoped 2026-08-28 rather than
      started, because starting it unverified would be worse than specifying it:
      - **There is no display-density source anywhere in the runtime.** `grep` for
        `AConfiguration_getDensity`, `SDL_GetWindowDisplayScale`, `SDL_GetDisplayContentScale`,
        `densityDpi` across `packages/runtime-native/src` and `include` returns nothing. The ratio
        has to be brought up on **three** platforms before a single line of `runtime.cpp:2980`
        changes — Android (`AConfiguration_getDensity` / the activity's `DisplayMetrics`), desktop
        and iOS (SDL's display-scale query). That is the actual work; the `1.0` literal is the last
        line of it.
      - **The drawing buffer must come out byte-identical.** `logical × dpr` *is* today's physical
        surface, so the arithmetic `logical × dpr × resolutionScale` reproduces exactly what ships
        now — but only if the `× dpr` lands in the same commit as the logical canvas. Split them
        and every tuned native game silently drops 2.6× in resolution on a Pixel 8.
      - **The defect is UI layout, not the 3D buffer.** §1.4's complaint is that CSS-facing
        dimensions are physical: a layout written against a "CSS pixel" canvas 2400 px wide renders
        tiny. So the fix that matters is `window.innerWidth/innerHeight` and
        `canvas.clientWidth/clientHeight` becoming logical, with `canvas.width/height` — the
        backing store — staying physical, exactly as the web platform defines those four.
      - **Whether *web* should also render at real device density is a separate decision and is
        not this item.** Web deliberately ships DPR 1 today (`renderer.ts`: "the default is
        intentional DPR 1"). Unifying it would render every retina browser game at 4× the fill and
        needs its own `pnpm visuals` gate and its own owner decision. It is only safe to consider
        now that `resolutionScale: "auto"` exists to absorb it.
- [x] `TN_FRAME_BUDGET` gains all five fields plus `atFloor`, nested under `surface` rather than
      spread across the window's top level — the window already groups `phases` and `shares`, and
      every named field is present. Emitted in every window in both modes. **Landed `ca121bf8`**,
      `atFloor` in `29ddecb6`, surfaced by `perf --text` in `dd27a4eb`. Verified on a physical
      Pixel 8 (§1.3.6): eighteen consecutive windows each naming their own scale and buffer.
- [x] Web path: the same field names come from the same `renderer.surface()` on every target, so
      web and native emit one marker shape rather than two. `pnpm visuals` **not run** — the web
      appearance at `resolutionScale: 1` is unchanged by construction (the scale multiplies the
      same `setSize` call it always did) but that is an argument, not a gate, and it is named here
      as unexecuted.
- [x] **`device-preflight.mjs` captures and reports display state on every run** — active mode Hz,
      supported rates, `peak_refresh_rate`, `min_refresh_rate`, `low_power` — and fails closed when
      a caller declares a rate the panel is not in (`requireRefreshHz`). Capture is unconditional,
      the gate is opt-in. **Landed `5b3ec150`.**
- [x] **Display coverage added to the existing `tests/device-preflight.test.mjs`** — 24/25, the one
      failure pre-existing and unrelated (below). Red-green mutation: delete the `refreshRate`
      failure branch, keeping capture → "refuses a panel that is not in the declared mode" fails;
      restored, green. The pre-existing full-shape contract test was extended, not worked around, so
      the unconditional capture is pinned by the assertion that already guarded this function.
      Verified on the physical Pixel 8: active 60 Hz, supported 120/60/40/30/24/20, declared-120
      rejected with `refreshRate: expected 120 Hz active, observed 60 Hz`, declared-60 passes.
- [x] **Red-green for the validation branch:** replace the `(0, 1]` guard's condition with `false`
      → "refuses a scale that cannot describe a drawing buffer" and "names the Android override in
      its error" both fail; restored, 8 passed. **The DPR half is open with its item above.**

### Phase 2 — the adaptive loop

**The controller's numbers, pre-registered here before the code exists.** They are arguable, and
Phase 0's slope may move them — but they move by an edit to this section, never by tuning in the
implementation until it looks right.

| Parameter | Value | Why |
| --- | --- | --- |
| Rungs | `1.00, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23` | ratio 0.85 linear ⇒ **0.72× pixels per step**. Coarse on purpose: every step reallocates render targets on WebGPU, so fine granularity buys smoothness with hitches. |
| Decision unit | one **300-frame** frame-budget window | the meter already emits exactly this; no new sampling path. |
| Down-step trigger | **`fps < 0.98 × display.maxFps`** for **1** window | react to a deficit immediately. |
| Up-step trigger | **`fps ≥ 0.98 × maxFps` and `presented p95 ≤ 1.15 × budget`** for **4 consecutive** windows | asymmetric by design: fall fast, climb slowly. The tail term is what stops it climbing into a frame that is hitting its average target while dropping frames. |
| Cooldown | discard the **1** window after any step | the resize frame is itself a hitch and must never feed the controller. |
| Ceiling / floor | `1.00` / `0.23` | at the floor still under target the scaler **stops and reports** `atFloor`; it must not pretend the budget was met. |
| Oscillation guard | two down→up→down cycles across the same rung boundary, each leg within `cooldown + upWindows + 1` windows ⇒ pin the lower rung for the session, report `scaleSource: "auto-pinned"` | thermal edges produce exactly this, and a visibly pumping resolution is worse than a marginally softer one. The PRD's original 3-window reach could never fire — by the rest of this table a down-then-up leg costs at least 5 windows. |

### Amended 2026-08-28, from the device, before the second implementation

**The original triggers were `presented p95 > 14.0 ms` down and `< 11.5 ms` up. They are wrong on
a vsync-capped panel, which is every shipped configuration.** Under FIFO the presented interval is
the *panel's* period, not the game's cost: a game locked perfectly at 60 fps on a 60 Hz panel
reports presented p50 16.67 ms and p95 ≈ 17.5 ms, so `p95 > 14` is true forever and the scaler
walks to the floor on a game that was already meeting its target.

That is measured, not argued. A scaffolded platformer template — never hand-tuned, `maxFps: 60`,
no resolution constant in its source — held **59.99–60.02 fps from the second window onward at
every rung**, with `frame p95 = 7.99 ms` of a 16.67 ms budget at full 2400×1080. It had enormous
headroom and the controller destroyed its image quality anyway, ending at 552×248 and reporting
`atFloor: true` — claiming the budget was *not* met while it was being met at 59.99 fps. Recorded
in §1.3.7.

**fps is the signal that is correct in both regimes.** It is derived from the mean presented
interval, so dropped frames pull it down on their own; a game that misses its target misses it
whether or not a panel is capping the top. `presented p95` survives only as an up-step tail guard,
where a capped panel's floor of ~1.05 × budget sits comfortably under the 1.15 × bar.

**Known and accepted:** `display.maxFps` above the panel's refresh rate is not satisfiable, so a
game asking for 120 on a 60 Hz panel walks to the floor and reports `atFloor`. That is the honest
answer — the target genuinely is not being met — and it is why `atFloor` is reported rather than
inferred.

The tail still matters — §1.3.3's own accepted run had a 74.72 ms worst frame behind a 16.66 ms
p50 — which is why it is the up-step's guard. What changed is that the tail may not be read off the
presented interval when a panel is setting that interval.

- [x] Controller implemented to the table above, values in one named constant block
      (`RESOLUTION_SCALER`). **Landed `ac75e3e8`.** **One correction to the pre-registered table,
      recorded rather than tuned in:** the oscillation guard's 3-window reach cannot fire — by the
      rest of the same table a down-then-up leg costs `cooldownWindows + upWindows` = 5 windows, so
      a 3-window reach only ever sees the up-then-down leg and the guard is dead code. The reach is
      derived from the table instead (tightest down-up leg, plus one).
- [x] A pinned `resolutionScale` constructs no scaler at all, asserted by an executable.
- [ ] **OPEN — the table it was to be read from is withdrawn.** See Phase 0's `(scale × samples)`
      item: the `antialias` arms may have measured an inert flag. The scaler moves resolution only,
      which is the safe behaviour while the sample cost is unknown.
- [x] The scaler never touches the overlay, never changes camera framing, and never alters aspect
      — every resize passes `updateStyle: false`, asserted.
- [x] **Red-green, mutation named:** `return this.#step(1)` → `return undefined` (downward step
      disabled) fails 6 tests across `resolution-scaler.spec.ts` and `game-auto-scale.spec.ts`;
      `renderer.surface().scaleSource === "auto"` → `true` (scaler runs when pinned) fails "does
      not move a pinned scale". Restored, 12 passed. **A device arm, not a playtest scenario:**
      §1.3.6 is the over-budget scene, and it is a stronger result than a synthetic one.
- [x] Floor-reached reporting asserted. **Landed `29ddecb6`**, mutation named, and observed on the
      device: Bayview reached `0.23` and stayed under 60 fps.
- [x] Allocation-free per frame: the controller runs once per 300-frame window, not per frame, and
      allocates nothing on that path. `frame-budget-steady-alloc.spec.ts` green.

### Phase 3 — the instrument (independent of 0–2; may run in parallel)

- [x] Implemented at both refusal sites. **Landed `96a8b3ec`.** `createQuerySet`, `timestampWrites`
      on render **and** compute pass descriptors, `resolveQuerySet`, buffer readback. The object
      path was the easy half — **the packed frame op stream is the path production frames take and
      it was silently dropping `timestampWrites`**; `beginComputePass` did not even accept a
      descriptor. New opcode 34 for `resolveQuerySet`.
- [x] Feature requested from every backend branch only when the adapter advertises it; an adapter
      without it degrades to today's behaviour. `createQuerySet` refuses a timestamp set **by name**
      when the device was never granted the feature, rather than letting a validation error surface
      later without naming the call.
- [x] Bindings test executable, **no display**, in the native-contract lane with a registered pass
      line. **It times a compute dispatch, not a clear**: a desktop fast-clear finishes inside one
      tick of the RTX 2080's 65536 ns timestamp clock and reported a real, useless zero on half of
      runs. Six consecutive runs identical afterwards.
- [x] Cross-engine coverage, named: **V8 and QuickJS both executed**, both reporting
      `{"supported":true,...}` with a positive delta. **JSC not executed** — it is the macOS/iOS
      engine and this lane is Linux. QuickJS needed a new `build/tn-linux-quickjs`, because the
      engine is a build-time choice with no runtime seam, and `-Wno-error=maybe-uninitialized`
      because vendored quickjs 0.11.0 does not compile clean on this GCC.
- [x] **Red-green, two mutations named:** restore the refusal → both engine arms fail with "the
      adapter advertises timestamp-query but the bindings refused it"; drop the op stream's
      `timestampWrites` block → "query slot 2 was never written". Restored, 2 passed.
- [ ] **OPEN — and the item as written is not achievable with the instrument it names.** A
      timestamp pair brackets a *pass*; it returns that pass's elapsed time and nothing about how
      that time split between binning and fragment. On a tile-based deferred GPU those stages are
      not separately observable through WebGPU at all — separating them needs vendor counters (Arm
      Streamline / `perfetto` GPU counters) or a differential experiment (same pass, same draws,
      fragment work removed). **What the instrument does deliver, and what should replace this
      item:** a per-pass cost breakdown of Bayview's frame on device, which §1.3.5's 13.79 ms
      intercept makes the more urgent question anyway. Re-file rather than tick.

### Phase 4 — device acceptance

- [ ] **OPEN — the headline criterion.** A game that has **never been hand-tuned** — a scaffolded
      template, not Bayview — reaches its configured `maxFps` on a physical Pixel 8 with
      `resolutionScale: "auto"` and no game-source resolution constant anywhere in its tree.
      Half-done: §1.3.6 proves the loop runs, steps, reports and reaches its floor on the device
      with `"auto"` and no constant in game source — but on **Bayview**, which the criterion
      excludes, and it reached the floor without reaching 60. A scaffolded template is a much
      lighter scene and is the arm that decides this.
- [ ] Bayview's pinned `0.36` still produces byte-identical presentation geometry to §1.3.3.
      Partly evidenced: the ladder's pinned arms produce exactly `round(2400 × scale) ×
      round(1080 × scale)` at every rung (§1.3.5's buffer column), which is the same arithmetic as
      before. Not asserted by an executable.
- [ ] `threenative-playtest perf --logcat <serial> --require-windows 4 --min-fps <target> --text`
      exits 0, SurfaceFlinger cross-checked, on a cool device per the preflight gate.
- [x] The templates' `AGENTS.md` documents it. **Landed `573d8f2e`** as its own shared fragment,
      `agent-docs/pixel-budget.md`, carried by all seven: the default, the pinning number, the
      named refusal, the `surface` payload, the three `scaleSource` values, the `antialias`
      override and the `display` wiring. Every instruction cap moved by the measured +177 with the
      reason recorded beside it.

## What is left

Named so the next session starts here rather than re-deriving the state.

1. **Phase 4's acceptance arm.** Scaffold a template into a sandbox, build for Android, and run it
   on the physical Pixel 8 **unplugged** at `maxFps: 60` on the 60 Hz panel. This is the headline
   criterion and nothing else substitutes for it. The harness exists:
   `<bayview>/tools/prd228-auto-arm.sh` builds, installs, preflights and measures one arm and the
   reader classifies its windows. Note the arm run in §1.3.6 was **on AC** and its preflight says
   so; the acceptance arm must be discharging.
2. **Phase 1's honest `devicePixelRatio`.** `runtime.cpp:2980` and `:2612`. The drawing buffer must
   come out byte-identical (`logical × dpr` is today's physical) or every tuned game moves.
3. **The descent is too slow, and the fix is arithmetic.** §1.3.6: ten rungs at one step per window
   plus a cooldown is about three minutes from the ceiling, visibly at 29 fps the whole way.
   §1.3.5's slope predicts the landing rung from one window's presented p50 in closed form, so a
   first-window multi-rung jump reaches it in one step. **This changes Phase 2's pre-registered
   table and therefore belongs in an edit to that section, not in the implementation.**
4. **Change C's sample half is stated but not implemented.** The scaler moves resolution only. The
   measured rule is in Phase 0 above.
5. **`renderer.antialias` does nothing on native, and it is shipped and documented.** Proven in
   §1.3.8: `antialias: true` in the config yields `sampleCount: 1` on device and a texture census
   with no multisampled attachment. The value reaches the bundle, `resolveRendererAntialias`
   returns it, `createRenderer` passes it to `WebGPURenderer`, and three's own constructor would
   set four samples — every link reads correct and the delivered frame is single-sampled, so the
   break is below the config seam and is not located. **This is the highest-priority open defect
   here**: it is named in every template's `AGENTS.md` as part of the pixel budget, so a game turns
   it on, sees no cost, and concludes sampling is free. It also means Change C has no measured
   default, because the `(scale × samples)` table compared an inert flag against itself.
6. **Phase 3's first use, re-scoped.** A pass-stage split is not obtainable from timestamp pairs;
   see that item. The instrument's first real use should be a per-pass breakdown of Bayview's
   frame, aimed at §1.3.5's 13.79 ms intercept rather than at its fill rate.

## Verification

Per the owner's exception, runtime/core performance findings update
`docs/verification/runtime-perf-state.md` **in place** — §1 for the ladder and acceptance, §1.3.2
for the pass split, §1.4 for the closed CSS-pixel defect, §1.5 for what the instrument removes from
"untried". No new `prd-228-*` performance file is opened. Non-performance run records (packaging,
bindings, conformance) stay one file per run.

Every arm records: serial, commit, binary sha256, battery level and charger state, battery and skin
temperature and thermal status at both ends, cold-launch confirmation, and the SurfaceFlinger
present-interval distribution beside our own fps. Arms run hot or under load are labelled or
discarded, never silently kept. Anything not run is named as not run.

## Acceptance Criteria

- [ ] **A scaffolded template with no hand-authored resolution constant sustains 60 fps at
      `frame p95 ≤ 14 ms` on a physical Pixel 8 pinned to its 60 Hz mode**, three captures,
      SurfaceFlinger-confirmed, at its shipped appearance. **Met once, on AC** (§1.3.7): 59.99–60.02
      fps across 59 consecutive windows at full 2400×1080, `frame p95` 6.51–8.70 ms, 19,372 of
      19,562 SurfaceFlinger frames at 16 ms with zero dropped and zero janky. **Outstanding: the
      run was charging, and the criterion asks for three captures.** Re-run unplugged, three times.
- [ ] The 120 Hz arm is run and reported **separately**, and no acceptance cites it.
- [ ] `renderer.resolutionScale` validates, plumbs to all four targets, and the active scale is reported
      in every frame-budget window **in both pinned and auto modes**. (Mutation: delete the
      validation branch → range test red; strip the Android manifest metadata → packaging test red.)
- [ ] `window.devicePixelRatio` is the real ratio on native. (Mutation: revert `runtime.cpp:2980`
      to `1.0` → DPR conformance case red.)
- [ ] The adaptive scaler is provably off when pinned and provably active when not, and cannot
      oscillate within its settle window. (Mutation: disable the downward step → over-budget
      playtest misses `minFps`.)
- [ ] `timestamp-query` is acquirable and resolves a monotonic nonzero delta on V8 and QuickJS, in a
      test that needs no display. (Mutation: restore the refusal → executable red.)
- [ ] Bayview's flat town pass is **attributed** to binning versus fragment with timestamps, and the
      verdict is written into §1.3.2. An unattributed pass leaves this criterion open.
- [ ] Change A and Change B are independently revertible, each with a negative control that fails on
      revert.
- [ ] No ablation or measurement flag ships: `scripts/__tests__/ablation-flags-never-ship.spec.ts`
      green.
- [ ] Web unchanged in appearance at `resolutionScale: 1`: `pnpm visuals` clean.
- [ ] The templates' `AGENTS.md` documents the convention, its override, and its reporting.

## What this PRD does not do

Named so they are not smuggled in, and so the next session does not re-derive them:

- **It does not reopen the backend question.** Closed by two independent routes (A1 swap, A2
  removal). Dawn on Android stays parked behind this work, not deleted.
- **It does not chase CPU.** The device frame is CPU-clean at 9.3 ms p50 of a 16.7 ms budget.
  PRD-227 owns that ledger and it is closed.
- **It does not pursue further draw collapse.** 780 → 232 already happened and the returns are
  diminishing. Whether draws still matter is precisely what Phase 3's pass split decides — that
  answer, not this PRD's assumption, licenses any further work there.
- **It does not touch the IBL.** The hemisphere replacement is falsified on appearance at two
  tuning attempts; the fixed-mip PMREM node already landed.
- **It does not address the tail.** 13 of 2,009 frames spiked, worst 74.72 ms, largest peak in
  `outside-game`. Real, visible at 60, and a separate hitch-attribution PRD — it is a smoothness
  defect, not a throughput one, and mixing them would let a throughput pass hide a hitch regression.
