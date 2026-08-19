---
prd_contract: v1
---

# PRD-161 — The framework is 262 lines from its review trigger, the native runtime is 28,266 past its own, and the tool that finds deletable surface crashes

**Status:** PROPOSED, 2026-08-19. Nothing below has executed. Every number in §1 was produced by
running the repository's own commands on `HEAD` today and is quoted verbatim.

**Outcome:** the next framework change crosses the 15,000-line review trigger with a justification
already written and a deletion pass already run, instead of crossing it silently; the native
runtime's 28,266-line overshoot has an owner and a stated reason; and `pnpm round:deletions` runs
again, so the kill switch has an instrument rather than a memory.

**Depends on:** nothing.

**Blocks:** nothing formally. Practically it blocks any honest use of the kill switch, which the
rules describe as binding on every change.

**Complexity: 5 → MEDIUM mode.** One script defect with a fail-closed repair, one attribution pass
over two counters, one written justification. No package boundary moves and no public export is
deleted without the deletion criteria being met first.

**Blast radius: ~12 files.** `scripts/round-deletions.ts`, `scripts/__tests__/`,
`docs/verification/loc-attribution-2026-08-19.md`, and whichever PRD owns the native overshoot.

---

## 1. What the instruments say today

### 1.1 `pnpm budgets`, run on `HEAD`

```
budgets trigger: native runtime LOC review trigger: 78266 lines (trigger 50000, +28266).
                 Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 7 framework packages, 7 example workspaces, 14738/15000 framework LOC,
            78266/50000 native runtime LOC, 10 PRD files, largest template 2246 LOC
```

Two facts sit in that output.

**The framework counter is at 98.3 % of its trigger — 262 lines of headroom.** A single ordinary
feature crosses it. The rule when it crosses is not "raise the number": the PRD that crosses owes
a justification and a kill-switch pass over what it added. Nothing today knows which lines the
counter is made of, so that justification cannot be written on the day it is needed. It has to
exist before the crossing, not after.

**The native counter is 56 % past its trigger and reports as a routine line.** The last recorded
figure in `docs/PRDs/OPPORTUNITY-AREAS.md` is 53,851 on 2026-08-09 — *+3,851*. Ten days later it
is *+28,266*. The overshoot grew by 24,415 lines and no PRD in the tree carries the justification
the trigger demands. A number routed around is worse than no number, and this one has been routed
around for ten days by being printed every time.

### 1.2 `pnpm round:deletions`, run on `HEAD`

```
Error: Round 10 has no framework archive rows.
    at frameworkArms (scripts/round-deletions.ts:81:32)
```

It exits non-zero and reports nothing. This is one of the two commands the repository's own agent
instructions name for the self-improvement loop — the one that "reports exports unreached across
consecutive rounds", the input to every deletion decision. It has been dead since round 10, which
opened on the template visual baseline instead of a paired build and therefore wrote no framework
arm row.

This is the framework's own fail-closed rule working correctly at the wrong altitude: throwing on
a round that legitimately has no arms is indistinguishable, to the caller, from throwing on a
round whose arms went missing. The first is a normal state of the ledger. The second is corruption.

## 2. Why this is one PRD and not three

The kill switch — *any abstraction that costs more code than plain Three.js is deleted, however
much work it took* — is the rule that keeps this repository from becoming the 790k-line v1 that
died. It is enforced by exactly two instruments: a counter that says how much there is, and a
sweep that says which of it nothing reaches.

One counter is about to fire with no attribution behind it, one has been firing unheard for ten
days, and the sweep does not run. The rule is currently enforced by nobody remembering to.

## 3. Execution phases

A later phase does not start on an unrun earlier one.

### Phase 0 — Repair `round:deletions`, fail-closed

A round with no framework arm rows is a valid ledger state and must report as one — by name, with
the round number, and with a non-error exit — while a round whose arms are *missing* must still
throw. Distinguish the two on the ledger's own contents; do not soften the throw into a warning
for both.

Add the test with the change: one spec for the no-arms round that expects the reported state, one
for the malformed round that expects the throw. An empty result set that reports as success is the
v1 harness defect this repository exists downstream of.

Then run it and record what it says.

### Phase 1 — Attribute the framework's 14,738 lines

Produce `docs/verification/loc-attribution-2026-08-19.md`: framework LOC per package, using
`scripts/check-budgets.ts`'s own file selection rather than a second hand-rolled count. Two
counting rules is two numbers, which is the defect PRD-076 spent a week adjudicating on a
different subject.

For the largest contributors, state which of the two questions admitted them: *could the game
write this portably itself*, and *does it decide how anything looks*. That is the current test;
size decides nothing. The output is an attribution table, not a deletion list.

### Phase 2 — Run the kill switch over the top of that table

For each of the largest surfaces, one of three dispositions, in writing:

- **Earned** — a named live caller outside its own tests, and it passes both questions.
- **Deletable** — nothing reaches it across consecutive rounds per the repaired Phase 0 tool.
- **Undecided** — the evidence to decide it does not exist yet, and what evidence would.

Delete only what Phase 0's repaired sweep supports. PRD-063 disposed of 167 unreached exports by
deleting 5 and un-exporting 106; un-exporting is usually the right disposition and deletion is
rarely it.

### Phase 3 — Give the native overshoot an owner

`packages/runtime-native/` is 78,266 lines against a 50,000-line trigger. Write the justification
the trigger demands, in the PRD that owns the native runtime, covering: what the 24,415 lines added
since 2026-08-09 are, which platforms they serve, and how much of the total is generated or
vendored-but-tracked rather than authored.

If the honest answer is that the trigger is set at the wrong number for a C++ host with four
platform backends, that is an owner decision recorded as one — with the new number and its
reasoning — and not a silent edit to `LIMITS`. Nothing in this PRD raises a limit on its own
authority.

### Phase 4 — Make the next crossing legible

The framework counter's message must, when it fires, name the packages that moved since the last
recorded attribution. A trigger that says "you crossed" without saying "here" is a trigger whose
justification gets written from memory.

## 4. Verification

| # | Check | Expected |
|---|---|---|
| 1 | `pnpm round:deletions` on `HEAD` | exits `0`, names round 10's no-arms state |
| 2 | Malformed-ledger spec | still throws |
| 3 | Attribution total | equals `pnpm budgets`' `frameworkLoc` exactly; a mismatch fails the phase |
| 4 | Every disposition in Phase 2 | earned rows name a live caller outside tests |
| 5 | `LIMITS` in `scripts/check-budgets.ts` | unchanged, unless Phase 3 records an explicit owner decision |
| 6 | `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` | green |

## 5. Acceptance criteria

1. `pnpm round:deletions` runs on `HEAD` and reports; both the no-arms and malformed cases have
   specs in the same commit.
2. `docs/verification/loc-attribution-2026-08-19.md` exists, its total matches `pnpm budgets`, and
   every large surface carries earned / deletable / undecided with its reason.
3. The native 78,266-line overshoot has a written justification in the PRD that owns the native
   runtime.
4. No budget limit is raised in this PRD without an explicitly recorded owner decision.
5. Any deletion is supported by the repaired sweep across consecutive rounds, never by one read.
