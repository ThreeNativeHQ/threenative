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

### Phase 4 — the 2026-10-03 Machinefall probe's gaps

A tick-counted probe on Machinefall read four instruments that could not all be true at once: one
window at boot and nothing after it, `phases.update` at 0 ms, `passes.main.triangles` at 338 M for
402 k triangles actually drawn, and ~15 GPU timestamps in a 300-frame window. Each box below is the
root cause found in the shipping tree and the red-green spec that pins it. They stay **unticked**:
a unit spec is not the probe, and the fixed-step run has not been re-measured on the game.

- [x] `advance()` charges a counted tick batch to the current window's `update` and `substeps` through `FrameBudget.addSimulation(ms, ticks)` rather than opening a metered frame around it: a batch presents nothing, so it never counts as a frame, never enters the `frame`/`render`/`hostGap`/`presented`/`gpu` summaries, never counts as a hitch however long it blocked, and never moves the presented-frame interval clock, while a fixed-step run still reports a non-zero `update` and real `substeps`. Windows therefore still close every `reportEvery` **presented** frames, as they did before `14bdef1ee`. proof: `packages/core/__tests__/loop.spec.ts` "charges a counted tick batch to update and substeps without counting it as a frame" and "does not dilute the render percentiles of presented frames with counted batches", red after `14bdef1ee` — which put 150 zero-render frames into half of every window's frame and render series and closed a 300-frame window on 300 *metered* frames, hence ~20 GPU timestamp samples instead of ~37 — green after this phase's change. **Game proof 2026-10-03:** Machinefall map-walk, RTX 2080 WebGPU, core `f6134b3cf`: `phases.update` p95 0.7–1.3 ms and substeps 1–2.8 per walking window (develop `9cf955355`: 0 / 0 in all nine windows).
- [x] The batch's cost reaches `update` exactly once, including when the frozen prime advances inside a live frame rather than opening a second one. proof: `packages/core/__tests__/loop.spec.ts` "charges a counted batch once when a frozen prime advances inside a live frame", red before `14bdef1ee`, green after. **Game proof 2026-10-03:** same run; update is non-zero only while ticks run and never doubles (p95 ≤ 1.3 ms against a 16.7 ms tick budget).
- [x] The window's main pass carries the GPU-selected triangles beside three's CPU capacity figure, and `threenative-playtest perf` prints the GPU one, naming the CPU one as the ceiling. proof: `packages/core/__tests__/render-pass-budget.spec.ts` "reports the GPU-selected main-pass triangles beside the CPU capacity figure" and `packages/playtest/__tests__/perf.spec.ts` "prints the GPU-selected main-pass triangle count and names the CPU capacity figure", red before `de745df4c`, green after. **Game proof 2026-10-03:** same run prints `main pass triangles: 8,729,208 GPU-selected, 148,258,300 CPU capacity` (develop printed only the 148 M capacity figure).
- [x] The 1-in-N GPU timestamp sampler counts the frames the engine draws, so 40 frames track 5 and the resolved frame id advances with them. proof: `packages/core/__tests__/gpu-timestamp-resolve-cadence.spec.ts` "tracks one frame in eight and reads a strictly advancing sample without three's animation loop", red before `c18b00687`, green after. **Open, root cause found, unproved on the game:** `c18b00687` fixed the clock the stride counts, and the sampler does sample, but the window's sample count is not the sampled frame count. Three answers a resolve with **one** number — the summed duration of the *last* frame in the batch (`three.webgpu.js:83746`) — and writes every other frame that batch measured into the pool's per-pass `timestamps` map, which nothing read. `packages/core/src/game.ts` fed the budget that single number through `renderer.gpuFrameSample()`, so a resolve that caught up on k sampled frames reported one of them and the other k−1 were gone for good: the pool is emptied before the resolve is submitted (`three.webgpu.js:83668-83676`), so the next batch starts from nothing. The engine also asks for the resolve on the same 1-in-8 stride it samples on, and three skips a resolve while one is still in flight (`three.webgpu.js:83625-83642`) — the stride is a frame count where the round trip is not, which is why the count *fell* as the frame rate rose: 28 samples in a 300-frame window at a slow frame rate, 1–2 in the ~200 fps ones, against the ~38 the sampler recorded. `RenderPassBudget.nextGpuFrame()` now walks the per-frame uid lists the recorder already keeps and hands out one resolved frame per presented frame, so a batch's frames are all reported; red on `eeb315180` at 18 of 38 samples per window with a 12-frame round trip, green after, at both 60 and 240 fps. proof: `packages/core/__tests__/gpu-timestamp-resolve-cadence.spec.ts` "reports a sample per sampled frame at 200 fps, where the resolve round trip outlives the stride" and "reports the same count at 60 fps, where the round trip is three times as long in wall time", plus `packages/core/__tests__/render-pass-budget.spec.ts` "attributes resolved per-pass GPU time to main and shadow, not the parent", red on `eeb315180`, green after. Unticked because no fixed-step run on the game has shown a window near `reportEvery / 8`. **Game proof 2026-10-03:** same run reports 36–44 GPU samples per 300-frame walking window (expected 300/8 ≈ 37.5); develop reported 3–30 and `eeb315180` 1–28, fewest at ~200 fps.

Standing scene under fixed step: root cause is the runner, not the meter — `packages/playtest/src/runner/steps.ts` turns `waitTicks` and, under `runtime.fixedStep`, `waitFrames` into 10-tick `advance()` batches, so a standing wait presents almost no frames; a browser wall-clock run (`__THREENATIVE_PLAYTEST_CLOCK__`) failed with `fixedStep advanced 3 actual ticks; expected 1`. Open.

**Still owed to this phase:** a real tick-counted run of Machinefall (or a template) with a named
WebGPU adapter, showing a window per 300 counted steps, a non-zero `update`, a `gpuTriangles` near the
drawn triangle count, and a GPU series with samples near `reportEvery / 8` rather than 15.

## 5. Completion boundary and references

Complete only when the shipping tree reports series with declared staleness and
unavailable-not-zero, with revision-linked evidence, and the general rule is enforced by a test so it
does not return in the next instrument. Merging `c1e48edd1` alone satisfies the `gpuMs` instance, not
this PRD.

This PR changes this PRD and the [critical README](README.md) only.
