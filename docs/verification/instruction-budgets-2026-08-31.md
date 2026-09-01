# Instruction budgets re-measured — 2026-08-31

Two increments are priced in one re-measurement, because the gate had already gone red on main
before the second of them landed:

1. **Unpriced template growth since 81698466** (the PRD-278 cap bump). The probe-volume
   (e8b5256d), godrays-refusal (8360606a), and see-it-in-numbers (e5d64b5f) instructions were
   added to the templates without moving a limit. Measured debt against 81698466: **+569**
   rendered words on action-rpg, defense, racing and shooter; **+530** on minimal, platformer
   and starter. `sailing` did not exist at that baseline; it measured 3134 against the then
   default of 3036, **+98**. `scripts/__tests__/instruction-budget.spec.ts` was red at HEAD
   before this change (action-rpg renders 3254, limit 3036) — the pre-existing failure this
   table also pays for.
2. **The shared `engine-bug-report` fragment**, this change: a uniform **+104** rendered words
   in every template — the rule that a confirmed `@threenative/*` engine bug is filed upstream
   with the user's own `gh` session, plus the pointer to the shipped `file-engine-bug` skill.

**The merged result, re-measured against the combined text after both landed:**

| Template | rendered | limit | headroom |
| --- | --- | --- | --- |
| action-rpg | 3358 | 3437 | 79 |
| defense | 3437 | 3437 | 0 |
| minimal | 4207 | 4207 | 0 |
| platformer | 3775 | 3775 | 0 |
| racing | 3404 | 3437 | 33 |
| sailing | 3238 | 3437 | 199 |
| shooter | 3502 | 3502 | 0 |
| starter | 4554 | 4554 | 0 |

`defaultMaxWords` is 3437 (defense, the largest template on the default cap). The four
pre-existing overrides move to their measured values: minimal 3881 → 4207, platformer
3413 → 3775, shooter 3101 → 3502, starter 4251 → 4554. No new override was created. Counts are
`renderInstructionText` + `countWords` over each template's `AGENTS.md` with placeholders
substituted and comments stripped.
