# PRD-088 fresh lane r4 — repair round 1 gate evidence

Date: 2026-08-12
Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-088-r4-20260812`
Branch: `linchpin/starter-kit-088-r4-20260812`
Base: `adfe6f0ae0b8d648e5f3f4f473ad2d8e5d7f8a02` (`fix native spatial query repair controls`)

## Defect repaired

The `threenative-native` physics entry now exports `MAX_PHYSICS_QUERY_RESULTS`, matching
the web entry. The native contract suite compares the runtime export-key sets of the web and
native entrypoints, so a future ESM export omission fails the focused test.

## Commands and exact outcomes

| Command | Exit | Outcome |
| --- | ---: | --- |
| `pnpm exec vitest run --config vitest.config.ts packages/physics/__tests__/native-contract.spec.ts` | 0 | 1 test file passed; 8 tests passed. Existing Rapier deprecation warning was emitted on stderr. |
| `pnpm typecheck` | 0 | Root TypeScript check passed; recursive typecheck completed for the 10-of-11 workspace scope, including `@threenative/physics`. |
| `pnpm exec biome check packages/physics/src/native/index.ts packages/physics/__tests__/native-contract.spec.ts` | 0 | Checked 2 files; no fixes applied. |
| `git diff --check` | 0 | No whitespace errors. |

The initial scoped Biome attempt exited 1 only because the new namespace import needed the
repository's organized-import order; that order was corrected before the final result above.
No review was started after this repair.

## Fresh lane r5 — synchronous dirty-query repair

Recorded 2026-08-12 in worktree
`/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-088-r5-20260812`, branch
`linchpin/starter-kit-088-r5-20260812`, based on `987c9f3e8dd897446420bacdf9078dc203d7987e`.

This is an engine bug: Rapier 0.19.3 documents
`World.propagateModifiedBodyPositionsToColliders()` as the supported no-step collider-pose
refresh, but its public `BroadPhase` API exposes no query-index rebuild/update method. The
web adapter now preserves that propagation, excludes teleported bodies from stale
broad-phase callbacks, and queries their current colliders directly for ray, shape, and
point queries until the next `World.step()` clears the dirty set. Collision masks,
malformed-input validation, the synchronous return contract, and the native implementation
were preserved.

### Immediate regressions and observed-red controls

The existing localized ray regression remains: a body moves from `x = -4` to `x = 4`, and a
ray spanning both poses must hit the new face at distance `13.5`, position `x = 3.5`. The
new web point regression mirrors native: the old point hits before teleport, the old point
is empty after teleport, and the new point immediately returns the body.

Both temporary mutations were restored before positive gates:

| Control | Observed red result |
| --- | --- |
| Current web implementation before the dirty-query fallback | The new point regression exited `1`; expected `1` hit at the new point, received `0`. |
| Removed `dirtyBodies.add(entry)` from web `setBodyTransform` | The targeted point regression exited `1` with 1 failed and 5 skipped; expected `1` hit at the new point, received `0`. |

### Exact verification

| Command | Exit | Exact result |
| --- | ---: | --- |
| `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts packages/physics/__tests__/native-contract.spec.ts --testTimeout=15000` | 0 | 2 files, 14 tests passed. Rapier emitted its existing deprecated-initialization warning. |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib` | 0 | 8 Rust unit tests passed, 0 failed. |
| `pnpm --filter @threenative/runtime-native native:physics:parity` | 0 | Web parity 24/24; Rust parity 1/1; `scenarioCoverageMismatches: 0`, `teleportGroundedMismatch: 0`, and `validationOutcomeMismatches: 6` (existing expected mismatch). |
| `pnpm --filter @threenative/runtime-native test` | 0 | 42 native test files; 246 passed, 31 skipped, 277 total; parity passed. |
| `pnpm native:verify:desktop` | 0 | Import-free native-smoke bundle; 300 desktop frames; non-blank screenshot; 14 physics assertions; query marker passed: `clearHitCount:0, maskedHitCount:0, pointCount:1, pointMaskedHitCount:0, pointMissCount:0, rayDistance:2, rayNormal:[0,1,0], rayPosition:[0,0,1], shapeCount:1, shapeMaskedHitCount:0, shapeMissCount:0`. |
| `pnpm typecheck` | 0 | Root and recursive TypeScript checks passed for the 10-of-11 workspace scope. |
| `pnpm exec biome check packages/physics/src/simulation.ts packages/physics/__tests__/spatial-query.spec.ts` | 0 | 2 files checked; no errors or fixes. Three existing complexity warnings remain in `simulation.ts`. |
| `pnpm budgets` | 0 | 6 framework packages; 9,188/15,000 framework LOC; 69,674/50,000 native LOC review trigger; 4 examples; 7 PRD files; largest template 1,569 LOC. |
| `git diff --check` | 0 | No whitespace errors. |

This evidence proves web and Linux desktop native behavior only. Android and iOS were not
executed in this lane; no mobile-readiness claim is made. No generated build, third-party,
or artifact path is staged.

## Fresh lane r6 — synchronous create-body query repair

Recorded 2026-08-12 in worktree
`/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-088-r6-20260812`, branch
`linchpin/starter-kit-088-r6-20260812`, based on `3a5f7a038f5e7818ac74d3b3692148b07e929837`.

This is an engine bug: web `createBody` registered the collider but omitted the existing
`dirtyBodies` fallback set. Rapier refreshes its broad-phase query index on `step()`, so a body
created after the previous step could be invisible to immediate ray, shape, and point queries.
The fix adds every new entry to `dirtyBodies` immediately after `bodies` and `byCollider`
registration. The existing fallback clears after `step()`; teleport handling, masks,
malformed-input validation, native propagation, and max-results semantics are unchanged.

The immediate regression steps an off-axis body, creates a body at `x = 4`, then asserts the
new body before the next step through point, shape (`maxResults: 1`), and ray queries.

### Observed-red controls

Both controls were restored before positive gates:

| Control | Exit and observation |
| --- | --- |
| Base implementation before the fix | `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts --testTimeout=15000` exited `1`; 7 tests, 1 failed; expected one point hit for body `1`, received `[]`. |
| Removed `dirtyBodies.add(entry)` from `createBody` | Targeted Vitest exited `1`; 1 failed and 6 skipped; the same immediate point query expected one hit and received `[]`. |

### Exact verification

| Command | Exit | Exact result |
| --- | ---: | --- |
| `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts packages/physics/__tests__/native-contract.spec.ts --testTimeout=15000` | 0 | 2 files, 15 tests passed. |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --lib` | 0 | 8 Rust unit tests passed, 0 failed. |
| `pnpm --filter @threenative/runtime-native native:physics:parity` | 0 | Web parity 24/24; Rust parity 1/1; `scenarioCoverageMismatches: 0`, `teleportGroundedMismatch: 0`, and `validationOutcomeMismatches: 6` (existing expected mismatch). |
| `pnpm --filter @threenative/runtime-native test` | 0 on retry | 42 native test files; 240 passed, 37 skipped, 277 total; parity passed. First attempt was setup-only red because `packages/playtest/dist/index.js` was absent. |
| `pnpm native:build` | 0 | Linux `mystral` host built through `380/380` CMake/Ninja targets. |
| `pnpm native:verify:desktop` | 0 | Import-free native-smoke bundle; 300 core frames at 1280x720; 14 physics assertions; non-blank screenshot; query marker passed: `clearHitCount:0, maskedHitCount:0, pointCount:1, pointMaskedHitCount:0, pointMissCount:0, rayDistance:2, rayNormal:[0,1,0], rayPosition:[0,0,1], shapeCount:1, shapeMaskedHitCount:0, shapeMissCount:0`. |
| `pnpm typecheck` | 0 | Root plus recursive TypeScript checks passed for the 10-of-11 workspace scope. |
| `pnpm exec biome check packages/physics/src/simulation.ts packages/physics/__tests__/spatial-query.spec.ts` | 0 | 2 files checked; no errors or fixes. Three existing complexity warnings remain in `simulation.ts`. |
| `pnpm budgets` | 0 | 6 framework packages; 9,189/15,000 framework LOC; 69,674/50,000 native LOC review trigger; 4 examples; 7 PRD files; largest template 1,569 LOC. |
| `git diff --check` | 0 | No whitespace errors. |

The first desktop attempt stopped on missing ignored package `dist` outputs; the second stopped
on the missing ignored native binary. Building those setup artifacts resolved both conditions.
No generated build, third-party, or artifact path is staged. Android and iOS were not executed
in this lane; no mobile-readiness claim is made.
