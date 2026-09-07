---
prd_contract: v1
---

# PRD-277 — merged geometry keeps its per-part tint, and refuses to merge silently

**Status:** DONE — implemented 2026-09-07 after a current-main caller census at
`234a1bfdf0df05d0fa216e5b236455ba3a63d443` found real generated template callers. Evidence:
[prd-277-merged-geometry-tint-2026-09-07.md](../../../verification/prd-277-merged-geometry-tint-2026-09-07.md).
Sibling of [PRD-276](../../feature-mining/PRD-276-instanced-batch-assembly-is-mechanism.md),
mined from the same game and judged by the same rules.

**Goal: an agent authoring a building out of primitives gets it into one draw without losing
per-piece colour, and hears about it when the merge fails.** This is the second-largest raw saving
in the `lumen-hall` survey and the one that was refused.

**Complexity:** two functions, roughly 25 code lines = **LOW**. The work is small; the missing
caller is the whole reason it is parked.

## The problem

An agent building a game usually has no artist, so it authors architecture and props in code out of
primitives. Getting fifty of those into one draw means `mergeGeometries`, and two things go wrong
every time:

1. **A merged mesh has one material, so per-piece colour is gone** unless every piece carries a flat
   vertex-colour attribute written before the merge. Painting that attribute is mechanical and the
   colour is entirely the game's.
2. **`mergeGeometries` returns `null` on mismatched attributes** and does not throw. The usual
   mismatch is trivial and invisible — `ExtrudeGeometry` is non-indexed while every other primitive
   is indexed — so the fix is to flatten everything on the way in, and the failure mode without it
   is a `null` that propagates.

Measured in `lumen-hall/src/render/cathedral.ts` (1,357 lines, one building):

| Site | Count |
| --- | --- |
| `part(geometry, tone)` — flatten to non-indexed, paint one flat vertex colour | 45 calls |
| `weld(parts, label)` — merge, throw by name instead of returning `null` | 12 calls |
| The two helpers themselves | ~25 code lines |

Inlined, `part` is roughly twelve lines per site. That is the largest raw saving in the survey.

## Why it passes the rules

Same row of the "where a change goes" table as PRD-276: a draw-call mechanism where every
appearance parameter comes from the game. `tone` is the caller's; the merge decides nothing about
colour, material, geometry or placement. Charter rule 3 does not fire — the game can change every
tint completely without editing package code, because the tint is an argument.

## Why it shipped now

**An export with no caller does not ship.** The 2026-09-07 baseline census found real callers in
generated templates and examples, so the parked condition no longer held. The implementation uses
the starter hero as the first genuine caller and leaves the other existing callers unchanged.

## Acceptance criteria, for whoever picks it up

- [x] **AC1 — a named caller first.** A template or example that authors merged geometry exists
      *before* the export does. If the caller is written to justify the export, stop.
- [x] **AC2 — the tint is the game's.** A unit test changes every part colour without touching
      package source.
- [x] **AC3 — red-green on the silent null.** Feeding mismatched attributes throws, naming the
      label; removing that check returns `null` and the test goes red on the propagated value, not
      on the throw.
- [x] **AC4 — the mixed indexed/non-indexed case.** A test merges an `ExtrudeGeometry` with a
      `BoxGeometry`, which is the mismatch that actually happens.
- [x] **AC5 — the kill switch is scored on the caller,** not on the mined game: code lines before
      and after in the caller's own file, as PRD-276 did.
