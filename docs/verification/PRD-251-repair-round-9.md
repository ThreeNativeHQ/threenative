# PRD-251 repair-round-9 verification — bridge topology coverage

Date: 2026-08-31

Baseline SHA: `cce34762b407124ff4d13ece2fac9ddeff807bec`

Branch: `linchpin/lane-251-r7-20260831`

Lane: `lane-251-r7-repair1-20260831`

Source PRD remained read-only. This repair stays in the engine layer: the defect was in
`packages/core/src/world-tiles.ts`, with its focused proof in the existing terrain-tile suite.

## Repair

`bridgeCoverageAt` now validates the bridge's current tile-pair keys, transforms every sampled
endpoint into world space, checks finite local and world coordinates, and requires each endpoint's
X/Z position to agree with the corresponding neighboring tile edge and sample orientation. Invalid
topology throws the seam diagnostic instead of subtracting stale vertical coverage. Bridge disposal,
residency, canonical surface parity, and the detached-bridge behavior remain unchanged.

## Seeded red

Mutation: add the regression `rejects an attached bridge translated away from its seam`, translate
the attached bridge with `bridge.position.x += 128`, and run it against the baseline source before
the topology validation was added.

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge translated away from its seam"
Exit: 1
Result:
1 test failed: expected [Function] to throw an error; the baseline accepted the translated,
attached bridge and therefore left the seam diagnostic unaware of the invalid topology.
```

## Green evidence

```text
Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts -t "rejects an attached bridge translated away from its seam"
Exit: 0
Result:
1 test passed; 26 skipped.

Command:
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
1 file passed; 27 tests passed.

Command:
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts packages/core/__tests__/world-erosion.spec.ts packages/core/__tests__/world-heightfield.spec.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
4 files passed; 50 tests passed.

Command:
pnpm --filter @threenative/core typecheck
Exit: 0
Result:
tsc --noEmit passed.

Command:
pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Result:
No errors; two inherited cognitive-complexity warnings remain in updateLodTransitionGeometry
and TerrainTiles.follow.

Command:
git diff --check
Exit: 0
Result:
No whitespace errors.
```

## Manager gate record

Read-only inspection was run before this repair commit:

```text
Command:
pnpm gate:status
Exit: 0
Result:
gate status (read-only)
run: tn-20260831T233912Z-3282599
phase: package-test
state: failed
heartbeat: 2026-08-31T23:40:26.329Z
owner: joao@joao-cachyos/pid:3282599
phase pid: 3282599
command: pnpm -r --workspace-concurrency=1 --if-present run test
worktree: /home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r7-20260831
HEAD: cce34762b407124ff4d13ece2fac9ddeff807bec
artifact: artifacts/gates/status.json (tn-20260831T233912Z-3282599:package-test)
terminal result: failed (exit 1)
next probe: pnpm exec tsx scripts/gate-cli.ts doctor --status-path /home/joao/projects/threenative/threenative-engine/.worktrees/lane-251-r7-20260831/artifacts/gates/status.json
```

The manager record is not reported as green; its failure is the pre-existing package-test/native
setup result recorded for the baseline. No native, Pixel 8, headed visual, cross-platform, or
material A/B evidence was run or claimed in this repair.

## Changed files

- `packages/core/src/world-tiles.ts`
- `packages/core/__tests__/world-terrain-tiles.spec.ts`
- `docs/verification/PRD-251-repair-round-9.md`
