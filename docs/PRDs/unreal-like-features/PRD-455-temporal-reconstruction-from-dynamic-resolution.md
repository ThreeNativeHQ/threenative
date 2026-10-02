---
prd_contract: v1
---

# PRD-455 — Fewer rendered pixels reconstruct into a stable full-resolution frame

**Status:** IN PROGRESS — full-resolution opt-in runtime milestone verified on browser software WebGPU; reconstruction remains open (2026-10-02).  
**Priority:** highest-value rendering project after the streaming quick wins.  
**Complexity:** 8 → HIGH. The renderer already has the difficult prerequisites; the remaining risk is history correctness and proving reconstruction wins more GPU time than it costs.  
**Depends on:** the landed motion-history implementation from PRD-269 (`packages/core/src/render/velocity.ts`, commit `3630847a`), the existing `RenderChain`, and [PRD-384 adaptive resolution](../PRD-384-adaptive-resolution-gpu-headroom.md).

## Problem

ThreeNative already has more temporal machinery than the old UE-gap notes describe:

- `RenderChain` knows `temporalReproject`, `taa` and `traa`, provisions velocity only when a
  temporal stage needs it, and measures rejected history.
- `VelocityTracker` retains rigid, skinned, instanced and batched previous-frame transforms.
- Native conformance scenes cover velocity, TAA, TRAA and temporal reprojection.
- `ResolutionScaler` can lower the internal raster size from measured GPU headroom.

What is still missing is the **TSR-like product outcome**: intentionally render the 3D scene below
display resolution, then reconstruct a stable display-resolution frame using temporal history rather
than simply presenting fewer pixels and sharpening them.

This PRD does not reimplement motion vectors, another resolution controller, or another render
chain.

## Outcome

When automatic resolution chooses a sub-1.0 render scale, one qualified reconstruction stage may
produce the display-resolution frame using current colour/depth, motion history and previous
reconstructed history. Camera cuts, resizes, invalid history and newly revealed surfaces reset or
reject history instead of smearing it.

At scale 1.0, or on a target where reconstruction costs more than it saves, the stage is absent and
the existing full-resolution path remains the baseline.

## Decisions

- **One reconstruction path first.** Do not ship several “quality modes” until one implementation
  survives the acceptance corpus.
- **The scaler owns resolution; reconstruction does not.** It consumes the actual internal/display
  sizes chosen by the existing renderer and never runs a competing controller.
- **History is disposable.** Resize, camera cut, projection discontinuity, device loss and explicit
  scene reset invalidate history immediately.
- **Velocity is necessary, not sufficient.** Disocclusion/newly revealed pixels must reject history;
  zero velocity does not prove a sample is safe.
- **No look preset in core.** Sharpening remains authored render-chain source. Reconstruction's
  public knobs, if any survive measurement, are correctness/performance limits rather than a visual
  style.

## Implementation order (owner direction, 2026-10-02)

First qualify plain full-resolution temporal AA using the installed Three.js 0.185.1 TRAANode,
RenderChain and VelocityTracker. The generated game owns the opt-in provider and history-reset
policy; no template default changes. Add a deterministic shared fixture, CPU regressions and a
maintained headed WebGPU screenshot lane before attempting lower-resolution reconstruction.
Then extend the existing renderer sizing seam to distinguish internal and display dimensions,
retain one scaler, and qualify the original reconstruction/visual/performance outcomes below.
Every PR revision retains actual runtime screenshots when the hosted capture lane can execute;
CPU-only checks never qualify image quality or native/hardware performance. Do not promote this
experimental path or mark the draft ready before the outstanding acceptance evidence exists.

## Integration ledger

| Existing surface | Change |
| --- | --- |
| `packages/core/src/render/chain.ts` | Add a reconstruction-capable stage contract that knows input raster size and output display size; reuse existing velocity provisioning/reporting. |
| `packages/core/src/render/velocity.ts` | Reuse current history; no second transform tracker. |
| `packages/core/src/resolution-scaler.ts` | No new policy. Expose/consume the resolved scale and reset history on size transitions. |
| `packages/runtime-native/conformance/scenes/shared/` | Add one reconstruction scene that runs the same source on browser/native targets. |

### Phase 1 — Define history correctness before chasing image quality

- [x] Full-resolution temporal AA is opt-in generated source, uses the existing velocity source and resets history on discontinuity. **proof:** hosted run `36990452407` at `9b6a3c6164602cfc710f04e0ea8f078832e3cd23` passes all five real runtime variants; 24 actual AA resolves, cut/projection/resize resets at frame 21, valid history by frame 24; exact source tests and actual screenshots below. Browser SwiftShader correctness only; native and visual-quality/performance superiority remain unqualified.

  Partial, 2026-10-02: the installed TRAANode setup/jitter regression reproduced
  `setProjectionMatrix is not a function` because RenderChain supplied a sampled texture where
  Three expects its velocity accessor. The caller now keeps accessor and texture separate;
  `vitest run packages/core/__tests__/{temporal-chain,render-chain,render-velocity}.spec.ts
  --maxWorkers=1` passes 56 tests after fresh-checkout red-to-green reproduction. No runtime,
  image-quality, native, or performance qualification is claimed by these CPU tests.

  Partial, 2026-10-02: starter-only generated `temporalAA.ts` now reuses TRAANode and owns
  explicit cut/reset, projection/size invalidation, raster-size guards and disposal. The shared
  fixture exercises moving rigid/skinned/instanced content; `integration-temporal.yml` captures
  reference, temporal, cut, projection and resize variants through the existing headed playtest
  runner. Fresh focused checks: 297/297 source/scaffold/workflow tests, 67/67 native-conformance
  contract tests, root TypeScript check, core build, fixture web build and shared native bundle
  all pass. These are source/contracts/builds, not native execution. Local runtime capture was
  attempted and refused because this environment has neither Xvfb nor a usable X display;
  the hosted lane must supply actual screenshots and adapter evidence before this box is checked.
  The complete repository test/budget/quality board and temporal visual-quality corpus are still
  unrun for this slice. The optional conformance row does not qualify any native target.

  Follow-up, 2026-10-02: hosted run `36986673556` passed 61 focused tests, then failed in
  the source-loaded runner's serialized callback (`__name` undefined), before temporal evidence.
  The verifier now imports the freshly built public runner rather than source-transpiled browser
  callbacks and preserves early failure diagnostics. A fresh red-to-green lifecycle regression
  also requires reset frames to overwrite **both** resolved output and next-frame history with
  current colour after upstream bookkeeping; a pre-resolve seed alone still reprojects at shifted
  UVs and is not complete rejection. Five lifecycle tests pass; screenshot proof remains pending.

- [ ] The reconstruction stage produces a display-sized output from a smaller colour/depth input and records input size, output size, history-valid state and rejection fraction. **proof:** focused render-chain test runs 0.67→1.0 sizing, then a mutation returning the low-resolution target directly fails the output-size assertion.
- [ ] Camera cuts, projection changes and resolution changes invalidate history for the affected frame; moving skinned and instanced fixtures use the existing velocity source rather than a camera-only approximation. **proof:** deterministic fixture covers cut/resize/skinned/instanced cases and a zero-velocity mutation fails the moving-object rejection/stability assertion.

### Phase 2 — Prove motion stability on content that exposes temporal defects

- [ ] A fixed camera route containing thin fences, foliage, sub-pixel edges, a moving character and an instanced moving object stays within pinned temporal-stability/ghosting thresholds against a full-resolution reference. **proof:** automated frame-sequence report records edge flicker, rejected-history ratio and image delta for full-res, low-res spatial upscale and temporal reconstruction; the temporal arm must beat the spatial arm on the named stability metric.
- [ ] Newly revealed surfaces do not inherit stale colour after occlusion/disocclusion events. **proof:** foreground-occluder fixture reveals a contrasting background and asserts stale-history pixels decay within the declared frame bound; disabling disocclusion rejection makes it fail.

### Phase 3 — Keep it only if it buys real frame time

- [ ] On a GPU-bound representative game, sub-1.0 rendering plus reconstruction lowers GPU/render p95 versus full-resolution rendering while meeting the Phase-2 visual thresholds. **proof:** paired fixed-route browser WebGPU and desktop-native table records internal pixels, reconstruction cost, total GPU/render p50/p95 and visual metrics; no “FPS only” verdict.
- [ ] Automatic resolution can move between at least three scales during one run without history corruption, allocation growth or a reconstruction cost spike larger than the saved raster cost. **proof:** scripted scaler route records scale transitions, history resets, render-target allocation count and per-stage cost; repeated up/down cycles end at the initial allocation baseline.

### Current execution notes

Fresh full core CPU directory: 175 test files passed, 2,209 tests passed, two skipped, using pinned
pnpm and `--maxWorkers=1`. The initial full-directory attempt exposed a child-command environment
failure in the hot-subpath declaration test; the correct environment passed that test, then the
entire directory was rerun green. This is still not the complete repository board.
Hosted run `36987345933` advances past the bundled-runner repair but fails the strict console-error
guard on one 404 in the reference fixture. The next fixture serves its compiled build and declares
an explicit data favicon. Every fixed step now waits for Three's existing RAF frame boundary, and
the verifier requires the AA resolve count to equal the fixture count. The verifier also rejects
`TN_PLAYTEST_SOFTWARE_DEVICE_LOST` even when the generic runner downgrades it to a warning; unit
regressions retain that fail-closed requirement. No visual acceptance box is inferred from a green
CPU gate or the diagnostic reference frame.

Hosted run `36988336664` proves the reference arm completes 24 RAF-separated frames with no
console or device-loss diagnostics, then the temporal arm fails before bridge installation. The
fixture now preserves startup exceptions through its diagnostic bridge instead of losing the cause
as a generic missing-bridge error. Error diagnostics take precedence over absent capture provenance
without weakening either requirement. Full root lint was run: five new fixture format/declaration
errors were corrected; a fresh whole-root error-level check then passed (existing warnings remain).

Hosted run `36989246532` exposes the actual temporal startup failure: the colour/depth/velocity
size guard runs before the lazy scene-pass dependency. The wrapper now registers the three input
nodes in NodeBuilder properties, following upstream GaussianBlur/FSR1's dependency mechanism, so
Three updates the existing input pass before temporal sizing/resolve; no second draw loop is added.
The dependency regression fails before this change and passes afterward. The verifier additionally
runs the existing `assertCaptureNotBlank` guard on every PNG: the failed temporal artifact has one
colour and is correctly rejected, while the clean reference has 1,641 colours and passes unchanged
thresholds. Pending hosted execution must establish the repaired temporal arm before acceptance.

## Runtime screenshot progress

[Verified full-resolution runtime provenance](../../verification/prd455/fullres-runtime.json):
source `9b6a3c6164602cfc710f04e0ea8f078832e3cd23`, run `36990452407`, SwiftShader/google.
All five final PNGs were inspected; all report diagnostics are empty. The reference and temporal
arms share frame 24 and matching poses; temporal resolves also count exactly 24.

- [No-AA reference](../../verification/prd455/fullres-reference.png)
- [Opt-in temporal AA](../../verification/prd455/fullres-temporal.png)
- [Camera-cut recovery](../../verification/prd455/fullres-cut.png)
- [Projection-change recovery](../../verification/prd455/fullres-projection.png)
- [Raster-resize recovery](../../verification/prd455/fullres-resize.png): 960×540 input **and output**,
  presented on the 1280×720 canvas; this is the baseline resize path, not reconstruction.

This verifies runtime operation/reset recovery in the narrow fixture. Edge-flicker/ghosting
thresholds, same-frame reset image comparisons, native execution and hardware frame-time wins
remain open. The PR stays draft and no shipped quality tier enables this helper.


- [Diagnostic no-AA reference](../../verification/prd455/diagnostic-reference.png), hosted run
  `36986673556`, source `bbbf93ca8c10a30b168fdb984d31a7567ebeccaf`. Actual canvas PNG inspected;
  [provenance](../../verification/prd455/diagnostic-reference.json) records SwiftShader/software
  WebGPU. This is a baseline progress frame, not temporal/motion/native/performance proof.
  The run stopped at the source-runner callback error; fixed-step rendering also needs a distinct
  Three.js frame boundary before temporal frame counts can qualify a motion sequence.

## Acceptance criteria

The win is **not** “TRAA is enabled.” The win is that a lower internal raster produces a stable
display-resolution image during motion, saves measured frame time, and degrades safely when history
cannot be trusted.

If the qualified reconstruction path does not beat the existing full-resolution path on a
GPU-bound workload after accounting for its own cost, it stays optional/experimental rather than
becoming a default.
