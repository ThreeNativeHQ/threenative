# PRD-061 r5 terminal-status gate evidence

- Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/night-watch-061-20260811-r5`
- Branch: `linchpin/night-watch-061-20260811-r5`
- Base: `b01b271`
- Date: 2026-08-11
- Scope: terminal status wording and required PRD relocation only. No proof artifact, round ledger,
  ROADMAP, or source change was made.

## Defect disposition

The completed round-4 PRD now starts with terminal wording that says round 4 executed, Phase 2
remains not green, and the document is not a new runnable round. It was moved with `git mv` from:

- `docs/PRDs/night-watch-26-08-10/PRD-061-round-4-paired-capability-proof.md`
- `docs/PRDs/done/PRD-061-round-4-paired-capability-proof.md`

The relocated file retains the historical round-3 text and all round-4 evidence.

## Commands and outcomes

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Fresh-worktree dependencies installed from the frozen lockfile. |
| Focused round/proof Vitest suite | 0 | 5 files, 56 tests passed: `round-ledger`, `sweep-ledger`, `proof-set`, `sweep-proof`, `sweep-pair`. |
| `pnpm --filter @threenative/playtest build` | 0 | Playtest bundle and publint passed; required to restore fresh-worktree build outputs. |
| `pnpm test` | 0 | Builds/publint, native parity, 85 test files, and 645 tests passed. |
| `pnpm typecheck` | 0 | Passed after the build-backed setup. |
| `pnpm lint` | 1 | 16 pre-existing diagnostics in `packages/core` (`collapse.spec.ts`, `collapse.ts`, `game.ts`); no scoped-file diagnostic. |
| `pnpm budgets` | 0 | Hard budgets passed; existing native-runtime review trigger reported at 64,214 LOC. |
| `git diff --check` | 0 | No whitespace errors. |

The first focused-suite attempt exited 254 because `vitest` was absent before the mandated install.
The first typecheck attempt exited 2 because package `dist/` declarations were absent before the
build-backed test setup; neither result is a source-verification result.
