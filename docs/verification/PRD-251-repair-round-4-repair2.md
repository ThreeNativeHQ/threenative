# PRD-251 repair-round-4 follow-up verification

Date: 2026-08-31

Baseline SHA: `c843c133ec8f71cb0522cf655324b67d9e1d7d71`

Branch: `linchpin/lane-251-r4-repair2-20260831`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

This follow-up repairs the three round-one review defects. The source PRD remains read-only. No
native, mobile, screenshot, or visual-inspection claim is made here.

## Red → green repair probes

Each focused regression was run against the c843c133 behavior before its implementation fix.

1. **Retained edge samples:** the focused core run exited `1`; the new per-tile assertion observed
   `8,400` bytes instead of the retained-storage total `8,672`, and the `8,400`-byte admission
   case did not throw. The fix counts four `Float32Array` edge samples for every LOD level in
   both `estimatedTileBytes` and `IResidentTile.bytes`.
2. **Topology observation isolation:** the focused core run exited `1` at the covered/uncovered
   resident comparison. The covered tile rendered and queried `-56.5548286` where the same
   coordinate without an observation field was `-52.891819`. The fix always builds resident
   fields from the game sampler; the optional field remains only for its declared topology
   observation and metrics. The regression compares render, `heightAt`, normals, collider
   heights, a neighboring tile, and both sides of a tile boundary.
3. **LOD pop contract:** the focused core run exited `1` because the base transition exposed two
   visible LOD meshes instead of one, and the large-mismatch negative control did not throw. The
   fix morphs the finer geometry and normals over three render frames, updates skirts with that
   geometry, and restores the canonical surface before selecting the target LOD. It never reads
   or mutates the caller's material.

## Focused green tests

```text
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Test Files: 1 passed (1)
Tests: 15 passed (15)

pnpm exec vitest run packages/playtest/__tests__/world-gameplay.spec.ts
Exit: 0
Test Files: 1 passed (1)
Tests: 7 passed (7)
```

The terrain scenario contract retains `maxLodPop <= 16`, requires that measurement to change,
and retains `maxLodTransitionFrames >= 3` plus `lodTransitions changed:true`.

## Browser scenario evidence

```text
node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/terrain.playtest.json --url 'http://127.0.0.1:5182/?terrain' --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5182 --strictPort' --browser-recipe webgpu --no-screenshots --headed
Exit: 1
```

The run reached the named NVIDIA WebGPU adapter and exercised real ArrowRight movement. The
repaired assertions passed with 8 resident tiles, `residentBytes: 19,647,824` under the
20,000,000-byte cap, `maxLodPop: 13.909428596496582` under 16, 33 LOD transitions, and three
transition frames. The run still fails closed on the existing `power-spectrum-slope`,
`median-64m-relief`, and `horton-strahler-order` topology thresholds. It produced no screenshot.

## Gate results

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | All workspace TypeScript projects completed. |
| `pnpm exec biome check packages/core/src/world-tiles.ts packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts` | 0 | No errors; two complexity warnings, including the new transition helper and the existing `follow` method. |
| `pnpm lint` | 1 | Repository-wide Biome run exceeded its 500-warning limit; no changed-file error was reported. |
| `pnpm test` | 1 | 87 files and 626 tests passed; six native tests failed because their CMake executables were not built. |
| `git diff --check` | 0 | No whitespace errors. |

Native desktop, Android, iOS, visual inspection, and the PRD's remaining quality and parity
evidence are unverified.
