# PRD-251 quality comparison

Date: 2026-08-31

Baseline SHA: `2293138591c04797aea53661cd295d590ab0a276`

Status: the metric evaluator and comparison table are present, but the current game sampler does
not meet all eight stated floors. This record intentionally does not convert that result into a
visual or quality pass.

## Three-subject table

All rows use the source-independent evaluator over a 1,024 m × 1,024 m region. The PRD-043 and
pinned-upstream rows are the measured Phase 0 records. The current-build row uses the game-owned
seed `251` sampler plus four CPU erosion iterations. `pass` means the stated threshold in the
PRD is met.

| Metric | Stated threshold | PRD-043 sine wireframe | Current build | Pinned upstream |
| --- | ---: | ---: | ---: | ---: |
| Directional anisotropy | ≤ 0.1 | 0.255 **fail** | 0.057751762 **pass** | 0.054 **pass** |
| Power-spectrum slope β | 2.5–5.0 | 10.190 **fail** | 1.134736378 **fail** | 3.888 **pass** |
| Relief / field edge | ≥ 0.1 | 0.0044 **fail** | 0.327534491 **pass** | 0.4392 **pass** |
| Median 64 m relief / global | ≤ 0.25 | 0.9136 **fail** | 0.405958701 **fail** | 0.0576 **pass** |
| Max Horton–Strahler order | ≥ 5 | 3 **fail** | 3 **fail** | 7 **pass** |
| Profile-curvature excess kurtosis | ≥ 5 | −0.385 **fail** | 13.502137365 **pass** | 65.341 **pass** |
| Effective vertices/km² | ≥ 500,000 | 19,775 **fail** | 4,029.274 **fail** | 1,031,494 **pass** |
| Slope fraction above 30° | ≥ 0.1 | 0 **fail** | 0.288757396 **pass** | 0.6915 **pass** |

The current build's live topology observation is 65×65 samples over the declared 1,024 m × 1,024 m
region. It fails `power-spectrum-slope`, `median-64m-relief`, `horton-strahler-order`, and
`effective-vertex-density`; the erosion/flow implementation is therefore not declared to have
passed the §11.2 three-metric gate. The Phase 0 PRD-043 floor record fails metrics 1–8, so the
incumbent remains discriminated from the pinned upstream reference even though this build has not
yet matched the reference.

## Executable metric surface

`packages/playtest/src/evaluators/world-gameplay.ts` now exports `measureWorldTopology` and
`evaluateWorldTopology`, applies every threshold fail-closed, accepts array-like height and flow
channels, and emits one assertion per metric when a terrain report supplies `topology`. The repair
now makes `TerrainTiles.debug()` publish an explicit game-configured 1,024 m measurement region's
dimensions, heights, and flow, so a resident 64 m tile cannot be scored as the world. The current
headed run remains partial: the evaluator reports four failed topology metrics rather than silently
passing an absent or undersized field.

## Negative controls and visual evidence

NC-1 was observed red at the field-evaluator level by substituting PRD-043's sine field: the
substitution reported failed directional anisotropy, power-spectrum slope, Horton order and slope
tail checks in the current evaluator. The literal PRD command
`pnpm playtest --project examples/abyss-framework --scenario terrain` exited `254` because the
root script does not exist, so the complete eight-metric playtest red is not claimed.

NC-5 was checked with a temporary forbidden appearance token in `packages/core/src/world.ts`.
`pnpm quality` itself exited `0` with the token present, while the direct world-source grep
returned exit `1` (a match). The source was restored and the enforceable grep is green afterward:

```text
rg -ni "material|light|tonemapping|postprocessing|\.wgsl" packages/core/src/world*.ts
look_gate_exit=1
```
The Phase 3 headed browser run produced one inspected capture at
`artifacts/playtest/after.png`. It is colorful and visibly deformed with the game-owned
`src/render/terrain.ts` normal surface, but the required three side-by-side subject captures were
not produced. The two-material same-world A/B charter test is unverified.

## Integration ledger caller census

The non-test census was run with:

```sh
rg -n "TerrainTiles|Heightfield\.fromSampler|toColliderHeights|getWorldCapabilities|worldCapabilities" \
  packages examples --glob '!**/__tests__/**' --glob '!**/*.spec.ts' --glob '!**/dist/**' \
  --glob '!**/capabilities.json'
```

The live consumer lines are:

```text
examples/abyss-framework/src/scenes/TerrainProbe.ts:5:  TerrainTiles,
examples/abyss-framework/src/scenes/TerrainProbe.ts:6:  getWorldCapabilities,
examples/abyss-framework/src/scenes/TerrainProbe.ts:107:    const tiles = new TerrainTiles({
examples/abyss-framework/src/scenes/TerrainProbe.ts:116:            field.toColliderHeights(),
packages/core/src/world-tiles.ts:545:    const field = Heightfield.fromSampler(sampler);
packages/core/src/world-capabilities.ts:84:export function getWorldCapabilities(...)
packages/core/src/world.ts:421:export { TerrainTiles } from "./world-tiles.js";
packages/core/src/world.ts:432:  getWorldCapabilities,
```

`TerrainTiles` calls `AssetLoader.release` in its eviction unit at
`packages/core/src/world-tiles.ts`; the game caller is `TerrainProbe.ts`, and no second terrain
scenario was added. `terrain-streaming` was edited in place.

## Checkpoint record

- Exact baseline SHA: `2293138591c04797aea53661cd295d590ab0a276`
- Seeded reds: NC-1 field substitution and NC-5 direct look grep; the literal NC-1 root command
  was a setup failure, and `pnpm quality` did not enforce the forbidden-token mutation.
- Headed evidence class: one inspected browser frame; no side-by-side set or A/B set.
- Gate status: metric comparison recorded, current build quality gate red on three metrics.

Changed files for this phase:

```text
examples/abyss-framework/src/scenes/TerrainProbe.ts
examples/abyss-framework/playtests/terrain.playtest.json
packages/playtest/src/evaluators/world-gameplay.ts
packages/playtest/src/evaluators/perf-signals-world.ts
docs/verification/PRD-251-quality.md
```
