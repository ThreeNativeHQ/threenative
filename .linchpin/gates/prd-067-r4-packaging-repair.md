# PRD-067 r4 packaging-repair gate evidence

Date: 2026-08-11
Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/night-watch-067-20260811-r4`
Base: `linchpin/night-watch-067-20260811-r3` at `4a49e6e`
Scope: the two requested packaging tests only; existing packaging, bundle, icon, and
platform-identity changes are preserved.

## Gate results

| Command | Exit | Outcome |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies installed. |
| `pnpm --filter @threenative/playtest build` | 0 | Playtest CLI and declarations built for fresh-worktree checks. |
| `pnpm exec vitest run --config vitest.config.ts tests/orientation-packaging.test.mjs tests/ios-packaging.test.mjs` from `packages/runtime-native` | 0 | 2 files, 15 tests passed. |
| `pnpm typecheck` after `pnpm build` | 0 | All 9 checked workspace projects passed. |
| `pnpm lint` | 1 | 16 pre-existing diagnostics in `packages/core`; no diagnostic was reported in the changed runtime-native tests. |
| `pnpm test` | 0 | 86 files, 675 tests passed; runtime-native package tests passed (41 files, 221 passed, 37 skipped) and Rust physics parity passed. |
| `pnpm budgets` | 0 | Hard budgets passed; existing native-runtime review trigger reported at 65,258 LOC. |
| `pnpm test:playtest` | 0 | Abyss framework movement and camera scenarios passed with no diagnostics. |
| `git diff --check` | 0 | No whitespace errors. |

## Template check outcomes

`pnpm test:templates` was run twice. The first run exited 1 before assertions because a
concurrent `night-watch-061` worktree owned port `4173`; that process was left untouched.
After it released the port, the retry passed the generated minimal and starter templates,
then exited 1 in the generated platformer `damage` scenario. The two failing assertions were
the template's `GameState.topSpeed` threshold and `player.health` change; diagnostics passed.
This is unrelated generated gameplay baseline behavior, outside the two changed packaging
tests. A concurrent `night-watch-064` template run occupied port `4173` afterward, so no
third full-matrix run was started.

## Setup and retry notes

- The pre-install focused Vitest invocation exited 254 because this fresh worktree had no
  `vitest` binary; frozen install fixed that environment issue.
- The first post-install focused invocation used the root Vitest config and exited 1 with
  “No test files found”; the package-local command above is the repository's correct focused
  command.
- `pnpm typecheck` first reached exit 2 because generated playtest, core, and physics
  declarations were absent. `pnpm --filter @threenative/playtest build`, then `pnpm build`,
  supplied the normal fresh-worktree build prerequisites; the final typecheck passed.
- Scaffold installs during the template check reported the expected optional
  `@threenative/runtime-native` Linux-x64 release-manifest 404 and continued with the web
  playtests.

No physical-device screenshots were available or claimed. This evidence does not claim
mobile-ready status.
