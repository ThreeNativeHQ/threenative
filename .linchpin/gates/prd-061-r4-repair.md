# PRD-061 r4 narrowed repair gate evidence

- Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/night-watch-061-20260811-r4`
- Base: `linchpin/night-watch-061-20260811-r3` at `09d6e59`
- Date: 2026-08-11
- Scope: no-op proof/hash artifacts and the two stale ROADMAP cost claims only. No visual or physics design changes.

## No-op artifact repair

The current sealed proof hash was computed with:

```sh
pnpm exec tsx -e 'import { sealedProofHash } from "./scripts/make-sandbox.ts"; console.log(sealedProofHash(process.cwd(), "physics-puzzle"))'
```

Result: exit `0`, `c241ea5e4120afd4a50325a5b9ee0606e81e1b9d8539896f2b6e9f6b8f85da0d`.

The mismatch source was the temporary no-op hash manifest: `/tmp/round4-noop-physics/sweep.json` still declared the superseded `4fe343…` hash. The no-op source itself was usable. After changing only that manifest to `c241…`, the exact repository consumer was run:

```sh
pnpm sweep:proof /tmp/round4-noop-physics
```

Result: exit `1` with `Sealed proof failed for framework/physics-puzzle: 0/1 scenarios passed.` The current proof evaluated 10 assertion results: `world.seed` passed; eight physics/gameplay assertions failed, and the separate `diagnostics` assertion failed, including `resource.state.replayMatches.atSteps` among the physics/gameplay failures. The regenerated proof, raw runner report, and hash manifest were copied to:

- `docs/verification/round-4-2026-08-10-artifacts/no-op/proof.json`
- `docs/verification/round-4-2026-08-10-artifacts/no-op/proof-artifacts/0/runner-report.json`
- `docs/verification/round-4-2026-08-10-artifacts/no-op/sweep.json`

The committed artifact invariants were checked with `jq`: proof hash `c241…`, proof result `0/1`, runner `pass: false`, 10 runner assertion results, and only `world.seed` passing. All invariants passed. The first attempt before dependency installation stopped at `tsx: command not found`; `pnpm install --frozen-lockfile` and the playtest build were then run before the exact consumer.

## ROADMAP repair

Both stale claims now say that the framework won blind visual polish, while vanilla won fair authored cost by 2 LOC:

- `docs/strategy/ROADMAP.md:95`
- `docs/strategy/ROADMAP.md:124`

## Commands and outcomes

| Command | Exit | Outcome |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies installed from the frozen lockfile. |
| `pnpm --filter @threenative/playtest build` | 0 | Runner built and publint passed. |
| `pnpm exec vitest run scripts/__tests__/proof-set.spec.ts scripts/__tests__/sweep-proof.spec.ts scripts/__tests__/sweep-pair.spec.ts` | 0 | 3 files, 44 tests passed. |
| `pnpm sweep:pair docs/benchmark/sweeps/physics-puzzle-2026-08-11 docs/benchmark/sweeps/physics-puzzle-2026-08-11-2` | 0 | Shared proof `c241…`; both arms `0/1`; authored LOC 354 framework vs 352 vanilla, delta +2. |
| `pnpm typecheck` | 0 | Passed after the build-backed rerun; the initial fresh-install run failed only because workspace `dist/` outputs were not built yet. |
| `pnpm lint` | 1 | 16 known pre-existing diagnostics in `packages/core`; no changed-file diagnostic after formatting the regenerated runner JSON. |
| `pnpm test` | 1 | 85 test files and 645 tests passed; the existing playtest orphan-cleanup check then found one Chromium process. It ended after the command. |
| `pnpm budgets` | 0 | Hard budgets passed; existing native-runtime review trigger at 64,214 LOC reported. |
| `pnpm test:playtest` | 0 | Framework movement and camera scenarios passed. |
| `pnpm test:templates` | 0 | Minimal and starter/platformer scaffolded playtests passed. |

No additional regression test was needed: the focused proof suite plus the exact `sweep:proof` consumer and committed artifact invariants cover this stale-hash failure mode.
