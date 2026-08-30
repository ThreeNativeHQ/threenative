# PRD-278 §5 — `toneMappingExposure` through an installed output node, settled

**Date:** 2026-08-30 · **Question owner:** AC7 · **Ran:** `pnpm tsx scripts/exposure-ab.ts`
**Evidence:** `docs/verification/exposure-ab-2026-08-30/` (`low.png`, `high.png`, `report.json`)
**Guard:** `scripts/__tests__/exposure-ab.spec.ts` classifies; `scripts/exposure-ab.ts` re-runs the capture.

## The question

PRD-278 §5: the mined `lumen-hall` `WorldEnvironment` states that once `setOutputNode`
installs a `RenderPipeline`, `renderer.toneMappingExposure` no longer reaches the frame —
"moving it from 0.85 to 1.45 changed nothing at all on screen" — and applies exposure as a
multiply on the scene pass instead. Reading `three@0.185.1` says the scalar is live
(`RenderPipeline.outputColorTransform` defaults to true; `ToneMappingNode`'s default
`exposureNode` is `rendererReference('toneMappingExposure', 'float')`). All seven templates
set the scalar immediately before installing their chain, so one of the two claims teaches
a dead line or buries a live one.

## The capture

The minimal template shape: ACES tone mapping, the scalar set, one lit scene pass installed
through a `RenderPipeline` output node — nothing else. Three captures: exposure 0.85, 1.45,
and 0.85 again as a same-value control. `compareCaptures` from the conformance metrics
judges each pair; the control must diff clean before either verdict is earned.

| pair | pixel mismatch | perceptual ΔE |
| --- | ---: | ---: |
| 0.85 → 1.45 | **1.0** (every pixel) | **5.81** |
| 0.85 → 0.85 (control) | 0 | 0 |

## Verdict

**`toneMappingExposure` reaches the frame.** The mined comment is wrong — the measurement it
cites was confounded by the scene-pass multiply carrying the same value at the same time.
The scalar being dead is not a trap on `three@0.185.1`, and the comment that ships in the
template file says so.

## What ships anyway

Applying exposure as a multiply on the scene pass stays, independently of the scalar: it is
the shutter, so it belongs before the tone curve, and it makes the bloom threshold mean the
same thing at any exposure. What changes is the *reason*: not "the renderer's scalar is
dead", but "the pass multiply is scene-referred, so downstream stages see the exposed
image". A template that sets both the scalar and the multiply to different values gets both
effects — that composition is the game's to choose and the file documents it.

The report's `adapter` field came back empty, so this run does not name its GPU; the verdict
rests on the node graph wiring, which is the same graph on any adapter, and on a control
pair that diffed to exactly zero.
