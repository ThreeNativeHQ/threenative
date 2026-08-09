# Blocked PRDs — everything done except evidence we cannot run

A PRD lives here when **every remaining item is blocked on hardware the operator does not
have**, and nothing else is left to build. It is not `done/`: an unmet criterion is unmet,
and a blocked criterion is deferred, never waived.

**The standing block (2026-08-08): no Apple machine.** No Xcode, no `xcrun`, no iOS
simulator, no physical iOS device. Linux and Android (adb, emulator) lanes are unaffected
and keep their executed-evidence requirement in full.

## Rules

1. **Do not summarize a PRD in here as done.** It is "implemented, evidence blocked."
2. **Implementation still proceeds.** iOS code and its fail-closed contract tests keep
   changing and merging on this host. Only the executed run waits.
3. **Move to `done/` only after the blocked criterion is actually met** on real hardware —
   never by rewriting the criterion to fit what this machine can run.
4. **A PRD with any non-hardware work left stays in the parent folder.** Being mostly
   finished is not the bar.

| PRD | Everything else | What is blocked |
|---|---|---|
| [PRD-045](PRD-045-playtest-on-device.md) — playtest on device | Criteria 1–6 and 8 MET; Phases 0–3 and 5 closed | Criterion 7 / Phase 4: the same scenario and its three negative controls on the iOS simulator |

## Why 046, 047 and 048 are not here

They each have real work left beyond hardware: PRD-046 owes published assets and a
clean-machine consumer proof, PRD-047 owes Windows/macOS lanes that were configured but
never run anywhere, and PRD-048 owes prebuilt consumer distribution. Their iOS rows are
blocked for the same reason as PRD-045's, but a blocked row does not make a blocked PRD.
