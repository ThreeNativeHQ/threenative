# Wildwood: crawling shadow speckle, and the whole-frame blur that was tried instead

Status: **RESOLVED 2026-09-05** by naming the cause. Accepted by the owner on the live game.
The rejected 2026-09-05 fix (global sharpening 0.28 -> 0.9) is reverted.

## Root cause

`SSGINode.useTemporalFiltering` ships **`true`**, and three's own documentation on that property
says that value *"requires the usage of `TRAANode`"* — while with it `false`, *"a manual denoise
via `DenoiseNode` is required"*. Those are the node's two supported configurations, and a chain
has to be one of them.

Wildwood's chain has no TRAA stage. Left `true`, the node rotates its slice direction by
`frameId % 6` and its ray-start offset by `frameId % 4` **every frame**, betting that something
downstream averages consecutive frames. Nothing did. A fresh noise realization reached the display
every frame, which on screen is dark speckle that *crawls* rather than grain that sits still.

Two consequences explain the whole shape of this bug:

1. **No single-frame filter can fix it.** The signal's design assumes a temporal filter. That is
   why filtering the occlusion term helped and never closed it, and why the previous session ended
   up reaching for a whole-frame blur — the only thing that visibly touched the artifact was
   destroying the image everywhere.
2. **`GTAONode` carries the same property and defaults it to `false`.** So the contact term's
   grain was static and spatially filterable all along, while the GI gather's was not. Two
   sibling nodes, opposite defaults, and the difference between them was the bug.

## The measurement that found it

Cross-arm screenshot comparison could not settle this, and the reason is the finding: **two
captures of the *same* build differed by 5.2/255 of mean luminance, against 7.5 between the arms
being compared.** Run-to-run instability was 70% of the signal the comparison was reading.

That instability was not uniform. Per 80x80 block, mean absolute difference between two identical
runs:

| region | same-build churn |
| --- | --- |
| top of frame, dense foliage | 9.1 – 10.1 |
| near ground, y=640 | 0.5 – 1.2 |

Worst exactly where the report said the artifact was. A static grain cannot do that; a per-frame
stochastic term can, and only one stage had one.

Two controls that were needed to trust any of it:

- **A same-arm repeat.** Without it the earlier comparison had no noise floor and was reading its
  own churn as an arm effect.
- **A deterministic pose.** Wind and dust are vertex programs driven by TSL `time`, so two arms
  captured at two wall-clock instants are two different sets of plants. Pinning `time` to a
  constant in the capture harness is what made crops comparable at all. The pre-fix
  before/after pair in this directory does not have this and its foliage does not match.

## The fix

All of it in game source, in `/home/joao/projects/threenative/sandbox/wildwood` (owning
repository `/home/joao/projects/threenative/sandbox`).

- `src/render/worldEnvironment.ts`
  - `gi.useTemporalFiltering = false` on the SSGI node — the fix.
  - `contact.useTemporalFiltering = false` on the GTAO node — **stated, not inherited.** It is
    already three's default there, but three ships the opposite default on the sibling node, so
    nothing about this scene's correctness should rest on which way the dependency happens to
    have it.
  - `contactDenoise`: the contact term keeps its own filter, off `DenoiseNode`'s defaults.
    `radius` 16 rather than 5 (the loop is a fixed 16 taps at any radius, so reach is free),
    `normalPhi` 1.5 rather than 5, `depthPhi` 0.35 m rather than 5 m. The normal term is why a
    default-tuned filter did nothing in foliage: the weight is
    `pow(max(dot(n, nSample), 0), normalPhi)`, so where adjacent normals disagree every
    neighbour's weight collapses and the filter returns the noisy centre texel while reporting as
    denoised. Contact occlusion is a property of a neighbourhood *in depth*, so the depth term
    does the localizing instead.
  - `TN_WORLD_ENVIRONMENT` now names `gatherTemporalFiltering` on every run, so a build that
    silently turned it back on cannot look like a scene that merely got noisier.
- `src/render/quality.ts`: `sharpenStrength` back to **0.28** on all three tiers, the value that
  shipped. 0.9 did hide the speckle, and the matched pair shows what it cost.

`radius` is 16 rather than the 12 the speckle measures at because the owner asked for the contact
shading a shade softer once the crawl was gone; widening here is the one way to buy that which
does not touch a texture.

## Regression coverage

`tests/contact-shading.test.mjs` compiles the real render source and inspects the Three.js node
graph installed through the renderer seam. No GPU needed.

Current source: **11 passed, 0 failed**. Five negative controls, each compiling an altered copy
without touching the game on disk:

| control | mutation | result |
| --- | --- | --- |
| `temporal-ssgi` | SSGI temporal filtering back on | 10 passed, **1 failed** |
| `temporal-gtao` | GTAO temporal filtering on | 8 passed, **3 failed** |
| `raw-ao` | unfiltered AO into the colour multiply | 5 passed, **6 failed** |
| `narrow-ao` | contact filter back to `DenoiseNode` defaults | 8 passed, **3 failed** |
| `soft-sharpen` | the rejected 0.9 sharpening | 8 passed, **3 failed** |

The suite also asserts that no `traa` stage is requested — if one is ever added, temporal
filtering becomes the *correct* setting and the test says to revisit it rather than silently
pinning yesterday's answer.

`pnpm test:render` is the first step of the game's `pnpm test`.

## Other gates

- Game typecheck: passed.
- Wildwood playtests, machine quiet: `startup`, `survives`, `walk`, `discover`, `wade-out` — all
  pass, zero console, network or runtime diagnostics.
- A first playtest run showed `startup.enteredMs` 2764 ms (budget 2500) and `startup.readyMs`
  28120 ms (budget 18000). **Not this diff**: it was taken with a dev server up and a 300 MB asset
  cook in flight, the `?lowtier` scenario does not enable SSGI at all, and this diff on that tier
  is three uniform values. Re-run quiet, ready came back at 14782 ms, inside this scenario's own
  recorded 14.4–15.4 s history. `enteredMs` sits on its budget already — run 0 of the archived
  `phase0-lowtier.json` is 2764 ms, the same number.

## Harness

`artifacts/wildwood-performance/noise-fix/contact-arm.mjs` — matched-camera ablation, anchors
updated to the current source. `--arm=none` is the shipped code and every other arm walks
*backwards* from it, so the shipped state is the thing under test rather than an edit of it.
Fail-closed on every pattern matching, on the adapter being the real GPU, and on the surface being
pinned at 1280x720 scale 1. `contact-crops.py` and `contact-zoom.py` measure and zoom the results;
the speckle and detail statistics they print reproduce to ±0.2 across a same-arm repeat.

These captures are local evidence on NVIDIA/Turing, not portable dependencies, and no number here
is a controlled performance guarantee. The separate engine shadow-material cache optimization was
never implicated and is untouched.
