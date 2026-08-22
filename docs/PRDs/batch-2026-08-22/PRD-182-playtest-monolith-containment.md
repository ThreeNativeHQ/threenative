---
prd_contract: v1
---

# PRD-182 — Contain the playtest monoliths before they are edited again

**Status:** OPEN, 2026-08-22. Filed from the 2026-08-22 area scorecard (finding #17; playtest
scored 60/100). Evidence verified at HEAD `a84f08da`.

Complexity: 5 → MEDIUM mode by the count rubric, but risk is the highest in this batch: these are
fail-closed verification semantics, where an accidental behavior change manufactures false test
results. Characterization first, movement second — never both in one phase.

**Outcome:** the three files most likely to be edited next (`assertion-evaluators.ts` 2,312 lines,
`scenario.ts` 1,867 and growing, `runner/runner.ts` 1,800 and top-churn at 35 commits/8wk) are
decomposed behind their existing facades with zero behavior change, proven by characterization
specs that pin current semantics first.

## Context (verified evidence)

1. The `85e0d9c8` decomposition is half-real. Genuine: `assertions.ts` → 29-line frozen facade over
   schema/report/splits; `renderProjection.ts` → 324 + plan 303 + apply 672. Regrowth: the
   assertion split produced `assertion-evaluators.ts` at **2,312 lines — the largest module in the
   repo**; `scenario.ts` **grew** post-split (1,799 → 1,867); `runner.ts` unchanged at 1,800.
2. Coverage exists but is concentrated on exactly these modules' public facades (~14,000 src /
   8,950 spec lines) — good for safe refactoring, insufficient to pin internal failure/restoration
   ordering that a split could disturb.

House rule honored: this is structural containment of live engine-harness code; no behavior change
ships in any phase, so each phase's proof is "identical outcomes on identical inputs", not new
features.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Evaluator family modules behind the frozen `assertions.ts` facade | every existing importer via the facade (unchanged import paths) | monolithic `assertion-evaluators.ts` | file reduced to re-export or deleted once empty | characterization specs red on any semantic drift |
| 2 | Scenario schema/validation vs evaluation vs reporting modules | `scenario.ts` public exports unchanged | monolithic `scenario.ts` | same | same |
| 3 | Runner transport/spawn vs orchestration modules | `runner.ts` CLI entry path unchanged | monolithic `runner.ts` | same | same |

## Phases (order matters; one phase per review)

#### Phase 1: Characterize before moving anything

**Files (2):** NEW `packages/playtest/__tests__/evaluator-semantics.spec.ts`;
NEW-or-EDIT scenario/runner characterization specs following existing spec patterns.

**Implementation:**
- [ ] Pin, per evaluator family: pass/fail verdict shapes, malformed-input throws (fail-closed),
      restoration/cleanup ordering after failures, report field presence. These specs assert
      CURRENT behavior — including behavior that looks wrong; fixing behavior is explicitly NOT
      this PRD.
- [ ] A deliberate semantic change during later phases must turn ≥1 of these red. If a split can
      land without any of them noticing, the characterization was too thin — thicken it before
      moving code.

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| `evaluator-semantics.spec.ts` | `should throw fail-closed on <each malformed family input>` | exact error codes preserved through all later phases | n/a yet — becomes the net for phases 2–4 |
| mutation check | flip one verdict branch → exactly its characterization rows go red | proves the net catches drift | paste that red before Phase 2 starts |

#### Phase 2: Split assertion-evaluators behind the existing facade

**Files (≤5):** `assertion-evaluators.ts` - EDIT down to re-exports or deleted; NEW family modules
(e.g. `evaluators/movement.ts`, `evaluators/diagnostics.ts`, `evaluators/visibility.ts` — names
follow the families the characterization found); facade untouched.

**Proof:** full playtest suite green with identical counts; characterization net green; LOC delta
past (2,312 → largest successor module target ≤ ~800, consistent with the quality thresholds).

#### Phase 3: Split scenario.ts the same way

**Files (≤5):** `scenario.ts` - EDIT to facade-or-delete + NEW schema / evaluation / reporting
modules. Same proof shape; `pnpm quality` afterwards must show the 1,867-line finding gone without
regenerating the baseline to hide anything else (PRD-179 lands first if practical — otherwise
paste the honest report).

#### Phase 4: Split runner.ts transport from orchestration

**Files (≤5):** `runner/runner.ts` - EDIT + NEW transport/spawn module (the shell-spawn surface
stays argv-controlled exactly as audited: documented operator flag, numeric substitution only).
Same proof shape plus: one real browser playtest scenario still exits 0 end-to-end
(`moves.json` under the standard recipe), pasted.

#### Verification Plan (whole PRD)

1. Per phase: suite counts identical, characterization net green, `git diff --stat` shows only the
   declared files.
2. Kill-switch sanity: `pnpm tsx scripts/count-loc.ts` — report the score; the refactor must not
   add abstraction cost beyond plain-module splits (no new frameworks, registries, or base classes).
3. Full gates green, pasted: `pnpm typecheck && pnpm lint && pnpm test`.
4. Concurrency note: another lane recently touched shooter-input proof files inside create-threenative;
   none of those paths appear here — verify with `git status` before starting each phase.

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Every importer of `@threenative/playtest` keeps working with zero import-path changes | grep of callers pre/post + suite counts |
| 2 | No repo file under packages/ exceeds the quality threshold that scenario/runner violated — honestly reported, baseline regenerated only per PRD-179's rule | pasted quality output |
| 3 | The harness fails on exactly the same malformed inputs, with byte-identical error codes, as before | characterization net output |
| 4 | A real browser scenario still runs end-to-end through the split runner | pasted playtest exit 0 |

## Deliberately out of scope

- Fixing any behavior the characterization exposes as questionable — file those separately.
- New assertion capabilities, new transports, timeout changes (PRD-167 owns the mailbox flake).
