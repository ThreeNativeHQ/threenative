# PRD-251 repair-round-5 verification

Date: 2026-08-31

Baseline SHA: `dd6302681e68658adfe48d10720bcae6a9d207a2`

Branch: `linchpin/lane-251-r5-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

This repair lane addresses the three round-two review defects. The source PRD remains read-only.
No browser, native, mobile, screenshot, or visual-inspection claim is made here.

## Red probes

1. **Per-frame LOD measurement.** Before the fix, the focused command exited `1` with 25 passing
   and 3 failing tests. The old complete-LOD measurement rejected the generated transition with
   `LOD pop threshold 16 exceeded by 16.40039825439453`; it also failed the new visible-transition
   assertion. The test used a scaled sampler whose complete LOD mismatch exceeds 16 while each
   three-frame morph step remains below 16.

2. **Visible seam measurement.** In the same pre-fix run, the static edge-sample path reported
   `0.013993382453918457` while the visible transition geometry measured
   `0.004664421081542969`. The regression therefore failed under the old immutable-edge path.

3. **Unused stored-region API.** In the same pre-fix run, the source census regression failed
   because `world.ts` still declared `IHeightfieldRegionOptions` and `Heightfield.fromStoredRegion`
   without a non-test consumer.

4. **No-morph seeded negative control.** I temporarily removed the per-frame
   `updateLodTransitionGeometry` call from `#advanceLodTransitions` and ran:

   ```text
   pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "measures the visible per-frame displacement"
   Exit: 1
   Failed: TerrainTiles LOD pop threshold 16 exceeded by 20.957183837890625
   ```

   The call was restored before the green run. This proves the no-pop assertion does not silently
   pass when the morph is removed.

## Green repair evidence

```text
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-heightfield.spec.ts
Exit: 0
Test Files: 2 passed (2)
Tests: 28 passed (28)
```

The LOD metric now compares the currently visible surface between rendered transition frames,
including the final switch to the canonical target. Seam diagnostics read the live position
attribute of the visible LOD on every observation, so transition morphing cannot be hidden by
retained build-time edge samples. No material or appearance parameter was changed.

The unconsumed `IHeightfieldRegionOptions` and `Heightfield.fromStoredRegion` surface was removed;
resident fields continue to be created from the game sampler. The production census command exited
`0` with no output:

```text
if rg -n "fromStoredRegion|IHeightfieldRegionOptions" packages/core/src --glob '!**/__tests__/**'; then exit 1; fi
production stored-region API census: empty
```

## Checkpoint gates

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm --filter @threenative/core build` | 0 | ESM/DTS build and publint passed. |
| `pnpm typecheck` | 0 | All workspace TypeScript projects completed. |
| `pnpm exec biome check packages/core/src/world-tiles.ts packages/core/src/world.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/core/__tests__/world-heightfield.spec.ts` | 0 | No errors; two existing complexity warnings (`updateLodTransitionGeometry`, `follow`). |
| `pnpm lint` | 0 | Repository check completed with 500 warnings and no reported changed-file error. |
| `pnpm quality` | 0 | Recorded 99 findings; this lane adds no quality gate failure. |
| `pnpm tsx scripts/count-loc.ts` | 0 | Platformer template 2,569 LOC; generated HUD 60 LOC; cloth framework 46 LOC. |
| `pnpm sync:agents` | 0 | 16 mirrors synced, 0 written. |
| `git diff --check` | 0 | No whitespace errors. |
| `pnpm budgets` | 1 | Stopped at outside-scope native census drift: 8,043 measured vs 8,030 recorded, tolerance 5. |
| `pnpm test` | 1 | 87 files and 626 tests passed; 39 skipped; 6 runtime-native tests failed because required CMake executables were not built. |

The incumbent-path check also exited `0` with no matches:
`rg -n "Math\\.sin|wireframe" examples/abyss-framework/src/scenes/TerrainProbe.ts`.

## Headed evidence class

None. Browser WebGPU, native desktop, Android/iOS capability, same-source parity, traversal,
visual side-by-side captures, and the full PRD quality table remain unverified in this focused
repair lane.

## Changed files

- `packages/core/src/world-tiles.ts`
- `packages/core/src/world.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `packages/core/__tests__/world-heightfield.spec.ts`
- `docs/verification/PRD-251-repair-round-5.md`
