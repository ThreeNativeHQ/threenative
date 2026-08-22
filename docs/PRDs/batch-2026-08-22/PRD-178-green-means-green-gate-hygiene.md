---
prd_contract: v1
---

# PRD-178 — Green means green: the quick-win gate-hygiene batch

**Status:** OPEN, 2026-08-22. Filed from the 2026-08-22 area scorecard (findings #3, #4, #5, #6,
#20; scripts/CI/DX scored 62/100). All evidence verified at HEAD `a84f08da`.

Complexity: 5 → MEDIUM mode (many small edits across packages and root; no deep state).

**Outcome:** a green default gate means what it says — no test suites silently uncollected, no
diagnostic that talks an agent into a false red, no package rebuilt twice per run, no native-addon
build approved for a dependency nothing imports.

## Context (verified evidence)

1. **Four stale duplicate suites run in no gate.** `packages/playtest/src/reachability.test.ts`
   (65 lines vs gated spec 69), `scenario.test.ts` (101 vs 753), `runner/bridgeClient.test.ts`
   (80 vs 177), `three/bridge.test.ts` (82 vs 331) are older, smaller node:test twins of gated
   specs, untouched since `4da02e62`. No script anywhere invokes `node --test`. They can drift
   silently and teach agents the wrong convention. Fix: delete.
2. **Diagnostics still prescribe forbidden `xvfb-run`** while root docs and the doctor forbid it
   because its failing-cleanup kill replaces the real exit status: `runner.ts:590-593`,
   `runner/cli.ts:96`, `assertion-evaluators.ts:76`, `conformance/run-conformance.mjs:618`,
   `scripts/profile-native-cpu.ts:353,755`. The template/doc side is already fixed and guarded by
   `create-threenative/__tests__/template.spec.ts:695-711`; these five emit-sites are the residue.
3. **The gate pipeline double-builds every package and double-runs root vitest.**
   `scripts/run-test-suite.sh` builds the workspace, then six packages' `test` scripts each run
   their own build again; playtest's `test` script invokes the entire root vitest suite before the
   unit phase repeats it. Multi-minute waste on every local and CI run.
4. **Root `argon2` + `pg` have zero importers** (`package.json:63,70-76`, incl.
   `onlyBuiltDependencies` approving argon2's native build; catalog entries in
   `pnpm-workspace.yaml`). Repo-wide grep clean; hosting moved out per `docs/README.md`.
5. **Catalog nits:** `zustand: 5.x` floats amid exact pins; `monaco-editor` is referenced by no
   workspace package.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Source-scan spec forbidding emitted `xvfb-run` advice | runs in the default vitest gate | five inline advice strings | deleted in Phase 2 | re-introducing the string turns the spec red |
| 2 | Single-build pipeline shape in `run-test-suite.sh` | every local + CI `pnpm test` run | build-inside-test-script ×6, double vitest | removed from the six package.jsons | instrumented run shows vitest executing twice → red |
| 3 | Root dependency set without argon2/pg | every install and CI job | orphaned deps + build approval | deleted from package.json/catalog | `pnpm install` fails if any live importer remains (there is none) |

## Phases

#### Phase 1: Delete the four stale duplicates

**Files (4):** the four `.test.ts` files - DELETE.

**Verification:** `git grep -l "node:test" packages/playtest/src` returns nothing;
`pnpm test` stays green with the same collected-test count minus zero (they were never collected —
paste the before/after counts to prove the deletion changed nothing running).
**Revert check:** none needed (pure deletion of dead files); the negative control is the before
count proving they were outside the gate.

#### Phase 2: One display-advice string, everywhere, with a guard

**Files (6):** `packages/playtest/src/runner/runner.ts` - EDIT; `runner/cli.ts` - EDIT;
`assertion-evaluators.ts` - EDIT; `packages/runtime-native/conformance/run-conformance.mjs` - EDIT;
`scripts/profile-native-cpu.ts` - EDIT; NEW spec `packages/playtest/__tests__/display-advice.spec.ts`.

**Implementation:** every diagnostic suggests exactly the wrapper root docs prescribe:
`sh scripts/xvfb.sh <cmd>` (never bare `xvfb-run`). Then the spec source-scans
`packages/{playtest,runtime-native}/src`, `runtime-native/conformance/*.mjs` and
`scripts/profile-native-cpu.ts` for the literal `xvfb-run` outside an explicit allowlist
(`docs/`, historical analysis records like `scripts/analyze-prd-075-render-advisor.mjs`) — the
enforcement pattern `template.spec.ts:695-711` already established.

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| `display-advice.spec.ts` | `should fail when a diagnostic prescribes xvfb-run` | scan finds zero occurrences | temporarily re-add the string to `cli.ts` → spec red |

#### Phase 3: Build once, run vitest once

**Files (7):** `scripts/run-test-suite.sh` - EDIT; `packages/{core,create-threenative,engine-mcp,physics,ui,playtest}/package.json` - EDIT.

**Implementation:**
- [ ] The shell script owns the single workspace build; package `test` scripts stop calling
      `pnpm run build` first.
- [ ] Playtest's `test` script stops invoking root vitest; the shell's unit phase remains the only
      vitest execution.
- [ ] Concurrency note: another lane has touched `playtest.spec.ts` recently — check `git status`
      before editing and keep this phase out of spec files entirely.

| Verification | Expected |
| --- | --- |
| instrumented run: `vitest` invocation count during `pnpm test` | exactly 1 (before: 2) |
| wall-clock of full `pnpm test` before vs after | strictly faster; paste both |
| all suites still execute | same test-count totals as before, pasted |

**Negative control:** temporarily remove the workspace build from the shell script → package tests
that need dist must fail (proves the build is load-bearing exactly once, not zero times).

#### Phase 4: Remove the orphaned root dependencies

**Files (2):** root `package.json` - EDIT (drop `argon2`, `pg`, `@types/pg`,
`onlyBuiltDependencies.argon2`); `pnpm-workspace.yaml` - EDIT (drop the three catalog lines; pin
`zustand` to its locked exact version; drop `monaco-editor` **unless** a record shows the private
Studio shares this catalog deliberately — if found, keep monaco and say so in the commit message).

**Verification:** `pnpm install` regenerates the lockfile cleanly; `pnpm publish:check`,
`pnpm typecheck && pnpm lint && pnpm test` green.
**Negative control:** `git grep -rn "argon2\|from \"pg\"" packages examples scripts --include="*.ts"` must be empty
before deletion (already verified 2026-08-22; paste it fresh at execution time).

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | No file under playtest/src is a test the default gate never collects | pasted `git grep node:test` output (empty) |
| 2 | Following any harness diagnostic's display advice never produces the documented false-red trap | pasted spec red on injected string, green after fix |
| 3 | `pnpm test` builds each package once and runs vitest once, measurably faster | pasted before/after timing + invocation count |
| 4 | A cold install of this repo approves zero native-build scripts for unused dependencies | pasted `pnpm install` output post-prune |
| 5 | Full gates green | pasted `pnpm typecheck && pnpm lint && pnpm test` tail |

## Deliberately out of scope

- The quality instrument's comparison semantics and long-gate records — PRD-179, filed alongside.
- Any change to what the gates measure (this PRD changes only how they run and advise).
