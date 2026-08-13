# PRD-092 repair gates

Date: 2026-08-12

Base: `61f86edcefc3fddb4dc940f34ba752c52965dcba` on
`linchpin/starter-kit-092-r4-20260812`.

This is the acceptance record for the two-review repair lane. The PRD-090 racing source was
staged in this worktree as an input dependency. This lane deletes the duplicate source, rewrites
its callers to the promoted core follower, moves lap/place ordering into the racing template, and
proves the result with source checks, unit tests, and real WebGPU scenarios. The route-closure JSON
remains historical inventory; it is not deletion evidence.

## Route-copy closure

The PRD-087 `PathFollow3D` row has three original implementation sites:

| Site | Current evidence | Closure state |
|---|---|---|
| Racing | `packages/create-threenative/templates/racing/src/track/Driveline.ts` is deleted; `Track.ts`, `Rival.ts`, `TrackSector.ts`, and `Race.ts` use `PathFollow3D`; `src/track/Ranking.ts` owns lap/place ordering; `packages/create-threenative/__tests__/racing.spec.ts` executes the replacement | **closed** — actual source deletion/rewrite and WebGPU behavior are proven |
| Strategy | `packages/create-threenative/templates/defense/src/attackers/Attacker.ts` imports and constructs `PathFollow3D` | **closed** — core `PathFollow3D` remains the route implementation |
| Platformer | `packages/create-threenative/templates/platformer/src/entities/Chaser.ts` imports and constructs `PathFollow3D` and retains reach gating | **closed** — core `PathFollow3D` remains the route implementation |

Run this exact command from the repository root:

```sh
set -eu
test ! -e packages/create-threenative/templates/racing/src/track/Driveline.ts
if rg -n --glob '*.ts' '\bDriveline\b|track/Driveline\.js|\bdriveline\b' \
  packages/create-threenative/templates/racing/src; then
  echo "racing source still references Driveline"
  exit 1
fi
rg -n 'PathFollow3D' \
  packages/create-threenative/templates/racing/src/track/Track.ts \
  packages/create-threenative/templates/racing/src/entities/Rival.ts \
  packages/create-threenative/templates/racing/src/track/TrackSector.ts \
  packages/create-threenative/templates/racing/src/scenes/Race.ts
if rg -n 'IPathFollow3D(Racer|RankedRacer)|routeProgress|rank\(|\blap\b|\bplace\b|\bracer\b' \
  packages/core/src/path-follow.ts packages/core/src/index.ts; then
  echo "racing vocabulary leaked into core"
  exit 1
fi
pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts \
  packages/create-threenative/__tests__/racing.spec.ts
```

Observed result: the source deletion check passed, the racing source scan found no duplicate
references, the core vocabulary scan found no racing-specific symbols, and the executable focused
run passed with 2 files and 7 tests. The numeric open-path endpoint assertion and racing-local
lap-aware ranking assertion both ran.

## Endpoint projection regression

`packages/core/src/path-follow.ts` now uses the preceding sample as the tangent start when an open
path projects to its final sample. The test projects `route.sample(route.totalLength).point`, checks
unit length, and requires a dot product above `0.9` against the final control-point segment. Loop
projection, malformed route inputs, and malformed deltas remain in the same core test file.

## Racing WebGPU evidence

The standalone racing template was typechecked and built using temporary ignored links to the
installed workspace packages; those links were moved out after the run.

| Result | Command | Exact result |
|---|---|---|
| pass | `pnpm exec tsc --noEmit -p packages/create-threenative/templates/racing/tsconfig.json` | racing template typecheck passed |
| pass | `pnpm exec vite build` from `templates/racing` | 115 modules transformed; production bundle built |
| pass | WebGPU `ranking.playtest.json` under `xvfb-run` | `sameDistanceRanking` was `lap-ahead` at both labels; `trackProgress=142.80964572963154`; 0 console/network/runtime errors |
| pass | full racing `pnpm run test:playtest` under `xvfb-run` | all 6 scenarios passed: shortcut, reverse, boost, rescue, ranking, outcome; outcome observed `completedLaps=3`, `place=2`, `raceStatus=DNF` |

## Racing route mutation

With `apply_patch`, the racing-local expression
`lap * route.totalLength + route.project(position).distanceFromStart` was temporarily changed to
`route.project(position).distanceFromStart`. The same WebGPU ranking scenario exited `1` with
`TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED`: at `lap-aware-baseline` it observed
`lap-behind` instead of the required `lap-ahead`. The source was restored before the positive
focused run and full racing suite.

## Review repair — direct-space ray query and palette cache

The racing track now reads the optional public `IPhysicsContext.directSpaceState` field and calls
`intersectRay({ collisionMask: 2, from, to })`. The Three.js road probe remains only for the
template's pre-PRD-088 fallback case; a present direct-space no-hit is not replaced by a visual
probe. Toon materials are cached by both color and roughness.

| Result | Command | Exact result |
|---|---|---|
| pass | `pnpm exec vitest run packages/create-threenative/__tests__/racing.spec.ts` | 1 file passed; 5 tests passed |
| pass | `pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts packages/create-threenative/__tests__/racing.spec.ts` | 2 files passed; 10 tests passed |
| pass | `pnpm exec tsc --noEmit -p tsconfig.json` from `templates/racing` | exit 0 with temporary ignored workspace-package links; links removed afterward |
| pass | `node node_modules/vite/bin/vite.js build` from `templates/racing` | Vite 8.2.0; 115 modules transformed; production bundle built |
| pass | `xvfb-run -a -s '-screen 0 1600x900x24' pnpm run test:playtest` from `templates/racing` | exit 0; all 6 scenarios passed: shortcut, reverse, boost, rescue, ranking, outcome; outcome `completedLaps=3`, `place=2`, `raceStatus=DNF` |
| pass | `pnpm exec biome check packages/create-threenative/__tests__/racing.spec.ts packages/create-threenative/templates/racing/src/track/Track.ts packages/create-threenative/templates/racing/src/render/palette.ts` | 3 files checked; no fixes |
| pass | `git diff --check` | no whitespace errors |

The direct-space mutation set `const directSpaceState = undefined`; the focused racing run exited
1 with 2 failed and 3 passed tests. The palette mutation changed the key to `${color}`; the same
run exited 1 with 1 failed and 4 passed tests. Both mutations were restored before the positive
runs. The live WebGPU run used this lane's pre-PRD-088 physics package and therefore exercised the
required Three.js fallback; the direct-space path is proven by the structural public-API test.

## Repair command results

| Result | Command | Exact result |
|---|---|---|
| pass | `pnpm install --frozen-lockfile` | lockfile current; 163 packages installed |
| pass | `pnpm sync:agents` | 13 mirrors checked; 1 generated `CLAUDE.md` mirror written |
| pass | `pnpm --filter @threenative/playtest build` | ESM/types build and publint passed |
| pass | `pnpm --filter @threenative/core build`, `@threenative/physics build`, `@threenative/ui build`, `create-threenative build` | all ESM/types builds and publint passed |
| pass | `pnpm typecheck` | root and all 10 workspace projects typechecked successfully |
| pass | scoped `pnpm exec biome check` over 9 changed TypeScript files | 9 files checked; no fixes |
| pass | `git diff --check` | no whitespace errors |
| pass | focused Vitest command above | 2 files passed; 10 tests passed |

## Scope and status

Only the core route implementation/tests, racing source rewrite/test, generated racing instructions,
and the two requested evidence files are intended to be staged. No push, merge, rebase, or
unrelated-lane edit is part of this repair.

The final handoff reports the repair commit SHA and confirms an empty `git status --short` after
the intentional paths were staged and committed.

## Endpoint projection repair — r5

The open-path projection now calculates `distanceFromStart` from the nearest sample index, while
the clamped final segment remains responsible for the endpoint tangent. Loop distance semantics
and tangent calculation are unchanged.

| Result | Command or control | Exact result |
|---|---|---|
| red — unfixed source | `pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts` | exit 1; 1 file failed; 1 test failed and 4 passed; endpoint expected `9.740065414081164`, received `9.663971153033655` |
| green — fixed source | `pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts` | exit 0; 1 file passed; 5 tests passed |
| red — observed control | Temporarily regressed `distanceFromStart` to `(segment / segmentCount) * this.totalLength`, then ran the same focused command | exit 1; 1 file failed; 1 test failed and 4 passed; endpoint expected `9.740065414081164`, received `9.663971153033655`; source restored |
| pass | `pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts packages/create-threenative/__tests__/racing.spec.ts` | exit 0; 2 files passed; 10 tests passed |
| pass | `pnpm --filter @threenative/core typecheck` | exit 0 |
| pass | `pnpm --filter @threenative/core build` | exit 0; ESM/DTS build and publint passed |
| pass | `pnpm exec biome check packages/core/src/path-follow.ts packages/core/__tests__/path-follow.spec.ts` | exit 0; 2 files checked; no fixes applied |
| pass | `git diff --check` | exit 0; no whitespace errors |

The clean checkout required `pnpm install --frozen-lockfile`, `pnpm --filter @threenative/playtest
build`, and `pnpm --filter @threenative/physics build` to create ignored workspace `dist/`
outputs before the final package checks could resolve workspace entrypoints. The initial combined
test and core typecheck/build attempts failed only on those missing outputs; the rerun above passed
after the dependency builds.
