# PRD-064 r4 review-round-2 manager evidence

Date: 2026-08-11
Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/night-watch-064-20260811-r4`
Branch: `linchpin/night-watch-064-20260811-r4`
Base: `e57e241`
Commit: final repair commit; verify with `git log -1`

## Defect repaired

The production budget already enforced draw-call and triangle maxima, but the
generated web and native frame samplers only emitted `frameIndex` and `frameMs`.
The real shared Three.js playtest bridge now optionally observes finite
`renderer.info.render.calls` and `renderer.info.render.triangles`, exposing them
as the plain `drawCalls` and `triangles` fields on the existing observation
snapshot. Missing or non-finite renderer values remain absent.

Both injected production samplers read that bridge observation after the render
callback. They preserve the existing out-of-band `performanceBounds` transport,
warmup behavior, screenshot handling, and thresholds. If the bridge or either
counter is unavailable, the sample remains incomplete and the existing evaluator
fails closed with `TN_PROD_PERFORMANCE_BUDGET`.

## Regression coverage

- The browser/native bridge test proves finite renderer counters are exposed and
  unavailable counters are omitted.
- The production profile test executes both generated sampler sources, proves
  counters are read after rendering, retains the validator and no
  `TN_PLAYTEST_SCENARIO_INVALID` assertions, and retains independent P95,
  draw-call, and triangle budget failures.
- The same production test proves missing draw/triangle counters fail the
  declared budget rather than passing.

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `pnpm --filter @threenative/playtest build` | PASS; ESM, declarations, and publint |
| `pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/three-bridge.spec.ts` | PASS; 15 tests |
| `cd packages/runtime-native && pnpm exec vitest run --config vitest.config.ts tests/production-profile.test.mjs` | PASS; 17 tests |
| `node --check packages/runtime-native/scripts/profile-production.mjs packages/runtime-native/scripts/production-evidence.mjs` | PASS |
| `pnpm typecheck` | PASS; root and all workspace projects |
| `pnpm lint` | EXIT 1; 16 pre-existing diagnostics in `packages/core`; none in changed files |
| `pnpm test` | PASS; 85 files, 643 tests; runtime-native 41 files, 231 passed and 37 skipped; native physics parity passed |
| `pnpm budgets` | PASS; no hard failure; existing native runtime LOC review trigger reported at 66,516 vs 50,000 |
| `pnpm test:playtest` | PASS; framework movement and camera scenarios |
| `pnpm test:templates` | PASS; minimal, starter, and platformer scaffolded playtests |
| `git diff --check` | PASS |

The template sweep emitted the expected optional native prebuilt HTTP 404 in its
temporary install; the install continued and all scaffolded playtests passed.
