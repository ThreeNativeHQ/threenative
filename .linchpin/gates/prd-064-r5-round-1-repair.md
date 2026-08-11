# PRD-064 r5 round-1 manager evidence

Date: 2026-08-11
Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/night-watch-064-20260811-r5`
Branch: `linchpin/night-watch-064-20260811-r5`
Base: `7d58f0c` (`fix(runtime-native): transport renderer performance counters`)
Commit: verify with `git log -1`

## Defect repaired

The shared Three.js playtest bridge now reads the finite per-frame WebGPU counter at
`renderer.info.render.drawCalls` first, then falls back to the finite WebGL counter at
`renderer.info.render.calls`. It keeps `triangles` finite-only and omits unavailable or
non-finite metrics, so the production evaluator remains fail-closed. The production sampler
still reads the bridge's `drawCalls` field after the render callback; thresholds, warmup,
screenshot handling, and out-of-band performance bounds were not changed.

## Regression coverage

- The bridge suite proves WebGPU `render.drawCalls` wins over `render.calls`.
- The bridge suite proves WebGL `render.calls` remains the compatibility fallback.
- The bridge suite proves unavailable and non-finite draw/triangle counters are omitted.
- The production-profile suite proves both generated samplers read performance after render
  and that missing counters still fail the production budget.

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; pinned workspace dependencies installed |
| `pnpm --filter @threenative/playtest build` | PASS; ESM, declarations, and publint |
| `pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/three-bridge.spec.ts` | PASS; 17 tests |
| `cd packages/runtime-native && pnpm exec vitest run --config vitest.config.ts tests/production-profile.test.mjs` | PASS; 17 tests after the package build; the earlier parallel attempt was setup-blocked by the missing playtest dist |
| `node --check packages/runtime-native/scripts/profile-production.mjs && node --check packages/runtime-native/scripts/production-evidence.mjs` | PASS |
| `pnpm typecheck` | PASS after the build-backed test gate generated workspace declarations; the fresh-install attempt was setup-blocked by missing `@threenative/core` and `@threenative/physics` declarations |
| `pnpm lint` | EXIT 1; 16 pre-existing diagnostics in `packages/core`, none in the changed files |
| `pnpm test` | PASS; 85 files, 645 tests; runtime-native 41 files, 231 passed and 37 skipped; native physics parity passed |
| `pnpm budgets` | PASS; no hard failure; existing native runtime LOC review trigger reported at 66,516 vs 50,000 |
| `pnpm test:playtest` | PASS; framework movement and camera scenarios |
| `pnpm test:templates` | PASS; minimal, starter, and platformer scaffolded playtests |
| `git diff --check` | PASS |

The template sweep emitted the expected optional native prebuilt HTTP 404 in temporary
scaffold installs; installation continued and all scaffolded playtests passed. No template
or unrelated runtime file was changed.
