---
prd_contract: v1
---

# PRD-228 — the pixel budget is the engine's, not the game's

**Status:** PROPOSED — **ready to execute; start at "The open decision" below, then Phase 0.**
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

**Session handoff (2026-08-28).** Landed here already: `de750dee` brackets the projection reconcile
inside the render phase, and `696e86e3` lands `renderer.resolutionScale` plus its Android override
(2/2 and 57/57 green). Root `pnpm typecheck` exits nonzero on 3 **pre-existing** `tracers.spec.ts`
nullability errors, unrelated to any of this and already named in §1.3.4. Uncommitted and
deliberately untouched: `sandbox/fps-framework` holds another lane's live arm — `maxFps: 60`,
`renderer.android.resolutionScale: 0.32`, plus `package.json`/`pnpm-lock.yaml` mid-reinstall. That
lane owns those files; do not sweep them.

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

## The open decision, before any measurement — 60 Hz or 120 Hz is the baseline?

**This is unresolved and every number in §1 depends on it. Settle it first; do not measure around
it.** It caused a real confusion on 2026-08-28 and one wrong action (this author restored the
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

**Recommendation, for the owner to accept or reject:** make **60 Hz the acceptance baseline** and
120 Hz a second, separately reported arm.

- The game ships a 60 fps target, and Smooth Display off is an ordinary user setting — many target
  phones have no high-refresh mode at all. A green obtained only at 120 Hz is a green on an easier
  machine than the shipping default.
- A 60 Hz panel makes the 16.67 ms cliff unforgiving, which is the honest bar: it demands real
  headroom rather than a frame that merely lands near budget.
- Under this baseline the 49.93 fps reading is a **genuine failure to fix**, not an artifact — and
  the resolution ladder that was being walked (0.36 → 0.32 → 0.28) is a defensible response to it,
  not a mistake. What was missing was only the statement of which panel each rung ran on.

If instead the owner accepts 120 Hz as the baseline, then §1.3.3 and §1.3.4 stand as written and
Bayview's shipped `maxFps` must move to 120 to match — but say so explicitly, because today the
record and the shipped config disagree.

### The gap that let this happen

`packages/runtime-native/scripts/device-preflight.mjs` gates battery percent, charging state,
thermal status and screen-on. It does **not** read the display mode, `peak_refresh_rate`,
`min_refresh_rate` or `low_power`, and it has **no tests at all**. So an arm can run on a
silently-downclocked panel and report a number that looks like a fill regression. Phase 1 closes
this; it is the cheapest item in the PRD and it removes the whole class.

## Execution Phases

### Phase 0 — earn the slope, before writing the contract

**Falsification gate. Run this first. It is a measurement phase and lands no product code.**

- [ ] **Settle the baseline-Hz question above and write the answer into this PRD** before a single
      arm is run. Every fps number below is meaningless until it names its panel.

- [ ] Five-point scale ladder on the physical Pixel 8 — 1.0, 0.72, 0.55, 0.44, 0.36 — at
      **120 Hz mailbox, uncapped**, so no point is clipped by a 60 Hz cap the way 0.36 was.
- [ ] Same build, same session, same commit, cold launch per method rule 4, first **two** runs
      discarded per rule 1, live windows only per rule 9, thermal status and battery at both ends.
- [ ] SurfaceFlinger `--timestats` cross-check on at least the endpoints, per rule 3.
- [ ] **Publish presented p50 against pixel count and fit the slope.** Under 2 ms/Mpx, or
      non-monotonic → Change A is falsified as a performance contract. Stop and re-file.
- [ ] **Second ladder, `(scale × samples)`:** at minimum 0.32/1×, 0.32/4×, 0.44/1×, 0.44/4×,
      0.55/4×. Mali-G715 resolves MSAA in tile memory, so the cost is not the naive 4× and the
      pairing must be measured, never assumed. This table chooses Change C's defaults.
- [ ] **Reconcile the record with the tree first.** The working tree holds uncommitted
      `resolutionScale: 0.32` and `maxFps: 60` against a record that says 0.36 and 120. Commit or
      revert before measuring; an arm whose config is not in git is not an arm.
- [ ] Record in `runtime-perf-state.md` §1 in place, per the owner's consolidation exception.

### Phase 1 — the contract, without the loop

- [ ] `resolutionScale?: number | "auto"` at both levels in `config.ts`, validated: `"auto"`, or a
      number in `(0, 1]`. Reject `0`, negatives, `> 1`, `NaN`, non-finite. `renderer-config.ts`
      resolves the platform override exactly as it does today.
- [ ] `antialias` added to the Android override block and resolved on the same seam.
- [ ] `devicePixelRatio` reports the real ratio; the canvas reports logical pixels; the 3D drawing
      buffer is `logical × dpr × resolutionScale`; the overlay surface is untouched.
- [ ] `TN_FRAME_BUDGET` gains `resolutionScale`, `sampleCount`, `drawingBufferWidth`,
      `drawingBufferHeight` and `scaleSource: "pinned" | "auto"`, emitted in every window in both
      modes. **This item is what makes every later fps number self-describing** — without it the
      record can drift from the tree again, exactly as it just did.
- [ ] Web path via `setPixelRatio`, same field names in the same marker.
- [ ] **`device-preflight.mjs` captures and reports display state on every run** — active mode Hz,
      `peak_refresh_rate`, `min_refresh_rate`, `low_power` — and fails closed when a caller declares
      an expected refresh rate that the panel is not in. Capture is unconditional; the gate is
      opt-in, so a cold-start arm is unaffected and an fps arm cannot run on the wrong panel.
- [ ] **First tests for `device-preflight.mjs`**, which currently has none. (Mutation: feed the
      parser a `peak_refresh_rate 60.0` / mode-0 dump against a declared 120 → the gate must fail.)
- [ ] **Red-green, mutation named:** revert `runtime.cpp:2980` to `1.0` → DPR conformance case red;
      delete the config validation branch → range test red. Paste both.

### Phase 2 — the adaptive loop

- [ ] Scaler consumes presented p50 from the frame budget, targets `maxFps`, steps within a stated
      bounded set of scales, with an up-step hysteresis margin and a settle window long enough that
      a single hitch cannot move it. Bounds, margin and window are numbers written into this PRD
      before the code, not tuned into it afterwards.
- [ ] A pinned `resolutionScale` disables every step, asserted by an executable.
- [ ] The scaler's order of spend between scale and samples is stated here, from Phase 0's
      `(scale × samples)` table, before the code is written.
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
      configured `maxFps` on a physical Pixel 8 with `resolutionScale: "auto"` and no game-source
      resolution constant anywhere in its tree.
- [ ] Bayview's pinned `0.36` still produces byte-identical presentation geometry to §1.3.3, proving
      the contract subsumes the hand-authored constant rather than perturbing it.
- [ ] `threenative-playtest perf --logcat <serial> --require-windows 4 --min-fps <target> --text`
      exits 0, SurfaceFlinger cross-checked, on a cool device per the preflight gate.
- [ ] The templates' `AGENTS.md` documents `resolutionScale`, its default, its override and its
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
