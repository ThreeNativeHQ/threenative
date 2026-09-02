<!-- schemaVersion: 1 -->

# Environment cost attribution — PRD-307, 2026-09-01

**Decision: REFUTED for the standing ≥2 ms steady-state frame threshold.** The Bayview game sets
its environment once and does not drive a per-frame PMREM update. Repeating the prefilter every
frame costs **+1.61 ms**, but the set-once environment versus no environment is below the measured
**0.37 ms noise floor**. Baking the set-once prefilter therefore cannot recover the ≈6.3 ms
steady-state frame cost attributed to `scene.environment`.

## Measurement provenance

The five-arm table below is the measured output recorded by the architecture follow-up on
2026-09-01: NVIDIA Turing, named `nvidia/turing` adapter, 60 seconds per arm, vsync disabled. The
refactored `scripts/env-cost-probe.ts` was **not re-executed in this closure lane**; the fixture and
driver described by the follow-up are not present in this worktree. No new run is claimed here.

| Arm | `gpuMs` median | p10–p90 |
| --- | ---: | --- |
| `static` — environment set once | 2.18 | 2.10–4.07 |
| `none` — no environment | 2.55 | 0.41–5.64 |
| `dirty/8` — prefilter every 8th frame | 2.41 | 2.28–9.87 |
| `dirty/2` — prefilter every 2nd frame | 2.23 | 0.51–4.57 |
| `dirty/1` — prefilter every frame | 3.79 | 3.65–6.48 |

The resolved deltas are:

- `dirty/1 − static = 3.79 − 2.18 = +1.61 ms`: a per-frame prefilter is measurable and costly.
- `static − none = 2.18 − 2.55 = −0.37 ms`: the expected causal ordering (`none ≤ static`) is
  inverted, so **0.37 ms is the observed noise floor**. No smaller difference is reportable.

The `dirty/1` control proves what a game that actually dirties its environment would pay. It does
not describe Bayview: its source audit found no `needsPMREMUpdate`, `ProbeVolume`, or `CubeCamera`,
and `PMREMGenerator` appears only in a comment. `scene.environment` is assigned exactly once at
`src/render/sky.ts:75`. Bayview therefore pays the per-fragment environment sampling cost every
frame, not a repeated prefilter cost that baking could remove.

## What the original 6.3 ms number means

The earlier Bayview ablation measured `gpuDrain p50` of **0.35 ms** with `scene.environment` nulled,
against the full scene's roughly **6.3 ms** difference. That ablation removes both prefilter work
and environment sampling, so **6.3 ms is an upper bound on the bakeable cost**, not a bakeable
steady-state estimate. The static-versus-none comparison above cannot resolve any steady-state
sampling difference beyond 0.37 ms.

## Phone launch-time arm — excluded

The separate Pixel 8 `TN_NO_IBL` launch-time arm used three paired cold launches, but it was
thermally confounded and is not a result: battery temperature rose monotonically from **33.3 °C to
36.3 °C**, the IBL arm's own spread was **17.3–21.5 s**, larger than the **2.4 s** between-arm
difference, and one of three paired comparisons changed sign. This record makes no launch-time
speed claim.

## Closure

The ≥2 ms steady-state falsification test fired. Phases 2 and 3 are conditional on a measurable
prefilter win and were skipped: no `environmentPass`, environment manifest field, core loader
branch, or template contract was added. The runtime PMREM path remains the correctness reference
and fallback by design.

Evidence is inherited from the architecture follow-up's recorded run; the planned re-execution
command was:

```sh
sh scripts/xvfb.sh pnpm tsx scripts/env-cost-probe.ts <port> 60
```
