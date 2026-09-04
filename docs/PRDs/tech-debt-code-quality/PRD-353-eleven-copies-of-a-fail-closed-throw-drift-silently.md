---
prd_contract: v1
---

# PRD-353 — eleven copies of a fail-closed throw, and nothing notices when one drifts

**Status: PROPOSED, 2026-09-04.** Filed out of PRD-322's Phase 0 audit, which measured the
duplication and then explicitly declined to act on it:
[`docs/verification/PRD-322-phase0-boundary-audit.md`](../../verification/PRD-322-phase0-boundary-audit.md)
§8 — *"If it is to be removed, the argument is scaffold-generation drift, not rule 1(a) — a
different PRD with a different justification."* That PRD did not exist. This is it.

**Complexity:** +1 touches the ten templates plus a sandbox game, +1 a new gate in an existing
runner, +0 no public surface = **2 → LOW mode.**

## 1. Context

`src/render/quality.ts` is generated into every template. Its first 19 code lines — a tier type, a
tier array, a string narrower and a `resolveQualityTier` that **throws on an unknown tier** — are
byte-identical across all eleven copies today:

```
$ sed -n '/^export type QualityTier/,/^  return request.mobile === true/p' <file> | md5sum
7f4a7f8f4ccf  packages/create-threenative/templates/action-rpg/src/render/quality.ts
7f4a7f8f4ccf  … (all ten templates)
7f4a7f8f4ccf  sandbox/wildwood/src/render/quality.ts
```

**Today** is the operative word. Nothing checks it.

**What the existing gate actually covers.** `scripts/template-quality.ts` runs in `pnpm budgets`
and reports *"10 templates ship src/render/quality.ts, read it, and document it"*. Reading it:
`:104` checks the three tier names are present, `:172` checks each is named in prose. **It does not
compare the eleven implementations, and it does not assert the throw exists.** A template whose
`resolveQualityTier` silently returned `"high"` on an unknown name would pass every gate in the
repository.

**Why that specific drift matters more than ordinary duplication.** The duplicated code is a
fail-closed throw, in a repository whose stated invariant is *"Fail closed everywhere: malformed
input throws, a missing observation fails, an empty assertion set is a failure."* The root
`AGENTS.md` records what a silent fallback costs here: v1's harness dropped malformed assertions
and reported green. A tier that silently became `"high"` is the same failure wearing a render
setting — and the file's own comment already names the symptom: *"a silent fallback here looks
exactly like a tier that turned out to have no effect."*

**This is explicitly not PRD-322.** That PRD proposed moving the code into `packages/core` as a
platform seam and was declined: the code reads no platform source, and its one platform-to-tier
line is a look decision rule 1(b) keeps in the game. **Nothing here proposes moving anything.** The
question is whether eleven generated copies of a safety property stay identical, which is a
scaffold-drift question with a scaffold-drift answer.

## 2. Solution

A drift gate, not an abstraction.

- Extend `scripts/template-quality.ts` to hash the narrower-and-throw span of every template's
  `quality.ts` and fail when they disagree, naming the templates that differ.
- Assert the throw is present, so a copy cannot lose its fail-closed behaviour while remaining
  identical to ten other copies that also lost it.

**What must not happen.** The presets below the span are the game's look and differ deliberately —
Wildwood's `high` is nothing like the starter's. The gate must hash only the span above
`qualityPreset`, or it will fail on exactly the variation the framework exists to allow.

## 3. Integration Ledger

| # | New thing | Live caller | Replaces | Negative control |
|---|---|---|---|---|
| 1 | Span-hash comparison across templates | `scripts/template-quality.ts:→impl`, via `pnpm budgets` | nothing — no bound exists | Change one template's narrower; the gate names that template |
| 2 | Throw-presence assertion | `scripts/template-quality.ts:→impl` | nothing | Replace one `throw` with a fallback return; the gate fails |
| 3 | Preset divergence stays legal | the same gate | — | Edit a template's `high` preset; the gate stays green |

## 4. Phases

**Phase 0 — the red.** Mutate one template's narrower, paste the failure. Mutate one template's
preset, paste the green. Both before the gate ships.

**Phase 1 — the gate**, in `template-quality.ts`, wired through the existing `pnpm budgets` entry.

**Phase 2 — decide what the span is.** Either a marker comment the generator emits, or a structural
anchor (`export type QualityTier` … `qualityPreset`). A marker is more honest than a line range.

## 5. Acceptance criteria

- [ ] **AC1 — drift fails.** One template's narrower changed → `pnpm budgets` fails naming it. Red
      pasted.
- [ ] **AC2 — a lost throw fails.** One template's `throw` replaced by a fallback → the gate fails,
      even though the copies still agree with each other. Red pasted.
- [ ] **AC3 — look divergence stays legal.** A template's preset values edited → green. This is the
      control that stops the gate becoming a look freeze.
- [ ] **AC4 — Wildwood is not gated.** It is a sandbox game in another repository; the gate covers
      what this repository generates.
- [ ] **AC5 — gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, output pasted.

## 6. Decline conditions

Close as DECLINED if the span cannot be delimited without a line range that itself drifts, or if
the templates' `quality.ts` files are already expected to diverge — in which case the eleven-way
identity is a coincidence rather than an invariant, and there is nothing to enforce.
