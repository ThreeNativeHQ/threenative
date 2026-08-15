# Durable template survival proof — repair verification — 2026-08-15

Status: the review-round repair is implemented and locally verified. The durable defense
scenario now measures an input-controlled subject, and all seven template survival scenarios
use the same subject/input boundary.

## Repair

- Added the defense command beacon in `templates/defense/src/entities/Player.ts`.
- Registered it as `player` in `templates/defense/src/scenes/Defense.ts`.
- Bound Arrow keys and WASD to the `move` action in `templates/defense/src/game.ts`.
- The beacon reads `ctx.input.vector("move")` and moves on the board; its registration and
  update stay inside the shipped defense game.
- Changed defense `survives.playtest.json` to send `ArrowUp` for 60 ticks, track `player`,
  require `player` movement, and require a negative-Z axis delta.
- The first-commit diagnostics and visual-surface runner changes are preserved; the repair
  made no changes to `packages/playtest/src/runner/runner.ts` or its focused test.

## Seven-file audit

| Template | Subject | Movement entity | Input step | Extra movement proof |
| --- | --- | --- | --- | --- |
| action-rpg | `player` | `player` | `ArrowUp` | distance |
| defense | `player` | `player` | `ArrowUp` | distance + `-z` axis |
| minimal | `player` | `player` | `ArrowUp` | distance |
| platformer | `player` | `player` | `ArrowUp` | distance |
| racing | `player` | `player` | `ArrowUp` | distance |
| shooter | `player` | `player` | `ArrowUp` | distance |
| starter | `player` | `player` | `ArrowUp` | distance |

The audit found no remaining durable scenario that tracks an autonomous subject with a
wait-only step.

## Focused proof and observed-red controls

| Command | Result |
| --- | --- |
| `pnpm exec vitest run packages/create-threenative/__tests__/playtest.spec.ts packages/create-threenative/__tests__/defense.spec.ts` | 2 files, 36 tests passed |
| Registration mutant: replace `ctx.entities.add("player", player);` with a comment, then run `pnpm exec vitest run packages/create-threenative/__tests__/playtest.spec.ts -t "register defense's input-controlled player subject"` | Exit 1; 1 failed, 23 skipped. Failure: expected the source to contain `ctx.entities.add("player", player)`. Restored. |
| Input mutant: replace `const move = ctx.input.vector("move");` with a zero vector, then run `pnpm exec vitest run packages/create-threenative/__tests__/defense.spec.ts -t "moves the registered command beacon"` | Exit 1; 1 failed, 11 skipped. Failure: observed Z `8` instead of expected `6`. Restored. |

The two mutation runs are observed-red controls at the registration/input boundary, not
simulated green assertions.

## Browser matrix

Authoritative run, started only after the other browser workers had released port 4173:

```text
pnpm test:templates
exit 0
action-rpg, defense, minimal, platformer, racing, shooter, starter: scaffolded playtests passed
```

The defense durable scenario passed in the generated project with subject `player`; the
runner reported movement assertions and diagnostics green. The local install also reported
the expected optional `@threenative/runtime-native` Linux prebuilt manifest HTTP 404 and
continued successfully.

Three earlier attempts were discarded as non-evidence: two stopped with
`TN_PLAYTEST_SERVER_FAILED` because another worker owned port 4173, and one reached an
untouched action-rpg combat scenario while the shared browser was contaminated. No process
was killed; the final matrix was rerun after the port was free.

## Repository gates

- `pnpm test` — exit 0; final Vitest pass was 130 files / 1,110 tests, with 9 files / 35 tests
  skipped. The native runtime suite and Rust physics parity also passed.
- The required chained rerun, `pnpm typecheck && pnpm lint && pnpm test`, passed typecheck and
  lint and again reached 130 files / 1,110 tests, but exited 1 twice at the unrelated
  `packages/playtest/__tests__/orphan-cleanup.sh` step: first it reported orphan PID `723599`
  with `playwright_chromiumdev_profile-SYEvBj`, then PIDs `737408` and its Chromium children
  with `playwright_chromiumdev_profile-DXdVg3`. The browser processes disappeared afterward;
  a direct rerun of `bash packages/playtest/__tests__/orphan-cleanup.sh` returned exit 0 with
  `no orphans`. This is recorded as a harness teardown race, not as a defense test failure.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0; existing cognitive-complexity diagnostics remained warnings.
- `pnpm budgets` — exit 0; 14,552/15,000 framework LOC and the existing native-runtime
  review signal at 69,910/50,000 were reported.
- `pnpm --silent quality --json` — exit 0.
- `pnpm sync:agents --check` — 16 generated `CLAUDE.md` mirrors in sync.
- `git diff --check` — exit 0.
