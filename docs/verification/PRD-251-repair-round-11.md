# PRD-251 repair-round-11 verification — rendered bridge topology

Date: 2026-08-31

Baseline SHA: `98742502e3cecef93283444bb6de0ba477d586f5`

Branch: `linchpin/lane-251-r8-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

The source PRD remained read-only. This repair is limited to the existing terrain bridge seam
diagnostic and its focused negative control.

## Repair

`bridgeCoverageAt` now requires an indexed bridge geometry whose index contains complete triangle
topology, whose index values are finite integer vertex references in range, and whose draw range
starts at zero and fully includes the indexed triangles. Empty, partial, non-triangular, missing,
or malformed topology throws the existing bridge topology diagnostic. The same validation runs
before an existing bridge is refreshed, so reconciliation cannot overwrite an invalid index before
the diagnostic observes it. Existing finite-coordinate and X/Y/Z endpoint checks remain intact.

## Seeded red

Mutation: add the empty-draw-range regression to the test file while keeping the source at the
baseline SHA, set the attached bridge geometry's draw range to `(0, 0)`, and run:

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge with an empty rendered draw range"
Exit: 1
Result:
1 test failed; 28 tests skipped (29 total). The baseline accepted the bridge after its rendered
draw range was set to zero; the failure was:
AssertionError: expected [Function] to throw an error
at packages/core/__tests__/world-terrain-tiles.spec.ts:878:37
```

## Green evidence

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge with an empty rendered draw range"
Exit: 0
Result:
1 test passed; 28 tests skipped (29 total).

Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
1 file passed; 29 tests passed.

Command:
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
4 files passed; 52 tests passed.

Command:
pnpm --filter @threenative/core typecheck
Exit: 0
Result:
tsc --noEmit passed.

Command:
pnpm typecheck
Exit: 0
Result:
Root and workspace typechecks passed.

Command:
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
No errors; two inherited cognitive-complexity warnings remain in updateLodTransitionGeometry and
TerrainTiles.follow.

Command:
pnpm lint
Exit: 0
Result:
Biome passed with 500 repository warnings and no errors.

Command:
git diff --check
Exit: 0
Result:
No whitespace errors.
```

## Manager-gate limitations

The full repository test gate was run:

```text
Command:
pnpm test
Exit: 1
Result:
The package-test phase reported 4 failed test files and 87 passed; 6 tests failed, 626 passed,
and 39 were skipped. All six failures were runtime-native tests whose required CMake executables
were not built under packages/runtime-native/build/tn-linux or
packages/runtime-native/build/tn-linux-quickjs. Core's package test passed before the native phase.
```

The manager status probe is not green because it records that same package-test failure:

```text
Command:
pnpm gate:status
Exit: 0
Result:
state: failed
phase: package-test
terminal result: failed (exit 1)
HEAD: 98742502e3cecef93283444bb6de0ba477d586f5
```

No native, device, headed visual, cross-platform, or material A/B evidence was run or claimed.

## Scope inspection

The complete changed-file list is:

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-11.md`
