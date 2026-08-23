# PRD-188 — Retire the rotten half of the LOC budget system; keep the spine that bites

**Status:** PROPOSED
**Complexity:** 1 (touches 5 files) → **LOW mode**
**Owner:** unassigned
**Depends on:** none
**Source:** 2026-08-22 spike into `pnpm budgets` friction, requested directly by the owner after
PRD-186 recorded their directive *"i dont care about LOC, i care about solving problems."*

---

## 1. Context

**Problem:** Two pieces of the LOC budget system are permanently red or permanently stale, so
they produce alarm noise and bookkeeping rituals instead of control — while the parts that do
bite (structural invariants, census verdict gate, benchmark ratchet) stay cheap and keep earning.

**Files analysed**

| Path | What it is |
|---|---|
| `scripts/check-budgets.ts` | the budgets gate: hard invariants + report-only LOC triggers + attribution snapshot reader |
| `scripts/__tests__/budgets.spec.ts` | fixture-based tests for all of the above |
| `docs/verification/loc-attribution-2026-08-20.md` | the active framework LOC attribution snapshot |
| `docs/architecture/CHARTER.md` | budget table pins framework 15k / native 50k review triggers |

**Measured state at spike time (`pnpm tsx scripts/check-budgets.ts`, 2026-08-22):**

```
budgets trigger: native runtime LOC review trigger: 79753 lines (trigger 50000, +29753).
  Justify in the owning PRD and run the kill switch over what was added.
native census drift: tests/ recorded 10,482, measured 10,481
budgets ok: ... 14702/15000 framework LOC, 79753/50000 native runtime LOC ...
```

And the attribution verifier, invoked explicitly:

```
recorded framework LOC attribution total disagrees with measured framework LOC:
recorded 12936, measured 14702
```

**Current behaviour**

- The native runtime LOC trigger has been crossed since PRD-064 justified it (+60% over) and now
  prints an unread warning on **every** run. A control that far over is not a control.
- The attribution snapshot machinery is non-fatal in normal enforcement, runs nowhere in CI, and
  its only explicit invocation is already red on the real tree (above). It costs periodic hand
  reconciliation commits ("use reconciled LOC attribution", "record framework LOC reconciliation")
  or silently rots. Its one consumer outside `check-budgets.ts` is a spec assertion of its own
  fixtures (`scripts/__tests__/budgets.spec.ts:175`).
- The semantics confuse even the repo's own records: PRD-186 states crossing 15k framework LOC is
  "a HARD CI failure"; the code makes it a printed warning (`budgetTriggers`, never in
  `budgetErrors`). Nothing fails CI on any LOC number today.
- What does earn its keep, measured this month alone: the framework 15k trigger produced PRD-165
  (DebugOverlay CSS moved out of `packages/ui` into generated template source on 2026-08-20); the
  census verdict gate forced KEEP/DELETE rows with live proof across ~80k lines of owned C++ and
  had its own fail-open hole closed (`15cb180a`); the structural invariants guard dependency
  boundaries for near-zero cost.

**What stays unchanged:** structural hard invariants (vendored-MCP ban, single-runtime-tree rule,
untracked `third_party`, capability manifest freshness), the native census verdict gate and
`pnpm census` generation, the framework 15k review trigger, and the `count-loc.ts` benchmark
ratchet over the frozen abyss arms.

---

## 2. Integration Ledger (removal form)

| # | Deleted thing | Was reached by | Proof of death | Negative control |
|---|---------------|----------------|----------------|------------------|
| 1 | `readFrameworkLocAttribution` / `parseFrameworkLocPackages` / attribution field | `budgetTriggers` delta text; `verifyFrameworkLocAttribution`; spec §"attribution" | grep over `scripts/ packages/ docs/architecture/` returns empty; trigger output loses its "Packages moved…" sentence | pre-removal: `git mv` the snapshot away → verifier red with "attribution is missing" (coupling observed live before deletion) |
| 2 | `verifyFrameworkLocAttribution` / `--verify-framework-loc-attribution` flag | manual CLI invocation only; never CI, never another script | flag no longer changes behaviour; typecheck fails on any surviving reference | the red output pasted in §1 is the observed failure being deleted |
| 3 | Native trigger value `50_000` → re-pinned `100_000` | `budgetTriggers` | `pnpm budgets` prints no native trigger line on this tree; spec fixtures assert the new boundary | fixture test goes red if `LIMITS.nativeRuntimeLoc` reverts to `50_000` (79,753 > 50,000 fires) |

**Reachability (inverted for removal):** every deleted symbol must have zero surviving callers;
every kept symbol keeps exactly its current callers. No new wiring is added anywhere in this PRD.

---

## 3. Phases

#### Phase 1: Delete the framework LOC attribution machinery — budgets output stops carrying a stale snapshot

**Files (4):**

- `scripts/check-budgets.ts` - EDIT: remove `FRAMEWORK_LOC_ATTRIBUTION`, `readFrameworkLocAttribution`,
  `parseFrameworkLocPackages`, `frameworkPackageDeltaSummary`, `frameworkPackageDifferences`,
  `verifyFrameworkLocAttribution`, the `--verify-framework-loc-attribution` CLI branch, and
  `BudgetReport.frameworkLocAttribution`; strip the "Packages moved since last recorded
  attribution:" sentence from the framework trigger text
- `scripts/__tests__/budgets.spec.ts` - EDIT: remove the attribution fixture writer and the
  attribution tests (~lines 77–95, 150–220 region), keep all other coverage intact
- `docs/verification/loc-attribution-2026-08-20.md` - DELETE (load-bearing copy; reproducible by
  measurement). The historical `loc-attribution-2026-08-19.md` stays untouched
- `docs/verification/budgets-decommission-2026-08-22.md` - NEW: evidence record naming what ran

**Implementation:**

- [ ] Remove the symbols and the report field; let typecheck name every survivor
- [ ] Update the framework trigger message to end after the kill-switch instruction
- [ ] Delete the spec sections exercising removed symbols; run the suite

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (observed red) |
|-----------|-----------|-----------|--------------------------------|
| existing `budgets.spec.ts` | remaining trigger/census/vendoring suites | all green after removal | suite was green before too; the red evidence is the pre-removal coupling check below |

**Verification Plan:**

1. Pre-removal red (already captured in §1): verifier invoked explicitly reports the
   recorded/measured disagreement — the coupling existed and was already failing
2. `grep -rn "frameworkLocAttribution\|readFrameworkLocAttribution\|verifyFrameworkLocAttribution\|loc-attribution-2026-08-20" scripts packages docs/architecture` → empty
3. `pnpm typecheck && pnpm lint && pnpm test` → green
4. `pnpm tsx scripts/check-budgets.ts` → exits 0; output contains no "Packages moved" text
5. Revert check: restoring any deleted symbol without its spec section fails typecheck/lint
   (`no-unused` / missing export consumers)

#### Phase 2: Re-pin the native runtime trigger to an honest number — the warning means something again

**Files (3):**

- `scripts/check-budgets.ts` - EDIT: `LIMITS.nativeRuntimeLoc` `50_000` → `100_000`
- `docs/architecture/CHARTER.md` - EDIT: budget table row for native runtime source 50,000 →
  100,000 (grep the charter for any other "50,000" mention first)
- `scripts/__tests__/budgets.spec.ts` - EDIT: native-trigger fixtures assert the 100k boundary
  (fires above, silent below), replacing the 50k fixtures

**Implementation:**

- [ ] Update `LIMITS` and the fixture numbers together
- [ ] Update the charter row; keep the charter's rule text untouched otherwise

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (observed red) |
|-----------|-----------|-----------|--------------------------------|
| `budgets.spec.ts` | `should fire the native runtime trigger past 100k lines` | fixture report at 100,001 yields a trigger | reverting `LIMITS` to `50_000` makes the silent-at-79,753 case red (paste) |
| `budgets.spec.ts` | `should stay silent at the pinned native trigger` | fixture at ≤100,000 yields `[]` | same mutation |

**Verification Plan:**

1. `pnpm tsx scripts/check-budgets.ts` → exits 0 with **no** native trigger line; summary reads
   `79753/100000 native runtime LOC`
2. Mutation: set `LIMITS.nativeRuntimeLoc` back to `50_000`, run the two fixture tests → both
   red; restore → green. Paste both outputs in the verification record
3. `pnpm typecheck && pnpm lint && pnpm test` → green

---

## 4. Acceptance criteria

Consumer-scoped: the operator running `pnpm budgets` on this tree sees zero LOC warnings and a
summary whose native number reflects reality; nobody regenerates or reconciles an attribution
snapshot again; the next genuine native growth spurt re-arms a trigger that is currently noise.

- [ ] `pnpm budgets` exits 0 printing no "review trigger" lines on the current tree
- [ ] Attribution grep (§ Phase 1, step 2) returns empty
- [ ] Charter table and `LIMITS` agree on 100,000
- [ ] Both phases' mutations were observed red and pasted into
      `docs/verification/budgets-decommission-2026-08-22.md`
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green at the closing commit

## 5. Non-goals

- Touching the framework 15k trigger (it fired usefully on 2026-08-20 via PRD-165). If the owner
  waives it again next crossing, that decision happens then, with PRD-186's waiver as precedent.
- Touching the census verdict gate, `pnpm census`, structural invariants, or the benchmark
  ratchet.
- Deciding whether the census drift warning should be fatal — separate question, separate PRD.
