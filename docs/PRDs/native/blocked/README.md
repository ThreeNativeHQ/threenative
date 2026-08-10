# Blocked PRDs — work stopped on an explicit blocker

A PRD lives here when **every remaining item is blocked on unavailable evidence or an explicit
review-cap blocker**. It is not `done/`: an unmet criterion is unmet, and a blocked criterion
is deferred, never waived.

**The standing block (2026-08-08): no Apple machine.** No Xcode, no `xcrun`, no iOS
simulator, no physical iOS device. Linux and Android (adb, emulator) lanes are unaffected
and keep their executed-evidence requirement in full.

## Rules

1. **Do not summarize a PRD in here as done.** It is "implemented, evidence blocked."
2. **Implementation still proceeds.** iOS code and its fail-closed contract tests keep
   changing and merging on this host. Only the executed run waits.
3. **Move to `done/` only after the blocked criterion is actually met** on real hardware —
   never by rewriting the criterion to fit what this machine can run.
4. **A PRD with non-hardware work left normally stays in the parent folder.** When an
   explicitly requested execution reaches a status of `BLOCKED`, it may move here with the
   unmet prerequisites and recovery owner recorded; implementation work is not implied.

| PRD | Everything else | What is blocked |
|---|---|---|
| [PRD-045](PRD-045-playtest-on-device.md) — playtest on device | Criteria 1–6 and 8 MET; Phases 0–3 and 5 closed | Criterion 7 / Phase 4: the same scenario and its three negative controls on the iOS simulator |
| [PRD-056](PRD-056-physical-mobile-qualification.md) — physical mobile production qualification | Planning complete; the qualification command, evidence envelope and fail-closed contract are specified in full | Every criterion. It needs a physical Android device, a physical iOS device, a production-signed Android artifact, an Apple signing identity and an Apple provisioning profile. None exists on this machine. An untracked byte-identical duplicate under `docs/PRDs/production-readiness/` was removed on 2026-08-09 |
| [PRD-057](PRD-057-native-audio-parity.md) — native audio parity | The isolated lane is committed and its manager gate packet passed all 16 command-level negative controls | Review cap reached with five new implementation defects: physical/virtual identity, rendered-output truth, aggregate target enforcement, stale identity validation, and the standalone smoke negative control; physical audible rows also remain blocked |
| [PRD-058](PRD-058-performance-reliability-observability.md) — performance, reliability, and privacy-safe observability | Isolated lane commit `5865937`; manager reran all 21 declared controls with exact observed-red evidence | Physical/current desktop evidence, physical Android/iOS soak and resource artifacts, physical OS crash/ANR artifacts, and the root marker-control collection remain unavailable; implementation is not squashed |
| [PRD-060](PRD-060-promoted-consumer-distribution.md) — promoted consumer distribution | Planning packet retained; no release implementation was started | Exact-candidate PRD-054 parity, PRD-059 provenance, a completed release run, public npm cohort, and npm/desktop/Android/Apple signing credentials are unavailable |

**Number collision, recorded not fixed:** `done/PRD-056-scene-picking-abstraction.md` also
claims 056. PRD-057, 058 and 060 reference "PRD-056" meaning the physical qualification one.
Renumbering is a separate change; nothing here depends on it being done first.

## Why 059 is not here

Rule 4. Each still has non-hardware work that can start today, so a blocked final criterion
does not make a blocked PRD:

- **PRD-059** (dependency provenance and SBOM) — fully executable on this host, hardware-free.

## Why 046, 047 and 048 are not here

They each have real work left beyond hardware: PRD-046 owes published assets and a
clean-machine consumer proof, PRD-047 owes Windows/macOS lanes that were configured but
never run anywhere, and PRD-048 owes prebuilt consumer distribution. Their iOS rows are
blocked for the same reason as PRD-045's, but a blocked row does not make a blocked PRD.
