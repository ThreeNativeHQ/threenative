---
prd_contract: v1
---

# PRD-339 — the frame sets its own exposure

**Status:** PROPOSED — filed 2026-09-03, measured at `43d03e6a`. Batch:
[docs/PRDs/AAA-visuals](./README.md). Judged with
[PRD-341](./PRD-341-a-frames-tone-is-a-number-and-the-number-is-a-gate.md), which is the only way to
tell whether this landed. Source studied: [TheLongSilence](https://github.com/achimala/TheLongSilence)
`src/gfx/PostFX.js`, the `LUM_FRAG` / `REDUCE_FRAG` / `ADAPT_FRAG` chain.

**Goal: a scene that changes brightness by ten stops stays readable, without the game hand-tuning a
`toneMappingExposure` constant per area.** This is the single largest look difference between a
Three.js scene and a shipped game, and the framework currently has none of it.

**Complexity:** a GPU reduction chain, a ping-pong history target, a TSL exposure node ahead of the
tonemapper, and a native parity case = **MEDIUM**. No new dependency, no new pass over the scene.

## The problem, measured at `43d03e6a`

### 1. There is no auto exposure anywhere in the repository

```
grep -rn 'autoExposure\|auto-exposure\|adaptation\|eyeAdapt' packages/core/src \
  packages/create-threenative/templates/*/src/render/
(no matches)
```

Every template's `worldEnvironment.ts` sets a fixed exposure. That constant is correct for exactly
one lighting condition. A game with an interior and an exterior, a day cycle, a muzzle flash, or a
teleport is choosing which of its own scenes to render wrong, and the agent building it has no
signal that a choice was even made — a dark room and a blown-out courtyard both come back as "the
game runs".

### 2. The naive implementation is the one that is wrong, and it is wrong intermittently

The reference implementation carries measurements for both traps, and both are the kind that survive
a green gate:

- **Linear smoothing of luminance is a first-order lag with a fixed time constant in luminance**,
  not in stops. `mix(prev, cur, rate)` closes a fixed fraction of the *remaining difference* per
  frame, so falling from a photosphere (radiance 100–400) to a moon lit by a distant star (near
  0.03) takes as many time constants for the last factor of a thousand as for the first factor of
  two. Measured in the reference: two runs of an identical command against an identical pose at an
  identical camera returned p99 168 / mean 47.3 and p99 44 / mean 7.4 — a four-to-five stop error,
  at random, on roughly three cold boots in ten at a 4.5 s settle, none at 9 s. Interpolating
  `log2` instead makes the rate constant in stops per second, and eleven stops then cost the same
  three time constants that one stop does.
- **A log mean of the scene is the textbook metric and it is wrong for a mostly-dark frame**; an RMS
  metric with a generous per-pixel clamp is wrong for a mostly-bright one. The reference measured a
  landscape under a low sun at mean 38/255 and median 22 — three stops under, with a judge calling
  every unlit face "dead dark maroon" — because a stellar aureole over a tenth of the frame at the
  RMS clamp contributed 3.6 to the mean square while the ground at 0.05 contributed 0.0025. The
  exposure was being set by the sun and nothing else.

Neither of these is discoverable from a screenshot that happened to boot on the good run. They are
discoverable from a settle-time assertion and a tone histogram, which is why this PRD is judged with
PRD-341.

### 3. The split: the loop is mechanism, the metric is the look

A game cannot write the reduction chain portably — it needs render targets, a ping-pong history that
survives a resize, a hook between the world pass and the tonemapper, and the same behaviour on
WebGPU in a browser and in the native host. That is rule 1(a): the framework owns it, at any size.

The *metric* — which pixels count, how hard they are clamped, whether the lower half of the frame is
weighted, how fast the eye opens versus squints, and at what error a change stops being an
adaptation and becomes a cut — decides how the game looks. That is rule 1(b), which vetoes 1(a):
those numbers ship as generated source in `src/render/`, and the framework must never pick them.

## What ships

### `packages/core/src/render/auto-exposure.ts`, exported from `@threenative/core`

- **The reduction.** Scene colour → a small luminance target → repeated 4×4 box reductions to 1×1.
  Sizes and step count are derived from the drawing buffer, so this survives the
  `ResolutionScaler` moving a rung underneath it.
- **The metric seam.** The per-pixel weight is a game-supplied TSL function
  `(colour, uv) => weight`, defaulting to `1`. The reference's clamp and vertical ground weight are
  expressible in it and are *not* built in. A game that wants a log mean writes a log mean.
- **The adaptation.** A 1×1 ping-pong target interpolated **in `log2`**, with separate `up` and
  `down` rates in stops per second, and a cut response: past `snapLo` stops of error the rate scales
  toward immediate, fully engaged by `snapHi`. Because the boost falls away as the error closes, it
  cannot ring or overshoot.
- **The exposure node.** A TSL node the render chain multiplies in before the tonemapper, so the
  bloom prefilter and the tonemap curve see the same scene-referred value.
- **Reset.** `reset(value?)` for a cut the game knows about — a level load, a teleport, a cutscene
  in. A resize must not silently reset the history; a rebuilt target is seeded from the last value,
  because the reference's resize path visibly re-flashed the frame on every dynamic-resolution step.
- **Reporting.** A `TN_AUTO_EXPOSURE` marker naming the measured luminance, the applied exposure in
  stops, the settle state, and — when the game turned adaptation off — the measurement *continues*
  and the marker says `applied=false`. Turning a convention off must not turn its measurement off.

### `src/render/exposure.ts` in every template, as generated source

The metric function, the clamp, the spatial weight, the two rates and the two cut thresholds, with
the comment saying what each one is for and which way to move it. `quality.ts` decides whether the
chain runs at a tier; this file decides what it aims at. Templates' `AGENTS.md` gains a row for it —
a convention missing from there does not exist.

## What does not ship

- No tonemapper. AgX/ACES selection stays where it is, in the game's own render chain.
- No histogram-based metric in v1. The reduction seam admits one later without an API change; a
  compute histogram is a separate PRD if a game ever needs one.
- No per-object or per-region exposure.

## Acceptance criteria

1. **The settle time is independent of the size of the change.** A playtest scenario cuts the camera
   between a bright pose and a dark pose eleven stops apart, and between two poses one stop apart,
   and asserts both reach within 0.25 stops of their steady value inside the same frame budget.
   *Red-green:* replace the `log2` interpolation in `auto-exposure.ts` with `mix(prev, cur, rate)` on
   raw luminance; the eleven-stop leg must fail with the measured settle time in the failure text
   while the one-stop leg still passes. Paste both.
2. **A cold boot into a pose is repeatable.** Ten runs of the same scenario at the same pose report
   p99 luminance within a 10% band (PRD-341's `assert.tone` supplies the number).
   *Red-green:* set `snapGain` to 0 so the cut response never engages; the run must go red on spread.
3. **Off does not mean unmeasured.** With `enabled: false`, `TN_AUTO_EXPOSURE` still prints a
   measured luminance and `applied=false`, and the frame's exposure is exactly the game's constant.
   *Red-green:* early-return from `update()` when disabled; the marker assertion fails.
4. **It runs on native.** A `--target desktop` playtest of the same scenario reports the same
   applied exposure within tolerance, and a native contract test covers the reduction chain without
   a display (see the native contract lane in `packages/runtime-native/AGENTS.md`).
   *Red-green:* the contract case is registered in all five places a new native target needs; a
   missing registration must fail `verify-native-contracts.mjs`, not skip.
5. **The framework picks no number.** `packages/core/src/render/auto-exposure.ts` contains no
   default clamp, weight curve or rate that is not `1`, `0` or an identity. A grep in the spec
   enforces it.

## Out of scope

Local tonemapping, bloom threshold coupling, and lens/iris simulation.
