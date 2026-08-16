---
prd_contract: v1
---

# PRD-121 — Delete unreached physics actuation members

**Status: CLOSED AS REJECTED — 2026-08-15.** The independent fresh paired round ran (round 8) and
confirmed no uninformed build reaches either member for a third round. The deletion does not
follow: `packages/runtime-native/native/physics/src/lib.rs` implements `apply_body_impulse` and
`apply_body_force` behind them, shipped by PRD-116 the same day. A live caller reopens the keep
decision, and this PRD's own completion record says the close is *rejected* rather than *deleted*.
See the completion record below.

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

**CLOSED AS REJECTED — 2026-08-15. A live caller was found, so both members stay.**

Step 1, the independent fresh paired build, ran as round 8
(`docs/verification/round-8-2026-08-15.md`). Neither member appears anywhere in the framework
arm's authored source, so this is the third consecutive round in which no uninformed build reached
for them.

Step 2, the exact search:

```sh
grep -rn "applyImpulse\|applyForce" \
  packages/*/src packages/*/__tests__ packages/create-threenative/templates examples \
  packages/runtime-native/include packages/runtime-native/native
```

Step 3, the callers it found. No template and no example calls either member — the single
`examples/` hit is a bundled `dist/` artifact, not source. But the package surface is wired
through to a **native backend that did not exist when this PRD was written**:

| Caller | What it is |
| --- | --- |
| `packages/physics/src/RigidBody3D.ts` | the public declarations |
| `packages/physics/src/simulation.ts` | the web backend behind them |
| `packages/runtime-native/native/physics/src/lib.rs` | `apply_body_impulse` and `apply_body_force`, the native Rust implementations |
| `packages/physics/__tests__/actuation.spec.ts` | removal-sensitive coverage of both |

`packages/runtime-native/native/physics/src/lib.rs:382` is the decisive one. PRD-116 shipped
native physics actuation on 2026-08-15 — the same day — and its delivery includes a native ABI and
a budgets census that count this code. This PRD's premise was that the two members were unexamined
abstraction with nothing behind them; a native backend delivered under its own PRD, with its own
gates and removal-sensitive tests, is the opposite of unexamined.

Step 3 of the work sequence is explicit that a caller reopens the keep decision, and the completion
record is explicit that the correct close in that case is **rejected**, not deleted. So nothing is
deleted and steps 4 and 5 do not run.

**Step 5, run rather than skipped.** `pnpm round:deletions` exits `0` against archives
`physics-puzzle-2026-08-15-9` and `-4`. It reports 273 persistent-unused candidates and
`applyImpulse` and `applyForce` are not among them, which is consistent with the caller chain
above: the native backend reaches both.

It could not run at all until the framework archive was rebuilt — the re-seal had been made by
copying source into a sandbox without installing, so it carried no `node_modules/@threenative`
declarations and both `round:deletions` and `sweep:pair` refused to measure it. Installing and
re-archiving fixed both.

**A finding from that output, recorded not silenced.** 58 of the 273 candidates are one or two
characters long — `$`, `A`, `B`, `C`, `v`, `w`, `x`, `y`, `z`. Those are minified bundle
identifiers leaking into the export census, not framework exports anyone could delete. The report
is therefore roughly a fifth noise, which matters because this is the instrument a kill-switch
decision reads. Not this PRD's to fix; worth knowing before anyone trusts a count from it.

**What stays true and should be re-examined.** No user-space build has reached for either member in
three rounds. That is a real signal about the *shape of the API*, not a licence to delete code a
sibling PRD is actively building on. The question a later round should ask is whether native
actuation wants a different surface, not whether these two names should vanish while a Rust
implementation sits behind them.

## Not in scope

This PRD does not add new physics capabilities, change gameplay source, alter the sealed proof
contract, or claim native/mobile parity.
