---
prd_contract: v1
---

# PRD-228 — the pixel budget is the engine's, not the game's

**Status:** PROPOSED. Filed 2026-08-28 from
[runtime-perf-state §1.3.3, §1.4, §1.5](../verification/runtime-perf-state.md). PRD-227 owned the
CPU seam and closed it: the device frame is now CPU-clean (frame p50 9.3 ms of a 16.7 ms budget).
This PRD owns what is left, which is pixels and the missing instrument to price them.

**Goal: any game reaches its `display.maxFps` target on a physical Pixel 8 without hand-authoring a
resolution constant, and the GPU frame is measured rather than inferred.** Bayview already hits 60+;
it hits it because a human picked `0.36` and typed it into game source. The next game starts at
20 fps again.

**Complexity:** +1 for a public config value crossing web and three native packagers, +1 for a new
WebGPU binding surface, +1 for the device acceptance lane = **HIGH mode**.

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

### Defect 1 — native hands every game the full physical pixel count and calls it DPR 1

`packages/runtime-native/src/runtime.cpp:2980` sets `window.devicePixelRatio` to the literal `1.0`.
`runtime.cpp:2612` then reports `canvas.width`/`canvas.height` as the physical surface. On a Pixel 8
that is 2400×1080 = **2,592,000 pixels** handed to three.js as though they were CSS pixels. The same
game in Chrome on the same phone gets a CSS viewport roughly one ninth that size and a
`setPixelRatio` the game (or three) clamps.

`TN_RENDER_SCALE` appears **nowhere in `packages/`** — the string exists in this repository only
inside the perf record. Bayview's 0.36 is a game-source constant that every subsequent native game
must rediscover by hand, on a device, through a build-measure-rebuild loop that costs an afternoon.

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

## Solution (decision recorded here)

Two changes. Change A is the fix and ships value alone. Change B is the instrument and unblocks
everything after this PRD. They are independent; B does not gate A.

### Change A — `display.renderScale`, defaulting to an adaptive scaler

A public config value on the object that already carries `maxFps`, following its exact plumbing:

```ts
export default {
  display: { maxFps: 120, renderScale: "auto" },
} satisfies IThreeNativeConfig;
```

- **`"auto"` is the default**, per the conventions rule: the framework measures the presented frame
  time it already emits in `TN_FRAME_BUDGET`, and moves the 3D drawing buffer scale toward the
  largest value that holds the `maxFps` budget. Hysteresis and a settle window are specified in
  Phase 2 so the scale does not oscillate on a thermal edge.
- **A number in `(0, 1]` pins it** and turns the loop off. That is the named override on the same
  object, and it is what Bayview's `0.36` becomes.
- **Turning the convention off does not turn its measurement off.** `TN_FRAME_BUDGET` reports the
  active scale, the drawing-buffer dimensions and whether the value was pinned or chosen, in every
  window, in both modes.
- **The overlay/UI surface is never scaled.** Only the 3D drawing buffer moves. This is the
  arrangement §1.3.3 accepted and proved: UI 2400×1080, 3D 864×389, composited.
- **Web carries the same contract** through `renderer.setPixelRatio`, or the feature is unfinished
  by the framework's own rule. Desktop and iOS carry it through their packaged config exactly as
  `maxFps` does.

Underneath it, `devicePixelRatio` stops being a lie: native reports the real ratio and exposes the
canvas in logical pixels, which is the behaviour web already has and the §1.4 defect this closes.

### Change B — `timestamp-query` in the WebGPU bindings

Implement `QuerySet`, `timestampWrites` on render/compute pass descriptors, `resolveQuerySet`, and
the feature advertisement the two refusal sites currently reject. wgpu-native exposes it; three.js
consumes it; Chrome has it behind the same feature name, so the same scene can be measured on both
sides with one code path. It ships as a normal optional feature, requested only when the adapter
advertises it — not as an ablation flag, so `ablation-flags-never-ship.spec.ts` stays green.

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
| 1 | `display.renderScale` in `IThreeNativeConfig` | `packages/core/src/config.ts`, every generated template | a per-game constant in game source, existing in exactly one game | delete the validation branch → the range/`"auto"` unit test fails |
| 2 | `TN_RENDER_SCALE` through the three packagers | `package-android.mjs:342`, `package-ios.mjs:131`, `package-desktop.mjs:179`, `android_main.cpp:208` | nothing; the value has no transport today | strip the manifest metadata → host reports scale 1.0 and the packaging test fails |
| 3 | Honest `devicePixelRatio` + logical-pixel canvas | `runtime.cpp:2980`, `runtime.cpp:2612` | hardcoded `1.0` and physical `canvas.width` | revert line 2980 to `1.0` → the DPR conformance case reads 1.0 against a known physical/logical pair and fails |
| 4 | Adaptive scaler driven by presented frame time | `packages/core/src/frame-budget.ts` consumer in `game.ts` | nothing | pin `renderScale` to a number → the scaler must not move, asserted; disable the downward step → the over-budget playtest misses `minFps` |
| 5 | Active scale reported every window even when pinned | `TN_FRAME_BUDGET` payload | a payload that cannot tell you what resolution produced it | pin the scale and assert the field is still present and correct |
| 6 | `timestamp-query` feature + `QuerySet` bindings | `bindings.cpp:2118`, `:5041`, three.js `TimestampQuery` path | two `if (featureName == "timestamp-query")` refusals | re-add the refusal → the bindings test that resolves a two-write query set fails |

## Execution Phases

### Phase 0 — earn the slope, before writing the contract

**Falsification gate. Run this first. It is a measurement phase and lands no product code.**

- [ ] Five-point scale ladder on the physical Pixel 8 — 1.0, 0.72, 0.55, 0.44, 0.36 — at
      **120 Hz mailbox, uncapped**, so no point is clipped by a 60 Hz cap the way 0.36 was.
- [ ] Same build, same session, same commit, cold launch per method rule 4, first **two** runs
      discarded per rule 1, live windows only per rule 9, thermal status and battery at both ends.
- [ ] SurfaceFlinger `--timestats` cross-check on at least the endpoints, per rule 3.
- [ ] **Publish presented p50 against pixel count and fit the slope.** Under 2 ms/Mpx, or
      non-monotonic → Change A is falsified as a performance contract. Stop and re-file.
- [ ] Record in `runtime-perf-state.md` §1 in place, per the owner's consolidation exception.

### Phase 1 — the contract, without the loop

- [ ] `display.renderScale?: number | "auto"` in `config.ts`, validated: `"auto"`, or a number in
      `(0, 1]`. Reject `0`, negatives, `> 1`, `NaN`, non-finite.
- [ ] Plumbed through all three packagers and `android_main.cpp` on the `maxFps` path, including the
      generated-template defaults each packager already carries.
- [ ] `devicePixelRatio` reports the real ratio; the canvas reports logical pixels; the 3D drawing
      buffer is `logical × dpr × renderScale`; the overlay surface is untouched.
- [ ] `TN_FRAME_BUDGET` gains `renderScale`, `drawingBufferWidth`, `drawingBufferHeight` and
      `scaleSource: "pinned" | "auto"`, emitted in every window in both modes.
- [ ] Web path via `setPixelRatio`, same field names in the same marker.
- [ ] **Red-green, mutation named:** revert `runtime.cpp:2980` to `1.0` → DPR conformance case red;
      delete the config validation branch → range test red. Paste both.

### Phase 2 — the adaptive loop

- [ ] Scaler consumes presented p50 from the frame budget, targets `maxFps`, steps within a stated
      bounded set of scales, with an up-step hysteresis margin and a settle window long enough that
      a single hitch cannot move it. Bounds, margin and window are numbers written into this PRD
      before the code, not tuned into it afterwards.
- [ ] A pinned `renderScale` disables every step, asserted by an executable.
- [ ] The scaler never touches the overlay, never changes camera framing, and never alters aspect.
- [ ] **Red-green, mutation named:** a playtest scenario on a deliberately over-budget scene with
      `assert.performance.minFps`; disabling the downward step makes it fail. Paste the red.
- [ ] Allocation-free per frame in the steady state, per the standing PRD-189 contract.

### Phase 3 — the instrument (independent of 0–2; may run in parallel)

- [ ] `timestamp-query` implemented at both refusal sites; `QuerySet` create/destroy,
      `timestampWrites` on render and compute passes, `resolveQuerySet`, buffer readback.
- [ ] Feature requested only when advertised; absent adapter degrades to today's behaviour with a
      reported reason, never a throw at frame time.
- [ ] Bindings test executable resolving a two-write query set with a monotonic, nonzero delta —
      **runs without a display**, per the native-contract lane.
- [ ] Cross-engine coverage named, not implied: V8 and QuickJS executed; JSC executed or explicitly
      recorded as unexecuted.
- [ ] **Red-green, mutation named:** restore the `if (featureName == "timestamp-query")` refusal →
      the executable fails to acquire the feature. Paste it.
- [ ] **First use, same phase:** split Bayview's flat town pass into vertex/binning versus fragment
      on the physical Pixel 8, and write the verdict into §1.3.2 in place. This is the deliverable
      that makes the instrument worth building; the bindings alone do not close this phase.

### Phase 4 — device acceptance

- [ ] A game that has **never been hand-tuned** — a scaffolded template, not Bayview — reaches its
      configured `maxFps` on a physical Pixel 8 with `renderScale: "auto"` and no game-source
      resolution constant anywhere in its tree.
- [ ] Bayview's pinned `0.36` still produces byte-identical presentation geometry to §1.3.3, proving
      the contract subsumes the hand-authored constant rather than perturbing it.
- [ ] `threenative-playtest perf --logcat <serial> --require-windows 4 --min-fps <target> --text`
      exits 0, SurfaceFlinger cross-checked, on a cool device per the preflight gate.
- [ ] The templates' `AGENTS.md` documents `renderScale`, its default, its override and its
      reporting. A convention missing from that file does not exist.

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

- [ ] **A scaffolded template with no hand-authored resolution constant reaches its configured
      `maxFps` on a physical Pixel 8**, three captures, SurfaceFlinger-confirmed, at its shipped
      appearance. 30 fps is a milestone to report, never a pass.
- [ ] `display.renderScale` validates, plumbs to all four targets, and the active scale is reported
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
- [ ] Web unchanged in appearance at `renderScale: 1`: `pnpm visuals` clean.
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
