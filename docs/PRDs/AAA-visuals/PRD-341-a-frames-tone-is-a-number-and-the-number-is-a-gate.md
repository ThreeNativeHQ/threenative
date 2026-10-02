---
prd_contract: v1
---

# PRD-341 — a frame's tone is a number, and the number is a gate

**Status:** PARTIAL — implementation started 2026-10-02 from `d7277838`; original proposal
filed 2026-09-03, measured at `43d03e6a`. Batch:
[docs/PRDs/AAA-visuals](./README.md). **Land this first** — it is what makes every other PRD in the
batch judgeable, and it is the cheapest thing here. Source studied:
[TheLongSilence](https://github.com/achimala/TheLongSilence) `tools/levels.mjs`, `tools/judgeset.mjs`.

**Goal: "it looks flat" stops being an opinion.** The reference states the rule plainly and this
repository already believes it — *playtest is the eyes, not screenshots* — but the eyes currently
report two numbers where five are needed.

**Complexity:** a histogram over pixels already decoded, a new assertion kind, a CLI report =
**LOW**. An afternoon, if `assert.tone` reuses the existing capture path.

## Implementation phases (2026-10-02)

### Phase 1 — one measurement and a strict contract

- [x] Compute the six display-luminance metrics in the existing PNG decode. proof: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 packages/playtest/__tests__/capture.spec.ts` — 9 passed after two missing-metric failures in the fresh reconstruction.
- [x] Reject empty, malformed and contradictory tone bounds at scenario load. proof: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 packages/playtest/__tests__/tone.spec.ts` — 28 passed after 25 missing-feature failures in the fresh reconstruction.

### Phase 2 — shared capture evidence and CLI

- [x] Evaluate tone bounds against named captures and fail on missing evidence. proof: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 packages/playtest/__tests__/tone.spec.ts` — 28 passed after 25 missing-feature failures in the fresh reconstruction.
- [x] Record `TN_TONE` on browser/device captures and print identical six-number CLI rows plus an average. proof: `node node_modules/vitest/vitest.mjs run --maxWorkers=1 packages/playtest/__tests__/tone.spec.ts packages/playtest/__tests__/tone-runner.spec.ts` — 33 passed; five missing-producer failures observed first.

### Phase 3 — scenario proof and qualification

- [x] Ship a discoverable GPU-lane scenario and document the exact statistic/capture contract. proof: `node --import tsx scripts/check-doc-links.ts` and scenario schema test in `tone.spec.ts` — 52 focused fixture/capture/doc tests passed; isolated production Vite bundle and playtest ESM/declarations built.
- [ ] Run the scenario with normal and two-stops-under exposure on a capture-capable GPU lane. proof: `pnpm test:tone` (also reached by `pnpm test:templates`); retain both measured verdicts and runtime PNGs here. Fresh local attempt built the fixture, then refused before browser launch: no usable X display and Xvfb absent. Maintained hosted integration is pending; unit PNG fixtures are not runtime screenshot proof.

## Implementation decisions

- 2026-10-02: keep the canonical PRD and historical measurements. The current harness uses `assert: { kind: ... }`; implement `assert.tone` as an array of frame-bound requests within that established schema rather than the historical illustrative `assert: "tone"` shape.
- Reuse the existing PNG decode without resampling; no new decoder, render policy, or GPU readback is introduced. A 256-bin display-referred Rec.709 luminance histogram uses rounded byte bins; wholly transparent pixels are excluded, consistently with the capture guard. No visible pixels means no tone observation.

## The problem, measured at `43d03e6a`

### 1. The capture path measures enough to detect a blank frame and nothing more

`packages/playtest/src/capture.ts` computes `visiblePixels`, `maxLuminance`, `brightPixels`, a mean
and a standard deviation, and spends all of it on `CAPTURE_GUARD_LIMITS` — is this frame blank, is
it suspiciously dark. Those are liveness checks. None of them can tell a correctly exposed frame
from one rendered three stops under, because a three-stop-under frame has plenty of variance and
plenty of visible pixels. It just looks wrong.

### 2. Every look PRD in this repository currently ends in an argument

The batch's own history is the evidence: the recorded method for calibrating a render against a
reference is *quantiles plus a one-build ablation*, written down after eyeballing picked the wrong
cause four times. That method exists, it works, and it is not available as an assertion — so it gets
re-hand-rolled per investigation and never becomes a gate.

The reference names the exact shape that ends the argument: **mean, p1, p50, p99, clip%, black%**,
per frame, with an average row. `0.00% of pixels clip and the 99th percentile is 165` is a sentence
someone can act on, and it is what the reference measured immediately before fixing its highlight
range.

### 3. Fail closed, or it measures nothing

The repository's own rule: an empty assertion set is a failure, a missing observation is a failure.
A tone assertion whose capture never happened must go red, not skip — this is the exact shape of the
v1 harness bug that reported green on scenarios asserting nothing.

## What ships

### `packages/playtest` — `assert.tone`

A new assertion kind over a captured frame:

```jsonc
{
  "assert": { "tone": [{
  "atStep": "landed",
  "mean": { "min": 60, "max": 140 },     // 0-255, display-referred, after tonemap
  "p99": { "min": 150 },                 // the frame has highlights
  "p1":  { "max": 40 },                  // and it has shadows
  "clipFraction":  { "max": 0.005 },     // 0.5% of pixels at display white
  "blackFraction": { "max": 0.25 }
  }] }
}
```

Every bound is optional; **an assertion with no bound at all throws at schema validation** rather
than passing vacuously. Percentiles are computed from a 256-bin luminance histogram over the decoded
frame — the reference decodes to a reduced size on the grounds that the statistics are unchanged and
a full-res decode of twenty frames is pointlessly slow, and the same applies here.

### `packages/playtest` — `tone` in the CLI

`node packages/playtest/dist/runner/cli.js tone <png...>` prints the reference's table verbatim in
shape: one row per shot, an average row, no browser needed. This is the tool an agent runs on a
directory of captures without writing a scenario, and it is what makes a set judgeable at once.

### Reporting

`TN_TONE` per captured frame, in the observation record, so a run that captured frames and asserted
nothing still leaves the numbers behind for the next round.

## What does not ship

- No verdict. This measures; it does not decide that a frame is good. Pixel metrics never replace
  semantic image review — the sculpt server's rule holds.
- No colour statistics, no per-channel histograms, no saturation. Luminance only in v1.
- No baseline comparison. `pnpm visuals` / `visuals:ab` already own A/B against a baseline; this
  bounds a frame on its own terms, which is what a scenario with no baseline needs.

## Acceptance criteria

1. **A misexposed frame is red.** The example fixture renders a scene with `toneMappingExposure`
   pinned two stops under; a `tone` assertion bounding `mean` and `p99` fails, and the failure text
   names both the measured and the required value.
   *Red-green:* the mutation **is** the pinned exposure — restore it and the same assertion passes.
   Paste both.
2. **An empty bound set throws.** A `tone` assertion with no bounds fails schema validation with a
   named error before the run starts.
   *Red-green:* soften the schema to allow it; `assertion-schema.spec.ts` goes red.
3. **A missing capture fails, it does not skip.** A `tone` assertion at a step that produced no
   frame reports a failure naming the step.
   *Red-green:* return `undefined` from the evaluator when the capture is absent; the fail-closed
   spec goes red.
4. **The CLI table matches the assertion.** `cli.js tone` on a frame and `assert.tone` on the same
   frame report the same six numbers, to the printed precision.
   *Red-green:* change the histogram bin count in one path only; the cross-check spec goes red.
5. **It works where captures work.** The delete-test lane rule applies — this needs a GPU lane, so
   the scenario lives on `pnpm test:templates`, not on CI's frame-less template runner.

## Out of scope

Baseline diffing, perceptual metrics, and any automatic judgement of composition.


## Reconstruction checkpoint — 2026-10-02

The first executor was replaced before its implementation commit was published. This is new
work from the surviving draft branch, with fresh tests; the lost local commit is not evidence for
this branch. The histogram slice reuses the guard's existing PNG decode. Remaining phase boxes
stay open until their implementation and proofs are rerun.

## Required runtime screenshot proof

The user explicitly requires screenshot proofs for every PR. Actual underexposed/restored WebGPU
runtime captures, adapter provenance and source SHA must be inspected and linked before this PR
leaves draft. Synthetic PNG unit-test inputs and pictures of test output do not satisfy this gate.


Fresh schema/CLI checkpoint: 118 tests passed across six focused files; scoped playtest TypeScript
passed. The shared evaluator now rejects missing/invalid captures and reports measured/bounded
values. Offline CLI parity includes different-sized frames to prove equal per-frame averaging.
Browser/device production of the observation remains the next open slice.


Fresh capture-wiring checkpoint: 52 tests passed across histogram, tone, target-driver and runner
orchestration. Scoped playtest TypeScript passed. All four target paths reuse the guard's decoded
metrics; host observations survive report assembly. The driver tests are not runtime screenshots.


Fresh screenshot-lane checkpoint: the maintained read-only `integration-tone` workflow builds this
commit's public bridge, then uses the same headed WebGPU/canvas-capture approach as native
conformance. The script requires both exposure verdicts, actual PNG files, nonempty adapter
identity and WebGPU provenance; it never accepts a missing capture as proof. Local playtest and
fixture typechecks pass; fixture/capture/primary-doc focused suite: 52 tests passed. Runtime
screenshots must still be produced by the hosted run and inspected before promotion.

Independent review and hosted retry checkpoint: the first hosted run (36986610377) built and
passed 43 tests, then failed before capture because the source-imported runner's serialized
callback referenced a tsx helper. The verifier now uses the built public runner and preserves
attempt/failure diagnostics. Three driver regressions reproduced an earlier `after.png` capture
incorrectly satisfying a final-frame assertion; newest matching final observations now win.
The pixel-proof verifier separately rejects software-device-loss warnings and unrelated errors
even in its expected-underexposed arm. Runtime screenshot qualification remains open until the
corrected hosted run produces inspected evidence; none of these CPU checks substitutes for it.
