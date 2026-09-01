# PRD-251 repair-round-10 verification — vertical bridge topology

Date: 2026-08-31

Baseline SHA: `c8ab5754a8de357fcd811455673b1c1cb77957da`

Branch: `linchpin/lane-251-r8-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

The source PRD remained read-only. This repair is limited to the existing terrain bridge
diagnostic and its focused negative control.

## Repair

`bridgeCoverageAt` now resolves the current rendered terrain levels and validates each sampled
bridge endpoint in world space. X, Y, and Z must be finite and must satisfy the existing bridge
coordinate tolerance; a mismatch throws the existing bridge topology diagnostic. The endpoint
height comes from the corresponding current rendered terrain edge, so a visible bridge translated
vertically cannot preserve a zero visual seam gap. Pre-reconciliation seam measurement continues
to omit bridge coverage until the bridge is reconciled, preserving the detached-bridge and
horizontal-translation checks without changing disposal, residency, or canonical surface parity.

## Seeded red

Mutation: run the added vertical-translation regression against the baseline source at the
baseline SHA, before the Y validation.

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge translated vertically away from its seam"
Exit: 1
Result:
1 test failed; 27 tests skipped. The failure was:
AssertionError: expected [Function] to throw an error
at packages/core/__tests__/world-terrain-tiles.spec.ts:849:37, the `tiles.process()` assertion.
```

## Green evidence

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge translated vertically away from its seam"
Exit: 0
Result:
1 test passed; 27 tests skipped (28 total).

Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
1 file passed; 28 tests passed.

Command:
pnpm --filter @threenative/core typecheck
Exit: 0
Result:
tsc --noEmit passed.

Command:
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
No errors; two pre-existing cognitive-complexity warnings remain in
updateLodTransitionGeometry and TerrainTiles.follow.

Command:
pnpm typecheck
Exit: 0
Result:
Root and workspace typechecks passed after building the repository's missing local package
artifacts.

Command:
pnpm lint
Exit: 0
Result:
Biome passed with repository warnings only (500 warnings; no errors).
```

## Gate limitations

The manager status probe was unavailable in this lane:

```text
Command: pnpm gate:status
Exit: 1
Result: RED observed: invalid or stale gate status — status file
/home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r8-20260831/artifacts/gates/status.json
is missing.
```

The root test command was also not fully green because the existing runtime-native CMake test
executables were not built:

```text
Command: pnpm test
Exit: 1
Result: 4 test files failed; 87 passed. 6 tests failed, 626 passed, and 39 were skipped.
The failures report missing executables under packages/runtime-native/build/tn-linux and
packages/runtime-native/build/tn-linux-quickjs and provide their cmake build commands.
```

No native, Pixel 8, headed visual, cross-platform, or material A/B evidence was run or claimed.

## Scope inspection

`git diff --check` passed. The complete changed-file list is:

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-10.md`
