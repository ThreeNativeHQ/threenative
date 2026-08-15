# Production-readiness integration evidence — 2026-08-15

This note records the approved production-readiness lanes integrated into the
integration worktree. It does not claim mobile readiness.

## Integrated lanes

- PRD-111: source commits `f264e20`, `44f2794`; integration commits `9c4e8ff`,
  `697f149`.
- PRD-115: source commits `d86ddcf`, `0ad1763`; integration commits `8cf2961`,
  `21456e3`.
- The integrated tip before this evidence and status commit was `21456e3`.

The only cherry-pick conflict was in PRD-115, in
`packages/create-threenative/__tests__/scaffold.spec.ts` and
`packages/create-threenative/templates/starter/package.json`. Resolution kept
the durable `survives` proof and the current-base starter cleanup, including
removal of the obsolete `boot-to-play` and `pick` paths. No engine-load-test or
PRD-118 base work was changed.

## Gate results

| Gate | Result |
| --- | --- |
| `pnpm sync:agents --check` | PASS, exit 0; 18 mirrors in sync |
| `pnpm typecheck` | PASS, exit 0 |
| `pnpm lint` | NOT GREEN, exit 1; repository-wide Biome diagnostic cap reached with 206 warnings and 6 surfaced errors, primarily existing/current-base complexity diagnostics. The changed-file check surfaced warnings only. |
| `pnpm test` | PASS, exit 0; root 134 files passed/9 skipped and 1,160 tests passed/35 skipped; runtime-native 42 files and 243 tests passed, with Rust parity passing 1 test |
| `pnpm test:templates` | Assertions PASS for action-rpg, defense, minimal, platformer, racing, shooter, and starter; command exit 1 from Debian `xvfb-run` cleanup killing an already-exited Xvfb PID after all seven templates reported passed |
| `pnpm budgets` | PASS, exit 0; 14,833 framework LOC and 70,077 native-runtime LOC. The existing native-runtime review trigger remains reported at 50,000 LOC. |

The fresh worktree required `pnpm install --frozen-lockfile` and ignored local
package builds before the gates could start; those generated outputs are not
tracked.

## Remaining blocked lanes

The following lanes remain active and blocked after review round 2; the batch is
not complete and was not archived:

- PRD-110 — `review-2-device-network-default-defect`
- PRD-112 — `review-2-defects-recorded`
- PRD-113 — `review-2-defects-recorded`
- PRD-114 — `review-2-diagnostics-record-and-side-effect-import-defects`
- PRD-116 — `review-2-native-collision-groups-and-kill-switch-defects`

PRD-111 and PRD-115 are archived in `docs/PRDs/done/`. No mobile-readiness
claim is made: desktop and iOS-simulator evidence does not prove physical
mobile support, and Android-emulator and physical-device readiness remain
open.
