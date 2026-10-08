---
prd_contract: v1
---

# PRD-537 — A lower internal raster reconstructs into a stable full-resolution frame

**Status:** NOT STARTED — successor to [PRD-455](../done/PRD-455-temporal-reconstruction-from-dynamic-resolution.md); no reconstructor has cleared the quality gate (2026-10-07).  
**Priority:** P1 — Carried over unchanged from PRD-455, whose own note ranked it the highest-value rendering project; the owner may lower it.  
**Complexity:** 8 → HIGH. Five candidates failed the same gate on hardware; the next one is a new design, not a parameter change.  
**Depends on:** PRD-455 (opt-in provider, lifecycle, fixture and 31-arm corpus) and PRD-269 (motion history).

## Problem

PRD-455 shipped full-resolution temporal AA as opt-in generated source and the corpus that judges reconstruction. Every low-resolution candidate then failed the unchanged gate on nvidia/turing hardware WebGPU:

| Evidence (2026-10-07) | Result |
| --- | --- |
| Full-res edge, moving camera | `.05849` against no-AA `.05029`, needs `<.04778` |
| Full-res edge, static camera | `.04847` against `.05245`, a 7.6% gain, still `.0007` short |
| Low-input edge | `.08062` against spatial `.07745`, needs `<.04687` (static: `.08132` against `.06930`) |
| Reveal stale after +1 frame | motion `1.77%`, quality `4.89%`, needs `<=1%` |
| Variance-clip gamma `[0.75,1.25]`, `[1,1.5]` | edge `.05822`, `.05803`; no check moves |

Localization: accumulation works when the camera is static, and sub-pixel camera drift costs about `.010` of edge error through reprojection and resampling. Clipping, the reactive mask and the raw4 current-footprint candidate are not the lever. A 426×240 input does not recover native-resolution edge accuracy in this metric.

## Outcome

One reconstructor that, at a sub-1.0 internal raster, produces a stable display-resolution image during motion, lowers measured GPU/render time, and degrades safely when history cannot be trusted. If it cannot beat full resolution after its own cost, it stays opt-in.

### Phase 1 — A reconstructor that clears the unchanged quality gate

- [ ] Thin fences, foliage, sub-pixel edges, a moving character and an instanced object stay within the pinned temporal thresholds against a full-resolution reference, and the temporal arm beats the spatial arm on the named stability metric. proof: an automated frame-sequence report records edge flicker, rejected-history ratio and image delta for full-res, low-res spatial upscale and temporal reconstruction; `sh scripts/xvfb.sh node --import tsx scripts/verify-temporal-motion.ts` exits 0 on hardware WebGPU with the original thresholds (`edge <.04778` full-res, `<.04687` low-input).
- [ ] Newly revealed surfaces do not inherit stale colour, and disabling disocclusion rejection fails the check. proof: the same command, `revealRecovery` and `qualityRevealRecovery` true (`<=1%` stale after one frame).

### Phase 2 — Keep it only if it buys frame time

- [ ] On a GPU-bound representative game, sub-1.0 rendering plus reconstruction lowers GPU/render p95 versus full resolution while meeting the Phase 1 thresholds. proof: paired fixed-route browser WebGPU and desktop-native table of internal pixels, reconstruction cost, GPU/render p50/p95 and visual metrics (no FPS-only verdict).
- [ ] Automatic resolution moves between at least three scales in one run without history corruption, allocation growth or a reconstruction cost spike larger than the saved raster cost. proof: scripted scaler route recording transitions, history resets, render-target allocation count and per-stage cost; repeated cycles end at the initial allocation baseline.

## Decisions

- The thresholds and the 31-arm corpus carry over unchanged; a candidate that needs them relaxed is rejected, not merged.
- Candidates already falsified (do not repeat): reactive mask, raw4 current-footprint weighting, variance-clip widening, and a rejection-fraction metric (it is velocity-blind; see PRD-269).
- CI: `verify-temporal-motion.ts` is not in CI today (its hardware Vulkan flags lose the device on the GPU-less runner, and four checks fail by design). Phase 1 includes returning it to the `temporal` integration job, with the unmet checks fail-closed once they pass.
- Ghosting margin to keep honest: the pinned moving-edge ratios (`<=.75`, `>=1.25x`) sit against measured `.629`/`.651` and `1.485`/`1.435` (hardware/CI).
- First step for the owner of this PRD: explain the `.010` camera-drift loss (history resampling) with a one-variable control before designing the next reconstructor.
