---
prd_contract: v1
---

# PRD-199 — Parity scenario validation fails closed

**Status: DELIVERED 2026-08-25** — squash-merged to main as `76ef4929`; 8 mutation failures observed red before the fix, evidence in `docs/verification/prd-199-parity-fails-closed-2026-08-25.md`.

**Complexity:** +1 for 1–5 files = **3 → LOW mode**.

## Context

Scan finding #3: `packages/playtest/src/scenario/schema-validate.ts` (~lines 115–124)
fail open — `validateParityAnimation` returns `undefined` for malformed entries and
callers `.filter(x => x !== undefined)` them out; non-string `parity.resources` entries
and unknown targets are dropped the same way. Finding #16:
`scenario/schema-accessors.ts:445-452` coerces a wrong-typed present `viewport` key to
1280×720 defaults instead of throwing. The scan's own verdict: these are the two residual
fail-open holes in an otherwise fail-closed posture — a mistyped animation silently
shrinks the parity comparison, and screenshots get compared at a resolution nobody asked
for.

Files analyzed: the two paths above and their callers in the load path.

## Solution

- Malformed parity animation entries, non-string resource ids, and unknown targets throw
  at scenario load, naming field and index — same as every other wrong-typed known key.
- A present-but-wrong-typed `viewport` throws; an absent one still means defaults.
- No new validation library; extend the existing throw-at-load helpers.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Throwing parity validators | scenario load path calling `schema-validate.ts` | filter-out-undefined drop | restore the `.filter(...)` → mistyped-fixture test goes red (loads instead of throwing) |
| 2 | Strict viewport accessor | every scenario read through `schema-accessors.ts:445` | silent 1280×720 coercion | restore coercion → wrong-typed viewport test goes red |

## Execution Phases

### Phase 1 — Malformed parity input throws at load

**Files (3):** `schema-validate.ts`, its spec, one fixture with a deliberately mistyped
animation/resource entry (NEW under test fixtures).

- [ ] Each drop site becomes a throw naming field, index and reason.
- [ ] Valid scenarios byte-identical: existing suite passes unchanged.
- [ ] Red first: today's build loads the bad fixture and shrinks the comparison — paste it.

Mutation for red: restore any single `.filter(x => x !== undefined)` — that drop site's
test must go red.

### Phase 2 — Wrong-typed viewport throws

**Files (2):** `schema-accessors.ts`, its spec.

- [ ] Present key with wrong type throws; absent key keeps defaulting.
- [ ] Red first: `viewport: {"width": "1280"}` currently runs at defaults — paste it.

Mutation for red: restore the coercion branch; its test must go red.

## Verification

Record `docs/verification/prd-199-parity-fails-closed-<date>.md`.

1. Both specs green; each mutation observed red and pasted.
2. `pnpm --filter @threenative/playtest test` full package green (no valid scenario
   regressed).
3. One playtest run against the in-repo example fixture proving valid scenarios still
   execute end-to-end after the stricter loader.

## Acceptance Criteria

- [ ] A mistyped animation name, resource id or unknown target fails scenario load with a
      message naming field and index.
- [ ] A wrong-typed `viewport` fails load; defaults apply only to absence.
- [ ] Zero valid in-repo scenarios changed behaviour (suite + example playtest prove it).
- [ ] Both mutations pasted red above.
