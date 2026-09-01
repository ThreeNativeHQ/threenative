# PRD-251 repair-round-8 verification — contract-preserving LOD and seam diagnostics

Date: 2026-08-31

Baseline SHA: `3ff3382abd72c8c06d6cf11eec6136b5098541dc`

Branch: `linchpin/lane-251-r7-20260831`

Lane: `lane-251-r7-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r7-20260831`

The source PRD remained read-only. This is an engine-layer repair: both defects were in the
portable terrain residency and LOD diagnostic mechanism in `packages/core/src/world-tiles.ts`,
not in the example sampler or material source.

## Repair scope

1. `TerrainTiles.#setLodLevel` captures the currently rendered geometry before finishing an active
   transition. Retargeting records the delta to the final rendered geometry immediately, so a
   visible snap between render-cadence snapshots contributes to `maxLodPop` and the existing
   finite threshold.
2. Seam diagnostics now treat a stitch bridge as visual coverage only when its mesh is attached to
   the owning `TerrainTiles` object and visible. Coverage is sampled from the bridge mesh's live
   position attribute; invalid bridge attachment or geometry fails closed. Bridge disposal and
   resident-byte accounting are unchanged.
3. Two focused regressions cover the interrupted transition and detached bridge paths.

## Seeded red evidence

The focused regressions were added before the source repair and run against the baseline
implementation:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "records a visible snap|reports a visual seam"
Exit: 1
Result:
- 1 file; 26 tests total, 2 failed, 24 skipped.
- Interrupted LOD retarget: expected `maxLodPop` `6.9857177734375` to be greater than or equal
  to the visible retarget snap `13.971425546875`.
- Detached bridge: expected `maxVisualSeamGap` `0` to be greater than `0`.
```

The first red result proves the old `#finishLodTransition` ordering missed the visible snap. The
second proves that a bridge record alone allowed the old diagnostic to report zero after its mesh
was removed from the terrain owner.

## Green evidence

Both repaired defects pass with the same focused command:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "records a visible snap|reports a visual seam"
Exit: 0
Result: 1 file passed; 2 tests passed, 24 skipped.
```

The existing terrain suite and the related world/playtest focused suite also pass:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result: 1 file passed; 26 tests passed.

Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-*.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts packages/playtest/__tests__/schema-boundaries.spec.ts packages/playtest/__tests__/silent-drop.spec.ts packages/playtest/__tests__/measures.spec.ts
Exit: 0
Result: 8 files passed; 109 tests passed.
```

The changed source and tests pass the focused formatter/linter check:

```text
Command:
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result: no errors; 2 existing cognitive-complexity warnings (`updateLodTransitionGeometry` and
`TerrainTiles.follow`).
```

## Checkpoint gates

| Command | Exit | Exact result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Dependencies installed from the lockfile. |
| `pnpm build` | 0 | Workspace build passed; capability manifest regenerated with 200 entries. |
| `pnpm typecheck && pnpm lint && pnpm test` | 1 | Typecheck passed; lint passed with 500 warnings and no errors; package tests stopped on 4 `runtime-native` files because required unbuilt CMake executables were missing, with 87 files passed, 4 failed and 6 tests failed, 626 passed, 39 skipped. This is an environment/native-build setup result, not a failure in the repaired focused suite. |
| `pnpm sync:agents` | 0 | `agent docs synced: 16 mirrors, 0 written`. |
| `pnpm budgets` | 1 | Existing out-of-scope native census drift: recorded `8,030`, measured `8,043`, tolerance `5`. No census file was edited. |
| `pnpm quality` | 0 | `quality report: 99 findings (21 new, 23 grew, 54 inherited, 1 waived)`. Advisory report. |
| `pnpm tsx scripts/count-loc.ts` | 0 | Platformer template `2,569` LOC; generated HUD `60` (`69` geometry HUD); cloth framework `46`, hand-written `761`, `94.0%` smaller. |
| `git diff --check` | 0 | No whitespace errors. |

The manager gate record was present and read-only inspection passed:

```text
Command:
pnpm gate:status
Exit: 0
Result:
run: tn-20260831T233140Z-3213722
phase: package-test
state: failed
command: pnpm -r --workspace-concurrency=1 --if-present run test
worktree: /home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r7-20260831
HEAD: 3ff3382abd72c8c06d6cf11eec6136b5098541dc
artifact: artifacts/gates/status.json
terminal result: failed (exit 1)

Command:
pnpm exec tsx scripts/gate-cli.ts doctor --status-path artifacts/gates/status.json
Exit: 0
Result:
gate doctor (read-only); phase `package-test`; state `failed`.
Next probe: `pnpm exec tsx scripts/gate-cli.ts resume --status-path .../artifacts/gates/status.json`.
```

The failed manager record is not reported as a green gate. No native CMake build was run in this
repair lane.

## Caller and evidence boundaries

- `TerrainTiles` remains exported by `packages/core/src/world.ts:473` and consumed by
  `examples/abyss-framework/src/scenes/TerrainProbe.ts:75,104`; no new public export was added.
- `seamObservation` has one live non-test caller at `packages/core/src/world-tiles.ts:1609`; the
  two new behavior proofs are in `packages/core/__tests__/world-terrain-tiles.spec.ts:449,756`.
- No native terrain execution, Pixel 8 capability evidence, iOS execution, headed visual capture,
  same-source cross-platform proof, or material A/B proof was run or claimed here.
- The PRD-wide negative controls for the sine field, Rapier ordering, eviction, erosion/flow, and
  core look ownership remain recorded in the earlier PRD-251 verification records; this repair
  adds the two exact seeded-red controls shown above.

## Changed files

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-8.md`
