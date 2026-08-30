---
prd_contract: v1
---

# PRD-275 — every effect runs on desktop, Android and iOS, or it does not ship

**Status:** PROPOSED — filed 2026-08-30, measured at `1eeecf1e`. Depends on
[PRD-271](./PRD-271-batchedmesh-reports-its-whole-batching-transform-as-velocity.md),
[PRD-272](./PRD-272-velocity-is-opt-in-and-nothing-reports-whether-it-was-on.md),
[PRD-273](./PRD-273-the-three-effects-with-no-upstream-node-ship-as-template-source.md),
[PRD-274](./PRD-274-every-export-has-a-named-tested-equivalent.md); gates all four.
**Extends [PRD-270](../lighting/PRD-270-no-lighting-node-ships-web-only.md) rather than repeating
it** — PRD-270 owns the lighting stages, this owns everything else in the coverage table. Batch:
[docs/PRDs/realism-effects](./README.md).

**Goal: the sentence "we support all of it" names four platforms, not one.** An effect proved in
Chrome and nowhere else is, by the root charter, unfinished — and this batch's whole premise is
that a GLSL/`WebGLRenderer` library cannot reach desktop, Android or iOS. Shipping a browser-only
replacement for it would be the same failure with better provenance.

**Complexity:** one conformance scene per effect, the five registrations each needs, and a device
lane run per platform = **MEDIUM**. Mechanical and wide; the failure mode is a row quietly not run.

## The problem, measured at `1eeecf1e`

### 1. The existing seam case proves the socket, not the plug

`packages/runtime-native/conformance/registry.json` holds 81 cases. `62-postprocessing-pass`
(`registry.json:589`, `required: true`) asserts that a TSL output node installs as a
`RenderPipeline` and renders — with a sphere, a torus knot and `MeshBasicMaterial`.

Nothing in it exercises what the effects in this batch actually compile to: multi-target writes for
the velocity output, `Loop` bodies in the denoiser, the history texture ping-pong in
`TemporalReprojectNode`, or the per-sub-draw previous-matrix indexing
[PRD-271](./PRD-271-batchedmesh-reports-its-whole-batching-transform-as-velocity.md) adds. Those
are the constructs that diverge between Dawn on desktop and wgpu-native on Android, and the seam
case sees none of them.

[PRD-270](../lighting/PRD-270-no-lighting-node-ships-web-only.md) makes this argument for the
lighting stages and stops there. `TRAANode`, `TemporalReprojectNode`, velocity provisioning,
`MotionBlur`, `SharpenNode` and the three template effects from
[PRD-273](./PRD-273-the-three-effects-with-no-upstream-node-ship-as-template-source.md) are outside
its scope, and they are most of the surface this batch claims.

### 2. A temporal effect is the one kind a single-frame conformance case cannot judge

Every case in the registry compares one captured frame against a baseline. A temporal stage is
defined by what it does across frames: it accumulates, it reprojects, it rejects history. Its
characteristic native failure is not a wrong first frame — it is a history texture that never
updates, or one whose format silently resolves differently on wgpu-native, producing a first frame
that matches the baseline exactly and a tenth frame that is frozen or diverging.

So a pixel case at frame zero is a green light for the exact defect most likely to occur. The
conformance run for these effects has to compare at a settled frame, and to compare two frames
against each other, not only against a baseline.

### 3. Two traps in this repository's own record would manufacture a false green here

Both are already wrapped, and both bite precisely this kind of run:

- **A WebGPU run that does not name its adapter may be SwiftShader.** A browser lane that silently
  fell back to a software adapter reports plausible pixels and proves nothing about a GPU path.
  `--browser-recipe webgpu` and an `adapter.info` check are mandatory on the browser row.
- **A device run measures the phone around itself.** An Android lane run hot reports throttled
  frames that read as a performance regression in an effect that is fine. `deviceMetrics`
  assertions — `notThermallyConfounded` — belong on every device row, or the row's numbers are not
  admissible.

## What ships

A conformance and playtest matrix covering every row of
[PRD-274](./PRD-274-every-export-has-a-named-tested-equivalent.md)'s coverage table that PRD-270
does not already own:

- **One conformance scene per effect**, in `packages/runtime-native/conformance/scenes/shared/`,
  with the five registrations each new case needs — the registry entry, the scene, the baseline,
  and the two lane registrations — done as one unit, because forgetting one of the five is the
  known failure mode and has cost this repository lanes before.
- **A settled-frame comparison for temporal effects**: the case captures at frame 0 and at a
  settled frame N, asserts the baseline at N, and asserts frames N and N+1 differ from frame 0 —
  so a frozen history fails instead of passing.
- **`--target desktop|android|ios` playtest scenarios** for the composed chain, not only per-effect
  cases, because the ordering bugs this batch is most exposed to appear when stages compose.
- **A gate that fails on an unrun row.** A coverage row with no result for a platform reports
  **unobservable**, never green — the PRD-265 rule, applied per platform rather than per scenario.
  A platform genuinely without a lane on the running machine reports as skipped-with-reason and
  the gate names it in the summary; a skipped row never counts as coverage.
- **`pnpm census` run in the same commit**, per the repository's standing rule for any
  runtime-native change — the numbers are generated, not retyped.

## Acceptance criteria

1. **Every covered row has a result on desktop, Android and iOS, or a named reason.** The gate
   produces a matrix of row × platform where every cell is a pass, a fail, or a
   skipped-with-reason. *Mutation:* let a cell be empty and the gate goes green on a matrix with
   holes in it — the failure this PRD exists to prevent.

2. **A frozen temporal history fails.** The settled-frame case asserts frames N and N+1 differ from
   frame 0. *Mutation:* pin the history texture so it never updates, and the case must fail at
   frame N while still matching at frame 0 — proving the case observes accumulation rather than
   the first frame.

3. **A software adapter fails the browser row rather than passing it.** The browser lane asserts
   `adapter.info` names a hardware adapter. *Mutation:* force SwiftShader and the row must fail,
   not report a green comparison.

4. **A thermally confounded device row is not admissible.** Android rows carry
   `notThermallyConfounded`. *Mutation:* run hot and the row must fail on the thermal assertion
   rather than on the pixels, so the failure names the real cause.

5. **A new effect cannot be added without a row.** Adding an entry to
   [PRD-274](./PRD-274-every-export-has-a-named-tested-equivalent.md)'s coverage fixture without a
   corresponding conformance registration fails the gate naming the effect. *Mutation:* let the
   registration be optional and an effect ships web-only with a green board.

6. **The composed chain runs natively, not just the parts.** A `--target desktop` and a
   `--target android` playtest drive a template with several effects composed and assert the frame
   is non-blank and the chain reports its tier. *Mutation:* assert per-effect cases only and a
   stage-ordering failure that appears only in composition ships green.

## Out of scope

The lighting stages PRD-270 owns — SSGI, SSR, GTAO, the denoiser, godrays and the probe volume.
Performance verdicts: this PRD proves the effects *execute and look right* per platform. FPS
belongs to the device lane and its own record in `docs/verification/runtime-perf-state.md`, and a
desktop lane cannot produce an FPS verdict at all because its presents are throttled.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`; `pnpm parity` across the new cases;
`pnpm native:verify:desktop`; `--target android` on a cooled device and `--target ios` on a
simulator or device, each pasted; the full row × platform matrix pasted into
`docs/verification/` as one file for the run, including every skipped-with-reason cell. `pnpm
census` in the same commit. No row in that record claims a platform it did not execute.
