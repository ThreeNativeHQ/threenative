# PRD-251 repair-round-7 verification — contract-preserving LOD repair

Date: 2026-08-31

Baseline SHA: `802e25f615a82dd613e6b91950abe898607d0b8a`

Branch: `linchpin/lane-251-r6-20260831`

Lane: `lane-251-r6-repair1-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r6-20260831`

The source PRD remained read-only. This is an engine-layer repair: the defects were in the
portable terrain residency and LOD mechanism in `packages/core/src/world-tiles.ts`, not in the
game's sampler or material source.

## Repair scope

1. Mixed-LOD stitching now uses a separate bridge topology made from the game-owned surface and
   canonical edge samples. It does not overwrite `Heightfield`, `heightAt`, or collider source
   heights. Bridge geometry is disposed when the pair becomes equal-resolution or a tile is
   evicted, and its bytes count toward residency.
2. Every neighbor reconciliation restores both live tile edges from the canonical field before
   the equal-resolution decision. A pair returning to equal LOD therefore cannot retain a stale
   coarsened edge.
3. `TerrainTiles.debug()` publishes finite `stitchedEdges`; the existing
   `terrain-streaming` scenario requires `terrain.stitchedEdges >= 1`. The evaluator regression
   rejects a report that observes zero stitched edges.
4. LOD-pop measurement snapshots the active rendered geometry before the frame's work and records
   the frame-to-frame delta only after transitions, field processing, and neighbor reconciliation
   have completed.

## Seeded red evidence

The four focused regressions were written before the implementation repair. Running the old
implementation produced this red result:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts -t "canonical query|mixed neighbors return|reconciles a mixed-LOD|final rendered LOD|terrain scenario|no stitched edge"
Exit: 1
Result:
- packages/playtest/__tests__/world-gameplay.spec.ts: 9 tests, 7 skipped, passing.
- packages/core/__tests__/world-terrain-tiles.spec.ts: 24 tests, 4 failed, 20 skipped.
Failures:
- canonical query/collider edge parity: rendered edge height `10` was not within `0.00001` of
  the canonical value.
- mixed neighbors returning to equal LOD: stale edge error
  `0.013993263244628906` was not within `0.00001`.
- mixed-LOD reconciliation: `stitchedEdgeCount` was `undefined`, not greater than `0`.
- final rendered LOD pop: the old ordering reported `maxLodPop` as `10`, while the final rendered
  geometry delta was approximately `8.164e-16`.
```

The reconciliation path was also disabled at both `TerrainTiles` call sites as a source-level
negative control. The source was restored before the green run:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "reconciles a mixed-LOD surface edge"
Exit: 1
Result: 24 tests total, 1 failed, 23 skipped.
Failure: expected `tiles.stitchedEdgeCount` (`0`) to be greater than `0`.
```

The consumer-side evaluator probe supplies `stitchedEdges: 0` to the existing scenario assertion
and fails closed. This is the scenario/evaluator form of the same disabled-reconciliation control;
the real `TerrainTiles` source calls were restored before the green run.

## Green evidence

The complete focused suite, including all four regressions and the consumer evaluator, passed:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts
Exit: 0
Result: 2 files passed; 33 tests passed.
```

The look-ownership guard passed after removing the transient material reassignment from the bridge
refresh path:

```text
Command:
pnpm exec vitest run packages/core/__tests__/constraints.spec.ts
Exit: 0
Result: 1 file passed; 4 tests passed.

Command:
rg -n "Material|new THREE\\.Color|0x[0-9a-fA-F]{6}|Texture\\(|Light\\(|snow|desert|tundra" packages/core/src/world*
Result: no matches (the final `rg` no-match exit was accepted by the gate wrapper).
```

## Checkpoint gates

| Command | Exit | Exact result |
| --- | ---: | --- |
| `pnpm typecheck && pnpm lint && pnpm test` | 0 | Typecheck passed; Biome checked 1,504 files with 500 warnings and no errors; 301 test files passed, 1 skipped; 3,009 tests passed, 3 skipped. |
| `pnpm sync:agents` | 0 | `agent docs synced: 16 mirrors, 0 written` (`packages/core/CLAUDE.md` remained generated and unchanged). |
| `pnpm budgets` | 1 | Existing out-of-scope native census drift: recorded `8,030`, measured `8,043`, tolerance `5`. No census file was edited. |
| `pnpm quality` | 0 | `quality report: 99 findings (21 new, 23 grew, 54 inherited, 1 waived)`. Advisory report; it includes the current `world-tiles.ts` file-length finding. |
| `pnpm tsx scripts/count-loc.ts` | 0 | Platformer template `2,569` LOC; generated HUD `60` (`69` geometry HUD); cloth framework `46`, hand-written `761`, `94.0%` smaller. |
| `git diff --check` | 0 | No whitespace errors. |

The manager gate record present at `artifacts/gates/status.json` is:

```text
identity: tn-20260831T230238Z-2926055:unit
command: vitest run
phase: unit
state: succeeded
exitCode: 0
expectedHead: 802e25f615a82dd613e6b91950abe898607d0b8a
branch: refs/heads/linchpin/lane-251-r6-20260831
worktree: /home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r6-20260831
startedAt: 2026-08-31T23:04:10.131Z
finishedAt: 2026-08-31T23:04:49.001Z
```

The manager record is a successful unit gate at the repair baseline; the final combined gate
above was rerun after the source repair and also passed. The budget failure is not reported as
green because it is caused by the pre-existing native census mismatch outside this lane.

## Evidence boundaries

- `rg -n "Math.sin|wireframe" examples/abyss-framework/src/scenes/TerrainProbe.ts` returned no
  matches in the incumbent game path.
- The existing non-test caller census remains populated: `TerrainProbe.ts` consumes
  `TerrainTiles`; `TerrainTiles` consumes `Heightfield`; and `packages/core/src/world.ts` exports
  the public terrain type. The new `stitchedEdges` observation is consumed by the existing
  `terrain-streaming` scenario through the playtest component evaluator.
- Native terrain execution, Pixel 8 capability evidence, iOS execution, headed visual captures,
  same-source cross-platform proof, and two-material A/B proof were not run in this repair lane
  and remain UNVERIFIED. The generic native tests included in `pnpm test` are not terrain evidence.
- The PRD-wide negative controls for the sine field, Rapier row ordering, eviction, erosion/flow,
  and core look ownership remain recorded in the prior PRD-251 verification records. The new
  reconciliation-disabled red result is recorded above.

## Changed files

- `examples/abyss-framework/playtests/terrain.playtest.json`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `packages/core/src/world-tiles.ts`
- `packages/playtest/__tests__/world-gameplay.spec.ts`
- `docs/verification/PRD-251-repair-round-7.md`
