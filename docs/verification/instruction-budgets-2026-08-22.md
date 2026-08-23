# Instruction budgets re-measured — 2026-08-22 (PRD-187 close-out)

PRD-187's Phase 4 replaced seven hand-typed capability inventories with one shared
`engine-capabilities` fragment and a generated `superseded-constructs` region. The squash that
landed it (`1f170dbc`) carried four known-red tests; this record closes them.

## The red that was carried in

Measured on `main` at `1f170dbc`, before any change here:

```
$ npx vitest run packages/create-threenative/__tests__/template.spec.ts \
    scripts/__tests__/instruction-budget.spec.ts \
    packages/create-threenative/__tests__/scaffold.spec.ts
× template.spec.ts        should require every shared agent fragment in every template
× template.spec.ts        should keep every generated instruction pair bounded
× instruction-budget.spec should keep every shipped template within its measured budget
× scaffold.spec.ts        should copy bounded references with project placeholders
```

Six of the seven shipped templates were over budget — the fragment work added more rendered
words than the deleted inventories saved:

| Template | Limit | Rendered at `1f170dbc` | Over |
|---|---|---|---|
| action-rpg | 2600 | within | — |
| racing | 2600 | 2646 | +46 |
| defense | 2600 | 2697 | +97 |
| minimal | 3300 | 3435 | +135 |
| shooter | 2600 | 2744 | +144 |
| starter | 3650 | 3800 | +150 |
| platformer | 2900 | 3056 | +156 |

Control: the same audit at `95c079b4` (the commit before the squash) reports **no violations** on
any template, so the overage is PRD-187's, not the asset-pipeline series'.

## What was cut, and what was re-measured

The override rule had been stated **three times** in every rendered template — in the
`ctx-surface` prose, in the generated region's trailer, and again in the `engine-capabilities`
fragment. The triplication was cut, not the content:

- `agent-docs/ctx-surface.md` — the "Reinvention fails CI" prose block deleted; its rule and its
  code example now live inside the generated region, which is where the construct list already was
- `scripts/generate-ctx-surface-table.ts` — the generated region carries the whole rule: what the
  gate scans, the table, the non-empty `// engine-override:` escape, and the example
- `agent-docs/engine-capabilities.md` — reduced to the one fact no other fragment carries: the
  second lookup route that needs no MCP server. Its duplicate `ctx`-conveniences paragraph
  (verbatim from `ctx-surface`) and its third statement of the override rule are gone

That paid back ~105 rendered words per template. The remaining ~60 is the generated
superseded-constructs region itself — mandatory inline content in all seven templates and the
user-facing half of the gate — so every budget was re-pinned by a uniform **+60**:
default 2600 → 2660, platformer 2900 → 2960, minimal 3300 → 3360, starter 3650 → 3710.

Post-change audit: **all seven templates within budget**, no violations.

Also fixed while here: the fragment pointed a generated project at
`packages/create-threenative/agent-docs/references/capability-reference.md` — a monorepo path that
does not exist in a scaffolded game. The reference-target check never saw it, because
`REFERENCE_TOKEN_PATTERN` only matches a backtick immediately before `agent-docs/`. The fragment now
names `agent-docs/capability-reference.md`, which is where the scaffolder ships it, and which the
check does enforce.

## Negative controls, observed

Budget re-pin, reverted to the old numbers:

```
$ sed -i 's/defaultMaxWords: 2660,/defaultMaxWords: 2600,/;…' scripts/instruction-budget.ts
$ npx vitest run scripts/__tests__/instruction-budget.spec.ts
× should keep every shipped template within its measured budget
AssertionError: minimal: RED observed: template word budget exceeded: 'minimal' renders 3330 words, limit 3300
   Tests  1 failed | 8 passed (9)
$ # restored
   Tests  9 passed (9)
```

Required-fragment list, with `engine-capabilities` removed:

```
$ npx vitest run packages/create-threenative/__tests__/template.spec.ts -t "shared agent fragment"
× should require every shared agent fragment in every template
AssertionError: expected [ 'asset-mcp-loop', …(6) ] to deeply equal [ 'asset-mcp-loop', …(5) ]
$ # restored
   Tests  1 passed | 25 skipped (26)
```

## Gates

```
$ pnpm typecheck                      → Done, exit 0
$ pnpm lint                           → exit 0 (285 pre-existing warnings, no errors)
$ npx vitest run                      → Test Files 192 passed (192) | Tests 1813 passed (1813)
$ pnpm sync:agents --check            → agent docs in sync: 45 CLAUDE.md mirrors
$ pnpm budgets                        → exit 0; ctx-surface table and capability reference in sync
$ pnpm check:docs                     → 748 links across 569 Markdown files
```

`pnpm budgets` still prints the **framework** 15k LOC review trigger (17,572, +2,572). That is the
asset-pipeline series' crossing, unrelated to this work and unchanged by it.

**Not run:** `pnpm test` as a whole. Its `packages/playtest` leg runs a machine-wide orphan-process
check, and a concurrent lane in `sandbox/fps-framework` kept a Playwright Chromium alive throughout
(observed live, PID re-spawning across three attempts, `etime` under a minute each time). The
vitest suite it wraps was run directly and is green above; `packages/playtest/__tests__/e2e-runner.spec.ts`
failed once under that same contention and passes standalone (19/19).
