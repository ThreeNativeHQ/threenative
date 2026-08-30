# PRD-251 Phase 1 verification

Date: 2026-08-30

Baseline: `9b2f64c8`

Worktree: `/home/joao/projects/threenative/worktrees/feature-mining-prd251-phase1-20260830`

Scope: Phase 1 only. Erosion, flow, GPU scheduling, LOD, eviction, native and mobile remain
unverified and are not claimed.

## Layer and ownership verdict

This is engine plumbing in the independent `@threenative/core/world` subpath. Core stores and
queries game-supplied numbers, creates appearance-free `THREE.BufferGeometry`, and translates the
row-major render buffer into Rapier's column-major height matrix. The game still owns the seed,
sampler, material, lighting, camera and every value that determines the terrain's look.

Phase 0 rejected a new package because this surface introduces no dependency that core must avoid.
The packed world-free bundle was exactly unchanged: 709,906 bytes before and after, SHA-256
`cf152402b86560fa89fe5bf963f6439baa96d3bbb47569c6a0669d580b35a846`, and `cmp` exited 0.

## Red-green unit proof

The parity fixture is deliberately non-square: 13 rows by 17 columns. Returning the canonical
row-major values directly from `toColliderHeights()` made the targeted test exit 1 at
`world-heightfield.spec.ts:74`, with maximum error 12.302858352661133 against the 0.000001 limit.
The fixed export transposes once to `collider[column * rows + row]` and the targeted suite reports:

```text
✓ packages/core/__tests__/world-heightfield.spec.ts (7 tests)
Test Files  1 passed (1)
Tests       7 passed (7)
```

The constructor now copies its input, and both public sample exports return copies. A caller
mutation therefore cannot silently split render, query and collision state.

## In-repository playtest

Command:

```sh
node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtests/terrain.playtest.json \
  --url 'http://127.0.0.1:5173/?terrain' \
  --browser-recipe webgpu --headed --allow-software
```

Result: exit 0. The scenario drove real input for 452.249064 m displacement and 452.672402 m
path length. The first chunk was absent after traversal, chunk 7 was visible with 17,916 projected
pixels, diagnostics were zero, and the adapter was NVIDIA/Turing. The headed `after.png` was
inspected: three visibly deformed terrain chunks and the grounded player were present.

## Detached packed-artifact validation

Sandbox root:
`/home/joao/projects/threenative/sandbox-runs/prd251-phase1-20260830/prd251-heightfield`.
It was created with `pnpm sandbox --genre open-world --template minimal`, installed the locally
packed `@threenative/core` tarball, and imported only `@threenative/core/world`; it did not import
workspace source.

The first detached run exposed a contract bug that the square in-repo terrain hid: Rapier consumes
a column-major matrix. With the row-major export the grounded player moved only 2.46 m and drifted
1.95 m on Z. After the transpose fix, the packed game passed:

```text
displacement:       66.309951 m
path:               70.429616 m
traversed relief:    8.311573 m (before: 0.003063 m)
outcome:             playing -> won
grounded:            true
diagnostics:         0
adapter:             NVIDIA / Turing
```

The final capture was inspected: two rolling ridges, the glowing goal ring and the teal player on
the terrain were visible.

The sandbox README maps `Heightfield` to PRD-251, the game rule “cross the ridge and traverse at
least 6 m of relief,” and the observable `won` outcome.

## Mutation proof

Changing the game-owned sampler to return a constant zero field preserved movement (69.665 m) but
held traversed relief at 0 and changed the outcome to `lost`. The unchanged scenario exited 1 with
`TN_PLAYTEST_RESOURCE_ASSERTION_FAILED` for the outcome and
`TN_PLAYTEST_RESOURCE_STATE_STAGNATED` for relief. Restoring the sampler returned the exact packed
game to the green result above.

## Capability and ownership checks

`pnpm build && pnpm sync:agents` generated 171 capability entries. The manifest contains
`Heightfield` for the situations “build terrain geometry and collision from one game-authored
height function” and “query the same ground height or normal that a player sees and collides
with.” `packages/core/dist/index.js` contains no world or `Heightfield` reference; `dist/world.js`
is an independent entry.

The look-ownership grep over `packages/core/src/world.ts` returns no material, colour, texture,
light, tonemapping or postprocessing constructor.

## Rule-2 kill switch

Command: `pnpm tsx scripts/count-loc.ts --world-repetitions=2`, exit 0. The two proven games are
the in-repository `TerrainProbe` and the detached packed mini-game. Shared call-site code and tests
are excluded from both arms. Because the implementation is portable TypeScript, the honest
no-framework arm is one equivalent fail-closed copy per game.

```text
world heightfield LOC: framework 232 (228 implementation + 4 wiring), repeated portable 456
across 2 proven games, 49.1% smaller
```

The subpath passes the kill switch. `scripts/__tests__/count-loc.spec.ts` also fails closed for a
zero repetition count and verifies the arithmetic.

## Final gates

The final source passed every required repository gate:

```text
pnpm typecheck                         exit 0
pnpm lint                              exit 0; 455 existing non-fatal warnings
pnpm test                              exit 0; 265 files passed, 1 skipped;
                                       2,656 tests passed, 3 skipped
pnpm budgets                           exit 0; all hard invariants passed
pnpm quality                           exit 0; 88 advisory findings recorded
pnpm check:docs                        exit 0; 1,112 links checked
pnpm sync:agents --check               exit 0; 16 mirrors in sync
pnpm tsx scripts/count-loc.ts \
  --world-repetitions=2                exit 0; framework arm 49.1% smaller
```

`pnpm test` required the runtime-owned V8 and QuickJS native contract executables. After building
those expected fixtures, all native, TypeScript and Rust suites passed. The final in-repository
playtest and a freshly repacked/reinstalled detached tarball playtest both passed after the last
source change.

## Changed-file census

Phase 1 adds the optional core subpath, tests and its real consumer, then updates generated
capability/docs surfaces and the executable LOC gate. It does not add a world package, appearance
policy, erosion, flow, LOD, residency, native or mobile behavior.

```text
docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md
docs/architecture/CHARTER.md
docs/verification/PRD-251-phase1.md
examples/abyss-framework/src/scenes/TerrainProbe.ts
packages/core/AGENTS.md
packages/core/CLAUDE.md
packages/core/__tests__/build.spec.ts
packages/core/__tests__/world-heightfield.spec.ts
packages/core/capabilities.json
packages/core/package.json
packages/core/src/world.ts
packages/core/tsup.config.ts
packages/create-threenative/__tests__/scaffold.spec.ts
packages/create-threenative/agent-docs/references/capability-reference.md
packages/create-threenative/capabilities.json
scripts/__tests__/count-loc.spec.ts
scripts/check-capability-docs.ts
scripts/count-loc.ts
```
