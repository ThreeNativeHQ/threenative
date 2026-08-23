# Asset cost census — PRD-098 Phase 0, 2026-08-22

Verdict: **PRD-098 is DECLINED under its own Phase 0 exit** ("if no shipped template or
example is triangle-bound, this PRD is speculative optimisation and should not be built").

## Method

Live measurements through the existing playtest bridge — no new instrument was built, per the
phase instruction to reuse the PRD-069 measurement lineage. Each game ran on this machine's
real GPU (`nvidia turing`, `--browser-recipe webgpu`); numbers read from
`doctor --url --text` and the `performanceSeries` of `examples/abyss-framework/playtests/draw-calls.playtest.json`.

## Measurements

| Scene | Triangles | Draw calls | Steady frame time |
|---|---:|---:|---|
| `starter` (scaffolded template) | 4,002 | 48 | not sampled; scene is procedurally trivial |
| `platformer` (largest template, scaffolded) | 3,045 | 63 | not sampled; same |
| `abyss-framework` (richest example) | 183,855 | 22 | **1.9–2.3 ms** (series 53.8 → 9.5 → 2.3 → 1.9 ms as shaders warm) |

Duplicate mesh+material node groups: none at meaningful scale. Every template's props are
procedural primitives with distinct materials; abyss renders procedural terrain chunks.

## Why the one big number is not triangle-bound

abyss-framework exceeds the budget doc's illustrative `maxTriangles: 10000` by 18×, but that
scenario is marked "still proposed, not built" in
[`PERFORMANCE-BUDGETS.md`](../product/PERFORMANCE-BUDGETS.md), and the cost that matters —
frame time — sits at **~12% of the 16.7 ms budget** while drawing all 183,855 triangles in 22
draw calls. A LOD pass or an instancing pass would change a number nobody pays for.

## What would reopen this PRD

A shipped scene whose measured p95 frame time approaches its budget while carrying distance-
varied geometry (LOD's case) or repeated identical mesh+material nodes at N≥10 (instancing's
case). The census script then exists to be re-run; nothing else was built. Declining strands
nothing: PRD-096's pass chain is independent, and `THREE.LOD` / `THREE.InstancedMesh` remain
available to games by hand today.
