# PRD-018 — The re-measure gate: did the abstraction get reached for?

**Complexity: 4 → MEDIUM mode** (1-5 files +1, tooling +1, multi-package deletions +2)

**Depends on:** PRD-016 (sweeps, ledgers, measurer), PRD-017 (the round-1 changes under test).
**Blocks:** nothing. **Charter authority:** `AGENTS.md` rule 2 (the kill switch), rule 6;
`CHARTER.md` §11, §12.

## 1. Context

**Problem:** `AGENTS.md` rule 2 says any abstraction that costs more code than plain
Three.js is deleted, however much work it took. **The rule has never been executed.**
Nothing in this repository can tell you whether a shipped abstraction was ever reached for.

**Files analyzed:** `docs/PRDs/PRD-016-genre-sweep.md`, `docs/PRDs/PRD-017-measured-friction-round-1.md`,
`scripts/count-loc.ts`, `scripts/check-budgets.ts`, `docs/strategy/ROADMAP.md` Phase 1,
`CHARTER.md` §11–§12.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The kill switch is scored by LOC only | `scripts/count-loc.ts` — framework lines vs vanilla lines, nothing about usage |
| `pnpm budgets` gates size, never reach | `check-budgets.ts` — packages, LOC, PRD files |
| PRD-016 produces `unusedExports[]` per sweep and no one consumes it | PRD-016 §4 Phase 3 |
| PRD-017 ships five changes on the evidence of **one** build | PRD-017 §1 |
| Nothing compares two sweeps of the same genre | no such script |

PRD-017 is a bet: five changes made because one agent stumbled on them once. This PRD is
where the bet is settled by a second agent that never read this repository.

## 2. Solution

- **`scripts/sweep-delta.ts`** compares two archived sweeps of the **same genre and the same
  brief hash** and prints: reach rate before/after, exports that moved from `unusedExports`
  to `usedExports`, exports still untouched, and friction rows carried over. Different
  genre or different brief hash is a **throw** — comparing across briefs measures nothing.
- **A per-change caller census, and that is the gate.** For each PRD-017 change, the fresh
  sandbox source either contains a call site or it does not. Binary, and written by an agent
  with no access to `packages/`, `docs/`, or any `AGENTS.md` in this repo.
- **Deletions land in the same phase as the verdict.** A change with no call site is removed
  in Phase 3, not filed as follow-up. That is the whole point of rule 2.
- **The two genres PRD-016 declared as unexercised** — `endless-runner` and `exploration` —
  are run here, closing the debt PRD-016 §4 Phase 4 declared inline.

### What this gate is not

Two agent builds are not a controlled experiment. Same model, different sampling, different
brief. So:

- **Reach rate is recorded, never gated.** A 6-point move between two runs is noise and this
  PRD will not pretend otherwise.
- **The caller census is gated**, because "did an uninformed agent call `teleport`" does not
  average out — it either happened in the tree or it did not.
- **A worse result is publishable.** If round 1 made things worse, the delta record says so
  and Phase 3 deletes. `CHARTER.md` §12: this document must be able to lose.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A reach-rate threshold in `pnpm budgets` | Gating CI on a two-sample agent-run number makes a noisy metric load-bearing; the census is the honest gate |
| Re-run the same genre five times for significance | Each run is an agent build. The cost is not the script, and `PROTOCOL.md` already owns repeat-count discipline for the head-to-head |
| Keep an unused abstraction "until more data" | That is exactly what rule 2 forbids, and how v1 reached 790k lines |
| Auto-delete from the script | A deletion is a diff a human reads. The script reports; the phase deletes |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `scripts/sweep-delta.ts` | `package.json` `sweep:delta`; run in Phase 2 and Phase 4 | eyeballing two ledgers | n/a | compare two different genres → throws; today nothing stops it |
| 2 | `docs/benchmark/DELTA-<date>.md` | linked from `docs/README.md` and from both round-1 sweep ledgers | n/a | n/a | delete a required section → the PRD-016 ledger schema test goes red |
| 3 | Census verdict per PRD-017 change | `docs/benchmark/DELTA-<date>.md` table; drives Phase 3 deletions | the untested assumption that round 1 helped | n/a | mark a change "reached" with no grep hit pasted → the evidence field is blank and the schema test fails |
| 4 | Phase 3 deletions | `packages/physics/src/*`, `templates/*` — whatever failed the census | the round-1 change itself | **yes, in Phase 3** | delete something that *was* reached → its template call site fails to compile, immediately |
| 5 | `docs/strategy/ROADMAP.md` Phase 1 item 4 progress | the roadmap itself | "three reference games" as an unstarted line | n/a | claim a genre without an archived sweep → the sweep folder is absent and the claim is false on inspection |

**Reachability:** operator runs `pnpm sandbox --genre topdown-action` against tarballs
rebuilt from PRD-017's `main` → agent builds → `pnpm sweep:archive && pnpm sweep:delta` →
a committed delta record whose census table decides, per change, keep or delete.

## 4. Phases

#### Phase 1: two sweeps can be compared, or the comparison refuses

**Files:** `scripts/sweep-delta.ts` NEW · `package.json` EDIT ·
`scripts/__tests__/sweep-delta.spec.ts` NEW · `docs/verification/SWEEP-TEMPLATE.md` EDIT
(a `Round` field, so a ledger states which round it belongs to).

| Test | Assertion | Negative control |
|---|---|---|
| `should report exports that moved from unused to used` | a fixture pair yields the moved symbol | make both sides the same archive → the moved list is empty, and the self-comparison guard below catches the setup |
| `should throw when the two sweeps name different genres` | throws | allow it → a platformer run "improves" a runner run |
| `should throw when the brief hashes differ` | throws | allow it → the subject changed under the measurement |
| `should throw when both paths resolve to the same archive` | throws | self-comparison always reports "no change" and reads as a stable result |

#### Phase 2: the round-2 sweeps, on rebuilt tarballs

**Files:** `docs/verification/sweep-platformer-<date>-r2.md` NEW ·
`docs/verification/sweep-topdown-action-<date>-r2.md` NEW ·
`docs/benchmark/DELTA-<date>.md` NEW · `docs/strategy/ROADMAP.md` EDIT ·
`docs/README.md` EDIT.

**Proof subject:** `topdown-action` again — no template, so the framework is the only thing
that can be reached for. The `platformer` control says whether any movement came from the
template rather than the packages.

The tarballs are rebuilt from `main` **after** PRD-017 merges; `pnpm sandbox` snapshots, it
does not link, so a stale sandbox measures the old framework and the manifest's framework
version is what proves which one was used.

| Test | Assertion | Negative control |
|---|---|---|
| Both r2 ledgers pass the PRD-016 schema test | `pnpm test` green | blank a field → red |
| `sweep:delta` output matches the numbers written in the delta record | recompute equals recorded | hand-edit a number → mismatch |
| Manifest framework version equals the merged PRD-017 commit | recorded in the delta record | run against stale tarballs → versions differ and the record is void |

#### Phase 3: the kill switch, executed

**Files:** whichever of `packages/physics/src/CharacterBody3D.ts`, `src/RigidBody3D.ts`,
`templates/*/src/**`, `templates/*/AGENTS.md` the census condemns · `docs/benchmark/DELTA-<date>.md` EDIT.

One row per PRD-017 change. Evidence is a pasted grep over the round-2 sandbox source, not
a judgement.

| Change | Census question | If no call site |
|---|---|---|
| `object: Object3D` on bodies | did the build parent visuals under a non-`Mesh` body? | revert to `mesh: Mesh` — the wider type cost surface and bought nothing |
| `CharacterBody3D.teleport()` | is `teleport(` in the sandbox source? | delete; respawn stays user-space through the raw body |
| `@types/three` in `minimal` | did the build run `pnpm typecheck` without adding it? | keep regardless — a scaffold that fails `tsc` is a defect, not an abstraction |
| Input-axis documentation | did the build move the character the right way on the first try? | rewrite the wording; a wrong direction in round 2 means the doc fix failed |
| Round-1 friction rows | does any reappear in the round-2 ledger? | a repeat means the fix missed the actual blocker; reopen it in the delta record |

| Test | Assertion | Negative control |
|---|---|---|
| `pnpm typecheck && pnpm test` after each deletion | green | delete something that *is* called → the template call site fails to compile, which is the check working |
| `should record a verdict and pasted evidence for every round-1 change` | every row has both | leave a row blank → schema test red |
| `pnpm budgets` | framework LOC after deletions is recorded in the delta | — |

#### Phase 4: the two genres nobody has run

**Files:** `docs/verification/sweep-endless-runner-<date>.md` NEW ·
`docs/verification/sweep-exploration-<date>.md` NEW · `docs/benchmark/DELTA-<date>.md` EDIT ·
`docs/strategy/ROADMAP.md` EDIT.

These close the debt PRD-016 §4 Phase 4 declared: long-session scene churn and procedural
streaming were exercised by neither round-1 subject. `exploration` is the one that stresses
`ctx.goto`, asset churn and memory across repeated level loads — the Phase 1 device-matrix
concerns, measured on the web first.

| Test | Assertion | Negative control |
|---|---|---|
| Both ledgers pass the schema test and name their brief hash | `pnpm test` green | — |
| Each new friction row names the API that blocked it | schema-enforced field | a row with a workaround and no API → red |
| `ROADMAP.md` Phase 1 item 4 lists exactly the genres with an archived sweep folder | folder exists per claim | claim a fourth → no archive, false on inspection |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets

# fail-closed proof, pasted rather than summarised
pnpm sweep:delta docs/benchmark/sweeps/platformer-<d1> docs/benchmark/sweeps/topdown-action-<d2>
#   expect: throw — different genres
pnpm sweep:delta docs/benchmark/sweeps/platformer-<d1> docs/benchmark/sweeps/platformer-<d1>
#   expect: throw — self-comparison

# the census, per change, over source written by an agent that never read this repo
grep -rn "teleport(" docs/benchmark/sweeps/topdown-action-<d2>/src
grep -rn "@threenative" docs/benchmark/sweeps/topdown-action-<d2>/src | wc -l

# the deletion check
# revert one Phase 3 deletion → its template call site must fail to compile
```

## 6. Acceptance (consumer-scoped)

- [ ] A delta record exists comparing two sweeps of the same genre on the same sealed brief,
      with the framework version each run used.
- [ ] Every PRD-017 change has a keep-or-delete verdict backed by a pasted grep over source
      an uninformed agent wrote, and every deletion is in the tree, not in a follow-up list.
- [ ] `pnpm sweep:delta` refuses to compare two different genres, two different briefs, or an
      archive with itself — all three observed throwing.
- [ ] Four genres have archived sweeps and ledgers, and `ROADMAP.md` Phase 1 item 4 names
      exactly those four.
- [ ] If round 1 did not help, the record says so in its own words and the framework is
      smaller than it was before this PRD started.
