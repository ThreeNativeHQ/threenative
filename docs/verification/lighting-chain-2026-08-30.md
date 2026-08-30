# Lighting chain — measured on a sandbox cathedral, 2026-08-30

Evidence for the [lighting PRD batch](../PRDs/lighting/README.md). Everything below was run
against `../sandbox/lumen-hall`, a game built outside this repository and installed from
tarballs, so nothing here benefits from the workspace.

**What executed:** browser lane only, Chromium with `--browser-recipe webgpu`, headed,
1600x900, on this machine's discrete adapter. **Nothing on native, Android or iOS** — no
result below claims a platform it did not run on. That gap is PRD-270's whole subject.

## Scene

98 draw calls, 413,060 triangles. Five stages composed through one `WorldEnvironment`:
`ssgi` -> `denoise` -> `godrays` -> `ssr` -> `bloom`, installed via `setOutputNode`.

## Stage cost, by ablation on one build

Each row disables named stages through a URL query on the *same* build, so the rows differ
by one stage and nothing else.

| config | fps | render.p50 | render.p95 |
| --- | --- | --- | --- |
| all stages | 42.9 | 6.5 ms | 28.6 ms |
| minus ssgi + denoise | 107.0 | 4.1 ms | 8.5 ms |
| minus ssr | 65.3 | 5.7 ms | 23.8 ms |
| minus godrays | 70.2 | 6.0 ms | 18.1 ms |
| all stages off | 292.4 | 2.7 ms | 4.8 ms |

SSGI at the `high` preset (3 slices x 16 steps = 96 samples/pixel) costs more than every
other stage combined. Dropping to `medium` (32 samples): 58.6 fps, render.p50 6.0 ms.

Later, after three lanes added geometry and textures: render.p50 9.0 ms. Godray raymarch
steps 60 -> 24 and shadow map 4096 -> 2048 brought it to 6.7 ms with no visible loss. The
draw-call count above is why those two levers were chosen over anything scene-side.

## Four defects found, all in the composition rather than in the nodes

1. **`SSRNode.maxDistance` defaults to 1 world unit.** On a 63 m nave every reflection ray
   died within a metre and the stage rendered nothing. Reads as "SSR is on and does nothing".
2. **`SSRNode` `reflectNonMetals` defaults to false.** A polished *stone* floor is not a
   metal, so even with the ray distance fixed nothing reflected until it was set.
3. **`colorNode` and `normalNode` must be texture nodes.** Both are `.sample()`d inside the
   pass. `@types/three` declares `normalNode` as `Node<"vec3">`, which invites a `.xyz`
   swizzle that typechecks and then fails at shader build with
   `this.normalNode.sample is not a function`. The colour input needs `convertToTexture`;
   `ssgi()` does that conversion in its factory and `ssr()` does not.
4. **`toneMappingExposure` does not reach a frame drawn through a `RenderPipeline` output
   node.** Moving it from 0.85 to 1.45 changed nothing on screen. Exposure has to be applied
   inside the node chain.

## A blank frame from a dangling graph branch

Disabling bloom rendered the bare background colour. Cause: `convertToTexture(lit)` was
passed to the SSR pass while the reflections were added back onto the *unconverted* `lit`,
producing two parallel copies of the same graph, one materialised and one not. Bloom's own
conversion re-materialised the second copy, so the bug appeared only with bloom off **and**
godrays on **and** SSR on. Isolated by ablation:

| config | mean luminance | spread | rendered? |
| --- | --- | --- | --- |
| bloom off | 7.5 | 0.0 | no — flat background |
| bloom off + ssr off | 88.5 | 209.1 | yes |
| bloom off + godrays off | 31.3 | 253.6 | yes |

Fix: materialise once and reuse that texture on both sides of the add.

## Godrays are a whole-frame brightener, not a shaft renderer

The pass returns a non-zero value for nearly every pixel, because in a building lit through
a clerestory most of the upper volume genuinely is lit, so every view ray accumulates
something. That something is small in linear space and large after the tone curve, which
lifts shadows hardest.

Luminance quantiles against the reference photograph, 0-255:

| config | mean | p05 | median |
| --- | --- | --- | --- |
| all stages | 115.4 | 71.1 | 113.1 |
| minus godrays | 57.0 | 4.1 | 37.2 |
| minus ssr | 114.5 | 71.1 | 111.8 |
| minus ssgi | 120.1 | 73.1 | 117.5 |
| **reference photograph** | **54.2** | **7.3** | **39.5** |

Godrays alone account for the whole error; SSR contributes about 1 luminance level and SSGI
slightly *darkens* through its occlusion term. Subtracting a floor before the add keeps the
air inside a real beam and discards the ambient lift. After that, and with exposure
calibrated against the same distribution:

| | mean | p05 | median | p95 |
| --- | --- | --- | --- | --- |
| ours | 52.2 | 2.7 | 36.3 | 167.6 |
| reference | 54.2 | 7.3 | 39.5 | 145.9 |

**Method note worth keeping:** matching a reference by eye converged on the wrong answer
four times running. Comparing luminance quantiles against the reference image found the
cause in one measurement and named the responsible stage in a second.

## Upstream gap

`SSGINode` has no `resolutionScale`. `SSRNode` has one, and halving it there recovered
34.5 -> 46 fps. SSGI resets itself to the full display resolution every frame inside
`updateBefore`, so it cannot be traced at reduced resolution from outside the class. On this
scene SSGI is the most expensive stage, which makes this the single largest missing lever
for PRD-266's tier ladder.
