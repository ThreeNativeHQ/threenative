---
prd_contract: v1
---

# PRD-226 — the native frame budget is attributed by ablation, then closed

**Status:** PROPOSED — filed 2026-08-27 after PRD-224's measurement refuted the fifth consecutive
lever. Supersedes the lever queue in [the PRD-222 fix plan](../verification/prd-222-fix-plan.md);
does not supersede PRD-222, which owns the target.

**Goal:** Bayview reaches the **30 fps floor** on a cool physical Pixel 8, then **58 fps**. Standing
owner goal is 60 — the maximum the platform gives, and Chrome already gets it on the same phone.

**Complexity:** +2 for new build-flag surface across the backend seam, +1 for a harness that must be
provably self-consistent, +1 for a device lane on every claim = **HIGH mode**.

## Why the previous five levers failed, and why this PRD is shaped differently

| Lever | Predicted | Delivered | Why the prediction was wrong |
| --- | --- | --- | --- |
| A — render-pass wrapper pool | fewer megamorphic ICs | flat, removed | targeted 0.647 ms of a 22 ms frame |
| C — projection/upload tuning | ≥2 ms | −0.31 ms | inside the meter's spread |
| F10 — swapchain frame latency 3 | device fps | flat on device | desktop-only effect |
| F12 — batched pass encoding | crossings own the frame | +5% | per-crossing tax is ~1 µs; crossings were ~2 ms of 40 |
| F14 / PRD-224 — per-call binding install | ≥2 ms | **0.02 ms** | ~6 calls/frame × 70 µs ≈ 0.3 ms |

Every one of them was inferred from a **sampling profile** and none of them was **priced against the
scene's actual call counts before it was built**. Three separate profile readings (F8, F12, F13) each
named a different owner, and each was overturned by the next measurement. The method is the defect.

**The frame is 22–24 ms on desktop and 33.6 ms on the phone against Chrome's 7.6 ms and 5.8 ms, on
the same machines, running the same three.js over the same scene on the same GPU.** After five
levers, **none of that excess is attributed**. This PRD refuses to propose a sixth lever. It builds
an instrument that decomposes the frame by **construction rather than by sampling**, publishes the
budget, and only then spends implementation effort — on the term the budget names.

## Solution (decision recorded here)

**An ablation ladder.** Each arm removes one layer from the real frame and measures what is left.
Terms obtained by subtraction must sum back to the control, and one term is obtained twice by
independent routes, so a mis-wired arm reports itself instead of producing a plausible wrong answer.

| Arm | What it is | Term it yields |
| --- | --- | --- |
| **A0** control | HEAD, unchanged | `T0` |
| **A1** backend swap | the same scene on **Dawn** instead of wgpu-native | Rust-backend delta — Chrome *is* Dawn, and this has never been A/B'd although both build directories already exist (`build/tn-linux` is Dawn, `build/tn-linux-wgpu` is wgpu-native) |
| **A2** null backend | every backend call returns immediately **after** argument parsing | `T0 − A2` = backend + driver |
| **A3** null bridge | binding entry points return immediately, no wrapper objects, no handles | `A2 − A3` = bridge; `A3` = JS execution |
| **A4** no JS | one recorded frame's command stream replayed from C++, zero JS per frame (`TN_WEBGPU_BATCHED_PASS` already records the op stream) | backend + driver, **independently** |
| **A5** Chrome | the same scene, same machine | the target |

**Self-consistency gate:** `A3 + (A2−A3) + (T0−A2)` must equal `T0` within **15%**, and `A4` must
agree with `T0 − A2` within **20%**. If either fails, the ladder is wrong and **no optimisation may
land** — the harness gets fixed first. This is what makes the result an attribution rather than a
fourth opinion.

**Pre-registration rule, binding on every lever this PRD or any successor proposes.** Before a line
is written, the proposal states in the verification record:

```
predicted ms/frame = (calls per frame on the measured scene) × (measured ns/call − Chrome ns/call)
```

with the call count taken from `TN_BRIDGE_BY_NAME` on the scene being optimised, not assumed. A
lever predicting **< 2 ms/frame is refused**. Applied retroactively this rule refuses Lever A,
Lever C, F10 and PRD-224 Phase 3 before any of them costs a night.

Rejected alternative, on the record: another round of `simpleperf` symbol work. Three readings of the
same profile produced three different owners; more resolution on the same instrument is not the
missing thing.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Ablation build flags (`TN_ABLATE_BACKEND`, `TN_ABLATE_BRIDGE`) | ablation harness only; default OFF in every shipped build | ad-hoc source mutations rebuilt by hand per A/B | packaging test asserts no shipped preset defines them; a build with either flag ON fails the release gate |
| 2 | `scripts/ablation-ladder.mjs` — runs the arms, parses, applies the sum gate | this PRD's verification record | hand-parsed one-off logs per lever | feed it a deliberately mis-wired arm → sum gate fails, exit 1 |
| 3 | The published frame budget | every future performance PRD | five levers' worth of inference | any lever whose pre-registered arithmetic predicts <2 ms/frame is refused at review |

## Execution Phases

### Phase 0 — the harness, proven able to fail

**Files (3):** `packages/runtime-native/src/webgpu/bindings.cpp` (flag guards),
`packages/runtime-native/CMakeLists.txt`, `scripts/ablation-ladder.mjs` (NEW).

- [ ] `TN_ABLATE_BACKEND` and `TN_ABLATE_BRIDGE` compile-time flags, both default OFF, both
      asserted absent from every shipped preset by an executable.
- [ ] `scripts/ablation-ladder.mjs` runs an arm N times, parses `TN_ANDROID_JS_NATIVE` with the
      recorded protocol (dedupe by `(frame,bindingNs,calls,threadCpuNs)`; ≥3 markers and >100
      indexed draws per frame; `work = threadCpu − present`; median of the last three quarters),
      and applies the 15%/20% gates.
- [ ] **Red-green with its mutation named:** point the ladder at an arm whose null-backend flag is
      compiled out, so `A2` returns the control's cost. The sum gate must report the inconsistency
      and exit 1. Paste the red, then the green. A harness that cannot fail proves nothing.
- [ ] Quiet-machine rule written into the runner: it refuses to record while 1-minute load exceeds
      a stated threshold, and stamps `sha256` of the binary it ran. Both PRD-224 lanes were
      polluted by unrelated load on 2026-08-27.

### Phase 1 — publish the budget (this is the gate)

- [ ] All six arms measured on desktop, three runs each, interleaved, on one quiet machine.
- [ ] Sum gate green, both routes to backend+driver agreeing.
- [ ] The budget published as a table in the verification record: JS, bridge, backend, driver,
      each in ms/frame, each with its run spread, against Chrome's total.
- [ ] **Stop rule: no implementation commit lands under this PRD until this table exists.** If the
      gates cannot be made green, that failure is the deliverable and the PRD stops here.

### Phase 2 — confirm the top term on the phone

Desktop and device render.p50 track each other in total (22.2 ms against 22.9 ms), but no term of
the budget has ever been shown to track. One arm proves it before a night is spent on the wrong
platform's bottleneck.

- [ ] The top term's arm, and the control, built as profiled arm64 APKs and captured on a cool,
      **discharging** Pixel 8 (`doctor --device` first; charger waiver recorded or absent).
- [ ] Paired, back-to-back, live windows only (`update.mean ≥ 3 ms`), window 1 discarded.
- [ ] If the top term does not dominate on device, the device's own ladder is run before any fix.

### Phase 3 — close the top term

- [ ] Pre-registered arithmetic published **before** implementation, per the rule above.
- [ ] One commit, independently revertible, with a negative control that fails when it is reverted.
- [ ] Desktop ladder re-run: the term must fall by at least the predicted amount, and the other
      terms must not rise to absorb it.
- [ ] Device pair re-run. **Only the device may make an fps claim.**

### Phase 4 — loop, with an exit

- [ ] Repeat Phases 2–3 on the next term until Bayview clears 30 fps on device.
- [ ] **Exit condition:** three consecutive terms closed for less than 2 ms of total device movement
      means the budget is wrong, not the levers. Return to Phase 1 and re-derive it; do not
      continue.

### Phase 5 — the architectural options, named now so they are not invented under pressure

Gated on Phase 1's budget; whichever the budget names, and none of them otherwise.

- [ ] **If JS execution owns it** — the embedded V8 runs the same three.js the same machine's Chrome
      runs. Then the lever is V8's build configuration (tiering, builtins, pointer compression,
      snapshot), not the bindings, and the first experiment is a pure-JS three.js-shaped benchmark
      in the host against Chrome on the same machine. Note that this PRD's own control already
      shows a plain property read is *faster* in the host than in Chrome, so this outcome would
      mean the gap is in compiled-code quality, not in the interpreter.
- [ ] **If the bridge owns it** — stop crossing per WebGPU call. Three.js records the frame's
      command stream once and C++ submits it; the op stream already exists behind
      `TN_WEBGPU_BATCHED_PASS`. F12 measured this at +5% for the encoder subset alone, so it is only
      justified if the budget shows the bridge term is large across *all* classes.
- [ ] **If the backend owns it** — A1 already answers this. Chrome is Dawn; if Dawn is materially
      faster on the same scene, the Android backend choice is the defect and the work is a
      wgpu-native fix upstream or a backend swap on Android, not more binding work.

## Verification

Record `docs/verification/prd-226-frame-budget-<date>.md`, one file per run session, naming what
executed and what did not.

1. Phase 0's harness red (mis-wired arm → sum gate exit 1) and green, both pasted.
2. The budget table, every arm's three run medians shown individually, never averaged across runs.
3. Binary `sha256` and load average stamped for every arm; arms measured under load are labelled or
   discarded, not silently kept.
4. Device captures name serial, temperature at start and end, battery level, charger state, and
   whether the install was fresh or an upgrade.
5. Any arm that could not be built or run is named as not run. "Unverified" is an acceptable answer.

## Acceptance Criteria

- [ ] The ablation harness fails on a mis-wired arm. (Mutation: compile out `TN_ABLATE_BACKEND` in
      the A2 arm → sum gate reports the inconsistency, exit 1.)
- [ ] A published frame budget whose terms sum to the control within 15%, with backend+driver
      derived twice by independent routes agreeing within 20%.
- [ ] No optimisation commit under this PRD predates that budget.
- [ ] Every lever carries pre-registered `calls/frame × Δns/call` arithmetic predicting ≥2 ms/frame,
      published before implementation.
- [ ] **Bayview ≥ 30 fps median on a cool, discharging physical Pixel 8**, live windows only, three
      captures, paired against the arm it replaces.
- [ ] Then **≥ 58 fps** on the same lane, or an explicit written statement of the remaining term and
      why it is not closable — the floor is the acceptance bar, the target is the goal.
- [ ] Web does not regress: `pnpm visuals` clean and desktop Chrome render.p50 unchanged.
- [ ] Ablation flags are absent from every shipped preset, asserted by an executable.
