# Blocked PRDs — work stopped on an explicit blocker

A PRD lives here when **every remaining item is blocked on unavailable evidence or an explicit
review-cap blocker**. It is not `done/`: an unmet criterion is unmet, and a blocked criterion
is deferred, never waived.

**The standing block (2026-08-08, corrected 2026-08-11): no Apple machine *on this host*.**
The operator's machine has no Xcode, `xcrun`, simulator or physical iOS device, so nothing
here is runnable locally. **The free hosted `macos-15` runner is an Apple machine and does
execute**, and it is sufficient for simulator-class evidence — that is how PRD-045 criterion 7
closed. It proves nothing about physical hardware: arm64 code generation, real Metal drivers,
device signing and install, touch hardware, thermal and battery all still need a phone. Linux
and Android (adb, emulator) lanes are unaffected and keep their executed-evidence requirement
in full.

**Read every row below with that correction in mind.** A row blocked on "no Apple machine"
may in fact be runnable on the hosted runner; a row blocked on *physical device* is not.

## Tier 2 — parked, with one unlock condition (owner decision, 2026-08-10)

Every PRD in this folder is **Tier 2** under
[ROADMAP.md](../../../strategy/ROADMAP.md)'s native reliability tiers. Parked means *not
worked and not re-reviewed each batch* — the churn of restating "still blocked" is what the
tier split exists to stop.

| Unlock | Reopens |
|---|---|
| A physical Android device on this machine | the Android half of PRD-056, PRD-057 and PRD-058 |
| An Apple machine + signing identity + provisioning profile | every **physical** iOS row. PRD-045 criterion 7 no longer needs it — it closed on the hosted simulator, 2026-08-11 |
| npm, GitHub and platform-signing release credentials | PRD-060 |
| A hosted same-candidate native prerelease | PRD-059 |
| `CHARTER.md` §12 criterion 3 — a stranger plays a ThreeNative game for five minutes | the tier as a whole |

**One device-free exception:** PRD-058 **Phase 5 only** (same-hardware web vs native desktop
performance and cold start) needs no device and is executed by
[PRD-064](../../PRD-064-tier-1-native-reliability.md). The rest of PRD-058 stays parked here.

Parking changes no criterion. An unmet criterion is still unmet; rule 3 below is unchanged.

## Rules

1. **Do not summarize a PRD in here as done.** It is "implemented, evidence blocked."
2. **Implementation still proceeds.** iOS code and its fail-closed contract tests keep
   changing and merging on this host. Only the executed run waits.
3. **Move to `done/` only after the blocked criterion is actually met**, on evidence of the
   class the criterion names — never by rewriting the criterion to fit what is available. A
   criterion naming the *simulator* closes on an executed simulator (PRD-045 criterion 7,
   2026-08-11). A criterion naming a *physical device* closes on nothing less; a hosted
   runner, an emulator or a simulator never substitutes for one.
4. **A PRD with non-hardware work left normally stays in the parent folder.** When an
   explicitly requested execution reaches a status of `BLOCKED`, it may move here with the
   unmet prerequisites and recovery owner recorded; implementation work is not implied.

| PRD | Everything else | What is blocked |
|---|---|---|
| [PRD-056](PRD-056-physical-mobile-qualification.md) — physical mobile production qualification | Planning complete; the qualification command, evidence envelope and fail-closed contract are specified in full | Every criterion. It needs a physical Android device, a physical iOS device, a production-signed Android artifact, an Apple signing identity and an Apple provisioning profile. None exists on this machine. An untracked byte-identical duplicate under `docs/PRDs/production-readiness/` was removed on 2026-08-09 |
| [PRD-057](PRD-057-native-audio-parity.md) — native audio parity | The isolated lane is committed and its manager gate packet passed all 16 command-level negative controls | Review cap reached with five new implementation defects: physical/virtual identity, rendered-output truth, aggregate target enforcement, stale identity validation, and the standalone smoke negative control; physical audible rows also remain blocked |
| [PRD-058](PRD-058-performance-reliability-observability.md) — performance, reliability, and privacy-safe observability | Isolated lane commit `5865937`; manager reran all 21 declared controls with exact observed-red evidence | Physical/current desktop evidence, physical Android/iOS soak and resource artifacts, physical OS crash/ANR artifacts, and the root marker-control collection remain unavailable; implementation is not squashed |
| [PRD-059](PRD-059-native-dependency-provenance-sbom.md) — native dependency provenance and SBOM | Isolated lane commit `fb222c8`; manager reran all 10 declared controls with exact observed-red evidence; local selectors return green after restoration | Same-candidate hosted native prerelease, artifact URLs/hashes, and release-operator confirmation are unavailable; implementation is not squashed |
| [PRD-060](PRD-060-promoted-consumer-distribution.md) — promoted consumer distribution | Planning packet retained; no release implementation was started | Exact-candidate PRD-054 parity, PRD-059 provenance, a completed release run, public npm cohort, and npm/desktop/Android/Apple signing credentials are unavailable |

**Number collision, recorded not fixed:** `done/PRD-056-scene-picking-abstraction.md` also
claims 056. PRD-057, 058 and 060 reference "PRD-056" meaning the physical qualification one.
Renumbering is a separate change; nothing here depends on it being done first.

## Why 046, 047 and 048 are not here

They each have real work left beyond hardware: PRD-046 owes published assets and a
clean-machine consumer proof, PRD-047 owes Windows/macOS lanes that were configured but
never run anywhere, and PRD-048 owes prebuilt consumer distribution. A blocked row does not
make a blocked PRD. Their iOS rows should be re-read against the 2026-08-11 correction above:
whichever of them need only the *simulator* may now be runnable on the hosted runner, as
PRD-045 criterion 7 was.
