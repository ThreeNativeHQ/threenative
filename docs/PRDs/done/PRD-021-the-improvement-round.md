# PRD-021 — The improvement round: a loop that survives a context reset

**Status: complete.** Phases 1–5 are shipped and exercised by a real isolated exploration
round. The round ledger, deterministic resume command, persistent-unused-export report,
firewall evidence, blind judge, pair decision, and required gates all have live evidence.

**Complexity: 5 → MEDIUM mode** (1-5 files +1, new system +2, tooling across repo +2)

**Depends on:** PRD-019 (arms, sealed proof, pair), PRD-020 (capture, instrument judge).
**Blocks:** nothing — this is the loop the other two feed.
**Charter authority:** `AGENTS.md` rule 2 (the kill switch), rule 6, rule 4 of "How you
work" (goal-driven execution); `CHARTER.md` §10, §11, §12.

## 1. Context

**Problem:** PRD-016 through PRD-018 ran one improvement cycle by hand. It worked — five
changes made, a caller census taken, deletions authorised. It also required a human to hold
the whole procedure in their head, decide what came next at every step, and re-derive the
state of play from seven archive directories. **A loop that only runs while someone
remembers how it goes does not run for days.**

**Files analyzed:** `docs/PRDs/done/PRD-016-genre-sweep.md`, `done/PRD-018-remeasure-gate.md`,
`docs/benchmark/DELTA-2026-08-05.md`, `scripts/sweep-delta.ts`,
`scripts/__tests__/sweep-ledger.spec.ts`, `scripts/check-budgets.ts`,
`.claude/skills/self-improve/SKILL.md` and its `references/`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The round procedure exists only as skill prose | `.claude/skills/self-improve/SKILL.md` — seven steps, no command computes which one you are on |
| Nothing on disk records a round | `docs/verification/` holds per-PRD and per-sweep files; there is no round file |
| `DELTA-2026-08-05.md` was assembled by hand | its own text — commands pasted, census grepped manually, verdict written by the operator |
| The delta compares two sweeps; nothing compares two **rounds** | `sweep-delta.ts` takes exactly two archive paths |
| `stillUntouched` lists ~150 exports and drives no action | `DELTA-2026-08-05.md` — both genres list the same set; nothing consumes it |
| Rule 2 has been executed **zero** times | `DELTA-2026-08-05.md`: "No deletion was needed in this phase" — the only round ever run |
| Ledger schema tests already fail closed on blanks | `sweep-ledger.spec.ts:30-38` — blank, `TBD`, or `<placeholder>` throws |

Row five is the one that matters most. An abstraction nobody reached for, twice, in two
independent uninformed builds, is what `AGENTS.md` rule 2 was written to delete — and the
list of them is sitting in a JSON blob that nothing reads. v1 died at 790k lines because
that list was never turned into deletions.

## 2. Solution

- **The round is a file.** `docs/verification/round-<n>-<date>.md`, written from
  `.claude/skills/self-improve/references/round-ledger-template.md`, with a schema test in
  the same style as `sweep-ledger.spec.ts`: every required field present, no blanks, no
  placeholders, `unmeasured` permitted only where the notes say why. Arms, column verdicts,
  gap list, dispositions, deletions, gates, and a **firewall attestation** — because a
  contaminated pair with good numbers is worse than no numbers.
- **`pnpm round:next` computes the next action from disk**, not from memory. It reads the
  latest round file and the archives it names, and prints exactly one command: build the
  missing arm, archive the unarchived sandbox, prove the unproven archive, capture, judge,
  pair, decide the undecided gap row, implement the PRD, or close the round. Ambiguity
  throws — two candidate next actions means the ledger is inconsistent and that is a finding.
- **Rule 2 gets an executor.** `pnpm round:deletions` intersects `unusedExports` across every
  archive of the current round and every archive of the previous one, and prints each export
  that survived two rounds unreached, with the count. That list is pasted into the ledger's
  deletion table, and each row is `yes` with a diff or `no` with a reason. The script reports;
  the human deletes — a deletion is a diff someone reads, per PRD-018.
- **Plateau is measured, not felt.** `round:next` marks a plateau when two consecutive rounds
  closed no gap row and moved no instrument score by more than one point. The skill's stop
  rule 3 then applies. Reach-rate movement is explicitly excluded from the plateau test — two
  agent builds are not a controlled experiment and a few points of reach is noise, exactly as
  PRD-018 already ruled.
- **Every round runs `pnpm budgets`, and a round may not raise a cap.** A round whose gates
  table shows a budget failure cannot be closed. `CHARTER.md` §10: exceeding a cap is not a
  signal to raise the cap.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A daemon or cron that runs rounds unattended | Each round spends real model budget on four agent builds. It starts when a human says so, and stops on the budget they named |
| Auto-delete unreached exports | PRD-018 settled this: the script reports, the phase deletes, a human reads the diff |
| Gate CI on reach rate or instrument score | Makes a two-sample agent-run number load-bearing. The gates are typecheck, lint, test, budgets — the ones that mean something |
| One round file per genre | The round is the unit of decision; the genres are its rows. Splitting it hides the cross-genre pattern, which is where rule 2 lives |
| Store round state as JSON for the tool to update | A ledger a human never reads is a ledger nobody checks. Markdown, schema-tested, with the JSON pasted in where it is evidence |
| Let `round:next` perform the action it prints | Then a wrong inference becomes a wrong build. It prints; the operator or the skill runs it |
| Track rounds in `docs/PRDs/` | The PRD budget is 10 files and rounds are unbounded. Rounds are verification records, and that is where they go |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `docs/verification/round-<n>-<date>.md` | `.claude/skills/self-improve/SKILL.md` steps 1, 5, 6, 7 | a procedure held in one operator's head | n/a | leave `Stop condition met` blank → schema test red; write `unmeasured` with no note → red |
| 2 | `scripts/__tests__/round-ledger.spec.ts` | `pnpm test` | nothing validated round records | n/a | a firewall attestation row reading `no` with the comparison still published → test rejects the file |
| 3 | `pnpm round:next` | `self-improve` step 0; every context reset | reading seven directories and guessing | n/a | delete an archive the ledger names → throws instead of printing a next step; make two steps eligible → throws with both |
| 4 | `pnpm round:deletions` | `self-improve` step 7; the ledger's deletion table | `unusedExports` read by nobody | n/a | mark an export deleted while a template still imports it → `pnpm typecheck` fails immediately, in the same phase |
| 5 | Plateau detection in `round:next` | `self-improve` stop rule 3 | "it feels like this is not going anywhere" | n/a | feed it two rounds with a closed gap row → no plateau; two with none → plateau, and reach-rate movement alone does not clear it |
| 6 | `AGENTS.md` pointer to the loop | `AGENTS.md`, regenerated `CLAUDE.md`, `docs/README.md` | a skill nothing references | n/a | `pnpm sync:agents --check` fails on drift |

**Reachability:** operator runs `pnpm round:next` in a fresh session with no memory of the
previous one → it prints `pnpm sandbox --bare --arm vanilla --genre exploration` → the skill
runs that build → archive, prove, capture, judge, pair → `round:next` prints the next
undecided gap row → disposition recorded → PRD written → next round's fresh build decides
whether the change survives, and `round:deletions` names what did not.

## 4. Phases

#### Phase 1: the round file has a schema

**Files:** `scripts/__tests__/round-ledger.spec.ts` NEW ·
`.claude/skills/self-improve/references/round-ledger-template.md` EDIT (only if the schema
finds it underspecified).

Validate: required header fields; round is a positive integer; arms table has both arms per
genre with matching brief and proof hashes; every column-verdict row resolves to `win`,
`tie`, or `loss`; the gap list has at least one row (`None` counts, blank does not); every
gap row has exactly one disposition, and a `framework change` disposition names a caller and
a PRD; the gates table has all four gates with a result; every firewall row is `yes`, or the
file declares the round void. `unmeasured` is legal only when the notes section explains it.

Run the validator over `references/round-ledger-template.md` as a **negative** control: the
template is all placeholders and must fail, proving the checks are live.

#### Phase 2: `round:next`

**Files:** `scripts/round-next.ts` NEW · `scripts/__tests__/round-next.spec.ts` NEW ·
`package.json` EDIT.

Read the highest-numbered round file, parse its arms and gap tables, stat the archives it
names, and resolve exactly one next action from an ordered rule list. Throw on: no round
file, a named archive missing, a manifest whose genre or arm contradicts the ledger row, or
two eligible actions. Print one command and one sentence of why.

Fixtures cover: fresh round with nothing built; one arm built; both built, unproven; proven,
uncaptured; judged, unpaired; paired with an undecided gap; all decided, PRD unwritten; round
closable.

#### Phase 3: rule 2 gets teeth

**Files:** `scripts/round-deletions.ts` NEW · `scripts/__tests__/round-deletions.spec.ts` NEW ·
`package.json` EDIT.

Intersect `unusedExports` from `measureSandbox` across every archive in the current and
previous round. Exclude nothing by category — a type that no build ever imported is a type
nobody needed. Print each surviving export with the number of consecutive rounds unreached
and the archives checked, JSON and table.

Deletion itself happens in the round that discovers it, as a normal diff with the templates
and tests updated. The negative control is structural: delete something a template imports
and `pnpm typecheck` is red before the round closes.

#### Phase 4: wiring and the first real round

**Files:** `AGENTS.md` EDIT · `CLAUDE.md` REGENERATED · `docs/README.md` EDIT ·
`.claude/skills/self-improve/SKILL.md` EDIT (remove the degraded-mode rows that PRD-019,
PRD-020 and this PRD have now closed).

Add to `AGENTS.md`: the loop exists, `self-improve` drives it, rounds live in
`docs/verification/round-*.md`, and `pnpm round:next` is how a session resumes. Add the round
records to the `docs/README.md` table. Run `pnpm sync:agents`.

Then run **round 1 for real**, on two genres, both arms, end to end, and commit its ledger.
A loop that has never completed a round is a design, not a system — this phase does not
close on green tests alone.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus the committed round-1
ledger passing its own schema test, plus `pnpm round:next` printing `close the round` against
it, plus `pnpm round:deletions` producing a list — even an empty one, which after a single
round is the honest answer.

### Closure evidence — 2026-08-07

- `docs/verification/round-2-2026-08-07.md` records the exploration pair: both sealed proofs
  pass `1/1`, the blind visual judge scores the framework arm `4/5` versus `3/5`, and the
  pair records vanilla lower on user-owned source cost.
- `pnpm round:deletions` checked the current framework archive and the previous framework
  archive and reported 161 persistent unused exports. The report is recorded in the round
  ledger; no deletion is automated by design.
- `pnpm round:next` printed `close round 2` after the ledger schema, four required gates, and
  the gap disposition were complete.
- Final gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` (116 files / 695 tests), and
  `pnpm budgets` all passed.
