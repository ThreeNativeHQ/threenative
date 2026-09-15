---
prd_contract: v1
---

# PRD-389 — the frame budget's instruments do not lie

## TL;DR

`FrameBudget`'s `gpuMs` reported a single instantaneous `info.render.timestamp` read. That field is
one resolved frame of three's timestamp batch, so the value lagged the presented frame by **up to 8
frames (`gpuAgeFrames` 8)** with a **3.5× spread** between consecutive reads. It reported GPU cost as
**2.98–10.40 ms** when per-frame attribution showed the real figure was **~17.6 ms** (main 11.9,
reflection 4.1, shadow 0.7, at 1920×1080 with 4× MSAA). A multi-hour optimisation campaign concluded
"GPU is not the budget, CPU is" partly on that number and chased the wrong term.

The reading was not wrong about the GPU being idle at that instant. It was wrong to present **one
lagged sample as the frame's cost**. The fix is already implemented on `feat/engine-consolidated`
(`c1e48edd1`); this PRD scopes the **general principle** so it does not silently return in another
instrument: every number the budget reports is a series with its staleness declared, absence is
reported as unavailable and never as zero, and a per-pass split is offered where the renderer can
attribute one.

**Status:** NOT STARTED as a general rule — `c1e48edd1` is prior art for `gpuMs` only and is not on
`develop`.
**Date:** 2026-09-15.
**Scope:** `FrameBudget` and the renderer's GPU-timestamp sampling in `@threenative/core`. No new
timer, no new dashboard, no change to what a game writes.
**Complexity:** MEDIUM — the sampling fix exists; the work is to generalize the contract and prove it
on a real frame.
**Charter:** [`docs/architecture/CHARTER.md`](../../../architecture/CHARTER.md) binds and outranks this
document. No IR, scene format, editor, preset/genre system, code-first ECS or bespoke CLI vocabulary
is introduced. Vocabulary is borrowed from Three.js and WebGPU before inventing.

## Closure Gates

| Gate | Evidence required | Reachable here |
| --- | --- | --- |
| A reported number is a series | The budget exposes a distribution (mean/p50/p95/p99/max/samples), not one sample, for each GPU term it reports; a test reads the series and fails if it collapses to a single value. | Yes — browser WebGPU. |
| Staleness is declared | `gpuAgeFrames` and a stale count are reported with the series; a frame with no fresh reading is counted as stale, not silently repeated. | Yes — browser. |
| Absence is unavailable, never zero | An unavailable channel reports `undefined`/`unavailable` and a test asserts it is not `0`. | Yes — unit test plus browser. |
| A per-pass split where attributable | The renderer offers main/reflection/shadow GPU attribution where three's queries allow it, or reports that it cannot and why. | Yes — browser; the obstacle is named below. |
| Native parity | The same series and staleness contract on the owned native host. | Partly — host present, GPU timestamp path not proven here. |
| Android/iOS | Per-platform evidence. | **No** — no mobile hardware; gates stay open and named. |

## 1. Problem and repository grounding

### The shipping defect, at `d32eb643a`

| Existing surface | What is wrong, or what this PRD must preserve |
| --- | --- |
| [`frame-budget.ts:202`](../../../../packages/core/src/frame-budget.ts) `readGpuMs?: () => number \| undefined`, stored at `:297`, called at `:455` | The window reads **one** instantaneous number from the renderer. That number is a lagged sample of the batch. |
| [`frame-budget.ts:176`](../../../../packages/core/src/frame-budget.ts) `gpuAgeFrames` and `:456` its read | The engine already knows the reading can be stale and reports an age — but still presents the single sample as `gpuMs`; the age is a warning beside a number that is used as if current. |
| [`frame-budget.ts:461-481`](../../../../packages/core/src/frame-budget.ts) | Validation exists; there is no "unavailable" distinction beyond `undefined`, and no series. |
| [`renderer.ts`](../../../../packages/core/src/renderer.ts) `resolveGpuFrame` / timestamp resolution, and [`game.ts:1247`](../../../../packages/core/src/game.ts) the per-frame resolve added for pool exhaustion | Timestamps are resolved per frame now for a different reason (three's 2048-query pool fills at ~38 frames with tens of passes). The sampling contract must coexist with that. |

### Prior art: `feat/engine-consolidated` `c1e48edd1`

Not on `develop` (verified). It replaces the single sample with a per-frame series:

- `frame-budget.ts`: `addGpuMs(ms, frame?)` at `:459`, deduped by resolved frame; `gpuStale` at `:209`;
  `gpuAgeFrames` at `:218`; the `gpu` distribution with mean/p50/p95/p99/max/samples; `gpuMs` becomes
  the mean for the scaler/perf.
- `renderer.ts`: `gpuFrameSample()` at `:187`, built at `:354` from `info.frame`,
  `info.render.timestamp` and `backend.getTimestampFrames("render")`; `resolveGpuFrame()` at `:392`.
- `game.ts` feeds it on every world-render frame; the `readGpuMs` option is removed.

Cite it as prior art. This PRD does not re-do it; it generalizes the rule and makes the shipping tree
carry it.

### The named obstacle to a per-pass split

Three's timestamp pool keys each duration as
`'r:' + renderer.info.render.frameCalls + ':' + abstractRenderContext.id + ':f' + frame`
(installed `three@0.185.1` `src/renderers/common/Backend.js:487-491`). The pool's
`this.timestamps` is a `Map` created at `src/renderers/common/TimestampQueryPool.js:86`, read at `:109`
and `:131`, and **never cleared or deleted**. A naive per-pass join over that Map is O(runtime). Any
per-pass split must bound the join (e.g. only the frames in the reported window) or say it cannot
attribute. This is a measured obstacle, not a guess; state it in the report.

## 2. Outcomes and non-goals

**Required:** the general contract — every reported number is a series with staleness declared; absence
is unavailable and never zero; a per-pass split is offered where the renderer can attribute one, and
its absence is reported as unavailable. `gpuMs` is one instance of the contract, not the whole of it.

**Not required for v1:** a second GPU timer alongside three's queries; modifying three's non-clearing
Map; a new dashboard; estimating GPU time from wall-clock algebra. The point is to stop one lagged
sample from being presented as a frame's cost.

## 3. Mechanism contract

- Every `FrameBudget` GPU/CPU term that can be sampled is a distribution, with sample count.
- Staleness is explicit: a term reports how old its newest reading is and how many frames had no
  fresh reading; a stale reading is never silently propagated as current.
- Unavailable is distinct from zero in the type and in the report; a test fails if unavailable becomes
  `0`.
- A per-pass split uses three's existing queries, bounded to the reported window, and reports
  `unavailable` with a reason when it cannot.
- No option is required: the ordinary case gets the series; the scaler/perf consumer gets the mean.

## 4. Execution phases

### Phase 0 — reproduce the lie

- [ ] A paired capture shows consecutive `gpuMs` reads spread ~3.5× and lagging up to 8 frames, and per-frame attribution showing the real ~17.6 ms.
- [ ] The per-pass attribution path and three's non-clearing Map are documented at real lines.

### Phase 1 — series and staleness

- [ ] A reported GPU term is a series (mean/p50/p95/p99/max/samples) with `gpuAgeFrames` and a stale count.
- [ ] Absence is typed and reported as unavailable; a test asserts it is never `0`.
- [ ] The scaler/perf consumer reads the mean, not a single sample.

### Phase 2 — per-pass split, bounded

- [ ] Main/reflection/shadow attribution is offered where three's queries allow it, bounded to the reported window.
- [ ] Where it cannot attribute, it reports `unavailable` with the reason (including the non-clearing Map).

### Phase 3 — native proof and general contract

- [ ] The series/staleness contract runs on desktop native through the real entry point.
- [ ] The general rule is applied to every reported budget number, not only `gpuMs`, and a test prevents a regression to a single sample.

**Verification:** browser WebGPU with a named adapter; compare a series-based report against per-frame
attribution (the ~17.6 ms figure); assert staleness and unavailable-not-zero in focused unit tests.
Native via `pnpm native:verify:desktop`. Report actual runs or "unverified".

## 5. Completion boundary and references

Complete only when the shipping tree reports series with declared staleness and
unavailable-not-zero, with revision-linked evidence, and the general rule is enforced by a test so it
does not return in the next instrument. Merging `c1e48edd1` alone satisfies the `gpuMs` instance, not
this PRD.

This PR changes this PRD and the [critical README](README.md) only.
