# PRD-115 — The scaffold ships one HUD, one state bus, and what a user keeps

**Status: DELIVERED — 2026-08-15.** The approved lane commits `d86ddcf` and `0ad1763` are integrated.
The starter cleanup and its profile/advisor consumers pass the template matrix and focused checks
recorded in the verification note. No mobile-readiness claim is made. Sliced from
`docs/strategy/PRODUCTION-READINESS.md`, "smaller findings not yet acted on".

**Complexity: 3 → LOW mode.** Deletions and one doc comment, in generated user source.

**LOC:** lands in `packages/create-threenative/templates/`, generated user source, reported and
not capped. Spends none of the 259-line framework headroom, and reduces template LOC rather than
adding to it.

---

## 1. Context

**Problem.** A user's first act should not be deleting half the scaffold. Two independent sandbox
builds, in separate contexts with no knowledge of each other, deleted the same files before writing
game code:

| Deleted by round 5 | Deleted by round 6 |
| --- | --- |
| `src/pick.ts` | `src/pick.ts` |
| `src/render/particles.ts` | `src/render/particles.ts` |
| `src/render/hud.ts` | `src/render/hud.ts` |
| `src/render/camera.ts` | `src/scenes/Boot.ts`, `src/render/loading.ts` |
| all 12 playtests | all 12 playtests, plus `playtests/` |

Round 6 deleted **607 of the starter's 1117 lines** (`starterSurvivedLoc: 510`) before it had a
game. Round 5 deleted roughly 500.

**The specific confusion: two HUDs.** The starter ships `src/render/hud.ts`, an instanced
bitmap-glyph HUD drawn inside the 3D scene, *and* `src/ui/Hud.tsx`, a React overlay. They overlap
in purpose and nothing says which one a user should keep. Round 6's builder: *"The scaffold's
`hud.ts` and the React `Hud.tsx` overlap in purpose. I kept React and deleted the 3D one."* Round 5
did the same.

**Files analysed.**

- `packages/create-threenative/templates/starter/src/render/hud.ts` — the 3D glyph HUD
- `packages/create-threenative/templates/starter/src/ui/Hud.tsx` — the React HUD
- `packages/ui/src/useGameState.ts` — 21 lines over `useSyncExternalStore`, no dependencies
- `packages/create-threenative/templates/starter/src/pick.ts`, `render/particles.ts`,
  `render/loading.ts` — deleted by both rounds

## 2. Scope

**Pick one HUD and delete the other.** The evidence says React: both rounds kept it, it is where
Tailwind already applies, and the template already wires `useGameState`. If the 3D glyph HUD earns
its place for a reason neither round encountered — a native target with no React, most plausibly —
then say so in one comment at the top of the file, because right now nothing does.

**Document where UI state belongs, in one line.** `game.state` is the single store. It is what the
fixed-step loop owns, what `stateFlushMs` flushes, and what the playtest bridge reads through the
`resources` provider.

**Do not add a state-management dependency.** This was considered and rejected. `useGameState` is
21 lines over React's built-in `useSyncExternalStore` with zero dependencies, and a store library
would add a dependency to do what is already done. Worse, it would create a second state bus with
three consequences: the playtest bridge reads `game.state`, so anything in a separate store is
invisible to assertions; `src/game.ts` is the portable entry and has no React, so state that
matters must live where native can see it; and `docs/strategy/PRODUCTION-READINESS.md` P2 already
names duplicated state buses as a smell to detect in audits. Tailwind stays — it is a borrowed
vocabulary and it ships already.

**Re-examine the other files both rounds deleted.** `pick.ts`, `render/particles.ts`,
`render/loading.ts`, and `scenes/Boot.ts` each survived zero of two builds. That is not proof they
are worthless — a pointer-picking demo may be exactly right for a different genre — but each needs
either a reason to stay or removal. A file no build keeps is a file every user pays to read.

## 3. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | The starter ships exactly one HUD, or the second one carries a comment saying why it exists | not started |
| 2 | One line in the template states that `game.state` is the single store and why | not started |
| 3 | No state-management dependency is added | not started |
| 4 | Each file both rounds deleted is removed, or carries a one-line reason to stay | not started |
| 5 | `pnpm test:templates` passes for every template | not started |
| 6 | Template LOC goes down, and `pnpm budgets` still reports it | not started |

Criterion 3 is stated as a criterion rather than a note so a later reader does not re-open it
without new evidence.

## 4. Evidence required

`pnpm test:templates` scaffolds every template and runs its playtests; it must stay green. Deleting
a file the scaffold's own scenarios import will fail there, which is the gate working.

Record template LOC before and after from `pnpm budgets` — largest template is currently 2074 LOC.
This PRD should move that number down, and a PRD that claims a cleanup while the number rises has
not done what it says.

## 5. What this does not do

- **It does not touch the look.** Crate materials, character placement and HUD layout are
  game-owned; the framework never owns them. Choosing *which* HUD component ships is a scaffold
  structure question, not a visual-quality one — the visual work is separate.
- It does not change the starter's default bloom. Two builders blew out emissive props at
  `bloom(colour, 0.7, 0.5, 0.2)` and both turned it down, but both were the same genre with a
  glowing goal pad and nobody has rendered the starter at 0.7 against a lower value. If a third
  independent build turns the same knob down, treat it as decided.
- It does not fix the dead `test` script. That is PRD-111, and the two should land together.
## Lane: lane-115
- state: PARTIAL
- commit: e982191
- reason: worker-committed-manager-gate-and-review-pending
- evidence: .linchpin/lane-115.log
