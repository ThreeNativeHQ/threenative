# PRD-251 repair-round-6 verification — seam diagnostics and neighbour LOD stitching

Date: 2026-08-31

Baseline SHA: `21a638f959fb1df02d84960f32bafba9a6019fc3`

Branch: `linchpin/lane-251-r6-20260831`

Lane: `lane-251-r6-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

The source PRD remained read-only. This repair closes the three review defects handed to this
lane:

1. A missing or non-finite live seam observation now throws a diagnostic-safe error.
2. The terrain scenario requires a positive raw seam observation while retaining a zero visual seam
   upper bound after coverage.
3. Resident neighbours coordinate LOD levels and reconcile the finer rendered surface edge from
   the retained coarser edge samples before skirts are used for coverage.

## Seeded red and green evidence

The focused regressions were added before the implementation was repaired.

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "fails closed when a live seam edge|reconciles a mixed-LOD surface edge"
Exit: 1
Result: 20 tests total, 2 failed, 18 skipped.
Failures:
- fails closed when a live seam edge contains a non-finite position: expected [Function] to throw an error.
- reconciles a mixed-LOD surface edge before skirt coverage: expected 0.013993382453918457 to be less than 0.00001.
```

The old implementation silently skipped the malformed edge and left the mixed-LOD surface gap
unreconciled. After the fix:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "fails closed when a live seam edge|reconciles a mixed-LOD surface edge|coordinates adjacent resident LOD targets"
Exit: 0
Result: 1 file passed; 3 tests passed, 18 skipped.
```

The independent neighbour-LOD regression was also seeded red by temporarily removing
`this.#coordinateNeighborLods(hadFocus)` from `TerrainTiles.follow()`:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "coordinates adjacent resident LOD targets"
Exit: 1
Result: 21 tests total, 1 failed, 20 skipped; expected east LOD 1, received 2.
```

The call was restored before the green run. This proves the mixed-LOD check is not satisfied by
skirts alone: without neighbour coordination the adjacent tile takes a two-level jump.

The scenario contract was seeded red by changing its raw seam lower bound from `0.000001` to
`0`:

```text
Command:
pnpm exec vitest run packages/playtest/__tests__/world-gameplay.spec.ts -t "requires the terrain scenario to prove an LOD transition after its baseline"
Exit: 1
Result: 1 test failed, 7 skipped; expected gte 0.000001, received 0.
```

The threshold was restored. The focused scenario checks then passed:

```text
Command:
pnpm exec vitest run packages/playtest/__tests__/world-gameplay.spec.ts -t "requires the terrain scenario|rejects a zero raw seam observation"
Exit: 0
Result: 1 file passed; 2 tests passed, 6 skipped.
```

The zero-value evaluator regression proves that a report with `maxSeamGap: 0` fails the new
numeric assertion; removing seam recording therefore cannot produce a vacuous pass.

## Repair details

`TerrainTiles` now validates every live edge height and every retained edge sample. Undefined or
non-finite seam observations throw instead of being ignored, while both finite lifetime maxima
remain monotonic.

Each resident neighbour pair is coordinated after independent distance selection. A pair may differ
by at most one LOD level; the coarser neighbour is corrected when needed. For a mixed-resolution
pair, the finer surface edge is written from interpolated retained samples of the coarser edge,
then skirts and live edge samples are refreshed. Seam diagnostics run before reconciliation to
retain a positive raw observation and after reconciliation to report the consumer-visible seam.
No material, colour, terrain palette, sampler, culling policy, collider ordering, or platform
branch was added to core.

## Scoped green tests

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-*.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts packages/playtest/__tests__/schema-boundaries.spec.ts packages/playtest/__tests__/silent-drop.spec.ts packages/playtest/__tests__/measures.spec.ts
Exit: 0
Result: 8 files passed; 103 tests passed.
```

The complete terrain unit file passed with 21 tests. A direct CPU probe of the repaired sampler
and resident tiles measured:

```text
maxSeamGap: 4.947147369384766
maxVisualSeamGap: 0
maxLodTransitionFrames: 3
peakResidentBytes: 2888352 of 20000000
peakResidentTiles: 9 of 9
lodTransitions: 2
maxLodPop: 3.900066375732422
skirtVertexCount: 4140
```

## Required source and manifest checks

The PRD look-ownership command returned no matches:

```text
Command:
rg -n "Material|new THREE\.Color|0x[0-9a-fA-F]{6}|Texture\(|Light\(|snow|desert|tundra" packages/core/src/world.ts
Exit: 1 (no matches; expected for this bare rg gate).
```

The incumbent path is absent:

```text
Command:
rg -n "Math.sin|wireframe" examples/abyss-framework/src/scenes/TerrainProbe.ts
Exit: 1 (no matches; expected).
```

The PRD caller census returned non-test consumers including:

```text
examples/abyss-framework/src/scenes/TerrainProbe.ts:5:  TerrainTiles,
examples/abyss-framework/src/scenes/TerrainProbe.ts:75:  #tiles: TerrainTiles | undefined;
examples/abyss-framework/src/scenes/TerrainProbe.ts:104:    const tiles = new TerrainTiles({
packages/core/src/world-tiles.ts:7:  Heightfield,
packages/core/src/world-tiles.ts:841:        : Heightfield.fromSampler({
packages/core/src/world.ts:473:export { TerrainTiles } from "./world-tiles.js";
```

```text
Command:
rg -n "TerrainTiles|Heightfield" --glob '!**/__tests__/**' --glob '!**/*.spec.ts' packages examples
Exit: 0.
```

The session did not expose the deferred MCP connector directly. The local stdio implementation of
the same shipped `engine_search_capabilities` tool was called through `handleLine` against
`packages/create-threenative/capabilities.json`:

```text
"generate a terrain a player can walk across" → Heightfield, TerrainTiles, getWorldCapabilities
"ask how high the ground is here" → Heightfield
"stream terrain without cracks" → TerrainTiles
Exit: 0.
```

The complete request result matched `generate a terrain a player can walk across`; the focused
results matched the exact ground-query and crack-free-streaming situations.

## Checkpoint gates

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies bootstrapped from the lockfile. |
| `pnpm build` | 0 | Workspace build completed; capability manifest regenerated with 200 entries. |
| `pnpm typecheck && pnpm lint && pnpm test` | 0 | Typecheck passed; Biome checked 1,504 files with 500 warnings and no errors; 301 test files passed, 1 skipped; 3,005 tests passed, 3 skipped. |
| `pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts` | 0 | No errors; two existing complexity warnings on `updateLodTransitionGeometry` and `follow`. |
| `git diff --check` | 0 | No whitespace errors. |
| `pnpm quality` | 0 | 99 advisory findings: 21 new, 23 grew, 54 inherited, 1 waived. |
| `pnpm tsx scripts/count-loc.ts` | 0 | Platformer 2,569 LOC; generated HUD 60 LOC (geometry HUD 69); cloth framework 46 vs hand-written 761, 94.0% smaller. |
| `pnpm sync:agents` | 0 | 16 mirrors synced, 0 written; generated `packages/core/CLAUDE.md` was unchanged. |
| `pnpm budgets` | 1 | Pre-existing out-of-scope native census drift: recorded 8,030, measured 8,043, tolerance 5. No census file was edited. |
| `pnpm native:build` | 0 | Native build/bootstrap completed. This was not a terrain scene execution. |
| `pnpm --filter @threenative/runtime-native test` | 0 | 91 files passed; 637 tests passed, 34 skipped. This was not native terrain evidence. |

The initial `pnpm typecheck` before bootstrap exited 2 because generated package distributions were
absent (`@threenative/playtest` protocol/three types and `@threenative/assets`); `pnpm build` fixed
that setup condition before the final combined gate.

## Declared negative controls carried into this repair

The phase-wide PRD controls were already observed red and are preserved in the earlier records:

- PRD-043 sine topology, row-order Rapier mutation, disabled eviction, zero erosion iterations,
  and the world look-ownership control are recorded with exact commands and results in
  `docs/verification/PRD-251-review-repair.md` and `docs/verification/PRD-251-repair-round-3.md`.
- This lane adds the exact red probes above for malformed live edges, missing neighbour LOD
  coordination, unreconciled mixed-LOD edges, and a zero raw seam threshold.

No package material, biome vocabulary, platform branch, or second terrain/LOD system was added.

## Browser, native, mobile, and visual evidence

The browser command was attempted with the WebGPU recipe. The first managed-server attempt exited
2 with `TN_PLAYTEST_SERVER_FAILED` after Vite reported ready on localhost. The corrected command
reached 180 movement frames and exited 1 with:

```text
adapter.architecture: swiftshader
distance: 302.45132154424255
pathLength: 380.7093707902042
terrain observation: missing
console errors: 45
runtime diagnostics: 22
```

The private-Xvfb capture used a software adapter and produced no valid terrain observation, so it
is not headed GPU evidence. Native terrain execution, Pixel 8 capability evidence, iOS evidence,
same-source cross-platform proof, inspected side-by-side captures, and two-material visual A/B
evidence are unverified in this repair lane.

## Changed files

- `examples/abyss-framework/playtests/terrain.playtest.json`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `packages/core/src/world-tiles.ts`
- `packages/playtest/__tests__/world-gameplay.spec.ts`
- `docs/verification/PRD-251-repair-round-6.md`
