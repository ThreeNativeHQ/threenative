# Instruction budgets re-measured — 2026-08-23

Three PRDs raised template instruction budgets on the same day, independently, each having measured
its own before/after. Their records are kept whole below rather than reconciled into one table: each
increment was measured against a different baseline, and flattening them would destroy the evidence
that each was measured at all.

**The merged result, re-measured against the combined text after all three landed:**

| Template | rendered | limit | headroom |
| --- | --- | --- | --- |
| action-rpg | 2559 | 2716 | 157 |
| defense | 2656 | 2716 | 60 |
| minimal | 3468 | 3469 | 1 |
| platformer | 3015 | 3016 | 1 |
| racing | 2605 | 2716 | 111 |
| shooter | 2703 | 2716 | 13 |
| starter | 3830 | 3831 | 1 |

`defaultMaxWords` is 2716: 2660 + 22 (PRD-214) + 34 (PRD-213). `minimal` and `starter` additionally
carry PRD-209's +53 and +65. Three templates now sit one word under their ceiling, which is the
budget doing its job — the next convention added has to buy its space from somewhere.

---

## Instruction budgets re-measured — 2026-08-23 (PRD-209, the portable-HUD convention)
Two overrides in `scripts/instruction-budget.ts` move: `minimal` 3360 → 3413 (+53 rendered
words) and `starter` 3710 → 3775 (+65). Nothing else changes; the default and `platformer`
stand.

## Why the words were spent

PRD-209's Phase 0 spike established that the framework ships no package text surface and does
not need one: the generated `src/render/hud.ts` already renders byte-identical, legible
`SCORE 1200` on web, on the Linux desktop native host, on the Android emulator and on a
physical Pixel 8 — 2 152 bright glyph pixels and bounds `[49,56,313,85]` on every lane, with
`pixelMismatchRatio` 0 against the browser reference on all three native lanes. Evidence:
`docs/verification/prd-209-2026-08-23.md`.

A convention that works and that no template names does not exist. Two template `AGENTS.md`
files were saying something worse than nothing:

- `starter` listed the portable HUD as optional — *"Add a native HUD in your game-owned render
  code only if your game needs one."* An Android build scaffolded from that shape shipped its
  world with **no HUD at all**: no score, no crosshair, no minimap, no loading screen, because
  all of them mount through React DOM from `src/main.ts`, which the native host never executes
  (`docs/bugs/mobile-stability-2026-08-23.md`, bug 2).
- `minimal` claimed *"`main.ts` subscribes a plugin to the store and writes to a DOM node"*
  while `src/main.ts` says, in a comment, *"No DOM readout here."* Prose and code disagreed, so
  the prose was wrong.

Both now state the rule and name the source to copy. The words are the cheapest part of the
fix; the alternative was a package text surface, which the spike priced and rejected.

## Before and after

Measured with `pnpm tsx scripts/instruction-budget.ts`.

| Template | Limit before | Rendered before | Headroom before | Rendered after | Limit after |
|---|---|---|---|---|---|
| action-rpg | 2660 | 2504 | 156 | 2504 | 2660 |
| defense | 2660 | 2601 | 59 | 2601 | 2660 |
| **minimal** | **3360** | **3339** | **21** | **3413** | **3413** |
| platformer | 2960 | 2960 | 0 | 2960 | 2960 |
| racing | 2660 | 2550 | 110 | 2550 | 2660 |
| shooter | 2660 | 2648 | 12 | 2648 | 2660 |
| **starter** | **3710** | **3710** | **0** | **3775** | **3775** |

`minimal` and `starter` had 21 and 0 words of headroom respectively. There was no version of
this convention that fitted; the override is the documented route and this file is the record
the contract in `scripts/instruction-budget.ts` asks for.

Both new limits are set to the exact measured value, no slack — the same ratchet the existing
numbers use, so the next addition has to justify itself the same way.

## The red, observed

Before the override moved, with the template edits in place:

```
$ pnpm tsx scripts/instruction-budget.ts
minimal       3413/3360 words  FAIL
  WORD_BUDGET_EXCEEDED: RED observed: template word budget exceeded: 'minimal' renders 3413 words, limit 3360
starter       3775/3710 words  FAIL
  WORD_BUDGET_EXCEEDED: RED observed: template word budget exceeded: 'starter' renders 3775 words, limit 3710
```

A first, wordier draft of the same convention measured `minimal` 3482 and `starter` 3948. It
was cut to the numbers above before the budget was touched — the override paid for what
survived the trim, not for the draft.


---

## Instruction budgets — uniform +34 for the mobile-memory pointer (PRD-213)
**Date:** 2026-08-23. Follows `instruction-budgets-2026-08-21.md` (the P2-2 reduction) and
`instruction-budgets-2026-08-22.md` (PRD-187's uniform +60).

## What changed and why it is charged to every template

PRD-213 measured, on a physical Pixel 8, that a game shipping one 3072x1536 equirect assigned to
both `scene.background` and `scene.environment` pays an extra `1536x2048 rgba16float` pair —
48 MiB — for an image-based light that is immediately blurred into roughness mips, and that
resizing that sky to 2048 saves exactly nothing because the cost moves in power-of-two steps.
Full evidence: `docs/verification/prd-213-2026-08-23.md`.

Nothing in the code tells an agent this. Three.js derives the render-target size inside
`PMREMGenerator._setSizeFromTexture`, and the number never surfaces anywhere a game author looks.
A cold agent choosing a sky asset cannot derive it, cannot grep for it, and — measured — does not
avoid it: the sandbox game shipped exactly that mistake.

So the hook goes in `agent-docs/performance-default.md`, the shared fragment every one of the
seven templates already includes. The **table, the arithmetic, the per-resolution budgets and the
worked fix all live in `agent-docs/references/mobile-memory-budget.md`**, which ships into every
generated project as `agent-docs/mobile-memory-budget.md` and costs the instruction budget
nothing. Only the pointer is charged.

The pointer is three lines, 34 words:

```
Phone memory is a ~500 MiB driver floor plus what you ask for, and one equirect on both
`scene.background` and `scene.environment` costs 48 MiB extra — measured, Pixel 8.
Budgets and the fix: `agent-docs/mobile-memory-budget.md`.
```

The fragment as a whole is 43 words, well inside the 130-word cap
`packages/create-threenative/__tests__/template.spec.ts:628` puts on it.

## Measured before and after

`npx tsx scripts/instruction-budget.ts .`, run on this worktree. Rendered word counts — shared
markers stripped, placeholders substituted, i.e. what a generated project's agent actually reads:

| Template | before | after | delta | old limit | new limit | headroom after |
| --- | --- | --- | --- | --- | --- | --- |
| action-rpg | 2504 | 2538 | +34 | 2660 | 2694 | 156 |
| defense | 2601 | 2635 | +34 | 2660 | 2694 | 59 |
| minimal | 3339 | 3373 | +34 | 3360 | 3394 | 21 |
| platformer | 2960 | 2994 | +34 | 2960 | 2994 | 0 |
| racing | 2550 | 2584 | +34 | 2660 | 2694 | 110 |
| shooter | 2648 | 2682 | +34 | 2660 | 2694 | 12 |
| starter | 3710 | 3744 | +34 | 3710 | 3744 | 0 |

The delta is uniform because the fragment renders identically into all seven. The bump is
therefore exactly the measured cost — not a round number chosen for comfort.

## Red observed, then green

Red — the first attempt put the whole ceilings table inline in the fragment, and the guard caught
it immediately, which is the guard working:

```
FAIL  packages/create-threenative/__tests__/template.spec.ts > should document a bounded performance assertion in every template
AssertionError: expected 322 to be less than 130

FAIL  scripts/__tests__/instruction-budget.spec.ts > should keep every shipped template within its measured budget
AssertionError: action-rpg: RED observed: template word budget exceeded: 'action-rpg' renders 2817 words, limit 2660

FAIL  packages/create-threenative/__tests__/template.spec.ts > should keep every generated instruction pair bounded
AssertionError: action-rpg: RED observed: template word budget exceeded: 'action-rpg' renders 2817 words, limit 2660
```

That red is what moved the content to the reference bundle; only after the move was the remaining
34 words paid for. Green:

```
action-rpg    2538/2694 words  OK
defense       2635/2694 words  OK
minimal       3373/3394 words  OK
platformer    2994/2994 words  OK
racing        2584/2694 words  OK
shooter       2682/2694 words  OK
starter       3744/3744 words  OK
instruction budgets met across 7 templates
```

```
 ✓ scripts/__tests__/instruction-budget.spec.ts (9 tests) 51ms
 ✓ packages/create-threenative/__tests__/template.spec.ts (28 tests) 3267ms
 Test Files  2 passed (2)
      Tests  37 passed (37)
```

## Note for whoever raises these next

`platformer` and `starter` now sit at exactly their limit and `minimal` has 21 words of headroom.
The next addition to any shared fragment will fail three templates on the first run. That is the
budget doing its job — treat the failure as a prompt to move prose into the reference bundle
first, as this change did, and only bump what genuinely has to be inline.
