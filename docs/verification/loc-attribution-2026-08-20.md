# Framework LOC attribution — 2026-08-20

This is the PRD-165 reconciliation record. It supersedes the 2026-08-19 attribution captured
before the UI audit. The source PRD remains unchanged.

Recorded framework LOC: 15,000

## Measurement and reconciliation

**Restated on integration.** This record was first written from `main` at `d75f4644` plus the UI
commit alone, which measured 14,989. PRD-162 landed in the same batch and added 11 counted lines to
`core` (`replay({ portable })` and its exported options type), so the integrated total measured on
`main` after the batch is **15,000** — level with the review trigger and not above it. `pnpm budgets`
reports `budgets ok`, and the one-shot verifier agrees with the rows below.

The historical baseline was 15,025 framework lines, recorded by PRD-161 at commit `12380541`.
The UI audit removed 36 counted source lines in commit `4c9ea89d`, changing `ui` from 208 to 172.
The post-PRD-161 integration target was measured from parent `main` at `d75f4644` plus that UI
commit in a throwaway checkout:

```sh
node --import tsx/esm -e 'import { collectBudgets } from "./scripts/check-budgets.ts"; const report = await collectBudgets(process.cwd()); console.log(JSON.stringify({ frameworkLoc: report.frameworkLoc, frameworkLocByPackage: report.frameworkLocByPackage }, null, 2));'
```

```json
{
  "frameworkLoc": 14989,
  "frameworkLocByPackage": [
    { "loc": 7832, "name": "core" },
    { "loc": 2491, "name": "create-threenative" },
    { "loc": 289, "name": "engine-mcp" },
    { "loc": 4205, "name": "physics" },
    { "loc": 172, "name": "ui" }
  ]
}
```

| Reconciliation | Framework LOC |
| --- | ---: |
| Historical baseline | 15,025 |
| UI audit delta | -36 |
| Integrated target | **15,000** |
| Framework trigger | 15,000 |

The integrated target is 11 lines under the trigger. The lane's pre-integration checkout reports
13,041 lines because it predates the parent tree's PRD-161 attribution instrumentation and later
commits; it is not used as the integrated attribution total.

`LIMITS` is unchanged: `frameworkLoc: 15,000` and `nativeRuntimeLoc: 50,000`. The native runtime
review trigger remains reported and is outside this lane's scope.

## Package attribution

Each counted package has a written verdict against both questions: whether the game can write the
surface portably, and whether the surface decides the game's look.

| Package | Counted LOC | Could the game write it portably? | Does it decide the game's look? | Disposition |
| --- | ---: | --- | --- | --- |
| `core` | 7,843 | **No.** Renderer/bootstrap, host seams, lifecycle, input, assets, and inspection are framework web/native plumbing. | **No.** Materials, lights, shaders, camera framing, and post remain generated game source. | **Earned** |
| `create-threenative` | 2,491 | **No.** Scaffolding, package wiring, and the project contract are framework tooling. | **No.** The generator copies and validates user-owned render and UI source; it does not choose the game's appearance. | **Earned** |
| `engine-mcp` | 289 | **No.** The offline capability server is the framework discovery contract, not game code. | **No.** It reports imports, constraints, and examples without rendering. | **Earned** |
| `physics` | 4,205 | **No.** Rapier/Recast WASM and the native bulk backend are dependency boundaries the game cannot supply portably. | **No.** Bodies and queries use supplied Three.js objects and do not choose materials or composition. | **Earned** |
| `ui` | 172 | **No.** The shared React mounting, throttled state, and diagnostics seams are framework plumbing; native builds omit the DOM package. | **No.** `DebugOverlay` now emits semantic markup only; `GameCanvas` retains only canvas mounting, sizing, and input-handling mechanics. | **Earned** |
| **Total** | **15,000** |  |  |  |

There is no `Undecided` row and no deletion claim.

## UI appearance audit

`packages/ui/src/DebugOverlay.tsx` retains mechanism only:

- development gating and backtick toggle;
- snapshot polling, flattening, and value formatting;
- semantic table markup and the `data-threenative-debug-overlay` hook.

Its former position, spacing, colors, background, shadow, typography, table layout, and overflow
rules now live in generated template source, where the user can change them:

- `packages/create-threenative/templates/action-rpg/src/style.css`
- `packages/create-threenative/templates/defense/src/style.css`
- `packages/create-threenative/templates/platformer/src/style.css`
- `packages/create-threenative/templates/racing/src/style.css`
- `packages/create-threenative/templates/shooter/src/render/ui.css`
- `packages/create-threenative/templates/starter/src/style.css`

The UI test asserts that the overlay and its table have no inline `style` prop. The user can change
the complete default debug presentation through generated selectors without editing package code.

Every project that mounts the overlay owns its rule, not only the generated templates. The
in-repo framework arm styles it in Abyss colours:

- `examples/abyss-framework/src/style.css`

`scripts/__tests__/debug-overlay-css.spec.ts` fails any example or template that mounts
`DebugOverlay` without a `[data-threenative-debug-overlay="true"]` rule of its own. Observed red
before the Abyss stylesheet was written:

```
AssertionError: expected [ 'examples/abyss-framework' ] to deeply equal []
```

and green after. `packages/ui/README.md` documents the selector for projects that install the
package directly rather than scaffolding one.

`packages/ui/src/GameCanvas.tsx` was retained as mechanism. Starting/stopping the game, replacing
the host canvas, filling the host, disabling touch gestures, and ensuring the canvas paints in the
host stack are mounting and input contracts. They do not choose colors, typography, materials,
lighting, camera framing, or post-processing.

## Repaired deletion sweep

The repaired sweep was run in the PRD-164 dependency worktree at commit `fcab85fe`:

```sh
pnpm round:deletions
```

Result: exit `0`; current round `11`; previous round `10`; `noFrameworkArms: [11, 10]`;
`visualOnlyRounds: [11]`; archives checked `[]`; candidates `[]`. Round 11 is visual-only and
round 10 is a declared no-arms round, so neither supplies deletion evidence. The current lane
starts before that repair and does not modify the round ledger or sweep implementation.

## Negative controls

All four declared controls produced observed-red evidence in disposable scratch checkouts:

1. Stale baseline row (`core` 7,832 → 7,831): attribution verification exited `1` with
   `framework LOC attribution total does not equal its package rows: 15024 != 15025`.
2. Removed framework trigger block: `pnpm exec vitest run scripts/__tests__/budgets.spec.ts`
   exited `1`; three trigger assertions failed instead of silently passing.
3. Raised `LIMITS.frameworkLoc` (15,000 → 16,000): the scratch diff guard exited `1` and showed
   the forbidden limit edit; no limit file changed in this lane.
4. Added fake unreached export `PRD165_Fake_Unreached_Export`: the repaired deletion sweep did
   not list it; the filtered command exited `1` with no candidate output.

## Gates

These commands passed in the lane after the repository dependencies and missing package build
artifacts were bootstrapped with the lockfile and package build scripts:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
```

The command exited `0`. The suite reported 146 test files and 1,359 tests passing; runtime-native
reported 48 files and 312 tests passing with 37 skips; the native physics parity test passed.
`pnpm lint` emitted existing warn-level cognitive-complexity diagnostics but exited successfully.

The template-specific gate also passed:

```sh
pnpm test:templates
```

All scaffolded template playtests passed under `scripts/xvfb.sh`, including the UI-bearing
templates. The first full attempt encountered a transient stopped-loop browser race in `starter`;
the isolated starter rerun and the subsequent full template gate both passed.
