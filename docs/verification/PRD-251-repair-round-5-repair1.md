# PRD-251 repair-round-5 seam-history verification

Date: 2026-08-31

Baseline SHA: `57811995abf1f305baf104c37f6a2489e2b4d56b`

Branch: `linchpin/lane-251-r5-20260831`

Lane: `lane-251-r5-repair1-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

This repair addresses the review defect where `maxSeamGap` sampled only the current visible
geometry. The source PRD remains read-only. No browser, native, mobile, screenshot, or visual
inspection claim is made here.

## Seeded red

The focused regression used two retained neighboring tiles. One tile morphed from fine to coarse;
the neighbor was already coarse. The live seam measured `0.006006717681884766` during the
transition and settled to zero afterward.

For the red probe, the repaired getters were temporarily changed back to current-frame-only
measurement and `#recordSeamDiagnostics` was temporarily disabled. The mutation was restored
before the green runs.

```text
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "retains the maximum seam diagnostics after a transient transition seam closes"
Exit: 1
AssertionError: expected +0 to be close to 0.006006717681884766, received difference is 0.006006717681884766, but expected 5e-7
Test Files 1 failed | 1
Tests 1 failed | 17 skipped | 18
```

## Repair

`TerrainTiles` now initializes finite lifetime maxima at zero and records live position-attribute
seam measurements after residency updates and at the end of every `process()` call. Both
`maxSeamGap` and `maxVisualSeamGap` retain their largest finite observation. Missing or non-finite
edge observations are skipped, so an empty or changing resident set cannot turn diagnostics into
`Infinity`/`NaN`. Skirts, LOD morphing, and the game-owned surface remain unchanged.

## Green evidence

```text
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "retains the maximum seam diagnostics after a transient transition seam closes"
Exit: 0
Test Files 1 passed (1)
Tests 1 passed | 17 skipped (18)
```

```text
pnpm exec vitest run packages/core/__tests__/world-*.spec.ts
Exit: 0
Test Files 4 passed (4)
Tests 41 passed (41)
```

The focused regression also verifies both maxima remain finite and nondecreasing after the
transient pair leaves residency and new tiles enter.

## Additional checks

```text
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Found 2 warnings in existing updateLodTransitionGeometry and follow complexity checks; no errors.
```

```text
git diff --check
Exit: 0
```

```text
pnpm typecheck
Exit: 0
All 20 participating workspace projects completed, including packages/core and examples/abyss-framework.
```

## Headed evidence class

None. Browser WebGPU, native desktop, Android/iOS capability, traversal, and visual evidence were
not part of this focused mechanism repair.

## Changed files

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-5-repair1.md`
