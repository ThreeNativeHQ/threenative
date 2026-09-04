---
prd_contract: v1
---

# PRD-345 — a backlit subject is not a hole in the sky

**Status:** PROPOSED — filed 2026-09-03, measured at `43d03e6a`. Batch:
[docs/PRDs/AAA-visuals](./README.md). **Ships as generated user source, not as a package** — it
decides how things look, and rule 1(b) vetoes 1(a) at any size. Source studied:
[TheLongSilence](https://github.com/achimala/TheLongSilence) `src/gfx/greeble.js:37`, the
`HULL_LIGHT` block and its environment note.

**Goal: the templates stop shipping two lighting failures that every game built from them
inherits** — a backlit subject that collapses to a flat silhouette, and an environment map so dark
that image-based lighting silently contributes nothing and every surface reads as painted clay.

**Complexity:** two material additions and one report, in ten template `src/render/` folders =
**LOW-MEDIUM**. The work is breadth and the `AGENTS.md` rows, not depth.

## The problem, measured at `43d03e6a`

### 1. `MeshStandardMaterial` has no grazing term in its diffuse lobe

So a subject lit from behind returns very nearly zero across its whole facing side, however bright
the key is, and reads as a hole cut in the background. A real backlit object never does that: light
wraps the limb and scatters off the dust and the paint at the edge. The reference calls this "the
difference between a spacecraft and a hole in the starfield" and fixes it with one Fresnel lobe
gated on how far behind the subject the key is — a dot product and a power, costing nothing.

Backlight is not an exotic setup. It is a sunset, a doorway, a headlight, a fire behind a character:
the shots a game is screenshotted in.

### 2. A dark environment makes IBL return zero, and nothing says so

`scene.environment` set to a near-black generated sky — which is what a night scene, a space scene or
an interior produces — makes three's IBL path return zero however high `envMapIntensity` is set.
Every material then falls back on its diffuse term alone and the whole game reads flat and chalky.
The failure is silent: the code is correct, the map is present, the intensity is set, and the image
is wrong. This is the same family as the TSL post stages that silently no-op, already recorded here.

The templates' `worldEnvironment.ts` sets an environment; nothing measures whether it contributes.

### 3. This is look, so it ships as source

A grazing wrap term and an ambient fill decide how every surface in the game appears. Rule 1(b) is
unambiguous: generated source in `src/render/`, at any size, with a named override on the same object
and honest reporting when overridden.

## What ships

### `src/render/lighting.ts` in every template, as generated source

- **A grazing wrap term**, added to the templates' shared material setup: one Fresnel lobe, gated on
  the key light being behind the subject, tinted by the key. Off by default is *not* the shape —
  conventions ship on, with a named override (`rimGain: 0`) on the same object.
- **An analytic ambient floor** for when the environment is dark: the game names its two dominant
  sources — a key direction with a colour, and a fill direction with a colour and an angular size —
  and the material adds a cheap analytic term from them. The reference's insight is that this is not
  an approximation of a degenerate sky, it *is* that sky: one disc plus a void, costing a reflect
  and two dot products. A generated template's sky is exactly as analytic.
- **Defaults that are a dim cool ambient rather than nothing**, so a subject has something to catch
  before the game writes its own values.

### The report — `TN_ENVIRONMENT_CONTRIBUTION`

Printed by the templates' `worldEnvironment.ts`: the mean radiance of the environment map actually
in use, and whether IBL is therefore contributing. A near-zero value prints the reason and names the
analytic fill as the thing carrying the ambient instead. **Turning the convention off must not turn
its measurement off** — `rimGain: 0` still reports.

### `AGENTS.md` rows

Both conventions get a row in each template's `AGENTS.md`, and the override name goes beside them. A
convention missing from the templates' `AGENTS.md` does not exist. Note the word budget lives in the
instruction-budget vitest spec, not in `pnpm budgets` — check it before adding prose.

## What does not ship

- Nothing in `packages/`. Not a helper, not a shared constant, not a "rim" utility. The moment a
  package owns a lighting term the framework owns the look.
- No area lights, no clustered lighting, no IBL replacement.

## Acceptance criteria

1. **A backlit subject has a lit limb.** A playtest scenario poses a template's character between
   the camera and the key light; `assert.tone` (PRD-341) over a crop of the silhouette edge asserts
   a p99 above the body's p99 by a stated margin.
   *Red-green:* set `rimGain: 0` in the scenario's setup; the same assertion fails, and the run still
   prints the measured rim contribution — the proof that measurement survives the override. Paste
   both.
2. **A dark environment is reported, not hidden.** A scenario with a near-black environment asserts
   `TN_ENVIRONMENT_CONTRIBUTION` names IBL as non-contributing and names the analytic fill.
   *Red-green:* delete the report; the marker assertion goes red.
3. **The scene is not flat without a sun.** The same scenario with the key light removed asserts,
   via `assert.tone`, that `p1` and `p99` remain separated — a scene lit only by the fill still has
   range.
   *Red-green:* set the analytic fill to black; the range assertion goes red.
4. **Every template has both, and says so.** `scripts/__tests__/primary-docs.spec.ts` and the
   templates' own gate assert each template's `AGENTS.md` names both conventions and both override
   names.
5. **The templates gate is green on the templates that currently pass it.** Note the known red lane:
   the templates gate aborts at the first failing template, so the shooter's deterministic capture
   red will hide everything after it. Fix or skip past it deliberately and say which — never report
   a template as passing because the gate stopped before reaching it.

## Out of scope

Anything in `packages/`, and any change to the tonemapper — PRD-339 and PRD-343 own exposure and the
white point.
