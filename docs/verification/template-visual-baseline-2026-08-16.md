# Template visual baseline — all seven templates, blind-scored — 2026-08-16

The first number this repository has for what a generated project looks like before the user
writes a line. Seven frames, one per template, captured by the same harness on a real adapter,
shuffled, and scored by a fresh read-only critic that was never told which project it was looking
at and was forbidden from reading the reveal.

Command: `pnpm visuals:baseline`. Bundle, verdict and reveal under
`docs/verification/visuals/baseline/`. Frames under `docs/verification/visuals/<template>.png`.

**This is a model score, not the human blind session.** `docs/product/VISUAL-BASELINE.md` states a
floor of 4 of 5 and requires a human to certify it. This drives the improvement loop and nothing
more; no charter result is claimed from it.

## Why this did not exist before

`pnpm visuals` already scaffolded every template, booted it, and captured a headed WebGPU frame —
and then discarded the frames unless a human score file was already sitting on disk. Nothing ever
read them. The only automated check applied to a frame is that it is not blank, and a flat
fog-coloured wash is not blank. That is how four templates shipped a sky gradient which never
reached the screen, for months, with `typecheck`, `lint` and every playtest green.

## Result

**2 of 7 templates reach the stated 4/5 floor. Mean 2.86.**

| Template | Visuals | Playability | Polish avg | Screenshot-worthy | Largest gap |
| --- | --- | --- | --- | --- | --- |
| starter | **4** | 3 | 3.2 | yes | The arena is a bare slab in black void, and the hero silhouette is an unmodified Three.js torus-knot primitive doing a designed subject's job |
| action-rpg | **4** | 4 | 3.2 | yes | About 40% of the frame — the whole upper-left — is dead near-black, so the composition is a small lit island in a large void |
| racing | 3 | 3 | 2.6 | no | Camera framing fails the subject: the car is tiny, near the right edge, and sliced by a gate post, while two thirds of the frame is a featureless plane at a grazing angle |
| platformer | 3 | 3 | 2.2 | no | Fog and exposure wash the whole frame to one pale mint hue; mid-ground geometry loses its own colour and the palette collapses to a single value band |
| minimal | 2 | 2 | 1.6 | no | Essentially empty — one box on a bare slab in a void — with an unstyled default-browser HUD chip on top |
| shooter | 2 | 3 | 2.0 | no | Two HUD layers drawn over each other at full brightness turn the upper-left quarter into unreadable interleaved glyphs |
| defense | 2 | 3 | 2.0 | no | The background is a single flat uniform teal with no gradient or horizon, and the one board floats in it with no ground or contact relationship to anything |

The critic chose `starter` as the strongest at medium confidence, and said why: a genuine vertical
sky gradient, one warm high-value hero against a cool dark field, a single accent colour carried by
the pickup, real directional cast shadows with contact darkening under every object, and a HUD that
does not fight the scene.

## What the round-9 fix already did, visible in the artifacts

The sky-dome `fog: false` fix landed the same day and these are the first frames captured after it.
The PNG sizes are the evidence, because a near-uniform image compresses to almost nothing:

| Template | Before (2026-08-08/12) | After | Change |
| --- | --- | --- | --- |
| defense | 17.9 KB | 169 KB | **9.4×** |
| minimal | 34.2 KB | 97.4 KB | 2.8× |
| starter | 249.6 KB | 200.1 KB | — |
| platformer | 161.3 KB | 190.8 KB | 1.2× |

`defense` and `minimal` were rendering as flat washes and now carry real detail. Both still score 2,
for reasons unrelated to the dome — see below. The fix was necessary and nowhere near sufficient.

## Defects this baseline found, none of which any gate reports

**1. Two HUD layers render on top of each other.** In `shooter` the upper-left quarter is
unreadable: `WAVE 1/5`, `CLEAR 5 WAVES - FAIL 0 LIVES`, `HEALTH 100` and `LIVES 100` collide
letter-by-letter with a second block reading `CLEAR 5 WAVES / FAIL 0 LIVES / WAVE 1/5 / HP 100
LIVES 3 / TARGETS 1 / SCAN 42 / TIME 00:02`. The same doubling appears in `platformer` — "a small
crisp COINS/HEARTS/CHECKPOINT row and a l[arger block]". This is the single worst thing in the set
and it is a duplicate-render bug, not a taste question. Scores `shooter` UX at 1 of 5.

**2. `defense` and `racing` have no sky gradient at all.** Distinct from the fog defect fixed in
round 9. Their domes are built with a solid `color: palette.skyLow` and no vertex colours, so there
was never a gradient for fog to destroy. Measured: `defense` has 8,001 unique colours in the whole
frame and a 240px vertical background sample runs `177888, 187888, 197988, 1B7988` — visually one
colour. `racing`'s sky samples `CEE6EA` byte-identical at y=100, 180, 260 and 340.

**3. `platformer`'s fog range washes the frame.** Frame mean luminance 0.77, the highest of the
seven; sky effectively flat from `D3EBF2` to `DCEFF2`; ground, platform and props all converge on
the same pale mint at distance. Its shadowing is genuinely good and is not the problem. Round 9
fixed the fog *range* in `starter` only and deliberately declined to generalise it without
evidence. This is that evidence, for one more template.

**4. `starter`'s hero is a stock primitive.** The critic, with no knowledge of the codebase, named
the unmodified torus-knot as the largest gap in the best-scoring frame. That is the same
`sculpture` demo content round 9 identified and withdrew from cutting. The withdrawal was on the
cost column; this is an independent visual reason to revisit it.

**5. `minimal` is empty rather than minimal.** 3,552 unique colours, the lowest of the seven, and a
HUD that reads `ITEMS 20` while zero items are on screen. Being small is the template's job; being
empty and self-contradicting is not.

## Instrument note

`pnpm sweep:judge` first rejected this verdict `TN_JUDGE_VOID: critic input contains an arm
identifier`. The critic had written "control bar" four times, meaning a row of input prompts, and
`\bcontrol\b` is a reserved arm identifier in the blind-scoring guard. The guard was not weakened;
the critic reworded the phrase and every score was preserved. The false positive will recur —
"control" is ordinary vocabulary for describing a HUD — and the guard is reused here slightly
off-label, since a template baseline has no arms to keep apart in the first place.
