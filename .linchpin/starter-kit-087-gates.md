# PRD-087 platformer qualification repair — gate evidence

Date: 2026-08-12

Scope: this lane repairs the fifth-genre qualification obligation by shipping a terminal-loop
upgrade to the existing platformer template. It does not claim the four child kits, their blind
visual scores, or a four-kit programme.

| Field | Value |
|---|---|
| Base | `d83ce20c252ff1fc6ab1c4dec145a5fe9ad12067` |
| Branch | `linchpin/starter-kit-087-r5-20260812` |
| Worktree | `/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-087-r5-20260812` |

## Implemented deliverable

- Portable gameplay/state: `packages/create-threenative/templates/platformer/src/state.ts`,
  `src/level/Checkpoints.ts`, `src/scenes/Level.ts`, and typed `src/game.ts`.
- Terminal win: `GameState.terminal = 1` plus `game/won` only when the player reaches the
  reachable final-platform threshold (`playerX >= 21.5`) while grounded on the platform.
- Terminal fail: `GameState.terminal = 2` plus `game/lost` at `hearts = 0`; exhausted hearts do
  not respawn, and gameplay updates stop after either terminal state.
- Render-owned observation: `src/render/hud.ts` and `src/ui/Hud.tsx` expose the numeric terminal
  value; movement, remaining-hearts respawn, and stomp behavior stay in the template gameplay.
- Required scenarios: `playtests/terminal-loop-win.playtest.json` and
  `playtests/terminal-loop-fail.playtest.json`, both wired into the template `test` script.

## Exact results

| Gate | Result | Exact command or observation |
|---|---|---|
| Dependency install | PASS | `pnpm install --frozen-lockfile`; exit `0` |
| Platformer typecheck | PASS | `pnpm --dir /tmp/threenative-platformer-contact.TZsc0O/platformer run typecheck`; exit `0` |
| Platformer web build | PASS | `pnpm --dir /tmp/threenative-platformer-contact.TZsc0O/platformer run build:web`; exit `0` |
| Canonical scaffold playtests | PASS | `pnpm test:templates`; minimal, starter, and platformer scaffolded playtests passed; exit `0` |
| Platformer focused loop | PASS | `xvfb-run -a -s '-screen 0 1600x900x24' pnpm --dir /tmp/threenative-platformer-contact.TZsc0O/platformer run test:terminal-loop`; `terminal-loop-win` and `terminal-loop-fail` both passed; exit `0` |
| Terminal win assertions | PASS | `terminal = 1`, `playerX = 24.60979652404785 >= 21.5`, `grounded = true` at labeled `reach-goal`, and one `game/won` signal; direct terminal-loop run passed |
| Terminal fail assertions | PASS | `terminal = 2`, `hearts = 0`, `respawns = 0`, and one `game/lost` signal; direct terminal-loop run passed after the extra wait/rightward damage pass |
| Observed-red contact/goal control | PASS | Temporary control started at `playerX = 19.5`, crossed the gap to `playerX = 21.636659622192383` with `grounded = false`; fixed predicate passed with `terminal = 0` and zero `game/won` signals (exit `0`), while the temporary x-only predicate went red (exit `1`) with `terminal = 1` and one `game/won` signal; source and scenario restored immediately |
| Focused unit/scaffold tests | PASS | `pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__/platformer.spec.ts packages/create-threenative/__tests__/playtest.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts`; 3 files, 33 tests passed, exit `0` |
| Scoped Biome | PASS | `pnpm exec biome check packages/create-threenative/templates/platformer/src/state.ts packages/create-threenative/templates/platformer/src/scenes/Level.ts packages/create-threenative/templates/platformer/playtests/terminal-loop-win.playtest.json packages/create-threenative/templates/platformer/playtests/terminal-loop-fail.playtest.json packages/create-threenative/__tests__/playtest.spec.ts`; 5 files checked, exit `0` |
| Workspace build | PASS | `pnpm build`; exit `0` |
| Workspace typecheck | PASS | `pnpm typecheck`; exit `0` |
| Workspace tests | PASS | `pnpm test`; 99 files, 825 tests passed; runtime-native 42 files, 240 passed and 37 skipped; Rust parity passed; exit `0` |
| Full lint | RECORDED BASELINE | `pnpm lint`; exit `1` on pre-existing formatter error in `scripts/__tests__/native-cpu-profile.spec.ts`; changed files only pass scoped Biome |
| Diff whitespace | PASS | `git diff --check`; exit `0` |

The first terminal-loop attempt used `GOAL_X = 27` and correctly failed closed: the real route
settled at `playerX = 21.856`, leaving `terminal = 0`. The threshold was corrected to the
reachable final-platform threshold before the passing run, and the positive route now samples
grounded contact at `reach-goal`. The temporary gap-fall control proves that the x-only predicate
would win while airborne; no four-kit claim was restored.
