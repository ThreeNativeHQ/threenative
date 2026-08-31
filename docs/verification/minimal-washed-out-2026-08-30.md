# `minimal` renders washed out — measured, dated, not yet fixed

**Status: OPEN, cause located, the remaining choice is a look decision.** Filed 2026-08-30 against
`5878aaaf`.

## What it looks like

`docs/verification/visuals/minimal.png` — refreshed by `2042b33d` — is a pale grey frame with
concentric banding across the whole background, a dark horizontal band through the upper third, and
almost no contrast. Every other template's baseline looks correct. The file is **1.04 MB** where the
other six are 400–750 KB, which is the banding refusing to compress.

## The measurement

Luminance quantiles (0–255), sRGB:

| Frame | p10 | p50 | p90 | p99 | ≥250 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `minimal.png` now | 53 | **130** | 205 | 212 | 0.0% |
| `minimal.png` at `1d68bc05` | 3 | **22** | 52 | 124 | 0.0% |
| `starter.png` now | 3 | 13 | 32 | 72 | 0.0% |

Nothing clips. This is not "blown out to white" — the **floor is lifted** (p10 3 → 53) and contrast
is crushed. Median luminance moved by about **6×** against the template's own previous baseline.

## The dates, which are the whole story

| When | Commit | What it did |
| --- | --- | --- |
| 2026-08-28 16:01 | `1d68bc05` | last good baseline captured — p50 22 |
| 2026-08-28 22:08 | `9ced139c` | gave `minimal` an atmosphere sky dome and an aerial-perspective base colour, tuned against a frame with **no post chain** |
| 2026-08-30 19:48 | `81698466` | shipped the render chain into all seven templates, adding `exposure 1.15` and ACES over that scene |
| 2026-08-30 20:26 | `2042b33d` | refreshed the baselines — the first time the result was visible |

`minimal` is the only template using the atmosphere sky and aerial perspective; the other six use the
plain vertex-coloured gradient dome, which is why they are unaffected.

**The regression sat in the templates for two days and no gate reported it.** A 6× shift in median
luminance passed, and the baseline was refreshed rather than the drift flagged. That is worth its own
decision, separately from the fix.

## Ablation — measured on a scaffolded `minimal`, not reasoned

Each row is a real build against the scaffold at `/tmp/threenative-minimal-*`, captured headed under
a private Xvfb on the NVIDIA adapter, seven seconds after the canvas appears.

| Sky multiplier | Aerial perspective | Chain | p10 | p50 | p90 | p99 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `.mul(24)` (shipped) | on | desktop | 84 | **145** | 203 | 209 |
| `.mul(4)` | on | desktop | 58 | 97 | 105 | 132 |
| `.mul(1.5)` | on | desktop | 52 | 85 | 93 | 127 |
| `.mul(0.0001)` | on | desktop | 53 | **82** | 90 | 125 |
| `.mul(24)` | off | desktop | 54 | 109 | 180 | 200 |
| `.mul(24)` | on | mobile (no SSGI/SSR) | 104 | **104** | 104 | 104 |
| `.mul(24)` | off | mobile | 0 | 0 | 0 | 0 |

**What this rules out.** The sky multiplier is not the lever: taking it from 24 to effectively zero
still leaves p50 at 82 against a target of 22. Reducing it was the obvious fix and it is the wrong
one.

**What it points at.** With the mobile preset the frame is a *perfectly uniform* 104 at every
quantile — one flat fill, no scene. Turning the base colour off with that preset gives pure black.
So the visible image in `minimal` is coming from the atmosphere terms rather than from the lit
scene: `baseColour` is the scene pass composed with `aerialPerspective` over its own view-Z, and the
atmosphere is configured at kilometre scale (`SphereGeometry(20_000)`, "1/km coefficients") over a
scene about ten units across. Every pixel is treated as being at extreme distance, so in-scattering
dominates and the scene is washed to the scattering colour. The dark horizontal band is that
horizon; the concentric rings are the scattering LUT quantised to 8 bits.

## What has to happen next, and why it is not decided here

The remaining choice is which look `minimal` should ship, and by the charter the look belongs to the
game, not to the framework. Two honest options:

1. **Give `minimal` the sky the other six templates use** — the vertex-coloured gradient dome in
   `starter/src/render/sky.ts`, with no aerial perspective. Restores the p50-22 look immediately and
   costs `minimal` its atmosphere demonstration.
2. **Re-scale the atmosphere for a ten-unit scene** — the coefficients, the dome radius and the
   aerial-perspective depth all assume kilometres. This keeps the demonstration and is real tuning
   work, not a constant to nudge; the ablation above shows single-constant edits do not reach the
   target.

Do not attempt option 2 by adjusting `.mul(N)`. That was measured and it converges to 82, not 22.

The regression frame is attached as
[`visuals/minimal-regression-2026-08-30.png`](./visuals/minimal-regression-2026-08-30.png).
