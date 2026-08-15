---
prd_contract: v1
---

# PRD-121 — Delete unreached physics actuation members

**Status: NOT STARTED — blocked on an independent fresh paired round, corrected 2026-08-15.**

**Renumbered 2026-08-15, 117 → 121.** Two PRDs held the number 117: this one and
`docs/PRDs/PRD-117-engine-load-test-godot.md`, which is executed and owns the Godot load-test
instrument. Nothing about this PRD's content changed. Records written before the renumber —
`docs/verification/round-7-2026-08-15.md`, `score-physics-puzzle-round-7-2026-08-15.md`, and the
`production-readiness-26-08-14` batch README — refer to this PRD as **PRD-117**, and are left
as written because they are the evidence record.

## Context

The first version of this PRD incorrectly treated the same framework archive as both round 6 and
round 7 evidence. That duplicate claim is withdrawn. The corrected records name distinct source
snapshots: round 6 uses
`docs/benchmark/sweeps/physics-puzzle-2026-08-15-2`, while the repaired round 7 replay uses
`docs/benchmark/sweeps/physics-puzzle-2026-08-15-4`.

Both source snapshots contain no authored call to `RigidBody3D.applyImpulse` or
`RigidBody3D.applyForce`. The exact source search was
`rg -n 'applyImpulse|applyForce' docs/benchmark/sweeps/physics-puzzle-2026-08-15-2/src docs/benchmark/sweeps/physics-puzzle-2026-08-15-4/src`, which returned no matches
(exit 1). `pnpm round:deletions` passes on the two archives, while the exact method-level
conclusion comes from direct source inspection. The round-7 archive is a re-sealed
fallback replay rather than an independent fresh uninformed build, so this is candidate evidence
only. The members remain until a fresh paired round confirms the result.

Evidence:

- `docs/verification/round-6-2026-08-14.md`
- `docs/verification/round-7-2026-08-15.md`
- `docs/benchmark/sweeps/physics-puzzle-2026-08-15-2/framework-types/`
- `docs/benchmark/sweeps/physics-puzzle-2026-08-15-4/framework-types/`

## Scope

- Remove `applyImpulse` and `applyForce` from the public physics surface only if an independent
  fresh pair still reaches neither member.
- Update the browser and native declarations together; one public class remains shared by both
  targets.
- Add removal-sensitive unit coverage and rebuild the package declarations before the verdict is
  closed.

## Work sequence

1. Run an independent fresh paired build on the repaired observation and archive instruments.
2. Search package source, tests, templates, examples, and native bindings for both members.
3. Record any live caller before deleting anything; a caller reopens the member's keep decision.
4. Delete both members and their dead native/backend plumbing only if the fresh search is empty.
5. Run `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm round:deletions` on the next pair.

## Completion record

The closing evidence must name the exact search command, the package declaration diff, the
removal-sensitive test, and the next-round deletion output. If a live caller is found, record why
the member stays and close this PRD as rejected rather than preserving an unexamined abstraction.

## Not in scope

This PRD does not add new physics capabilities, change gameplay source, alter the sealed proof
contract, or claim native/mobile parity.
