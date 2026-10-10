---
prd_contract: v1
---

# PRD-571 — Exposure meters a histogram and ignores the sun

**Status:** NOT STARTED
**Priority:** P2 — AC-1 and AC-2 are open: the shipped meter is a clamped linear mean, so a bright sky behind the subject still sets the exposure.
**Complexity:** 2 (LOW) — 1–5 files (1): three identical template files, copied to 13 templates by the scaffolder, plus the existing fixture; no new module, no package change. Risk override: none.
**Owner:** João
**Depends on:** None. Follows [PRD-339](../done/PRD-339-the-frame-sets-its-own-exposure.md) (done), which shipped the mean meter and says a compute histogram "is a separate PRD if a game ever needs one" (PRD-339:106-107). This is that PRD. Judged with the tone gate of [PRD-341](../done/PRD-341-a-frames-tone-is-a-number-and-the-number-is-a-gate.md) (done).

## Context

Auto exposure is generated template source. The three files are byte-identical in all 13
templates (`md5sum` on 2026-10-09): `src/render/exposure.ts`, `src/render/exposureGraph.ts` and
`src/render/autoExposure.ts`. It ships opt-in (`exposure.ts:29`, `enabled: false`).

What the meter does today (`templates/starter/src/render/`):

- `exposureMeter` (`exposure.ts:45-50`) takes linear luminance, clamps it to `[0.0001, 8]`, and
  weights the bottom of the frame more (`1 + uv.y`) so that ground counts more than sky.
- `reduceExposure` (`exposureGraph.ts:33-51`) averages 4×4 blocks, level after level, down to
  1×1 (`exposureReductionSizes`, `exposure.ts:85-97`).
- `adaptExposure` (`exposureGraph.ts:53-84`) turns the mean into a goal in stops,
  `log2(key) − log2(mean)`, clamps it to `[minStops, maxStops]`, and moves toward it at
  `rateUp` / `rateDown` in log2 space, with a snap for cuts.

PRD-339 already recorded why both textbook metrics fail (PRD-339:51-56): a log mean is wrong for a
mostly dark frame, and a clamped mean is wrong for a mostly bright one. In its reference, a
sun aureole over a tenth of the frame set the exposure, and the ground sat three stops under.
The clamp at 8 and the bottom weight reduce that error but do not remove it. A backlit subject
in front of a bright sky is still exposed for the sky.

[PRD-345](../rendering/PRD-345-a-backlit-subject-is-not-a-hole-in-the-sky.md) fixes the backlit subject from the
material side. Its "Out of scope" section gives exposure to PRD-339 and PRD-343, and its
2026-10-09 decision points here for the metering side.

### What Unreal does (UE 5.8.3, read 2026-10-09)

- **The default method is the histogram.** `AutoExposureMethod = AEM_Histogram`
  (`Engine/Source/Runtime/Engine/Private/Scene.cpp:494`). The low and high percents are 10 and 90
  (`Scene.cpp:495-496`). The histogram covers log2 luminance from −8 to 4 by default, or −10 to
  20 EV100 when the extended range is on (`Scene.cpp:499-513`). The speeds are 3 up and 1 down
  (`Scene.cpp:519-520`).
- **64 bins.** `HISTOGRAM_SIZE` is 64 (`Engine/Shaders/Private/PostProcessHistogramCommon.ush:89-90`).
  The build pass gives each thread its own histogram in group-shared memory, adds pixels to it with
  atomic adds, and then merges (`Engine/Shaders/Private/PostProcessHistogram.usf:69-72`, `:99-102`,
  `:169-170`). A second pass reduces the group histograms (`PostProcessHistogramReduce.usf`).
- **The average ignores both tails.** The average walks the bins from dark to bright. It first
  removes the darkest `low percent` of the total weight, then keeps weight only until it reaches
  the `high percent`. The result is the weighted mean of the kept bins in log2 space, and it
  returns to linear with `exp2` (`PostProcessHistogramCommon.ush:150-186`). With 10/90, the
  darkest 10% and the brightest 10% of the frame do not move the exposure.
- **No weight means no change.** If nothing is left after the clip, the average falls back to the
  minimum luminance, not to a division by zero (`PostProcessHistogramCommon.ush:176-179`).
- **A meter mask weights the screen.** Each pixel's histogram weight comes from a mask texture
  (`PostProcessHistogramCommon.ush:37-38`, `:201-204`; used at `PostProcessHistogram.usf:141`).
  The default is a white texture
  (`Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessEyeAdaptation.cpp:792-805`).
  TN's bottom weight in `exposureMeter` is the same idea as a function of UV.
- **Adaptation runs in log2 space.** It uses exponential approach when the error is small and a
  linear rate when the error is larger than a start distance (`PostProcessHistogramCommon.ush:208-240`).
  TN already adapts in log2 space with a snap for large errors (`exposureGraph.ts:73-79`), so this
  PRD does not change adaptation.
- **Local exposure is separate, and neutral by default.** UE also ships a bilateral-grid local
  exposure (`Engine/Shaders/Private/PostProcessLocalExposure.usf`), but its contrast scales and
  detail strength default to 1.0 (`Scene.cpp:527-529`), which changes nothing. This PRD defers it
  (see Decisions).

## Solution

Replace the metric, not the pipeline. The goal, clamp, adaptation, snap, readback and lifecycle
from PRD-339 stay as they are. Only the value that `adaptExposure` reads as "scene luminance"
changes: it becomes the clipped histogram average instead of the 1×1 mean.

1. **Bins.** 64 bins over log2 luminance. The range comes from the settings the game already
   authors, so there is no new constant: from `log2(key) − maxStops` to `log2(key) − minStops`.
   With the shipped `−12..12` this is 24 stops, 0.375 stop per bin.
2. **Weight.** Each sample's weight is the existing `exposureMeter` weight (the bottom-of-frame
   preference). The luminance clamp at 8 is removed from the histogram path, because the
   percentile clip now does that job. The game can still edit both.
3. **Clip.** `lowPercent` and `highPercent` join `IExposureSettings`, at UE's 10 and 90. The
   average follows the UE walk above: remove the low tail, stop at the high tail, take the
   weighted log2 mean of what is left. Empty weight keeps the previous exposure (the existing
   `valid` select at `exposureGraph.ts:65-68`).
4. **Build.** Phase 1 chooses between two arms by measured cost:
   - **Gather arm (default if it is cheap enough).** One extra 4×4 level stores the log2
     luminance and weight per block. A 64×1 fragment pass then gives each bin one texel. That
     texel loops over the second reduction level (about 8,160 texels at 1080p) and sums the
     weight that falls in its bin. No compute, no atomics, and it runs on every backend that
     runs the current meter.
   - **Compute arm.** A TSL compute pass with workgroup atomics, like UE's. Use it only if the
     gather arm costs more than the phone budget below.
5. **Templates.** The three files stay byte-identical, so all 13 templates get the change in one
   edit. Exposure stays opt-in (`enabled: false`). Turning it on by default is outside this PRD.

The consumer flow does not change: the game opts in through `src/render/exposure.ts`, the render
chain installs `AutoExposureNode`, and `TN_AUTO_EXPOSURE` diagnostics report the result.

Risk: the 4×4 pre-average mixes a small sun disc with the sky around it before the histogram sees
it. This is acceptable because the goal is to ignore small bright sources. A fixture box proves
that a sun disc of 1% of the frame does not move the exposure.

## Acceptance Criteria

- [ ] AC-1 [local]: In the auto-exposure fixture, a subject in front of a sky ten stops brighter is metered within the PRD-341 tone band. The current mean meter fails the same scene (red), and the histogram meter passes it (green). proof: `pnpm exec vitest run --maxWorkers=1 packages/create-threenative/__tests__/auto-exposure-proof.spec.ts` (new `backlit` room).
- [ ] AC-2 [local]: On the RTX 2080 browser WebGPU lane at 1080p, the histogram meter costs at most 0.1 ms GPU more than the mean meter. proof: `node packages/playtest/dist/runner/cli.js perf` on the fixture, both arms, `--browser-recipe webgpu`.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Histogram exposure metric | Game sets `enabled: true` in `src/render/exposure.ts` → `AutoExposureNode` (`autoExposure.ts`) → `adaptExposure` | Replaces the 1×1 mean as the luminance input. The mean reduction stays only if the gather arm reads its levels. | AC-1, Phase 1 |

## Decisions

- 2026-10-09 (João, via the Unreal source review): local exposure (UE's bilateral grid) is
  deferred. UE ships it neutral by default (`Scene.cpp:527-529`), so it is not part of UE's
  default look, and PRD-345 covers the backlit subject from the material side. A game that needs
  it after this PRD gets a separate PRD.

## Execution Phases

#### Phase 1: The histogram metric in the fixture

**Status:** NOT STARTED
**Files:** `packages/create-threenative/templates/starter/src/render/{exposure,exposureGraph,autoExposure}.ts`; `packages/create-threenative/__tests__/fixtures/auto-exposure/fixedRooms.ts` (new `backlit` room); `packages/create-threenative/__tests__/auto-exposure*.spec.ts`
**Implementation:** Add `lowPercent` and `highPercent` to `IExposureSettings` and validate them (`0 <= low < high <= 100`). Build the gather arm. Record the gather and compute costs. Keep the compute arm only if the gather arm misses AC-2.

- [ ] The clipped average matches a CPU reference of the UE walk on synthetic histograms: all weight in one bin, a uniform spread, an empty histogram, and `low == high`. proof: `pnpm exec vitest run --maxWorkers=1 packages/create-threenative/__tests__/auto-exposure.spec.ts`.
- [ ] A sun disc covering 1% of the frame moves the settled exposure by less than 0.1 stop. proof: `pnpm exec vitest run --maxWorkers=1 packages/create-threenative/__tests__/auto-exposure-proof.spec.ts`.
- [ ] The existing static, cut, cold-boot and lifecycle fixture scenarios still pass with the histogram metric. proof: `pnpm exec vitest run --maxWorkers=1 packages/create-threenative/__tests__/auto-exposure-proof.spec.ts packages/create-threenative/__tests__/auto-exposure-lifecycle.spec.ts`.

#### Phase 2: All templates, native and the phone

**Status:** NOT STARTED
**Files:** the same three files copied into the 12 other templates; `packages/create-threenative/agent-docs/references/auto-exposure.md`
**Implementation:** Copy the three files byte for byte. Document `lowPercent` and `highPercent` and say when to change them.

- [ ] All 13 templates ship byte-identical exposure source with the histogram metric, and the scaffold test passes. proof: `pnpm exec vitest run --maxWorkers=1 packages/create-threenative/__tests__/auto-exposure-scaffold.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts`.
- [ ] The desktop native host settles the static fixture with the histogram metric. proof: `node packages/playtest/dist/runner/cli.js packages/create-threenative/__tests__/fixtures/auto-exposure/native-static.playtest.json --target desktop`.
- [ ] On the Pixel 8, the histogram meter costs at most 0.2 ms GPU more than the mean meter. proof: `node packages/playtest/dist/runner/cli.js perf --logcat <serial>` on both builds.
- [ ] The reference doc names `lowPercent`, `highPercent` and the meter weight, and the doc checks pass. proof: `pnpm check:docs`.
