---
prd_contract: v1
---

# PRD-063 — 167 unreached exports, zero deleted

**Status: COMPLETE, 2026-08-10.** The frozen worklist has one disposition and caller evidence
for all 167 candidates; five dead exports were deleted and 106 internal-only exports were
un-exported. The round-3 ledger records the outcome.

**Complexity: 4 → MEDIUM mode.** One report run, one live-caller review per candidate group,
deletions with their tests, one ledger row per decision.

**Blast radius:** `packages/*/src` exports that survive review as dead, their tests, their
export maps, `docs/verification/deletions-2026-08-10.md`, and the round-3 ledger's deletion
table. **No template source, no example, no native runtime, no new package.**

**Depends on:** PRD-021 (`round:deletions`, shipped). Round 3's ledger is the input.

**Charter authority:** `CHARTER.md` §3 (the kill switch), `/AGENTS.md` rule 2: *"Any
abstraction that costs more code than plain Three.js is deleted, however much work it took."*
`docs/PRDs/done/PRD-021` states the rule in its operational form: *any export that no fresh
uninformed build reached for is deleted in the round that discovers it.*

## 1. Why this exists

Round 3's ledger, deletions table, verbatim:

| Export | Rounds unreached | Deleted? | Evidence |
| --- | --- | --- | --- |
| 167 persistent candidates | 2 | **no** — report only; each needs live-consumer review before deletion | `pnpm round:deletions`, rounds 2 and 3 framework archives |

`ROADMAP.md` records the same thing about rounds 1–3: *"167 unreached exports reported,
**zero deleted**."* The rule says delete in the round that discovers it; the round deferred
every candidate to a review that was never scheduled and has no owner. Two rounds of evidence
have now accumulated behind a promise to look later.

This matters beyond tidiness. The framework's claim is that it costs the user less than
vanilla. Every export nobody reaches for is surface a model must read past, and the deletion
sweep is the only mechanism that shrinks it. A kill switch that has never once fired is not a
kill switch.

## 2. The honest complication

"Unreached by two sweep builds" is not the same as "dead." The report's evidence column names
two archives (`open-world-2026-08-09-3`, `exploration-2026-08-07-5`), and a sweep game is a
narrow consumer. Visible in the current report are names like `runStandalonePlaytest`,
`parsePlaytestTarget`, `parseViewport`, `sampleThreeObservations` — playtest CLI and bridge
internals a *sweep game* would never call, but the CLI itself does.

So the sweep report is a **candidate generator, not a verdict.** This PRD supplies the missing
step: a cheap, mechanical live-caller check that turns each candidate into one of four
dispositions, with no "review later" escape.

## 3. The four dispositions

Every one of the 167 candidates lands in exactly one, and the count in each is recorded.

| Disposition | Test | Action |
|---|---|---|
| **Reached externally** | a caller exists outside the declaring package: another `packages/*/src`, a template, an example, or the playtest CLI | keep the public export; record the external caller path |
| **Internal only** | every caller lives inside the declaring package's own `src` or `__tests__` | **un-export**: remove from the package `index.ts`, keep the symbol module-local. A test-only caller does not justify a public export |
| **Public by contract** | no internal caller, but it is a documented consumer entry point in an export map that a scaffolded project uses | keep; record which template or generated file calls it. A public export with no consumer anywhere is *not* this row |
| **Dead** | no caller in the repository, no consumer in any template, no export-map path a user reaches | delete with its tests in this PRD's commit |

A candidate that cannot be placed in a row is **dead by default**. Fail closed: the burden is
on the export to prove it has a consumer, not on the sweep to prove it does not.

## 4. Phases

**Phase 0 — regenerate and freeze the list.** Run `pnpm round:deletions`, write the full
current candidate list to `docs/verification/deletions-2026-08-10.md`. That file is the
worklist; nothing outside it is touched.

**Phase 1 — mechanical caller resolution.** For each candidate, resolve callers by name across
`packages/*/src`, `packages/*/__tests__`, `packages/create-threenative/templates/**`,
`examples/**`, and every `package.json` `exports` map. Record the disposition and the evidence
for it. This is the step round 3 deferred; it is grep work, not judgement work, for the large
majority.

**Phase 2 — delete the dead.** One commit. Exports, their implementations if nothing else uses
them, their tests, and their export-map entries go together. `pnpm test` runs each package's
build plus `publint`, so a broken export map fails immediately.

**Phase 3 — close the ledger row.** Round 3's deletion table is amended in place to record what
actually happened: counts per disposition, the deleted list, and the evidence file. The row
stops saying "no — report only".

## 5. Acceptance criteria

1. `docs/verification/deletions-2026-08-10.md` lists all current candidates, each with exactly
   one disposition and the evidence that produced it. Zero candidates carry "review later".
2. Every `dead` candidate is deleted in this PRD's commit.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` green after the deletions.
4. `pnpm test:templates` green — a deletion that breaks a scaffolded project is a deletion of
   something that had a consumer, and the disposition was wrong.
5. Round 3's ledger deletion table reflects the outcome, including a count of `kept` with
   caller evidence.
6. If the outcome is *zero deletions*, the evidence file names a caller for all 167. "Nothing
   was dead" is an acceptable result **only** with 167 caller paths behind it.

## 6. Self-verification

```sh
pnpm round:deletions               # before: candidate count
pnpm typecheck && pnpm lint && pnpm test
pnpm test:templates
pnpm budgets                       # framework LOC before/after, both pasted
pnpm round:deletions               # after: candidates that remain, with why
```

## 7. Scope fence

This PRD deletes unreached exports. It does not redesign an API, rename anything, or
consolidate two surfaces into one — each of those is a change a consumer feels, and none is
justified by a deletion sweep. If a candidate is dead but its neighbours suggest a better
shape, record the observation and stop.
