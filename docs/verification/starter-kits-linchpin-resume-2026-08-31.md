# Starter-kit Linchpin execution — 2026-08-31

## Result

The requested `docs/PRDs/starter-kits` batch was routed and executed with `@Linchpin`. The two
blocked lanes from the first run received fresh continuation lanes, one review each, and both
were approved. Their production changes are on `main`; the three-PRD batch is archived at
[`docs/PRDs/done/starter-kits/`](../PRDs/done/starter-kits/).

The continuation ledger is
`.linchpin/run-20260831-004341-starter-kits-review2.md`.

## Delivered lanes

| PRD | Layer | Fresh lane and review | Main integration | Result |
|---|---|---|---|---|
| 087 genre borrow ledger | template/docs | original lane `61597ced`; review 2 approved | `1d7d7d0f` | platformer terminal-loop qualification delivered |
| 236 sailing starter kit | core, physics, template | `linchpin/starter-kit-236-tsl-20260831`; tip `ed1bbc2e`; review approved | `326c053f`, with sailing scaffold repair `fed7145d` and mirror repair `ad215e95` | numeric TSL graph proof, buoyancy, sailing kit, and enumeration sweep delivered |
| 267 starter scaffold audit | test tooling | `linchpin/starter-kit-267-native-playtests-20260831`; tip `2c35d041`; review approved | `81241af0` | audit covers `playtests` and sibling `native-playtests`, with per-template continuation |

The historical first continuation correctly blocked 236 on missing numeric TSL evaluation and 267
on a duplicated audit regression. The fresh lanes repaired those exact defects; no third review was
used.

## Acceptance evidence

The current web matrix was run from `main` with `pnpm test:templates` and exited `0`:

| Template | Scenarios reported by the audit | Scaffolded playtests |
|---|---:|---|
| action-rpg | 7 | passed |
| defense | 7 | passed |
| minimal | 3 | passed |
| platformer | 22 | passed |
| racing | 8 | passed |
| sailing | 5 | passed |
| shooter | 6 | passed |
| starter | 23 | passed |

This run reached the sailing scaffold after `fed7145d` added the missing `.mcp.json`, and reached
both `platformer-terminal-loop-win` and `platformer-terminal-loop-fail` successfully.

The fresh lane worker gates and reviews recorded:

- numeric WaveField TSL graph evaluator: the `.div` → `.mul` mutation failed with a
  `0.01947515008705014` mismatch; restored code passed the focused suite;
- sibling `native-playtests` regression: red before the production audit composition and green
  after it;
- `pnpm typecheck`: exit `0`;
- `pnpm budgets`: exit `0`;
- `pnpm quality`: exit `0` with a nonfatal report;
- `pnpm native:build`: exit `0`, with desktop native WaveField conformance selected-row pass.

The formal Linchpin validator exited `1` for both fresh PRDs because these legacy PRDs lack the
validator's machine-readable Integration Ledger, Execution Phases, Negative Controls, and
Checkpoint Protocol sections. The exact output is retained in
`.linchpin/lane-236-tsl-20260831.gates.md` and
`.linchpin/lane-267-native-playtests-20260831.gates.md`; this is not claimed as a passing formal
gate.

## Repository checks

| Command | Result |
|---|---|
| focused merged Vitest suites (5 files) | passed, 104 tests |
| `pnpm build` | exit `0` |
| `pnpm typecheck` | exit `0` |
| `pnpm budgets` | exit `0` |
| `pnpm quality` | exit `0`; 95 findings, report-only by design |
| `pnpm test:templates` | exit `0`; all eight templates passed |
| `pnpm lint` | exit `1`; 18 unrelated complexity diagnostics remain in examples/support code, with no starter-kit audit error |
| `pnpm test` | exit `1`; `packages/playtest/__tests__/orphan-cleanup.sh` found an external Chromium process owned by `/home/joao/projects/rpg-engine`, plus the existing native-binary environment failures in the lane report |
| Android/iOS device lanes | not run |

The selected web and desktop WaveField conformance rows passed, but the conformance CLI exits `2`
when its other 87 rows are blocked; no full four-target parity claim is made. The full root lint and
test gates remain honest reds for the unrelated diagnostics above.
