---
prd_contract: v1
---

# PRD-227 — the frame crosses once

**Status:** IN PROGRESS — P1 accepted; P2 executed and falsified; Phase 4 is implemented in
Bayview. Phase 3 device acceptance, the hosted JSC execution lane, and the web gate remain open.
Filed 2026-08-27 from the measured budget in
[PATH-TO-60FPS](../verification/PATH-TO-60FPS-2026-08-27.md). This is the implementation PRD that
PRD-226's ablation ladder was built to justify. PRD-226 stays live and owns the instrument; this one
owns the fix.

**Goal: Bayview at 60 fps or better in the native host on a physical Pixel 8.** 30 fps is not a
pass. The panel is 120 Hz, so the whole frame must fit in **16.67 ms**; it costs **43–48 ms** today.

**Complexity:** +2 for a per-frame protocol between JavaScript and C++, +1 for the object-model
change across three engines, +1 for the device acceptance lane = **HIGH mode**.

## The problem, measured

The host crosses the JavaScript↔C++ seam **5,713 times per frame** with **15,005 marshalled
arguments**. The cost of the seam itself is **22.3 ms of the Pixel 8's 37.7 ms frame**:

| Term | ms/frame (device) | Fate |
| --- | ---: | --- |
| actual JavaScript running three.js | 10.1 | stays |
| V8 machinery (22.9 V8 total − 10.1 JS) | 12.8 | **removed** |
| `libmystral` bridge dispatch + backend | 8.1 | **mostly removed** |
| `libc`/scudo allocator churn | 4.3 | **mostly removed** |
| Mali driver | 2.3 | stays |
| **total** | **37.7** | F13 states 37.2 |

Chrome runs the same scene at **59.99 fps on the same phone** with the same three.js. The JavaScript
is not the problem; the seam around it is.

## Solution (decision recorded here)

**Two changes that land together.** Neither works alone, and both have already been tried in partial
form and measured ~zero — which is what the model predicts and why this PRD refuses to ship half.

### Change 1 — the frame crosses once, not 5,713 times

Three.js records the frame's WebGPU command stream in JavaScript; C++ replays and submits it in a
single crossing. **The op stream already exists** behind `TN_WEBGPU_BATCHED_PASS`, but covers only
the render-pass encoder subset and is default OFF. It must cover **every per-frame command**,
`queue.writeBuffer` included — 428 calls/frame, the highest-frequency single crossing.

Removes: per-crossing dispatch in `libmystral`, the API-scaffolding half of the V8 machinery
(`LookupIterator`/`Object::Get`, `GlobalHandles::Create`, `Isolate`/`Context` re-entry,
`Value::IsExternal`), and the `bridgeOverheadNs` marshalling term.

### Change 2 — wrapper objects get fixed shapes

Every WebGPU wrapper is a property bag assembled from C++ with `Reflect.set`, read back by name
through `Object::Get`, with a `v8::Persistent` per crossed callback argument. Replace with
`ObjectTemplate` + internal fields; borrow callback arguments for the duration of the native call.
Callback results still receive an owned handle when they cross back into JavaScript.

Removes: the megamorphic stub cache and name-dictionary lookups — **3.9 ms/frame on device** — that
three.js pays because we hand it a new object shape every frame and its inline caches go
megamorphic, plus most of the 4.3 ms of scudo churn.

### Pre-registered arithmetic, per PRD-226's binding rule

Published here **before implementation**, with call counts from `TN_BRIDGE_BY_NAME` on the measured
scene:

| Change | Predicted device saving | Threshold |
| --- | ---: | --- |
| Change 1 | **13.4 ms/frame** | ≥2 ms ✓ |
| Change 2 | **8.9 ms/frame** | ≥2 ms ✓ |
| Together | 22.3 ms of 37.7 → **15.4 ms ⇒ 65 fps** | ≥60 fps |

**Margin is 1.3 ms. Sixty fps is achievable, not comfortable.**

Rejected alternatives, on the record: a sixth micro-lever of any kind (PRD-226's graveyard has five,
all measured flat); a backend change (A1 and A2 closed it by two independent routes — the backend is
8.5% of the frame); more `simpleperf` symbol work (three readings of one profile gave three
different owners).

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Op stream covering every per-frame command | runtime WebGPU bindings, all games | 5,713 per-call crossings | disable the stream → `bridgeNs` returns to ~9 ms in the profiled lane; conformance replay test fails |
| 2 | `queue.writeBuffer` recorded into the stream | uniform/attribute upload path | 428 direct crossings/frame | staging + stream both off → upload probe red |
| 3 | `ObjectTemplate` + internal fields for WebGPU wrappers | every wrapper handed to three.js | `Reflect.set` property bags read by name | shape-identity test: two wrappers of one class must share a hidden class; revert → red |
| 4 | No `v8::Persistent` per crossed callback argument | native callback inputs | per-argument Persistent + weak ref | handle-lifetime test fails on premature collection |

## Execution Phases

### Phase 1 — Change 1, and the cheapest chance to be wrong

**Falsification gate P1. Run this before any of Phase 2 exists.**

- [x] Op stream extended to every per-frame command, `queue.writeBuffer` included; recorded in JS,
      replayed and submitted from C++ in one crossing per frame.
- [x] Desktop profiled lane (Xvfb, **not `:0`** — voided at `d42d1a3d`), same-session control pair,
      F15 warm-up rule, load stamped, binaries sha256'd.
- [x] **Prediction, pre-registered:** `bridgeNs` collapses **9.15 → under 1.5 ms**; `work` falls
      **23.9 → ≤17 ms**.
- [x] **Falsification evaluated and not triggered:** `bridgeNs` and `work` both crossed their
      thresholds. If `bridgeNs` had collapsed but `work` had not, the seam's cost would be
      somewhere other than where this PRD puts it, and Change 2's premise dies with it. **Stop and
      re-derive; do not proceed to Phase 2.**
- [x] Red-green with its mutation named: the executable's disabled-stream control fails, and
      disabling the stream at its request-device entry point returns `bridgeNs` to the direct-call
      control; paste both.

### Phase 2 — Change 2, fixed-shape wrappers

- [x] `ObjectTemplate` + internal fields per WebGPU class; native handles resolved from internal
      fields, never by name lookup.
- [x] No `v8::Persistent` per crossed callback argument; arguments are borrowed for the native
      call and wrapper lifetime is re-derived from the receiver.
- [ ] Cross-engine: QuickJS and JSC lanes **exercised, not compile-checked**. Name the lane that ran;
      "compiled only" is not verification. An engine without the capability keeps the legacy path
      behind an explicit gate.
- [x] **Falsification gate P2 executed — FAIL:** fresh symbolized `simpleperf` measured
      megamorphic stub cache + name dictionary at **11.84%**, not under 3%. Source-resolved V8 IC
      logging names Three.js's node-material shader graph, not native wrapper shapes, as the
      dominant steady-state population.

### Phase 3 — device acceptance

- [ ] Cool, **discharging** Pixel 8 (`doctor --device` first; charger waiver recorded or absent),
      fresh install, cold launch, live windows only (`update.mean ≥ 3 ms`), window 1 discarded,
      three captures.
- [ ] **Every fps claim cross-checked against SurfaceFlinger** on the game's exact `(BLAST)` layer:
      `dumpsys SurfaceFlinger --latency` when it emits presentation rows, otherwise the current
      AOSP `--timestats -clear/-enable/-dump/-disable` path with its `averageFPS` and
      `present2present` histogram. `dumpsys gfxinfo` is **not** a valid meter here — it reports the
      Skia view pipeline and reads ~5× flattering.
- [ ] Web does not regress: `pnpm visuals` clean, desktop Chrome `render.p50` unchanged.

### Phase 4 — the named fallback, if the margin does not hold

Stated now so it is not invented under pressure. The model leaves **1.3 ms** of headroom. If the
residual terms land worse than modelled, the next lever is **the game's own draw-call and material
count** — Bayview issues 418 indexed draws and 661 bind-group sets per frame — **not more seam work.**
That is a Bayview change, not a framework change, and it belongs in the game.

## Verification

Record `docs/verification/prd-227-<phase>-<date>.md`, one file per run session.

1. P1's before/after with `bridgeNs`, `bridgeOverheadNs`, `commandNs` and `work` per frame, from the
   same-session control pair.
2. P2's symbolized profile, before and after, with the stub-cache and dictionary shares named.
3. Phase 3's device captures with serial, temperature at both ends, battery level, charger state,
   fresh-install flag, **and the SurfaceFlinger present-interval distribution beside our own fps**.
4. Every arm's binary sha256 and the machine load it ran under. Arms run under load are labelled or
   discarded, never silently kept.
5. Anything not run is named as not run. "Unverified" is an acceptable answer.

## Acceptance Criteria

- [ ] **Bayview ≥ 60 fps median on a cool, discharging physical Pixel 8**, three captures,
      SurfaceFlinger-confirmed. This is the bar; 30 fps is a milestone to report, never a pass.
- [x] The frame issues **one crossing per frame** for command submission, asserted by an executable.
      (Mutation: disable the stream drain → the executable rejects the direct-call control.)
- [x] Two wrappers of the same WebGPU class share one hidden class, asserted by an executable.
      (Mutation: revert to `Reflect.set` assembly → shape-identity test fails.)
- [x] Both changes are independently revertible, each with a negative control that fails on revert.
- [x] No ablation or measurement flag ships: `scripts/__tests__/ablation-flags-never-ship.spec.ts`
      green.
- [ ] Cross-engine coverage is **named**, not implied.
- [ ] Web unchanged: `pnpm visuals` clean.
