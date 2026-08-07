# PRD-029 — The last ten points: what is left in the arm, and whether 50% is reachable honestly

**Complexity: 4 → MEDIUM mode** (census +2, one authorised absorber +2, no new package)

**Depends on:** PRD-026, PRD-027, PRD-028 all landed and their deltas recorded. Running this
before them measures code that is about to be deleted.
**Blocks:** any further LOC work — this PRD decides whether there is any left to do.
**Charter authority:** `AGENTS.md` rule 1, rule 2, rule 4, "Verification honesty";
`CHARTER.md` §2 ("what it is not" — the closed questions), §3, §11.

## 1. Context

**Problem:** the target is a framework arm at **≤50% of the normalised vanilla control
(≤237 of 473)**. The arm is 480 today. PRD-026 through PRD-028 project ~115 lines of
absorbable plumbing and ceremony between them, landing the arm near 365 — a **23%**
reduction, not 50%. The remaining 128 lines have to come out of code that is not plumbing,
and that is where a framework starts owning gameplay, which `CHARTER.md` §2 has already
closed against in several specific forms.

**This PRD does not assume the target is reachable. It measures whether it is, and says so.**
A round that reports "37%, and here is the line-by-line reason the rest cannot move without
breaking §2" is a successful round. A round that hits 50% by moving lines into an uncounted
file, or by shipping a preset system, is a failed one that looks green.

**Files analyzed:** `examples/abyss-framework/src/scenes/Abyss.ts:170-224,303-382`,
`examples/abyss-vanilla/src/main.js:168-217,293-405`, `scripts/count-loc.ts`,
`packages/physics/src/Area3D.ts`, `packages/core/src/entities.ts`,
`docs/PRDs/done/PRD-017-measured-friction-round-1.md` (the census format this reuses).

**Current behavior — what will still be in the arm after PRD-028:**

| Block | Lines | Shape | Can the framework take it? |
|---|---:|---|---|
| TSL shader bodies (spawn, current, pull, wrap, colour ramp) | ~45 | **look** | No — rule 3, explicitly. The vanilla arm pays these too |
| Entity construction: lure, halo, pearls, hunters, glow materials | ~35 | look + spawn plumbing | Partly — the spawn/placement half only |
| Per-frame rules: steering, energy, pickup, chase, damage, game over | ~80 | **game** | No — this is the game. Absorbing it is a preset system |
| Group iteration and per-group housekeeping (drift, bounce, spin, despawn) | ~25 | pattern | Candidate — measured in phase 1 |
| Imports, types, scene shape after PRD-028 | ~40 | plumbing | Partly — shrinks as the blocks above shrink |
| Lighting + post after PRD-027 | ~20 | **look** | No — rule 3 |

The honest floor implied by that table is roughly **145 (look) + 80 (game) = 225 lines of
irreducible content**, plus whatever plumbing survives. 237 is therefore *reachable but
tight*, and only if the pattern rows go and nothing regrows.

## 2. Solution

- **Phase 1 is a census, in the PRD-017 format**, over the post-PRD-028 arm: every line
  classified `look` / `game` / `pattern` / `plumbing`, with the vanilla control classified
  the same way by the same pass. Published to `docs/verification/`. A line that two people
  would classify differently is classified `game` — the classification that helps the
  framework's number is never the tiebreak.
- **Phase 2 authorises at most one absorber**, chosen by measured line count from the
  `pattern` rows, and only if it clears rule 1 (>20 lines to hand-write) and rule 4 (a Godot
  node name, method names and signal semantics). The current best candidate:
  **`Node3D` groups + `Area3D` overlap without a physics dependency** — Godot's
  `add_to_group` / `get_nodes_in_group` and `Area3D.area_entered` / `body_entered`, where
  the framework owns membership, iteration and the overlap test, and the game owns what
  happens on the signal. The pearls-and-hunters block is ~46 lines across two entity kinds
  and would fall to roughly 25.
  **If the census says the candidate is worth fewer than 20 lines, nothing ships.** That is
  the expected outcome for at least one of them, and reporting it is the deliverable.
- **Phase 3 states the reachability verdict** in the round ledger, with the arithmetic: the
  measured total, the ratio, the irreducible floor, and — if the target is missed — the named
  §2 rule that stops the remaining lines from moving. No adjective substitutes for the
  number.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Hit 50% by moving blocks into `src/lib/` or a second scene file | PRD-025's import-closure check fails the build, and it would be dishonest with or without the check |
| A gameplay preset (`makeCollectible`, `makeChaser`, `arcadeMovement`) | `CHARTER.md` §2: preset systems are a closed question. It is also exactly how v1 reached 790k lines |
| Rewrite the benchmark game into something the framework happens to be good at | The control is frozen and the brief is sealed. Changing the game to win the measurement voids the measurement |
| Count the vanilla arm's `index.html` and `style.css` to inflate its total | `count-loc.ts:47-51` — neither arm's UI is counted. Counting one side's is the same cheat in the other direction |
| Raise the 50% target to whatever the census lands on | The target is a goal, not a prediction. A missed goal with a measured reason is a result; a moved goalpost is nothing |
| Absorb the per-frame game rules behind a `behaviours` config | An IR for gameplay. §2, closed |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `docs/verification/arm-census-<date>.md` | the round ledger's gap table; PRD-025's ratio line | an estimate held in one head | n/a | a census whose per-class line counts do not sum to the file total → schema test red |
| 2 | The one authorised absorber (if any) | the arm **and** one template — a node with a single caller is not shipped | the hand-written pattern block | yes, deleted in the same commit | measured delta smaller than the framework lines it cost → reverted in the same phase, per rule 2 |
| 3 | Reachability verdict + arithmetic in the round ledger | `pnpm round:next`, `README.md` ratio line | "we are getting closer" | n/a | a verdict with no measured ratio → ledger schema test red |

**Reachability:** the operator runs the census, reads three numbers, and either ships one
node or writes down why nothing shipped — and the next round starts from a written floor
instead of a guess.

## 4. Phases

#### Phase 1: the census

**Files:** `scripts/arm-census.ts` NEW · `scripts/__tests__/arm-census.spec.ts` NEW ·
`docs/verification/arm-census-<date>.md` NEW.

Classify both arms, same pass, four classes. Sums must equal the normalised file totals from
`count-loc.ts` — a census that does not reconcile with the published count is a broken
instrument, and the test asserts the reconciliation.

#### Phase 2: at most one absorber

**Files:** decided by phase 1, and named in the ledger before any code is written.

Rule 1 and rule 4 are argued in the PRD amendment, not in the commit message. Ships with the
arm and a template as callers, tests, and the same-round measured delta. Ships nothing if the
census says nothing clears 20 lines.

#### Phase 3: the verdict

**Files:** `docs/verification/round-<n>-<date>.md` EDIT · `README.md` REGENERATED.

Measured total, ratio against the normalised control, irreducible floor, and the verdict:
target met, or target missed with the specific `CHARTER.md` §2 rule that stops each remaining
block. Both are publishable results. Only silence is not.

#### Phase 4: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus the census reconciling with
`count-loc --check`, plus the arm's playtest scenarios green, plus the ratchet at its new
value. If phase 2 shipped nothing, this phase still runs and the round still closes.
