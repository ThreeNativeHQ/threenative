# PRD-203 loading single source — 2026-08-23

Status: implementation verified; the repository visual score gate remains blocked by its
pre-existing score file, and the all-template playtest gate is flaky on unrelated triviality
assertions.

## Scope

- Canonical source: `packages/create-threenative/template-assets/loading.ts`.
- Stamped outputs: action-rpg, defense, platformer, racing, shooter, and starter.
- `minimal` remains the intentional loading-screen no-op from PRD-153 and is not one of the six
  full loading implementations.

## Consistency and stamping

The focused consistency spec passed after restoration:

```text
pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__/loading-screen.spec.ts --reporter=dot
Test Files  1 passed (1)
Tests       18 passed (18)
```

The independent source check reported:

```text
action-rpg: MATCH
defense: MATCH
platformer: MATCH
racing: MATCH
shooter: MATCH
starter: MATCH
```

The two-kit fresh-scaffold smoke used `createProject({ install: false })` and verified the stamped
output contained `export function createLoadingScreen`:

```text
action-rpg: scaffold stamp passed
platformer: scaffold stamp passed
```

The normalized-signature grep returned no matches:

```text
rg -n --glob 'loading.ts' 'function createStatus|const create\s*=|function create\s*(' \
  packages/create-threenative/template-assets packages/create-threenative/templates
```

The template loading files contain no `@threenative/*` import.

## Required negative controls

### Hand-edit drift

Temporary mutation: renamed `function meshFor(` to `function driftedMeshFor(` in the action-rpg
copy. The consistency test went red:

```text
FAIL ... keeps every full kit stamped from the one canonical implementation
AssertionError: action-rpg: expected ... function driftedMeshFor( ... to be ... function meshFor( ...
Test Files  1 failed (1)
Tests       1 failed | 17 skipped (18)
RED_CONTROL_EXIT=1
```

The mutation was restored with the canonical `function meshFor(` signature.

### Deleted copy

Temporary mutation: moved `templates/defense/src/render/loading.ts` out of the tree. Both required
checks went red:

```text
FAIL ... requires every full kit to ship the loading source
Error: ENOENT ... templates/defense/src/render/loading.ts
FAIL ... keeps every full kit stamped from the one canonical implementation
Error: ENOENT ... templates/defense/src/render/loading.ts
Test Files  1 failed (1)
Tests       2 failed | 16 skipped (18)
RED_CONTROL_EXIT=1
```

The file was moved back and `/tmp/prd-203-defense-loading.ts` was confirmed absent.

## Gates

Passed:

- `pnpm install --frozen-lockfile` — completed successfully; dependencies were bootstrapped before
  verification.
- `pnpm build` — exit 0; package build, DTS, publint, and workspace builds completed.
- `pnpm typecheck` — exit 0 across the workspace.
- `pnpm lint` — exit 0; it reported 291 existing warnings and no errors.
- `pnpm --filter create-threenative typecheck` — exit 0.
- `pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__` — 23 test
  files and 249 tests passed.
- `pnpm exec tsx scripts/verify-one-template.ts starter` under the repository Xvfb wrapper — the
  isolated starter scaffold passed all playtests.

The root `pnpm test` gate was run after dependency installation and workspace build. It stopped in
`packages/playtest/__tests__/orphan-cleanup.sh` with exit 1 after its timeout probe reported orphan
Playwright Chromium processes. This is unrelated to template loading and the root command is not
recorded as green.

`pnpm test:templates` was run twice. The first run passed action-rpg, defense, platformer, racing,
shooter, and minimal, then failed in starter's existing coyote/buffer playtest. The isolated
starter rerun passed. The second full run failed earlier in action-rpg because
`playtests/combat.playtest.json` observed the player's health already at 95 and emitted
`TN_PLAYTEST_ASSERTION_TRIVIAL`; the same gate is timing-sensitive and no loading assertion failed.
The full command therefore remains recorded as not green.

`pnpm visuals` completed structural inspection and captured all seven templates, but exited 1 at:

```text
TN_VISUAL_SCORE_FLOOR: action-rpg scored 3; floor is 4.
```

`docs/verification/visuals/scores.json` already contains action-rpg `3` in `HEAD` (and other scores
below the 4/5 floor), so this lane did not alter the score file or retain generated PNG changes.
The loading consistency/runtime checks are green; a pre/post pixel verdict remains unverified by
the existing visual score gate.

## LOC accounting

The six pre-change copies totalled 1,701 lines (`272 + 272 + 338 + 272 + 272 + 275`), matching the
PRD's rounded ~1,660-line finding. The normalized implementation has 301 common structural lines.
The six declared appearance blocks total 90 lines (14 each for action-rpg, defense, racing, shooter,
and starter; 20 for platformer). Thus the unique maintenance surface is 301 canonical structural
lines plus 90 kit-specific appearance lines; stamped generated outputs remain full user source in
each kit by design.
