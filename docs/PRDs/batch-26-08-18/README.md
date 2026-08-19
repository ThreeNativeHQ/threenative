# Batch — the engine ships it, the agent finds it, the gate can't lie about it

**Status: ACTIVE, 2026-08-19.** PRD-151, PRD-156, PRD-157 and PRD-158 are complete and
individually archived. No device result, mobile-readiness claim or platform-parity claim exists
for any PRD in this batch.

PRD-153, which this folder previously carried, closed on 2026-08-18 and is archived at
`docs/PRDs/done/PRD-153-game-branding-from-launch-to-play.md`.

## Why this batch exists today

One incident on 2026-08-18, on a real scaffolded game at
`~/projects/threenative/sandbox/fps-framework`, produced three separate findings that are three
layers of the same failure.

An agent building an ordinary shooter hand-wrote roughly 700 lines the engine either already
shipped or should have — including 446 lines replacing `@threenative/physics/navigation` and
`attachToBone`, both installed and importable. Two of those hand-rolled systems then ran the game
at **9.4 FPS**. And the scenario written to protect the death animation stayed green while the
death animation was frozen, because all six of its assertions had waived the harness's own
triviality guard.

Read as layers:

| Layer | What went wrong | PRD |
|---|---|---|
| The agent could not see the capability | ~20 public exports have no tool surface, no manifest, no generated reference — one paragraph of prose that omits half of them | [157](../done/PRD-157-capability-discovery-before-authoring.md) |
| The engine did not ship the convention | Grounding, asset scale and pipeline prewarm are each left to the game, and the game got them wrong at a 6x frame-rate cost | [156](../done/PRD-156-engine-ships-conventions-by-default.md) |
| The gate could not report either one | `allowTrivial` is a free boolean the failure message itself recommends; the guard covers 3 of 21 assertion kinds | [158](../done/PRD-158-the-triviality-opt-out-is-free.md) |
| The docs that should have carried the rule | Seven hand-copied `AGENTS.md` files, four of which dropped rules the other three keep | [151](../done/PRD-151-shared-template-agent-docs.md) |

## The work

| PRD | What it closes | Complexity | State |
| --- | --- | --- | --- |
| [157](../done/PRD-157-capability-discovery-before-authoring.md) | Generates a situation-indexed capability manifest from the export maps and serves it to the authoring agent as MCP tools, so engine capabilities are found before they are hand-written | 7 | DONE |
| [156](../done/PRD-156-engine-ships-conventions-by-default.md) | Ships skinned-model grounding, asset scale normalisation and GPU pipeline prewarm as engine conventions with documented overrides; gates the templates' capability docs against the real export set | 9 | DONE |
| [158](../done/PRD-158-the-triviality-opt-out-is-free.md) | Makes the triviality waiver carry a written reason, counts waivers in the report, fails a scenario that waived everything, and makes all 21 registry entries justify their `triviality` label | 5 | DONE |
| [151](../done/PRD-151-shared-template-agent-docs.md) | Writes the rule every generated project's agent must read once, in shared fragments, enforced by the existing `sync:agents --check` gate instead of by whoever remembers to paste it seven times | 3 | DONE |

## Order

**1. PRD-157 first.** Its manifest generator walks the export maps; PRD-156's census gate consumes
that output. Two independent export-walkers would drift past each other silently.

**2. PRD-158 second, and before PRD-156's Phase 5.** 156 deletes hand-rolled systems from
`fps-framework` and proves the deletion with that project's gates. Those gates are the ones with
18 waivers across 8 scenarios. Repairing the gates after trusting them to certify a deletion is
the wrong order.

**3. PRD-156 third.** Its Phase 0 census gate needs 157's manifest; its Phase 5 needs 158's
repaired gates.

**4. PRD-151 last, or in parallel.** It depends on nothing and blocks nothing. Landing it after
156 and 158 means the shared fragments are written once against the final rules rather than
edited twice. If it lands first instead, 156 Phase 0 and 158 Phase 4 edit fragments rather than
seven files each — either order works, and only this one is a free choice.

Within each PRD, its own phases are the order, and a later phase does not start on an unrun
earlier one.

## What this batch can be executed against

Every gate in all four PRDs runs on this machine: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:templates`, `pnpm budgets`, and browser playtests under `sh scripts/xvfb.sh`. **No
phone, no Mac and no CI minute is required by anything here.** PRD-156's frame-rate criteria are
desktop-browser measurements against a named adapter, not device claims.

## Batch completion

This folder remains active while any PRD in it is `PROPOSED`, `OPEN`, `PARTIAL`, `BLOCKED` or
otherwise unfinished. Archive the whole folder to `docs/PRDs/done/batch-26-08-18/` in the commit
that closes the last one, with executed evidence linked and every acceptance row resolved. A PRD
that finishes well ahead of its siblings is archived individually.

## Deliberately outside this batch

- **PRD-133** (published packages have READMEs), which stays at `docs/PRDs/`. Its one remaining
  red criterion is five stale published-version findings, and clearing it means publishing to npm
  — an outward-facing action that needs an owner decision, not an unattended run.
- Any physical-device, iOS or Android result. The Android emulator lane is red and bisects to
  PRD-155; that is its own work.
- A preset system, a component library, or any framework-owned visual style. Still closed.
- Re-scoring `OPPORTUNITY-AREAS.md` against the retired 20-line rule.
