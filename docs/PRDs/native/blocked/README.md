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
| [PRD-056](PRD-056-physical-mobile-qualification.md) — physical mobile production qualification | Planning complete; the qualification command, evidence envelope and fail-closed contract are specified in full | Every criterion. It needs a physical Android device, a physical iOS device, a production-signed Android artifact, an Apple signing identity and an Apple provisioning profile. None exists on this machine. An untracked byte-identical duplicate under `docs/PRDs/production-readiness/` was removed on 2026-08-09 |

**Number collision, recorded not fixed:** `done/PRD-056-scene-picking-abstraction.md` also
claims 056. PRD-057, 058 and 060 reference "PRD-056" meaning the physical qualification one.
Renumbering is a separate change; nothing here depends on it being done first.

## Why 057, 058, 059 and 060 are not here

Rule 4. Each still has non-hardware work that can start today, so a blocked final criterion
does not make a blocked PRD:

- **PRD-057** (native audio parity) — the bounded Web Audio subset, deterministic buffer
  tests, lifecycle routing and the emulator/virtual-driver rows are all executable here. Only
  the audible physical-output rows wait.
- **PRD-058** (performance, reliability, observability) — the profiler, the `performance`
  assertion contract, redaction and the evidence manifest run on web and Linux desktop. Only
  the physical mobile and soak phases wait.
- **PRD-059** (dependency provenance and SBOM) — fully executable on this host, hardware-free.
- **PRD-060** (promoted consumer distribution) — blocked on credentials and an Apple machine,
  not on hardware alone, and its release orchestration is unimplemented. It stays in the
  parent folder until that code exists.

## Why 046, 047 and 048 are not here

They each have real work left beyond hardware: PRD-046 owes published assets and a
clean-machine consumer proof, PRD-047 owes Windows/macOS lanes that were configured but
never run anywhere, and PRD-048 owes prebuilt consumer distribution. Their iOS rows are
blocked for the same reason as PRD-045's, but a blocked row does not make a blocked PRD.
