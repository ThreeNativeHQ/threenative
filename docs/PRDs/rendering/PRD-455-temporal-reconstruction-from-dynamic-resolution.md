---
prd_contract: v1
---

# PRD-455 — Fewer rendered pixels reconstruct into a stable full-resolution frame

**Status:** PROPOSED — filed 2026-09-26.  
**Priority:** highest-value rendering project after the streaming quick wins.  
**Complexity:** 8 → HIGH. The renderer already has the difficult prerequisites; the remaining risk is history correctness and proving reconstruction wins more GPU time than it costs.  
**Depends on:** the landed motion-history implementation from PRD-269 (`packages/core/src/render/velocity.ts`, commit `3630847a`), the existing `RenderChain`, and [PRD-384 adaptive resolution](../performance/PRD-384-adaptive-resolution-gpu-headroom.md).

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

## Integration ledger

| Existing surface | Change |
| --- | --- |
| `packages/core/src/render/chain.ts` | Add a reconstruction-capable stage contract that knows input raster size and output display size; reuse existing velocity provisioning/reporting. |
| `packages/core/src/render/velocity.ts` | Reuse current history; no second transform tracker. |
| `packages/core/src/resolution-scaler.ts` | No new policy. Expose/consume the resolved scale and reset history on size transitions. |
| `packages/runtime-native/conformance/scenes/shared/` | Add one reconstruction scene that runs the same source on browser/native targets. |

## Phase 1 — Define history correctness before chasing image quality

- [ ] The reconstruction stage produces a display-sized output from a smaller colour/depth input and records input size, output size, history-valid state and rejection fraction. **proof:** focused render-chain test runs 0.67→1.0 sizing, then a mutation returning the low-resolution target directly fails the output-size assertion.
- [ ] Camera cuts, projection changes and resolution changes invalidate history for the affected frame; moving skinned and instanced fixtures use the existing velocity source rather than a camera-only approximation. **proof:** deterministic fixture covers cut/resize/skinned/instanced cases and a zero-velocity mutation fails the moving-object rejection/stability assertion.

## Phase 2 — Prove motion stability on content that exposes temporal defects

- [ ] A fixed camera route containing thin fences, foliage, sub-pixel edges, a moving character and an instanced moving object stays within pinned temporal-stability/ghosting thresholds against a full-resolution reference. **proof:** automated frame-sequence report records edge flicker, rejected-history ratio and image delta for full-res, low-res spatial upscale and temporal reconstruction; the temporal arm must beat the spatial arm on the named stability metric.
- [ ] Newly revealed surfaces do not inherit stale colour after occlusion/disocclusion events. **proof:** foreground-occluder fixture reveals a contrasting background and asserts stale-history pixels decay within the declared frame bound; disabling disocclusion rejection makes it fail.

## Phase 3 — Keep it only if it buys real frame time

- [ ] On a GPU-bound representative game, sub-1.0 rendering plus reconstruction lowers GPU/render p95 versus full-resolution rendering while meeting the Phase-2 visual thresholds. **proof:** paired fixed-route browser WebGPU and desktop-native table records internal pixels, reconstruction cost, total GPU/render p50/p95 and visual metrics; no “FPS only” verdict.
- [ ] Automatic resolution can move between at least three scales during one run without history corruption, allocation growth or a reconstruction cost spike larger than the saved raster cost. **proof:** scripted scaler route records scale transitions, history resets, render-target allocation count and per-stage cost; repeated up/down cycles end at the initial allocation baseline.

## Acceptance criteria

The win is **not** “TRAA is enabled.” The win is that a lower internal raster produces a stable
display-resolution image during motion, saves measured frame time, and degrades safely when history
cannot be trusted.

If the qualified reconstruction path does not beat the existing full-resolution path on a
GPU-bound workload after accounting for its own cost, it stays optional/experimental rather than
becoming a default.
