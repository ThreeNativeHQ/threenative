# PRD-251 review repair verification

Date: 2026-08-31

Review baseline: `13a8f1522ea0fbec4bae071bbda5ce5e3aacdf84`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-251-exec-20260830`

Status: the five round-one review defects are repaired and covered by focused red-green tests.
The terrain quality result remains partial; native, Android/Pixel 8, iOS, and visual side-by-side
evidence remain UNVERIFIED.

## Repairs

- `world-gameplay.ts` fails closed when a terrain report lacks a valid topology observation. It
  publishes eight failed topology assertions and `TN_PLAYTEST_WORLD_TOPOLOGY_ASSERTION_FAILED`.
  `TerrainTiles.debug()` now publishes the resident tile's dimensions, heights, and flow.
- `measureWorldTopology` consumes the published flow channel for the Horton-Strahler metric. A
  zero-flow mutation produces order `0`, while routed flow produces a higher order.
- GPU capability reporting no longer claims GPU generation. A host with a valid adapter report is
  reported as `gpu: true`, `generation: "cpu-fallback"`, with the reason that canonical GPU
  readback is unsupported. `Heightfield` rejects `worldPasses.gpu: true`; CPU data is never labeled
  GPU-generated. `TerrainProbe` no longer hardcodes a false GPU availability claim.
- `TerrainTiles` measures raw inter-tile edge discontinuity before skirt coverage. A deliberately
  mismatched shared edge reports a positive seam gap.
- The root world export surface contains only consumed aliases/types. The follow-up removes the
  fabricated procedural-tile model lookup and tests release against a preloaded game-owned key.

## Red-green evidence

Before the repairs, the focused regression command exited `1`: 4 files had 7 failing tests. The
failures covered GPU capability selection, the missing GPU rejection, seam-gap masking, missing
asset loading, absent/malformed topology, and the ignored flow mutation.

After the repairs:

```text
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts
✓ 5 files, 29 tests
```

The requested focused suite also passes:

```text
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/playtest/__tests__ packages/create-threenative/__tests__/scaffold.spec.ts
✓ 75 files, 811 tests, 0 failures
```

## Gate evidence

- `pnpm build`: exit `0`; regenerated 199-entry capability manifests and built the affected
  packages/examples successfully.
- `pnpm typecheck`: exit `0`.
- `pnpm lint`: exit `0`; it emitted warnings but no errors.
- `pnpm budgets`: exit `0`; framework/native LOC trigger notices remain reports, not failures.
- `npx vitest run packages/core/__tests__ scripts packages/create-threenative/__tests__`: 184
  files passed, 1 skipped, 1,864 tests passed, and 1 unrelated pre-existing scaffold test failed.
  The failure is
  `packages/create-threenative/__tests__/playtest.spec.ts` because its committed fixture contains
  `allowTrivial` while the test still expects `changed: true`; no file in that test was changed by
  this repair. The capability-manifest stale failure is resolved by `pnpm build`.

## Terrain playtest

The real headed command was:

```sh
node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/terrain.playtest.json --url 'http://127.0.0.1:5173/?terrain' --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5173 --strictPort" --browser-recipe webgpu --headed
```

It ran against `/?terrain` with the in-repository server and WebGPU recipe, then exited `1` with:

```text
TN_PLAYTEST_WORLD_TOPOLOGY_ASSERTION_FAILED
World topology failed metrics: directional-anisotropy, median-64m-relief, horton-strahler-order.
```

This is the intended fail-closed result: the live report included a 65×65 topology with heights
and flow, all residency/LOD/visibility assertions passed, and no console or runtime diagnostics
were reported. The scenario did not claim a terrain-quality pass because those three metrics remain
below their PRD floors.

## Repair round 2 — 2026-08-31

Baseline SHA: `2293138591c04797aea53661cd295d590ab0a276`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-251-r3-20260831`

This round closes the five blockers from the second review. The source PRD remained read-only.
Native desktop, Android/Pixel 8, iOS, and the required visual side-by-side/A-B captures remain
UNVERIFIED.

### Red probes before each repair

1. The topology producer test was red before the producer fix: the resident 9×9 field reported
   16×16 m while the probe required 65×65 samples over 1,024×1,024 m.
2. The skirt/seam test was red before the geometry observation fix: the observed visual seam value
   was absent while the raw seam mismatch was positive. The explicit skirt-removal mutation then
   exited `1` with `2 failed, 4 passed`; it failed on zero observed skirt vertices and a 10 m
   uncovered visual gap. Restoring the generated geometry exited `0` with `6 passed`.
3. Removing `changed:true` from `terrain.playtest.json` exited `1` with `1 failed, 3 passed` in
   the scenario contract test. The real run then showed the initial 8 transitions were trivial;
   removing the initial `gte:1` threshold left the post-baseline `changed:true` proof.
4. The fabricated asset lookup regression was red before the lifecycle fix: the tile path
   `terrain/tile-0-0.glb` was passed to `assets.model()`. The fixed test preloads
   `terrain/fixture.glb`, clears the model spy, and requires release of that exact key.
5. Returning render-row-major values directly to Rapier exited `1` with `1 failed, 8 passed`;
   the maximum parity error was `12.302858352661133`. Restoring the column-major transpose made
   the heightfield suite `9 passed`.
6. For the declared erosion negative control, forcing CPU iterations to zero exited `1` with
   `1 failed, 6 passed`; the deterministic erosion test observed no changed heights. Restoring
   the loop made the erosion suite `7 passed`.
7. Disabling eviction exited `1` with `2 failed, 4 passed`: resident tiles reached `8` against
   the cap of `4`, and the preloaded release was absent. Restoring eviction made the tile suite
   `6 passed`.

### Green repair evidence

The focused repair suite passed after the fixes and manifest build:

```text
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts
6 files passed, 78 tests passed
```

`pnpm build` exited `0`, regenerated the 200-entry capability manifest/reference, and built the
workspace. `pnpm typecheck` exited `0`. `pnpm lint` exited `0` with repository complexity
warnings only. `pnpm sync:agents` exited `0` and reported `16 mirrors, 0 written`.

The broad `pnpm test` exited `1`: `87` files passed, `626` tests passed, `39` skipped, and six
tests in four native-runtime files failed because their required CMake executables were not
built. This is recorded as an unbuilt native setup result, not as native world evidence.

`pnpm budgets` exited `1` on the pre-existing out-of-scope native census drift:
`conformance/` recorded `8,030` lines and measured `8,043` (tolerance `5`). No unrelated census
file was edited. `pnpm quality` exited `0` with `99` findings, including the newly added world
files; `pnpm tsx scripts/count-loc.ts` exited `0` and reported platformer LOC `2,569`, generated
HUD LOC `60` (geometry HUD `69`), and cloth framework/hand-written LOC `46/761`.

### Live headed evidence

Command:

```sh
node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/terrain.playtest.json --url 'http://127.0.0.1:5173/?terrain' --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5173 --strictPort" --browser-recipe webgpu --headed --no-screenshots
```

Exit code: `1`, fail-closed on `power-spectrum-slope`, `median-64m-relief`,
`horton-strahler-order`, and `effective-vertex-density`. The run otherwise proved real input
movement: distance `380.9110981152656` m, path length `387.46644359564755` m, six tile-column
boundaries, `lodTransitions` `8 → 66`, peak residency `9` tiles / `3,175,992` bytes, raw seam
gap `2.6062299013137817`, visual seam gap `0`, and no console/runtime diagnostics. The browser
capture record reports `rendererKind: webgpu` and an NVIDIA Turing adapter. Only one browser
adapter/capture record exists; the required three side-by-side captures and two-material A/B
proof are unverified.

### Changed files in this repair round

```text
docs/verification/PRD-251-native.md
docs/verification/PRD-251-quality.md
docs/verification/PRD-251-review-repair.md
examples/abyss-framework/playtests/terrain.playtest.json
examples/abyss-framework/src/scenes/TerrainProbe.ts
packages/core/__tests__/world-terrain-tiles.spec.ts
packages/core/src/world-tiles.ts
packages/core/src/world.ts
packages/create-threenative/__tests__/scaffold.spec.ts
packages/playtest/__tests__/world-gameplay.spec.ts
packages/playtest/src/evaluators/world-gameplay.ts
```
