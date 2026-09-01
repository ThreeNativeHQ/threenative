# PRD-251 Phase 3 verification

Date: 2026-08-30

Baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-251-exec-20260830`

Status: residency, LOD composition, skirts, collider lockstep and browser traversal are green;
native traversal and a measured screen-space pop threshold are not claimed.

## Green unit evidence

Command:

```sh
pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
```
Exit code: `0`.

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

The tests cover hard tile/byte caps with complete-unit eviction and `AssetLoader.release`, mixed
LOD seam coverage with skirts, and fail-closed admission when one tile cannot fit.

## Browser traversal evidence

Command:

```sh
node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtests/terrain.playtest.json \
  --url 'http://127.0.0.1:5173/?terrain' \
  --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5173 --strictPort' \
  --browser-recipe webgpu --allow-software --headed
```

Exit code: `0`.

```text
scenario: terrain-streaming
target: web
movement distance: 383.3739925772788 m
path length: 389.97284732558575 m
player x delta: 382.4175720214844 m
ticks after: 216 (180 input frames)
resident tiles: 9; peak resident tiles: 9; cap: 9
resident bytes: 3175992; peak resident bytes: 3175992; cap: 8000000
max seam gap: 0
LOD transitions: 66 after traversal
diagnostics: 0
generation: cpu-fallback; reduced erosion iterations: 4
```

The traversal crossed six 64 m tile boundaries and the configured 48 m/96 m LOD thresholds.
The browser capture recorded adapter identity: WebGPU, vendor NVIDIA, architecture Turing. The
headed run used the runner's private Xvfb display `:3`, 1280×720.

## Seeded negative controls

NC-2 temporarily returned render-row-major values directly to Rapier. The source was restored
after the run.

```sh
pnpm exec vitest run packages/core/__tests__/world-heightfield.spec.ts
```

Exit code: `1`: one test failed with maximum render/collider error
`12.302858352661133` versus the `0.000001` limit; the fixed suite later reported `7 passed`.

NC-3 temporarily made `#evict` a no-op. The source was restored after the run. The exact runner
command above exited `1`; the terrain component reported `residentTiles: 22` and
`peakResidentTiles: 22` against the cap of `9`, with zero diagnostics and movement
`383.3739925772788 m`. Resident bytes happened to remain below the byte cap in this mutation, so
the tile-count assertion is the observed red.

The PRD's literal command was also checked:

```sh
pnpm playtest --project examples/abyss-framework --scenario terrain
```

It exited `254` because this repository has no root `playtest` script (`pnpm` suggested
`test:playtest`). That setup failure is recorded, not presented as a playtest result.

## Headed inspection and checkpoint record

`artifacts/playtest/after.png` was inspected from the headed run. It shows a non-blank,
normal-shaded, visibly varied generated field. This is one inspected final frame, not the PRD's
required three-capture side-by-side visual proof. No measured screen-space pop series or traversal
video is claimed.

- Exact baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`
- Seeded reds: NC-2 and NC-3, both restored after red observation.
- Headed evidence class: one inspected browser frame; adapter identity recorded.
- Native evidence class: not executed in this phase.

Changed files for this phase:

```text
packages/core/src/world-tiles.ts
packages/core/src/world.ts
examples/abyss-framework/src/scenes/TerrainProbe.ts
examples/abyss-framework/playtests/terrain.playtest.json
packages/core/__tests__/world-terrain-tiles.spec.ts
docs/verification/PRD-251-phase3.md
```
