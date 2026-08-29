# PRD-241 closure audit — game-owned tween easing, 2026-08-29

Closes `docs/PRDs/done/PRD-241-a-sequence-is-one-cancellable-object.md`, archived by this run out of
`docs/PRDs/feature-mining/`. The feature itself landed earlier in `affb48e8` (`feat(core): allow game-owned tween easing`) with its boxes
never audited; this run executed every negative control the PRD names and states what each did.

**Tree:** `main`, clean at start. **Node** v20.19.6, **vitest** 4.1.10, node environment.

## What was already implemented, verified in live source

| PRD requirement | Where | Verified |
| --- | --- | --- |
| `ease?: (t) => number` on `Scheduler.tween` | `packages/core/src/schedule.ts:8,57,91` | yes |
| Forwarded through `ctx.tween` | `packages/core/src/game.ts:775-776` | yes |
| Public type exported | `packages/core/src/index.ts:341`, `scene.ts:10,83` | yes |
| Curve lives in a template's `src/render/` | `templates/starter/src/render/easing.ts` | yes |
| A shipped template uses it visibly | `templates/starter/src/scenes/Play.ts:148` — the pickup rises on `pickupRiseEase` | yes |
| Capability doc tag + example | `capabilities.json:638,640` | yes |
| No easing menu in `packages/` | `grep -rniE "easeIn\|easeOut\|easeInOut\|elastic\|cubicBezier\|EASINGS\|easings\b" packages/*/src/` → no matches | yes |

## Negative controls — executed, not inferred

Each mutation was applied to live source, run, and reverted. Command:
`npx vitest run packages/core/__tests__/schedule.spec.ts packages/core/__tests__/frame-budget-steady-alloc.spec.ts`

| # | Mutation | Expected | Observed |
| --- | --- | --- | --- |
| 1 | landing frame assigns `start + (end - start) * ease(1)` instead of `end` | red | **RED** — `should reach the exact end value when the curve does not return 1 at t=1`, that test alone (1 failed / 11 passed) |
| 2 | `const easedProgress = progress` — ignore the option | red | **RED** — the midpoint test plus 3 siblings (4 failed / 8 passed) |
| 3 | default becomes `progress * progress` instead of identity | red | **RED** — `should behave identically to a linear tween when no curve is given` + `should resolve tween() exactly once at the end` (2 failed / 10 passed) |
| 4 | wrap the ease callback per tick | red | **GREEN — control does not reproduce.** See below. |

## Control 4 does not reproduce, and the guard is why

`frame-budget-steady-alloc.spec.ts` observed GC events across 1.2M steady frames and asserted the
list was empty. It could not fail:

| Probe | Result |
| --- | --- |
| per-tick closure wrapping (the PRD's own mutation) | green |
| per-tick closure **retained on an escaping sink**, 1.2M frames | green |
| 3M escaping objects, `takeRecords()` read synchronously | 0 events |
| same 3M objects, one `setTimeout(…, 0)` before reading | **42 events** |
| explicit `global.gc()` ×2 under `--expose-gc`, awaited | 2 events |

V8 hands GC entries to a `PerformanceObserver` through the event loop, never at the moment of
collection. The window was fully synchronous and disconnected before yielding, so `events` was `[]`
regardless of what the frame allocated. Every allocation claim resting on this file was unproven.

**With the yield restored the same window reports 22–130 GC events**: the fixed-step frame is not
allocation-free. That is a pre-existing engine defect, larger than PRD-241, and PRD-241 neither
caused it nor owns it.

### One source found and fixed

`FrameBudget.endFrame` built a fresh `IFramePhaseSample` every frame; `FixedStepLoop.stepFrame`
discarded it whenever `collectMetrics` was false — the shipping default. The old docstring claimed
V8 scalar-replaced it, which it cannot: the object escapes across the method boundary and `endFrame`
is far too large to inline.

- Change: `endFrame(nowMs, wantSample = true)`; `loop.ts:202` passes `this.#collectMetrics`. Every
  window meter is still pushed — turning the sample off does not turn measurement off.
- Observed red (loop level): revert the second argument → `expected [ …(240) ] to deeply equal []`,
  one built sample per frame across 240 frames.
- Observed red (unit level): make the sample unconditional → `should build no phase sample when the
  caller will discard it` fails with `expected { hostGap: 1.42, … } to be undefined`.
- Measured effect on the 1.2M-frame window: 80 → 63 GC events.

### The instrument cannot be repaired into a gate

Per-process, 1.2M frames each, `control` = arithmetic-only spin of the same length:

| Arm | GC events |
| --- | --- |
| control spin | 10 |
| stepFrame, no budget | 67 |
| stepFrame, budget, no tween | 123 |
| stepFrame, budget, curved tween | 114 |

Two windows in one process report ~135 for whichever runs **first** and ~70 for whichever runs
**second**, regardless of which configuration each holds (linear-first: 142/72, 137/76, 133/72;
curved-first: 124/62, 133/66). The count reads warm-up order, not allocation. A bar tight enough to
catch a regression flakes on ordering; a bar loose enough to be stable asserts nothing. No bar was
built on it.

`frame-budget-steady-alloc.spec.ts` now pins the properties deterministically instead — curve
evaluated exactly once per tick; `t === 1` delivered exactly once and not used for the landing
assignment; no phase sample built per frame with metrics off — and its docstring states the above in
full rather than leaving a green that means nothing.

## Not changed

`packages/core/src/schedule.ts` is byte-identical to `affb48e8`. One candidate edit — skip
evaluating the curve on the landing frame, whose result is discarded — was written, run, and
**reverted**: PRD-241 requires `t === 1` to be delivered exactly once and `schedule.spec.ts:174`
pins it. The contract outranks the saved call.

## Gates

Recorded in the commit that lands this file.
