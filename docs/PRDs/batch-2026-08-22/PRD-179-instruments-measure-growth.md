---
prd_contract: v1
---

# PRD-179 — The instruments measure growth, not coordinates

**Status:** OPEN, 2026-08-22. Filed from the 2026-08-22 area scorecard (findings #11, #14;
scripts/CI/DX scored 62/100). Evidence verified at HEAD `a84f08da`.

Complexity: 5 → MEDIUM mode (two instruments; comparison semantics are subtle — the 2026-08-20
audit called fixing the baseline *before* semantics "debt laundering", and this PRD obeys that
order).

**Outcome:** the quality report's new/inherited split reflects what actually grew, and
`pnpm gate:status` can see every long lane — not just `pnpm test`.

## Context (verified evidence)

1. **Quality keys findings by position and ignores the measured value.**
   `scripts/check-quality.ts:219-220` — `findingKey = file:line:signal`; `runQuality`
   (`:358-379`) marks "inherited" purely on key match. Consequences, both live today:
   `scenario.ts` grew 1,799 → 1,867 while staying "inherited" (file-length findings always report
   line 1, so a file can double past threshold unnoticed), while any line shift mints fake-"new"
   findings — today's run reports **42 new / 11 inherited**, mostly coordinate noise. The baseline
   (`docs/verification/quality-baseline.json`) was generated 2026-08-11.
2. **Six long chains emit no gate records.** The sole `TN_GATE_STATUS_PATH` writer is
   `scripts/run-test-suite.sh`. Zero phase/heartbeat emission in `scripts/sweep-capture.ts`,
   `scripts/template-baseline.ts` (visuals:baseline), `scripts/visual-gate.ts`,
   `scripts/profile-native-cpu.ts`, `packages/runtime-native/scripts/profile-production.mjs`, and
   `packages/runtime-native/conformance/run-conformance.mjs` (parity). CLAUDE.md promises "long
   gates write one read-only local record"; a hung parity run currently has no heartbeat for
   `gate:status`/`gate:doctor` to report.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Value-aware finding classification | `runQuality` `check-quality.ts:~358` | key-only classification | replaced in place | scenario.ts's real growth classifies as `grew`, not `inherited` |
| 2 | Shared gate-record writer | called at phase boundaries of all six chains | `run-test-suite.sh`'s inline writer | reduced to a call of the shared helper | kill a chain mid-phase → `gate:status` shows the stale heartbeat, `gate:doctor` names the phase |

## Phases

#### Phase 1: Quality compares values; identity survives line movement

**Files (3):** `scripts/check-quality.ts` - EDIT; its spec `scripts/__tests__/` (follow the
existing naming) - EDIT; `docs/verification/quality-baseline.json` - REGENERATED **after**
semantics land, never before.

**Implementation:**
- [ ] Classification keys on `file:signal` (line-independent); a finding is `grew` when its
      measured value exceeds the baseline's recorded value, `inherited` when ≤, `new` when no
      baseline row matches, `waived` unchanged.
- [ ] The report gains a `grew` state (counts + rows); `pnpm quality` stays never-fatal, and the
      budgets gate keeps its own hard triggers — this PRD changes reporting honesty, not fatality.
- [ ] Only after the spec below is green, regenerate the baseline with `--update-baseline` in the
      same commit, pasting the before/after counts.

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| quality spec | `should mark a hotspot grew when its value rises past the baseline` | scenario.ts-shaped fixture (same file:signal, value 1,799 → 1,867) classifies `grew` | run the new spec against the OLD classification → red |
| quality spec | `should stay inherited when only the line moved` | same value, line shifted → `inherited`, not `new` | same revert → red |
| quality spec | `should keep fail-closed baseline validation` | malformed baseline still throws | n/a (existing behavior pinned) |

**Revert check:** reverting the classification change makes the first two tests red.

#### Phase 2: Every long chain writes the gate record

**Files (7):** NEW shared writer `scripts/gate-records.mjs` (extracted from the shape
`run-test-suite.sh` already writes); `scripts/run-test-suite.sh` - EDIT (calls the shared writer);
`scripts/sweep-capture.ts`, `scripts/template-baseline.ts`, `scripts/visual-gate.ts`,
`scripts/profile-native-cpu.ts`, `packages/runtime-native/scripts/profile-production.mjs`,
`packages/runtime-native/conformance/run-conformance.mjs` - EDIT (phase-boundary calls). (Seven
files is one over the phase cap — split the six call-site edits into 3+3 if needed.)

**Implementation:**
- [ ] The writer emits the existing record shape (run, phase, heartbeat, owner, command, artifact)
      to `TN_GATE_STATUS_PATH`; chains call it at phase start/end; no chain invents a second shape.
- [ ] `gate:status` / `gate:doctor` / `gate:resume` work unchanged against every chain — verify at
      least one non-test chain end-to-end (e.g. `pnpm parity`) before claiming the rest.

| Verification | Expected |
| --- | --- |
| during a `pnpm parity` run: `pnpm gate:status` | names the run, current phase, fresh heartbeat — pasted |
| kill the chain mid-phase | `gate:status` shows the stale heartbeat; `gate:doctor` names the hung phase — pasted |
| `pnpm test` behavior unchanged | its record shape identical to before via the shared writer |

**Negative control:** with the writer temporarily writing to a bogus path, `gate:status` must show
no record for that chain (proves the record comes from the writer, not from stale state on disk).

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | The report flags `scenario.ts` (or its successor hotspot) as `grew` the day it grows — and stops minting fake `new` rows when a file is edited without growing | pasted quality output before/after a no-growth edit |
| 2 | An operator watching any of the six chains can answer "hung or slow?" from `pnpm gate:status` alone, for at least parity and one visuals lane | pasted status outputs incl. one killed-run record |
| 3 | Baseline regenerated only after the new semantics' spec is green, in the same commit | pasted commit diff order + spec output |
| 4 | Full gates green | pasted `pnpm typecheck && pnpm lint && pnpm test` tail |

## Deliberately out of scope

- Making quality findings fatal, or adding C++-language checks to the quality instrument.
- Re-baselining the native LOC trigger (owner decision, tracked in the batch README).
