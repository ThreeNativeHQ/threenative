# PRD-251 repair-round-13 verification — unsigned bridge index buffers

Date: 2026-08-31

Baseline SHA: `aa950e50c3a1f4694dc22d12c38624a9131deb7a`

Branch: `linchpin/lane-251-r9-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

The source PRD remained read-only. This repair is limited to the rendered terrain bridge
topology validator, its focused floating-point index regression test, and this evidence note.

## Seeded red

The focused test was added while production remained at the baseline SHA. It replaces an
attached bridge's valid index attribute with a `Float32Array` containing the same numeric strip
indices, then expects the existing bridge-topology diagnostic.

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t 'rejects an attached bridge whose rendered index buffer uses floating-point data'
Exit: 1
Result:
1 test failed; 30 tests skipped (31 total). The baseline accepted the floating-point rendered
index buffer; the failure was:
AssertionError: expected [Function] to throw an error
at packages/core/__tests__/world-terrain-tiles.spec.ts:941:37
```

## Green evidence

`validateBridgeTriangleTopology` now accepts only `Uint16Array` and `Uint32Array` index arrays. The
existing exact strip-connectivity, draw-range, coordinate, and attachment checks remain intact.

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t 'rejects an attached bridge whose rendered index buffer uses floating-point data'
Exit: 0
Result:
1 test passed; 30 tests skipped (31 total).

Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
1 file passed; 31 tests passed.

Command:
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
4 files passed; 54 tests passed.

Command:
pnpm --filter @threenative/core typecheck
Exit: 0
Result:
tsc --noEmit passed.

Command:
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
No errors; two pre-existing cognitive-complexity warnings remain in updateLodTransitionGeometry
and TerrainTiles.follow.
```

## Manager-gate limitations

The full repository `pnpm test`, root `pnpm typecheck`, root `pnpm lint`, native/device, and visual
gates were not run in this narrow repair lane. No native, device, headed visual, cross-platform, or
material A/B evidence was executed or claimed. No verification check was blocked; these broader
gates are unrun by scope.

## Scope inspection

The complete changed-file list is:

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-13.md`
