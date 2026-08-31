# Starter-kit Linchpin execution — 2026-08-30

## Scope and routing

The three requested PRDs were routed together with:

```sh
bash /home/joao/.codex/plugins/cache/linchpin/linchpin/0.10.0/scripts/linchpin.sh route \
  "execute docs/PRDs/starter-kits using @Linchpin then squash to main" \
  docs/PRDs/starter-kits/PRD-087-genre-borrow-ledger.md \
  docs/PRDs/starter-kits/PRD-236-sailing-starter-kit.md \
  docs/PRDs/starter-kits/PRD-267-the-starter-scaffold-fails-its-own-tests.md
```

The result was `ROUTE-EXECUTE-CONFORMING -> prd-swarm-coordinator`, with all three PRDs flagged
as legacy-shaped advisory inputs. `preflight` passed, the workspace was ready, and `mode auto`
selected three parallel standalone lanes because none declared machine-readable file lists.
The PRDs were executed as written; none was migrated or rewritten.

## Lane evidence

| Lane | Result | Evidence |
|---|---|---|
| 087 genre borrow ledger | `DELIVERED(branch)`; final commit `61597ced` | The terminal-loop win and fail playtests passed. The deliberate x-only assertion mutation failed red, then the grounded predicate was restored. `pnpm typecheck`, `pnpm lint`, `pnpm budgets`, and `pnpm quality` exited 0; lint reported 491 existing warnings. Review round 1 found the missing `pretest:terminal-loop` hook; repair commit `61597ced` added it. Review round 2: `APPROVE`. |
| 236 sailing starter kit | `BLOCKED` | WaveField focused tests passed `5/5`. Buoyancy focused tests remained `3/4`: moving-wave nonpenetration observed `0.1449` above the `0.13` threshold after three repair attempts. No sailing kit commit, native conformance, or template proof was produced. |
| 267 starter scaffold | `BLOCKED` after review cap | Initial commit `363cdaf4` made the template sweep continue after test failures and corrected golden-path software selection. Repair commit `56896d31` captured malformed audit failures per template; focused repair tests passed `4/4`. Typecheck, lint, and budgets exited 0. Review round 1 found audit fail-fast behavior and was repaired. Review round 2 found the regression test duplicated the production audit-failure merge, so it would stay green if that production composition were removed. |

## Manager gates and review

The formal gate command was run for every PRD. Each exited 1 because the `prd_contract: v1` marker
is present but the legacy document shape lacks the required machine-readable sections and valid
ledger/control rows. The exact commands and outputs are retained in the lane gate reports under
`.linchpin/`; this is an evidence gap, not a claim that a formal gate passed.

The observed validator outputs were:

- PRD-087: missing Execution Phases, Negative Controls, Acceptance Criteria, Checkpoint Protocol,
  malformed Files list, invalid ledger/control rows; exit 1.
- PRD-236: missing Integration Ledger, Execution Phases, Negative Controls, Acceptance Criteria,
  Checkpoint Protocol, malformed Files list, invalid ledger/control rows; exit 1.
- PRD-267: missing Integration Ledger, Execution Phases, Negative Controls, Acceptance Criteria,
  Checkpoint Protocol, malformed Files list, invalid ledger/control rows; exit 1.

The 087 lane’s approved range was squashed onto `main` as:

```text
1d7d7d0f test(platformer): harden terminal loop gate
```

The delivered code changes were limited to `packages/create-threenative/__tests__/playtest.spec.ts`
and `packages/create-threenative/templates/platformer/package.json`; this manager record is also
part of the squash. Four pre-existing unstaged `packages/playtest/` edits were left untouched. No
PRD was archived:
236 and 267 are blocked, and 087’s parent batch still has explicit child-kit evidence outside this
run.

## Known red evidence

- The full template sweep reached all seven templates but retained existing avoidance/chase,
  performance, and action-RPG timing failures.
- The root test run observed `624` passed and `6` failures for unbuilt native executables.
- The shipped `create-threenative@0.2.3` registry probe returned npm `E404`; historical `0.2.2`
  evidence was not reused.
- A final guarded `pnpm test` at `4f7afff4` reached package tests but exited 1 in
  `packages/playtest` publint because its declared `dist/*.d.ts` files were absent at that point;
  no full-suite pass is claimed. The suite also encountered two earlier worktree-guard exits when
  other agents advanced `main` during the run.
