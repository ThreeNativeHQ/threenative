---
prd_contract: v1
---

# P2-2 — Bound cold-agent instruction payloads

Complexity: 7 → HIGH mode

## Context

The seven generated template `AGENTS.md` files repeat a large shared block, then mirror it into
`CLAUDE.md`. `scripts/sync-agent-docs.ts:159-179` intentionally expands shared fragments into
each template, so every cold game agent pays the full payload before it can use the capability
manifest. The framework already has searchable capability discovery and `packages/create-threenative`
already owns the generated instructions.

## Solution

- Keep the mandatory first-use path, platform constraints, and fail-closed rules inline.
- Move long recipes and reference tables into searchable generated reference files with stable links.
- Add a measured word budget for every generated `AGENTS.md`, mirrored consistently into `CLAUDE.md`.
- Fail the scaffold gate when a template exceeds its budget or contains a broken reference.
- Preserve placeholder replacement and the generated-docs contract.

```mermaid
flowchart LR
  A[Template AGENTS source] --> B[Sync and budget checker]
  B --> C[Bounded inline instructions]
  B --> D[Searchable reference files]
  C --> E[Generated project]
  D --> E
```

Data changes: none; generated reference Markdown is shipped with the template.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | Template instruction word-budget checker | `packages/create-threenative/src/index.ts:180` copies template instruction files | unbounded generated payload | old unbounded path becomes budgeted | Add a large fragment; the scaffold gate must fail |
| 2 | Searchable template reference bundle | `packages/create-threenative/src/index.ts:180` copies template files | duplicated long inline recipes | long recipes moved or reduced in the same phase | Remove a reference file; scaffold discovery check must fail |
| 3 | Budgeted generated mirror | `scripts/sync-agent-docs.ts:159` expands and mirrors `AGENTS.md` | unconstrained `CLAUDE.md` duplication | mirror remains, but is bounded | Change `AGENTS.md` without sync; `pnpm sync:agents --check` must fail |

## 4. Execution Phases

### Phase 1: Measure and define the payload contract

**Files (4):**

- `scripts/instruction-budget.ts` - NEW: count words, classify mandatory sections, and validate reference links.
- `scripts/__tests__/instruction-budget.spec.ts` - NEW: red/green tests for limits, links, and generated mirrors.
- `packages/create-threenative/__tests__/template.spec.ts` - EDIT: assert every shipped template is within budget.
- `packages/create-threenative/agent-docs/framework-blocks-you.md` - EDIT: mark the mandatory inline block and reference boundaries.

**Implementation:**

- [x] Define one default maximum and explicit per-template overrides only when justified by measured content.
- [x] Count rendered placeholder text, not source markers or comments.
- [x] Reject missing reference targets and any template whose `AGENTS.md`/`CLAUDE.md` pair differs.

**Wiring:**

- [x] Caller edited: `template.spec.ts` invokes the budget checker over the real template tree.
- [x] Registration: root test and scaffold smoke consume the same checker.
- [x] Old path: no template bypasses the checker.
- [x] Ledger rows filled: 1 and 3.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `scripts/__tests__/instruction-budget.spec.ts` | `should reject a template above its word budget` | oversized inline text returns a diagnostic | Add 1,000 words to the fixture; `pnpm exec vitest run --config vitest.config.ts scripts/__tests__/instruction-budget.spec.ts` returns non-zero with `RED observed: template word budget exceeded` |
| `packages/create-threenative/__tests__/template.spec.ts` | `should keep every generated instruction pair bounded` | all seven real templates pass | Remove a referenced file; the same command returns non-zero with `RED observed: missing generated reference` |

**Revert check:** disable the checker; the pre-existing scaffold test must no longer detect an
oversized template, proving the gate is connected to real output.

**Verification Plan:** run the focused budget tests, scaffold generation, `pnpm sync:agents --check`,
and `pnpm test:templates`. Record word counts for each template and the reference paths copied.

**User Verification:**

- Action: scaffold a starter project and read its first instruction file.
- Expected: the first-use workflow is present, the file is within the declared word budget, and
  every long recipe points to a searchable file that exists in the generated project.

### Phase 2: Reduce and ship the real templates

**Files (5):**

- `packages/create-threenative/templates/starter/AGENTS.md` - EDIT: retain mandatory rules and link long references.
- `packages/create-threenative/templates/minimal/AGENTS.md` - EDIT: retain the minimal-project contract within budget.
- `packages/create-threenative/templates/shooter/AGENTS.md` - EDIT: retain input/playtest guidance within budget.
- `packages/create-threenative/agent-docs/` - NEW: generated reference pages for moved recipes.
- `packages/create-threenative/src/index.ts` - EDIT: copy and validate the reference bundle during scaffolding.

**Implementation:**

- [x] Reduce all seven templates, not only the starter used by the first smoke test.
- [x] Copy references with the same placeholder substitution and path safety as source templates.
- [x] Keep `CLAUDE.md` generated; do not hand-edit mirrors.

**Wiring:**

- [x] Caller edited: `renderTemplate` copies the bounded instruction and reference surfaces.
- [x] Registration: the generated project's documented capability-search path reaches the references.
- [x] Old path: repeated long inline recipes are deleted or reduced to links.
- [x] Ledger rows filled: 1–3.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|---|---|---|---|
| `packages/create-threenative/__tests__/scaffold.spec.ts` | `should copy bounded references with project placeholders` | generated project contains the links and substituted names | Omit reference copying; the generated-project check returns non-zero with `RED observed: referenced recipe missing` |

**Revert check:** restore one pre-change template payload; the word-budget gate fails on that real
template.

**Verification Plan:** run `pnpm sync:agents`, `pnpm sync:agents --check`, `pnpm test:templates`,
`pnpm typecheck`, and the full test suite. Compare before/after word counts in committed evidence.

**User Verification:**

- Action: start a cold agent in each generated template and ask it to find a capability by situation.
- Expected: mandatory rules are available immediately and the agent can reach the moved recipe by
  the documented search/reference path.

## Negative Controls

All four observed red on 2026-08-21 and restored to green in the same session; verbatim output in
`docs/verification/instruction-budgets-2026-08-21.md`.

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| word budget | ~1,000 filler words appended to `templates/shooter/AGENTS.md` | checker rejects the template | `pnpm exec vitest run --config vitest.config.ts scripts/__tests__/instruction-budget.spec.ts`; result: `RED observed: template word budget exceeded: 'shooter' renders 3137 words, limit 2600`; exit: 1. Restored → 9 passed |
| reference target | `agent-docs/references/ctx-cookbook.md` removed from the bundle | template gate rejects every template naming it | `pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__/template.spec.ts`; result: `RED observed: missing generated reference: 'agent-docs/ctx-cookbook.md' linked from 'action-rpg/AGENTS.md' is not in the shipped bundle`; exit: 1. Restored → 26 passed |
| reference copy | `copyReferenceBundle` call removed from `createProject` | scaffold reference check fails closed at generation time | `pnpm exec vitest run --config vitest.config.ts packages/create-threenative/__tests__/scaffold.spec.ts` (same `createProject` that `pnpm test:templates` drives); result: `RED observed: referenced recipe missing: 'AGENTS.md' links 'agent-docs/finding-assets.md', which the scaffold did not copy.`; exit: 1. Restored → 19 passed |
| mirror sync | sentence appended to `templates/racing/AGENTS.md`, no regeneration | sync check fails closed | `pnpm sync:agents --check`; result: `RED observed: agent docs out of sync with shared fragments or AGENTS.md:` (racing CLAUDE.md listed); exit: 1. Restored → `agent docs in sync: 16 CLAUDE.md mirrors` |

## Acceptance Criteria

- [x] All seven generated template instruction payloads meet their declared word budgets.
- [x] Mandatory rules and the first-use capability-search path remain inline.
- [x] Moved references are copied, linked, placeholder-safe, and searchable from a generated project.
- [x] AGENTS/CLAUDE mirrors remain generated and synchronized.
- [x] Scaffold and template gates fail on budget, missing reference, and mirror drift mutations.
- [x] Before/after counts are recorded (`docs/verification/instruction-budgets-2026-08-21.md`). The
  cold-agent user verification (a fresh agent per generated template) did not execute in this run;
  recorded as unexecuted with its structural equivalent — mandatory-inline probes assert the
  first-use workflow stays present, and the scaffold test proves every named reference page exists
  with substituted names in the generated project.

## Checkpoint Protocol

After each phase record per-template word counts, copied reference paths, exact command output, and
one observed-red mutation per gate. A smaller file with a missing rule or unreachable reference is
not a pass; any unmeasured template blocks delivery.

## Results (2026-08-21)

Full evidence: `docs/verification/instruction-budgets-2026-08-21.md`.

**Payloads.** Rendered-word totals across the seven templates fell 30 108 → 20 493 (−32%):
action-rpg 3747→2393, defense 3797→2490, racing 3793→2439, shooter 3862→2537,
platformer 4263→2834 (limit 2900), minimal 4855→3224 (limit 3300), starter 5791→3576 (limit 3650).
Default limit 2600; the three overrides each name the mandatory-class content that keeps that
template above default after two reduction passes. Mandatory inline probes (first-use capability
search, fallback-to-Three.js, doctor-first, durable proof, navigation subpath, look budget) hold on
all seven.

**References.** Six searchable pages shipped in `packages/create-threenative/agent-docs/references/`
and copied to `<project>/agent-docs/`: finding-assets, sculpt-from-a-reference, capture-the-frame,
ctx-cookbook, gameplay-recipes, visual-baseline. `agent-docs` added to the published package
`files` — the golden-path pack-and-scaffold test caught its omission (scaffold threw
`RED observed: referenced recipe missing` against the packed tarball); fixed and green.

**Gates.** Focused specs 9+26+19 passed; `pnpm sync:agents --check` green (16 mirrors);
`pnpm typecheck` exit 0; `pnpm budgets` exit 0 with all 39 public exports still documented in all
seven templates; `pnpm test:templates` exit 0 — all seven templates scaffolded through the new
copy-and-assert path and 60 playtest scenarios ran green. Full unit suite first run 1586 passed /
1 failed; the failure was the golden-path pack-and-scaffold test catching the missing `agent-docs`
entry in the published package `files` (fixed), after which verify-golden-path is 12/12 green.
`pnpm lint` fails only on foreign concurrent-lane WIP (`examples/*`, `packages/core`); a scoped
biome check over this PRD's files is clean. Negative controls: four observed reds pasted verbatim
in the evidence doc, each restored and re-verified green.

**Unexecuted:** the cold-agent user verification (a fresh agent per generated template) did not
run; recorded as such with its structural equivalent above. The clean full-suite re-run after the
packaging fix is recorded in the evidence doc.
