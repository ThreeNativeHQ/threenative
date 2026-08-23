# PRD-195 performance convention evidence — 2026-08-23

`prd_contract: v1`

## Scope and identity

- Lane: `lane-195`
- Worktree HEAD at verification start: `a84f08daa0cbfe0a78cc430e6aad77026f1f719e`
- The shared rule is authored once at `packages/create-threenative/agent-docs/performance-default.md`.
- Seven template `AGENTS.md` files consume the marker; `pnpm sync:agents` expands them and writes
  their seven generated `CLAUDE.md` mirrors.
- The PRD names `agent-docs/references/assertion-reference.md#performance` as an existing
  dependency. It is absent at this lane HEAD, so this lane does not add or edit that out-of-scope
  generated reference.

## Observed-red controls

Each mutation was restored before the green checks below.

| Control | Mutation | Command and observed red |
| --- | --- | --- |
| Shared-fragment required set | Removed the `ctx-surface` marker from starter `AGENTS.md`. | `pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t 'should require every shared agent fragment in every template'` — exit 1; `starter/ctx-surface` was named. |
| Generated mirror | Changed the expanded starter block from “about twenty classes” to “about nineteen classes”. | `pnpm sync:agents --check` — exit 1; `RED observed: agent docs out of sync ... templates/starter/AGENTS.md`. |
| Charter workload count | Changed the Charter’s executable count from 22 to 14. | `pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts -t "Charter's reference workload"` — exit 1; expected the executable count `22`, received `14`. |
| Bounded assertion | Replaced the example with `{ "performance": {} }`. | `pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t 'bounded performance assertion'` — exit 1; the contract rejected the missing `maxFrameMsP95` bound. |

## Green evidence

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; lockfile was up to date. |
| `pnpm build` | PASS; capability manifest and workspace builds completed. |
| `pnpm sync:agents` | PASS; 14 template instruction files written. |
| `pnpm sync:agents --check` | PASS; 16 repository mirror pairs checked. |
| Focused Vitest: template, primary-docs, and sync specs | PASS; 3 files, 40 tests. |
| `pnpm tsx scripts/instruction-budget.ts` | PASS; all 7 templates within budget. Platformer: 2897/2900; shooter: 2600/2600. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS with the repository’s existing 239 complexity warnings; exit 0. |
| `pnpm budgets` | PASS; existing native-runtime LOC review trigger was reported, not failed. |

## Declared gates not green on this lane base

- `pnpm test` — BLOCKED at `check:docs`: all 14 new template links report the absent upstream
  `agent-docs/references/assertion-reference.md#performance`. The link is required by the PRD;
  add the dependency through its owning lane before rerunning.
- `pnpm test:templates` — FAIL in the first generated action-RPG browser run; the wrapper reported
  `pnpm test exited 2` with a top-level scenario report of `"pass": false`. The run reached a
  real NVIDIA WebGPU adapter and did not identify a changed file from this lane, so no unrelated
  gameplay edit was made. Rerun after the dependency and upstream template lanes are integrated.
