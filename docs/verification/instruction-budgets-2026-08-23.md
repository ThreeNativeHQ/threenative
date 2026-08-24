# Instruction budgets re-measured — 2026-08-23 (PRD-209, the portable-HUD convention)

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
