---
prd_contract: v1
---

# PRD-455 — Fewer rendered pixels reconstruct into a stable full-resolution frame

**Status:** IN PROGRESS — full-resolution opt-in runtime milestone verified on browser software WebGPU; reconstruction remains open (2026-10-02).  
**Priority:** highest-value rendering project after the streaming quick wins.  
**Complexity:** 8 → HIGH. The renderer already has the difficult prerequisites; the remaining risk is history correctness and proving reconstruction wins more GPU time than it costs.  
**Depends on:** the landed motion-history implementation from PRD-269 (`packages/core/src/render/velocity.ts`, commit `3630847a`), its pending canonical [PR393 repair](https://github.com/ThreeNativeHQ/threenative/pull/393) at `47e188e41601a64decb4fe0f580037546d63b543`, the existing `RenderChain`, and [PRD-384 adaptive resolution](../performance/PRD-384-adaptive-resolution-gpu-headroom.md).

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
  fixture exercises moving rigid/skinned/instanced content; the `temporal` lane of
  `integration.yml` captures
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

- [x] The reconstruction stage produces a display-sized output from a smaller colour/depth input and records input size, output size, history-valid state and rejection fraction. **proof:** focused render-chain test runs 0.67→1.0 sizing, then a mutation returning the low-resolution target directly fails the output-size assertion. **result, 2026-10-06:** `packages/create-threenative/__tests__/temporal-aa.spec.ts` -t "presents a display-sized raster" drives the real `RenderChain` over the generated `temporalAAStages` `traa` factory and the same stubbed renderer the other sizing tests use. One arm reports the scene pass target at 1280×720 while the node the chain presents holds 1920×1080, with `report()` carrying `inputWidth 1280`, `inputHeight 720`, `outputWidth 1920`, `outputHeight 1080`, `historyValid false` on the opening reset and the measured `rejection { fraction 4/2073600, visited 2073600, staleFrames 0 }`. The mutated layer is `stages[0].build` in the test fixture: the generated stage still builds the provider and still owns its per-frame work, and the chain is handed the scene pass colour node instead of `provider.node`. The same `expectDisplayRaster` assertion then fails with the exact message `The presented raster is 1280x720, not the display raster 1920x1080.`, and the presented node's own render target measures 1280×720 — the low-resolution target — so the failure is classified at the output-raster contract, not at a missing measurement, a startup refusal or a canvas label. 26/26 in the file; root `pnpm typecheck` and `biome check` exit 0. No core change, no new dependency, no threshold touched. Runtime evidence for the same arm is the qualified browser/native result already recorded above.
- [ ] Camera cuts, projection changes and resolution changes invalidate history for the affected frame; moving skinned and instanced fixtures use the existing velocity source rather than a camera-only approximation. **proof:** deterministic fixture covers cut/resize/skinned/instanced cases and a zero-velocity mutation fails the moving-object rejection/stability assertion.

### Phase 2 — Prove motion stability on content that exposes temporal defects

The next maintained full-resolution measurement captures frames 21–36 from the actual generated
helper/RenderChain, matched against a 4× raster reference numerically integrated in linear RGB.
It measures edge error, changes in reference-relative error (excluding true scene motion), and
stale-colour residue inside a two-pixel inset after a contrasting occluder disappears at frame 29.
The fixture also renders zero-velocity and unchecked 95% history controls. The latter bypasses
both depth rejection and neighbourhood clipping; it does not isolate either mechanism or report
the shader's per-pixel rejection fraction. Before the first runtime measurement, the experimental
bar is pinned at 5% edge/instability improvement versus no-AA, at most 1% stale interior pixels
after one frame, and detectable negative controls. Five numerical tests and the fixture bundle
pass; hosted sequence results remain pending. These checks do not qualify reconstruction or the
broader foliage/content corpus below.

First actual sequence, source `1124d7036787488b9fa9adf4aecbd535a099654c`, hosted run
`36994374046`: **quality gate failed**. All five arms rendered, all diagnostics were empty,
and 80 PNG hashes were verified. Temporal error instability improves 10.1%, but edge error worsens
13.5% versus no-AA. Stale-colour residue remains on 19.2% of 3,721 newly revealed interior pixels
one frame later and drops below 1% only after seven frames. The zero-velocity arm has lower moving
edge error than the temporal arm; this requires projection/velocity-grid/history-timing diagnosis
before any blend tuning. Unchecked history is detected on 100% of revealed pixels. The original
thresholds remain unchanged. [Complete measurements/provenance](../../verification/prd455/motion-runtime.json),
[before reveal](../../verification/prd455/motion-before.png),
[matched no-AA reference](../../verification/prd455/motion-reference.png),
[failed temporal reveal](../../verification/prd455/motion-reveal.png), and
[later recovery](../../verification/prd455/motion-recovery.png) retain genuine unchanged frame bytes.
All 80 frames remain in the workflow artifact; these four selected frames were inspected.

The next diagnostic retains the same scene, resolve and thresholds and reads actual velocity MRT
pixels at interior rigid, instanced and skinned surface points. A CPU oracle projects the same
surface points from consecutive rendered poses using unjittered camera matrices; observations
also retain the projection used during the draw and the tracker-scheduled instance/bone history.
This tests NDC sign, grid scale and previous/current timing before changing blend or shader policy.
The fixture-only readback is explicitly excluded from performance claims. Its TypeScript uses
the existing `@types/three` 0.185.3 development cohort; the Three runtime pin remains 0.185.1.

Probe run `36997077219`, source `dd541a46d871e5bf871d179d694d5ef7b54858db`, confirms two separate
input defects. The rigid velocity error matches the exact current Halton jitter within 0.000290
pixel across all 16 frames; the first input-pass material compiled while VelocityNode's explicit
projection was still null. The helper now primes TRAA's own unjittered matrix during setup, before
the dependency can compile that material, without applying camera jitter early. A real
VelocityNode.setup regression fails before the fix and passes afterward; the maintained GPU
oracle now requires rigid velocity error below 0.01 pixel. Hosted run `36998277547` at
`0564aaaf0a45e7f51e901c63bccd3753debc0322` passes that MRT check across all 16 matched frames;
the image-quality gate remains red (edge error 0.06070, instability 0.03196, reveal residue 22.6%
after one frame).
The repaired rigid velocity's maximum oracle error is 0.000308 pixel;
[exact runtime record](../../verification/prd455/projection-fixed.json) and
[actual frame 30](../../verification/prd455/projection-fixed.png) preserve this partial result.
That run's no-AA frame 30 is byte-identical to the linked earlier reference. All 96 screenshot
hashes were verified and every arm's diagnostics are empty; the repaired frame was inspected.
Separately, instanced velocity has 9.34-pixel mean error, and a dynamic-buffer control reduces this
to 1.00 pixel but leaves timing error. The shipped previous-instance attribute upload/ordering
defect belongs to PRD-269/PR393 and is not patched here. All original quality thresholds remain.

A re-setup regression also reproduced copying an active camera jitter into the saved projection.
The helper now tracks its own active view offset, preserves the unjittered matrix during setup,
and avoids applying the same frame jitter twice. The maintained recompile arm changes the public
renderer context-node version and must observe both a repeated setup during jitter and correct
MRT velocity. Hosted run `36999580189` at `2b9bdf16aba68c86ba5f8ce0af784727a215c8ed`
observes setup count 1→2 while jitter is active at frame 23, with maximum rigid error 0.000308
pixel. Ordinary temporal PNGs remain byte-identical to the prior run. A separate fixture-only
strict-rejection arm sets
TRAA edgeDepthDiff to 1 to test its documented depth-edge exception without changing blend weights,
any quality threshold, or generated appearance policy.
[Actual control frame](../../verification/prd455/edge-exception-control.png) and
[all original scores/lifecycle evidence](../../verification/prd455/edge-exception-control.json)
record the measured comparison. Strict rejection yields zero projected stale pixels one frame
after reveal, but 59 late pixels still trip that score; inspecting them shows dark-blue fence
undercoverage, which can point toward the old red vector without added red. The score remains
unchanged and conservative. A separate matched open-history control and red-excess diagnostic
are being added to isolate causal tint; regressions reject neutral brightening/darkening and
recover a known 25% injected red history. The independent edge-quality bar remains red.

Hosted causal run `37001381134`, source `5c071b4b757537b0fa48f780839b6a96933eafe5`, captures
176 matched sequence frames across 11 arms with empty diagnostics. Against each policy's own
never-occluded temporal control, standard temporal AA has red tint on 11.61% of revealed pixels
one frame later; strict rejection has 0% in all eight reveal frames; unchecked history has 100%
throughout. [Exact causal results and unchanged original scores](../../verification/prd455/causal-history.json)
and the [actual matched open-history frame](../../verification/prd455/causal-open-control.png)
retain this diagnostic. Frame bytes/hashes were checked and the selected control was inspected.
The new causal diagnostic does not replace or weaken the original gate. Appearance experiments
pause here until PR393's verified instance-history fix is consumed and the fixed benchmark reruns.

Dependency integration, 2026-10-02: PR398 explicitly merges the exact reviewed PR393 commit
`47e188e41601a64decb4fe0f580037546d63b543`, preserving the canonical patch and its ancestry.
Its separate signed WebGPU oracle run `37003076606` passed; combined temporal quality remains
pending until this branch reruns all 176 frames with the original thresholds and controls.
The merge also includes landed tone gate `924b92f825d602485ef4e682f434b4757a825cd7`.
PR393 must land before PR398 can become ready or merge, and PR398 must then refresh onto the
resulting develop so its final diff excludes the prerequisite repair. No acceptance box changes.
Frozen offline installation accepts the new Three patch and retains runtime pin 0.185.1; all 87
focused helper, scaffold, numerical quality, evidence and velocity-probe tests pass. Actual
generation changes only the starter hash relative to the PR393 hashes, as expected from this
branch's generated temporal helper. Fresh combined core validation passes 176 files and 2,222 tests, with two skipped. Root types,
error-level lint, documentation links and the unchanged evidence budget pass. Core rebuild and
public playtest build/publint pass; the latter uses the identical assertion-generator check via
`node --import tsx` because the package-script tsx CLI hits the local IPC restriction. Hosted
measurement is recorded below; the complete repository board remains unqualified.
Evidence validation: 29 documentation/citation/budget tests pass; two CLI-launch tests hit the
known environment prohibition on tsx IPC pipes. Their unchanged 1,200-line and 701-file CLI
fixtures both pass through `node --import tsx`. The real tracked evidence budget also passes.

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


### Combined canonical motion-history result

Source `e48c31b8ec63a0e74f971c4d7c9938da1eff1589`, exact PR393 input
`47e188e41601a64decb4fe0f580037546d63b543`, hosted run `37004283653`: all 176 named
PNG hashes verify and all eleven diagnostics are empty. Actual instance velocity now has maximum
error 0.000986 pixel; default and dynamic instance arms produce identical PNG sequences. The
zero-velocity negative control now correctly worsens moving-edge error: 0.04169 versus 0.03024.
Rigid error remains at most 0.000308 pixel; skinned point error is at most 0.01558 pixel.

The original quality gate still fails: edge error 0.06001 versus no-AA 0.05061, despite residual
instability improving to 0.03119 from 0.04915. The original reveal score remains 22.6% one frame
after reveal; causal red tint remains 11.61%, while the strict fixture control measures zero
causal red tint throughout. No threshold or appearance policy changed. Recompilation also exposes
a separate one-frame instance corner: frame 23 reports zero object-Y motion instead of the expected
-0.00289756 NDC, a 0.52156-pixel error; later frames recover. That lifecycle corner remains open.

[Exact combined measurements, dependency ancestry and screenshot provenance](../../verification/prd455/combined-history.json)
and [actual combined temporal frame 30](../../verification/prd455/combined-temporal.png) retain
unchanged renderer bytes. The frame was inspected; the matched no-AA reference bytes are unchanged
from the earlier linked reference. The separate velocity and tone workflows also pass on this exact
combined source, while temporal intentionally fails the unchanged quality bar.


The next fixture-only diagnostic observes the already-compiled instance draw at frames 22–24,
recording the actual vertex shader, matrix attribute bytes/versions and object identities. It
does not invoke another compile or render, and releases its temporary draw observer on disposal.
The existing quality thresholds and appearance stay unchanged. This isolates the one-frame
recompile corner before any engine patch; PR393 retains canonical motion-history ownership.
A separate HDR-reference hypothesis is not supported by the captured sequence: across all 32
reference/no-AA PNGs, non-marker channel maxima are 189/227/242 and no non-marker channel
saturates. The authored marker is unit red. No reference method or score has been changed.


A fixture-only nearest-history control and its matching never-occluded arm test whether repeated
bilinear history reprojection causes the thin-edge blur. They add 32 actual captures to the
unchanged original 176-frame corpus and use the same numerical evaluator; all original gates
remain authoritative. The control changes only the history texture sampler. Nearest sampling can
snap under subpixel motion, so it is a causal experiment, not an adopted filter or product mode.


Hosted draw diagnostic `37005814851` stopped at the bridge's JSON-safety guard: the installed
InstancedBufferAttribute exposes numeric `id`, not `uuid`. Direct construction reproduces the
undefined field. The diagnostic now records `matrixId`; no renderer, history or quality logic
changes. The earlier combined 176-frame evidence remains valid; this diagnostic run is incomplete.


Source `12704356112ed1bba9c29af57faa9021fb5cf978`, run `37006364268`, completes all
208 captures with empty diagnostics; every PNG hash verifies and the original 176 PNGs are
byte-identical to combined source `e48c31b8`. Nearest history worsens edge error to 0.07036
(from 0.06001), residual instability to 0.03246 (from 0.03119), and moving-edge error to
0.03528 (from 0.03024). It is rejected as a quality fix. Its causal red-tint fraction remains
6.21% one frame after reveal. [Inspected actual control frame](../../verification/prd455/nearest-history.png)
and [exact measurements, draw states and provenance](../../verification/prd455/history-sampling.json)
retain the failed experiment.

The actual frame-22/23/24 vertex shaders are identical and explicitly multiply distinct previous
instance attributes. The mesh, matrix and interleaved-buffer identities persist. At the frame-23
draw, current and previous CPU Y are -0.6999545693 and -0.6924691796, both buffers have version 23,
and both before-frame and before-object events are present. The observed GPU object-Y velocity
remains zero. Thus missing previous assignment and stale scheduled CPU arrays do not explain the
recompile corner; actual upload/binding state remains under investigation in canonical PR393.

The next quality experiment will retain TRAANode's allocation, jitter and history lifecycle while
comparing a game-owned Catmull–Rom history sampler. An authored-linear control must reproduce the
installed resolve before interpreting the higher-order filter. This follows the reconstruction
problem discussed by [Emilio López](https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/)
and [Alex Tardif](https://alextardif.com/TAA.html); it does not establish that the proposed filter
passes this fixture or the broader acceptance corpus.


Before a higher-order filter is tested, the evaluator gains an additional local-reference
excursion diagnostic: a pre-reveal pixel is outside its 3×3 reference RGB bounds by more than
0.01. The fixed allowance exceeds one 8-bit sRGB code step in linear light. Exact/quantized
controls score zero and an injected halo fails in a numerical red-to-green regression. This
reports possible halos or undercoverage, not a causal classification of ringing; the original
edge, instability and reveal scores/gates remain unchanged.

The recompile diagnostic now also records attribute-wrapper identities, backend create/update
calls, pre-existing shared GPU buffers and render-call deduplication state. It copies actual
current/previous matrix GPU bytes through the installed renderer readback API after those same
three draws. No extra render is introduced, and diagnostic readback remains excluded from any
performance claim. The canonical PR393 worker is investigating a fresh-wrapper/shared-buffer
upload hypothesis; no engine repair is duplicated here.


Actual GPU readback at source `aabfa0272b486d345010d00aadeeb042e6cf2b39`, run `37008638293`,
confirms the recompile cause. Frame 23 creates four fresh current-matrix attribute wrappers over
the existing GPU buffer. Each backend create call sees that buffer already present and uploads
nothing: GPU current Y remains -0.6924691796 from frame 22 despite CPU Y=-0.6999545693.
Previous GPU Y correctly advances to -0.6924691796, so the velocity becomes zero. Frame 24 issues
an update and catches up. All 208 PNGs remain byte-identical and diagnostics empty.
[Exact actual-upload and GPU-byte evidence](../../verification/prd455/matrix-upload.json) is
forwarded to PR393's owner; the engine repair remains canonical there.

The experimental generated `temporalResolve.ts` now retains Three.js 0.185.1's resolve equations
with source attribution and MIT notice, then offers an explicit linear/Catmull–Rom history
sampling comparison. It creates no target and owns no jitter, depth copy, frame loop or history
lifetime. The kernel's independently evaluated polynomial tests cover sample-centre identity,
constant/linear/quadratic reconstruction and negative lobes. The actual quality gate is still red
from the previous source; these CPU tests do not qualify the new filter.

The maintained candidate run adds an authored-linear arm, cubic and cubic+strict-rejection arms,
matching never-occluded controls and a matched cubic+strict zero-velocity control, for 304 total
frames. Authored-linear output must be byte-identical to the installed temporal arm before any
cubic finding is interpretable. Original scores and thresholds remain; additional candidate
reports compare edge error, instability, both reveal diagnostics and neighbourhood excursions
against both no-AA and the installed temporal arm. The cubic filter clamps negative history
samples before the existing variance clip. Ringing and cost remain open until measured.


Frozen candidate review checkpoint: 135 focused tests pass, including all 13 actual generated
scaffold hashes; only starter changes. Root types, error-level lint, quality scanner, fixture
build, documentation links, evidence budget and instruction mirrors pass. Evidence JSON was
formatted without changing parsed values or PNG bytes. Independent review is required before
publishing this shader increment or running its hosted comparison. No candidate quality result
is claimed and all remaining acceptance boxes stay open.

Review correction: authored-linear equivalence now participates in the aggregate pass and has
its own assertion after the complete summary is saved. A mismatch invalidates cubic
interpretation even if every original quality check passes; the failure names the retained
artifact. Red-green regressions cover both passing and failing original checks. Non-strict
cubic is explicitly diagnostic-only because it lacks a matched zero-velocity control and is
excluded from qualification. No original quality threshold or runtime arm changed.
Empty check sets also save `pass: false` before throwing a missing-checks error; equivalence
failure retains precedence. The new false-pass regression went red-green; both empty-set paths
and the existing checks now pass.

Actual 304-frame run `37016735368`, source `3afcbc66a8101be6a39bac489e09d3f75b8895c4`,
passes authored-linear equivalence: all 16 PNGs are byte-identical to installed TRAA. All 304
hashes verify, all 19 arm diagnostics are empty and the earlier 208 PNGs remain unchanged.
Cubic+strict improves edge error relative to installed temporal (0.05605 versus 0.06001), but
still loses to no-AA (0.05061) and misses the fixed 5% improvement bar. Instability is 0.03173;
causal red tint is zero across all reveal frames. Conservative reveal projection and excursions
versus installed temporal still fail. Its matched zero-velocity arm degrades moving-edge error
from 0.02470 to 0.04169. The unqualified result and all controls are retained in
[exact cubic experiment evidence](../../verification/prd455/cubic-history.json), with inspected
[before](../../verification/prd455/cubic-strict-frame-27.png),
[reveal](../../verification/prd455/cubic-strict-frame-30.png) and
[recovery](../../verification/prd455/cubic-strict-frame-36.png) runtime frames.

The next explicit dependency merge consumes canonical PR393 uploader repair
`ac7e78978854beea2c7db1026b26da5ea2f71716`, whose actual GPU recompile gate passed in run
`37016640068`. Frozen offline install and 199 focused combined tests pass. The only merge
conflict was the scaffold hash table; all thirteen were measured and only starter differs
from the incoming dependency because it includes this PR's generated temporal source.
The identical 304-frame benchmark must run on the combined source before its result can be
attributed to this new dependency. Neither the earlier experiment nor the dependency's separate
oracle establishes that combined result. PR393 still must land before this PR becomes ready.

Combined run `37018389700` on `e638fc470f2c36d59b2046de4822cfd406424048` now verifies
the canonical uploader repair in this temporal helper's actual recompile path. All 304 PNG
hashes verify and all 19 diagnostics are empty. Recompile matches ordinary temporal pixels,
metrics and MRT samples exactly across all 16 frames. Frame 23 instance error falls from
0.52156 pixel to 0.00005972 pixel; the sequence maximum is 0.0009863 pixel. Actual GPU current
Y now equals CPU current Y=-0.6999545693 while previous Y remains -0.6924691796.
Only recompile frames 23–36 change from the previous source; all other pixels and scores remain
unchanged. Authored-linear equivalence still passes, while the same image-quality gates fail.
[Combined provenance, unchanged metrics and corrected readback](../../verification/prd455/combined-cubic-history.json)
and the inspected [corrected recompile frame](../../verification/prd455/recompile-corrected-frame-23.png)
are retained. Existing cubic/reference images remain valid because their bytes are unchanged.
Further resolve changes await a fresh critique of these measured remaining errors.

Fresh critique identifies lost thin-fence coverage and dark cubic excursions as the largest
remaining problems. The next bounded diagnostic changes only the final cubic+strict blend:
ordinary `mix(clippedHistoryColor, currentColor, currentWeight)` replaces luminance reweighting,
at the identical previously computed current weight. Sampling, clipping, rejection, jitter,
history lifetime and every original quality threshold remain unchanged. Matching never-occluded
and zero-velocity arms accompany it, for 352 frames total. Real pinned-WGSL regression verifies
that the diagnostic removes luminance reweighting and uses the existing weight directly;
omitted and explicit luminance settings compile identically. No default changes.

A new diagnostic records mean linear blue per column over x=165–219/y=140–194, then sums each
column's signed difference from the matching reference background pixel (0,0). All sixteen
profiles are reported without clamping dark deficits. Its
[baseline measured on the existing combined source](../../verification/prd455/fence-profile-baseline.json)
gives frame-28 contrast 3.7238601 for reference, 2.3472733 installed and 2.9720493 cubic+strict.
The arithmetic is documented independently of the critic's unrecorded calculation. The
full-image edge, instability, reveal, causal and excursion measures remain authoritative;
a local contrast improvement alone cannot qualify the candidate. Increased shimmer or bright
halos remain explicit risks. If the deficit does not consistently shrink across the sequence,
reject this hypothesis instead of tuning blend constants. Hosted execution awaits review of
this diagnostic increment; no ordinary-blend image-quality result is claimed yet.
Frozen diagnostic checkpoint: 141 focused tests pass, including actual WGSL generation and
all thirteen generated scaffold hashes. Root types/error-level lint, fixture build, docs,
instruction mirrors and the 71.3 MB evidence budget pass. Full runtime qualification is pending.


### Lifecycle repair preserved in current develop merge (2026-10-04)

The published toggle repair `004e4b8a` removes the chain-owned physical velocity attachment
after invalidating its old GPU targets, preserves borrowed attachments and reattaches the
cached texture on reactivation. Published head `b32342b9` adds only the public type-import fix.
The original hardware three-toggle fixture has no console errors/warnings and is nonblank,
with final targets/history/stages/provisioning zero; its full result remains **failed** because
the unchanged p95 baseline-noise gate is exceeded by +0.625 ms. This does not qualify cost.

The isolated normal merge with develop `15adf350` retains the incoming fluid, exposure/fog,
assets and render-output ownership changes. Frozen install, JavaScript dependency builds,
full workspace TypeScript and 255 focused CPU tests pass; the real Three patch predecessor
regression is fixed with exact full-blob migrations and tamper refusal. The merged runtime
has not been captured. No reconstruction, quality, ghosting, native or performance acceptance
box changes. The original quality failures and diagnostic hypotheses above remain open.

### Second develop merge into PR #398 (2026-10-04)

The repair lane fast-forwarded from `ffa6ea9bb` to the published head `ea0c30701` with no
history rewritten, then merged `origin/develop` `64aed30fe` (PRD-345 backlight and
dark-environment defaults). One conflict, in `packages/create-threenative/__tests__/
scaffold.spec.ts`: both sides had re-pinned `PRD_201_PARENT_SCAFFOLD_HASHES` for unrelated
reasons, so neither table described the merged tree. The resolution is the merged-tree
measurement through the actual `createProject` trees, and
`vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t byte-stable` passes on
it. The incoming backlight, environment-contribution and material-lighting bytes and the
temporal render source both survive; nothing under `src/render/` moved into a package.

`pnpm ci:fast` passes all four stages: lint, docs, agents mirror and drift (including the full
scaffold spec). The wider `vitest run packages/create-threenative` run is 1272/1282. Its
deterministic reds all name files this merge did not touch and are already red on the
published head: `temporalResolve.ts` at 347 lines, `temporalAA.ts` with no importer and an
uncalled `createTemporalAA`, and the starter `CLAUDE.md` 100-line budget. The rest are
environment reds on an unbuilt checkout: a 60s build ceiling, `publication.spec.ts` missing
`packages/metahuman/dist`, three asset-cook 60s timeouts and one 180s pristine-scaffold
typecheck timeout. No threshold, control or sample count moved.

This merge has no new runtime proof, no capture and no hardware run. Every quality,
ghosting, dynamic-resolution, native and performance acceptance box above stays exactly as it
was, and the p95 baseline-noise control is still unpassed.

### Browser positive is green on the display-sized arm; the cold-frame control is not (2026-10-04)

The browser lane now runs through the harness on the correct HTML entry and the flags this host's
X11 compositor accepts, so the two earlier causes are closed rather than re-diagnosed. The entry is
`/temporal.html?measure&variant=scaled`, not the bare `/temporal-main.js` module URL that rendered as
text and produced `TN_PLAYTEST_BRIDGE_MISSING`. The flags are the six already proved on this
adapter — `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --use-vulkan
--disable-vulkan-surface --no-sandbox` — passed as repeated `--browser-arg`, which is the supported
override and replaces the recipe rather than extending it, so no harness change was needed.

Positive, `examples/abyss-framework/playtests/temporal-aa-scaled.playtest.json` against
`http://127.0.0.1:5199/temporal.html?measure&variant=scaled`: 26 of 26 assertions pass and
diagnostics are empty. Adapter `nvidia`/`turing`, 30 scenario frames, eight declared triviality
opt-outs. Both cold frames compared the full 192 samples at outside 0 — the opening frame at input
853x480 with no lattice (`viewEnabled false`), the resize frame at input 853x320 with
`jitterMatchesInput true` — and both published mean 0.0833 against an oracle mean of 0.0833.

Native positive was re-executed rather than reused, so no stale parity pass covers the new row
wiring: `artifacts/conformance/native-r8/report.json`, `temporal-aa-scaled` pass, native exit 0,
1280x480 non-uniform, `pixelMismatchRatio 0.0413037109375 <= 0.06`, `perceptualDeltaE
0.2009623136688549 <= 9`, zero GPU validation errors, 192 samples per cold frame at outside 0. The
runner exits 2 because the other 96 rows are unselected and one further row is blocked; that exit is
the blocked-row contract, not a failure of the selected row. The native adapter is genuinely
unknown and is reported as such.

The cold-frame control was red in that window, and this paragraph's explanation of it was **wrong**.
It claimed the fixture's constant-valid hook was a silent no-op because Three.js 0.185.1's
`TRAANode.js` has no `_historyValidUniform` member. That member is not upstream's: `temporalAA.ts`
installs it on the node and `temporalResolve.ts` reads it, so
`historyValid.greaterThan(0.5).and(...)` is the live `hasValidHistory` term of the kernel the
provider installs. The gate reaches the shader. What the 8x8 centre block actually showed is weaker:
variance clipping pulls a stale history towards the current neighbourhood, so one flat block of the
frame agreed with the oracle whether or not the gate was installed, and 192 samples could not tell
the two arms apart. The measurement was too small, not inert. The control row and its registry entry
stay uncommitted until the comparison covers the frame.

The fix was not a re-diagnosis of the browser lane and not a new shader seam. It is a wider
measurement: one cold frame's whole published display against the same spatial GPU oracle.

### Two static contracts cleared by a comment-and-spacing repair (2026-10-04)

The generated `temporalResolve.ts` lost its narration comments and their blank spacing, 347 to331
lines, with the MIT notice, the pinned Three.js 0.185.1 attribution and the boundary, citation and
calibration comments kept. `ts.transpileModule` with `removeComments: true` and `sourceMap: false`
emits 9,363 bytes before and after and the two outputs are byte-identical, so the repair changes
no executed statement. The three `temporal-resolve.spec.ts` tests pass.

That repair did not clear the cap and is not claimed to. It bought room, and the resolve equations
were then split into the modules that fit: `temporalAA.ts` 198 lines, `temporalAAFrame.ts` 197,
`temporalAAStage.ts` 52, `temporalResolve.ts` 122, `temporalResolveDepth.ts` 124 and
`temporalResolveMath.ts` 146. Every generated temporal helper is now under 200 lines, so the earlier
`looks.spec.ts` exemption for `temporalResolve.ts` is removed rather than kept. The 200-line cap now
holds for every generated render file except the two named reasons beside it, `loading.ts` and
`worldEnvironment.ts`, and the ownership assertion above them — no `@threenative/` import in any
generated render file — still covers every one of the six.

The starter `AGENTS.md` lost the blank line before each of nine section headings, 97 to 88 lines,
so the generated `CLAUDE.md` mirror measures 91 lines against the 100-line budget. No sentence,
word, reference, convention, temporal note, backlight note or appearance note was removed;
`pnpm sync:agents` rewrote that one mirror and its `--check` reports 22 mirrors in sync.

Focused results on this tree: `looks.spec.ts -t 'should keep generated render files readable and
framework-free'` 1 passed (was red at 347 lines), the whole `looks.spec.ts` 19 passed,
`template.spec.ts -t 'should scaffold flat agent docs without shared marker comments'` 1 passed
(was red at 100 lines), `scaffold.spec.ts -t 'byte-stable'` 1 passed after the measured `starter`
tree hash moved to `f62b055c8c33441007a9bf293427ba88b126cacf44d062d46b17cb1f697c7a88` with the
other twelve unchanged, `pnpm check:docs` clean across 2,442 links, `pnpm typecheck` Done, and
biome reporting one pre-existing `looks.spec.ts:88` complexity warning that is identical at HEAD.
The full `template.spec.ts` run is 56 passed and the same two reds as above: `starter/temporalAA.ts`
has no importer and `createTemporalAA` is uncalled.

No threshold, control, sample count or acceptance box changed, no runtime proof was gathered and
no capture or hardware run was made.

### Native reset/readback proof on the desktop lane (2026-10-04)

`scene-support.js` calls `subject.render()` and never `subject.sampleVelocity()`, so the readbacks
this proof needs could not execute natively. The scene's `build` callback is the supported async
seam — `offscreen-screenshot.js` already reads a render target there — so
`temporal-aa-scaled.js` drives its 22 diagnostic frames inside `build` and asserts every one before
the frame loop starts. No shared harness file changed.

Ran `sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs --target desktop
--only-tests temporal-aa-scaled --reference packages/runtime-native/artifacts/conformance/web --out
artifacts/conformance/native-r7` against the prebuilt `build/tn-linux/mystral`, no C++ change and no
rebuild. Row `temporal-aa-scaled` passed: native exit 0, non-uniform screenshot,
`pixelMismatchRatio` 0.0394287109375 against the 0.06 tolerance, `perceptualDeltaE` 0.24874598761131655
against 9, zero GPU validation errors, 1280x480. The runner exited 2 because the 96 unselected rows
are reported blocked, which the registry requires.

The native adapter identity is not available: the conformance stdout carries no adapter, vendor or
architecture string, so nothing claims hardware here. The host window is 1280x720 and the capture is
1280x480 after the fixture's own height-only resize.

Because the row passed, those assertions held natively: input raster 853x480 then 853x320, depth
history 853x480 then 853x320, display, resolve and history 1280x720 then 1280x480 with the display
width held, the far border of the display raster answering a display-sized resolve, exactly two
compared reset frames, 192 compared samples in each with none outside the spatial oracle, no jitter
lattice on the opening frame, and the resize frame's lattice equal to the input raster. The disabled
gating control (`scaled-unchecked-reset`) did not run natively in this window, so its contamination
is still browser-only.

Browser rerun: red. `temporal-aa-scaled.playtest.json` and its `-unchecked-reset` control both stop
at `TN_PLAYTEST_BRIDGE_MISSING` with `frames: 0`, headed and headless, so the page installs no bridge
under the current fixture. The earlier 26/26 and 5/5 results predate the final fixture, probe and
scenario edits and describe no current tree. `examples/abyss-framework/temporal-main.js` gained the
scaled arms' 1280x720 display raster, `settle` 20 and a 5-frame startup advance to make the browser
control reach the same raster pair; that change is unproved while the scenario is red.

Every full-phase box stays open: rejection, corpus, quality, ghosting, automatic-scale and
performance. No threshold, tolerance or assertion was widened, no capture was taken on hardware and
no commit was made.

### The whole-display cold-frame oracle separates the two arms (2026-10-05)

`temporal-resolve-probe.ts` now compares a cold frame's **whole published display** against the same
immutable-current-input spatial GPU oracle, at the same half-float precision and the same tolerance.
Each readback's row stride is derived from the returned typed array rather than assumed to be its pixel
width, because a GPU readback pads rows to a 256-byte boundary. Precision, thresholds, depth rejection
and variance clipping are untouched; the oracle is still the resolve's own colour sample of the same
input texture, rendered by the same state discipline at display size.

Browser, the two proved entries and the six proved flags, adapter `nvidia`/`turing`:

- Positive `temporal-aa-scaled`: **29 of 29 assertions pass**, diagnostics empty, 30 scenario frames,
  nine triviality opt-outs. Both cold frames report `outside 0` with `worstRatio 0` over the whole
  display — **2,764,800** channels at 1280x720 and **1,843,200** at 1280x480 — with published mean
  0.0336 against oracle mean 0.0336 and 0.0277 against 0.0277. `artifacts/playtest/wholeframe-positive`.
- Control `temporal-aa-scaled-unchecked-reset`: **8 of 8 assertions pass** on the identical sample
  sets, `outside` **168,884** of 2,764,800 (`worstRatio` 898.096) at the opening reset and **119,914**
  of 1,843,200 (`worstRatio` 959.5) at the resize reset. `artifacts/playtest/wholeframe-control`.

So the reset gate is live and now carries weight: with the whole frame compared, the gated arm
publishes the untouched input everywhere and the ungated arm publishes an unwritten history over
6.1% and 6.5% of the frame. Both browser scenarios and both native scenes now assert
`pixels === width * height * 3` on each cold frame instead of the 8x8 block's 192.

Focused units stay green: `temporal-resolve.spec.ts`, `temporal-aa.spec.ts`, `looks.spec.ts` and
`scaffold.spec.ts` pass, 104 tests in 7.26 s.

**Native is not re-executed in this window, and the reason is a blocker, not a pass.** Generating the
fresh browser reference both native rows require fails on the positive row, deterministically, in three
consecutive runs — twice with the control in the same run and once with the row alone
(`packages/runtime-native/artifacts/conformance/web-wholeframe-r1`, `web-wholeframe-r2`,
`web-posonly-r3`): the probe's
pre-existing raster guard throws `Resolve must hold the display raster; it is 1280x720 against
1280x480` at the fixture's height-only transition, so that row writes no reference capture and the
desktop lane has nothing to compare against. The control row passes the same frames and captures
1280x480. `guardRasters` runs before any comparison this window changed, so the cause is not yet
diagnosed; what it is not is a product claim either way. The earlier `native-r8` positive pass
compared the 8x8 block and describes no longer-current measurement, so it does not carry over. No
native row, adapter identity or hardware claim is recorded here.

Every full-phase box stays open: rejection, corpus, quality, ghosting, automatic-scale and
performance. No threshold, tolerance or assertion was widened, no capture was taken on hardware and
nothing is committed: the normal hook commit needs all four lanes green and only the two browser
lanes are.

### The blocked native reference was a missing frame boundary in the scene (2026-10-05)

The blocker above is a fixture-scheduling defect, in the conformance scene, not a product defect and
not a measurement defect. Both diagnostic frames ran back to back inside one turn: the loop issued
`fixture.render()` and then awaited only `fixture.sampleVelocity()`, which is a GPU-completion
await, not a frame boundary. `temporal-main.js` already carries the reason — a temporal node's own
frame update waits on the animation clock, so renders issued without one never advance it. At the
height-only transition the resolve therefore still held the pre-resize display raster, and the
probe's pre-existing `guardRasters` threw `it is 1280x720 against 1280x480` before any comparison.

The fix is one line in each of `temporal-aa-scaled.js` and `temporal-aa-scaled-unchecked-reset.js`,
reusing the advance already proven in this directory's `probe-volume-sample.js`:
`await new Promise((resolve) => requestAnimationFrame(resolve))` before each diagnostic render. No
new helper, file, dependency or product change, no guard, threshold, tolerance or assertion touched,
and both arms keep the identical 22-frame loop so they stay one frame-for-frame pair. The browser
lane's Chromium already carries `--enable-unsafe-webgpu --enable-features=Vulkan` in
`run-conformance.mjs`, so the reference needs no extra flag route; the repeated `--browser-arg` form
belongs to the direct playtest CLI and was used there.

All four runtime arms, on this exact tree:

- Browser positive **29 of 29**, adapter `nvidia`/`turing`, `outside 0` and `worstRatio 0` over the
  whole display at **2,764,800** and **1,843,200** channels — identical to the run above, because the
  browser fixture did not change. `artifacts/playtest/raf-positive`.
- Browser control **8 of 8**, `outside` **168,884** (`worstRatio` 898.096) and **119,914**
  (`worstRatio` 959.5) on the same channel counts. `artifacts/playtest/raf-control`.
- Fresh web reference, adapter `nvidia`/`turing`, both rows pass at display 1280x480, no page errors
  and no GPU validation error. `packages/runtime-native/artifacts/conformance/web-raf-r9/report.json`.
- Native desktop, prebuilt `build/tn-linux/mystral`, no C++ rebuild: both rows pass, native exit 0,
  zero GPU validation errors, non-uniform 1280x480. `temporal-aa-scaled`
  `pixelMismatchRatio 0.0350537109375 <= 0.06`, `perceptualDeltaE 0.2504743023768323 <= 9`;
  `temporal-aa-scaled-unchecked-reset` `0.045857747395833336 <= 0.06`, `0.19054617552811 <= 9`.
  `packages/runtime-native/artifacts/conformance/native-raf-r9/report.json`. The runner exits 2
  because the other 96 registry rows are unselected; that is the blocked-row contract. The native
  adapter remains genuinely unknown and is reported as unknown, not inferred from the browser row.
- `biome check` clean on both scenes; `pnpm check:docs` clean across 2,442 links; the 104 focused
  unit tests were green before this window and this change touches no unit-covered source.

No full CI, no push, no merge. Every full-phase box stays open: rejection, corpus, quality,
ghosting, automatic-scale and performance.

### The per-pixel rejection fraction is measured on both lanes (2026-10-06)

`ITemporalAAReport` now carries a measured `rejection`, and the report is the only place a caller
reads it. `temporalResolveDepth.ts` lifts the one history-validity decision — `historyValid ∧
validUV ∧ (edge ∨ ¬disocclusion)` — into a single `historyValidity` node parameterised by the
pixel's UV. `temporalResolve.ts` calls that node for the blend weight, so the appearance is
untouched: no new gate, no control uniform, no colour alpha. `temporalRejectionCounter.ts` calls the
*same* node once per display pixel from a compute dispatch, `atomicAdd`s the rejected and visited
words into a two-word `instancedArray`, and copies them back asynchronously, one at a time. A
reported fraction therefore cannot describe a different decision than the one the resolve drew,
because there is only one decision node. The dispatch runs between the resolve draw and this frame's
depth-history copy, so the kernel reads the depth and matrices the resolve just drew with; nothing is
re-rendered and no `PassTexture` dependency is added, so no input changes.

Fail-closed on purpose: a copy that never lands, lands short, lands with `visited ≠` the display, or
lands with `rejected >` `visited` **withdraws** the measurement and records the reason. `settled()`
rejects with that reason, `report()` omits the field, and `drain()` hands the chain nothing — never a
zero, never the previous frame's number. The report field is omitted rather than set to `undefined`,
which a real failure caught: the playtest bridge publishes a resource whole and rejects
`undefined` as not JSON-safe. `chain.observeFrame()` then fails closed on its own terms too — a
non-advancing frame, a non-finite share or a share outside `[0, 1]` throws — and an unlanded
measurement is reported as absent, never as `0`.

`temporalAAHooks.ts` (51 lines) owns the two pipeline callbacks separately, and the lifecycle
decision is unchanged: both originals are captured **once, before** upstream's setup writes the
node's own pair; our `before` is installed after setup alongside the owned upstream `after`; the
jitter callback keeps one identity across recompiles; and `dispose()` restores **both** first
originals only while each slot still holds what this node installed, so a later replacement survives.
Three tests prove the restore, the recompile identity and the later-owner case.

Files: `temporalAA.ts` (report field, shared rejection instance, hook install), `temporalAAFrame.ts`
(dispatch between resolve and depth copy, dispose the counter), `temporalAAStage.ts` (publish the
callback the chain asks for), `temporalResolveDepth.ts` (the shared node), `temporalResolve.ts` (call
site), `temporalAAHooks.ts`, `temporalRejectionCounter.ts`, the canonical `worldEnvironment.ts` and
its twelve copies, and `temporal-aa-fixture.js` (`settledRejection()` then `chain.observeFrame()`).

**Capability audit actually run before this work**, through the registered `engine-mcp`
implementation (`packages/engine-mcp/dist/index.js`, `searchCapabilities` + `capabilityDetail`), not a
filtered read of the manifest: two queries — one on owning pipeline callbacks around a third-party
node that writes the same callbacks during setup, one on measuring the rejected-history share on the
GPU with an asynchronous readback — returned **25 hits** and `engine_capability_detail` ran on every
one. The hits that decided the design: **`GPUReadback`** (one copy in flight, requests during one
dropped rather than queued, every sample carries `staleFrames`, WebGPU-only) — it is the exact
throttle the counter implements by hand, and it is not reachable from generated `src/render/`, which
may import no `@threenative/`; **`velocityTexture`** (`VelocityTracker.update()` before the render,
`commit()` after) — already what the fixture does; **`temporalReproject`** — rejected, an addon that
owns the look. No capability ships a rejection counter, so the count kernel is new generated source,
not core. Zero core changes, zero new dependencies, no generic manager.

Results on this tree, adapter `nvidia`/`turing` in both browser lanes, no SwiftShader:

- Units: **58** focused create-threenative tests pass (25 in `temporal-aa.spec.ts`, including the
  callback lifecycle and the fail-closed recovery cases), plus `scaffold.spec.ts` **66** and
  `shared-render-sources` / `looks` / `temporal-resolve` / `temporal-initial-projection` green.
  `pnpm typecheck` and `pnpm lint` exit 0 (Biome warnings only), `pnpm check:docs` clean across
  2,442 links, and every changed generated file is under the 200-line gate after Biome.
- Browser positive **passes** on `temporal.html?measure&variant=scaled`: reset frames at frame 1 and
  frame 21 report fraction **1** with the GPU's own visited count **921,600** (1280×720) and
  **614,400** (1280×480); the 33 warm frames range **0 … 0.006279296875**; the settled
  `aa.rejection` is frame 35 at `0.0014860026041666667` with `staleFrames 0`; the whole-display
  oracle is unchanged at **2,764,800 / 1,843,200** channels, `outside 0`, `worstRatio 0`.
  `artifacts/playtest/rej-positive`.
- Browser control **passes** on `…&variant=scaled-unchecked-reset`: the same counter visits the same
  **921,600 / 614,400** pixels, its cold fractions are **0.92068359375** and **0** — not 1 — and the
  contaminated oracle is unchanged at **168,884 / 119,914**. So the positive row's `1` is the reset
  gate, not a constant. `artifacts/playtest/rej-control`.
- Fresh web reference, both rows **pass**, adapter `nvidia`/`turing`, no page errors, no GPU
  validation error. `packages/runtime-native/artifacts/conformance/web-rej-r2/report.json`.
- Native desktop against that reference, prebuilt `build/tn-linux/mystral` with no C++ rebuild: both
  rows **pass**, native exit 0, zero GPU validation errors, non-uniform 1280x480.
  `temporal-aa-scaled` `pixelMismatchRatio 0.03699544270833333 <= 0.06`,
  `perceptualDeltaE 0.23186547772174834 <= 9`; `temporal-aa-scaled-unchecked-reset`
  `0.043798828125 <= 0.06`, `0.24407629667666397 <= 9`.
  `packages/runtime-native/artifacts/conformance/native-rej-r2/report.json`. The runner exits 2
  because the other 96 registry rows are unselected, which is the blocked-row contract. The native
  adapter is genuinely unrecorded by this harness and is reported as unknown, not inferred.
- One defect this window found and fixed, in the fixture rather than the product: the cold-frame
  visited check indexed the observation array by reset index, and the two resets land on diagnostic
  frames 0 and 20, so reset 1 was compared against the pre-resize 1280×720 raster. The counted
  display now travels with the row it describes.

Both Phase 1 boxes stay **open**. The output-size half still needs its low-resolution-passthrough
mutation to fail the assertion, and the cut/projection/zero-velocity mutation for moving skinned and
instanced content has not run. Phases 2 and 3 stay open. Scoped commit only: no full CI, no push, no
merge.
