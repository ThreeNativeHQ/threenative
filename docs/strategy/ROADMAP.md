# Roadmap — get ThreeNative to a production-ready beta

**Goal of v1:** a beta a stranger can install, build a game with, and ship — on web first,
on device where the evidence allows. Everything below is either done, partially done, or
not done; nothing here is aspirational prose.

**Legend:** ✅ done · ⚠️ partially done · ❌ not done.

**Status (reconciled 2026-08-20):** Gate 0 ✅ closed 2026-08-07 · Phase 1 ✅ passed
2026-08-08 · Phase 2 ⚠️ active; its replacement gate was adopted 2026-08-19 and executed
2026-08-20 by PRD-162, red on exclusivity · Phase 3 ⚠️ executed once for that gate, while the
native lane remains out of order. Completed work is archived under `docs/PRDs/done/`; active and
blocked work remains in its owning folder.
The charter wins wherever this file disagrees with it.

Phases are gated, not scheduled. A phase starts because the previous gate passed.

## The score — moved

**"Would I use this instead of vanilla Three.js?" is answered in
[VALUE-PROPOSITION.md](VALUE-PROPOSITION.md), which now owns the score outright** — the five
axes, their instruments, the measured result, the ceiling arithmetic, and which claims are
earned. It was duplicated here until 2026-08-11; two copies of a score is two scores.

The `+N → ~N/100` notations in **Phases** below are on that scale and stay here, because the
phase gates are this file's subject. If a number disagrees, the value-proposition file wins.

## The beta bar — what "production ready" has to mean

**Proposed here, not charter-binding.** Each row is a gate someone can run.

| # | Beta requirement | State |
|---|---|---|
| 1 | `pnpm typecheck && pnpm lint && pnpm test` green, budgets green, no cap raised | ✅ held on every landed change |
| 2 | Seven templates scaffold, build, and pass their playtests from a clean machine | ✅ `pnpm test:templates`, scaffold-smoke in CI |
| 3 | The adopted three-part Phase 2 capability gate must **PASS**: a post-adoption capability that vanilla Three.js cannot match, a consumer-scoped proof on an instrument that does not hand the control arm the capability, and a same-subject negative control observed red | ⚠️ open; the gate was adopted 2026-08-19 and executed 2026-08-20 by PRD-162, **red with attribution**. The capability shipped: the browser-recorded replay reached `stateHash = 1884960806` on web and on the desktop host, and the same-subject negative control was observed red. The gate is red on the instrument condition — the plain-Three.js arm has no desktop runtime of its own, so running its native leg meant lending it the framework's bundler and host, which voids the run; under that lend the arm matched its own browser hash. Exclusivity is settled in neither direction ([phase-2-2026-08-20](../verification/phase-2-2026-08-20.md)) |
| 4 | Web/native parity is *checkable*, not asserted — PRD-054's matrix passes aggregate | ⚠️ Tier 1 not reached, but **both lanes are now adjudicated**. Desktop: [tier-1-2026-08-15](../verification/tier-1-2026-08-15.md), `66/0/1`, exit `2`, and it cannot exit `0` while the multitouch row is excluded ([PRD-077](../PRDs/BLOCKED/requires-evdev-delivery/PRD-077-desktop-multitouch-injector.md)). Android: settled 2026-08-19 — two full emulator lanes measured `66 / 1 / 0` with 66 rows passing pixel comparison, so `parity-2026-08-10-r2`'s `67/0/0` **reproduces** and `tier-1-2026-08-10`'s `27/40/0` is **retired** on its Android row ([android-parity-2026-08-19](../verification/android-parity-2026-08-19.md)). The row is **not green**: the Android lane exits `1` on `25-camera-parented-overlay`, a marker timeout filed as [PRD-166](../PRDs/PRD-166-camera-parented-overlay-never-marks-on-android.md). The emulator proves the emulator |
| 5 | A user with no C++ toolchain ships a native game from published artifacts | ⚠️ **There are no published artifacts.** Ten release tags produced zero surviving releases; the lane deletes its own release when the consumer proof fails ([PRD-078](../PRDs/BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md)). The `v0.1.14` version skew is diagnosed and fixed — the binary's version now comes from `package.json` instead of a second copy in `CMakeLists.txt` — and the tag that would prove it has not been pushed |

Rows 3–5 are the beta blockers. Rows 1–2 are held, not finished — they stay green or the
change does not land.

## The alpha bar — the step before this one

**Added 2026-08-15, reconciled 2026-08-16.** `docs/PRDs/alpha-readiness/` collected the PRDs that stood between the tree and *"an outsider can install this and ship a small
game"*. The row that governed the rest is closed: `create-threenative` 404'd on the public registry
until PRD-119 published all seven packages on 2026-08-16, and a clean room installed them and built
a game — [registry-install-2026-08-16](../verification/registry-install-2026-08-16.md). The
sentence that buys is narrow: *a stranger can install ThreeNative from npm and build a game on the
web.* No native prebuilt artifact is published, and nobody outside this repository has played a
game yet. Three of the batch's PRDs were blocked on external capabilities; the folder was deleted on
2026-08-18 and its surviving rows are tracked individually. Beta rows 3, 4 and 5 are represented there — PRD-114, PRD-076/077 and PRD-078 — because a
claim an outsider cannot check is an alpha problem before it is a beta one.

## Native reliability tiers — owner decision, 2026-08-10

"Reliable" is split into what this machine can prove and what only physical hardware can.
Owned by [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md); the blocked-PRD dependency
order lives in [`docs/PRDs/BLOCKED/README.md`](../PRDs/BLOCKED/README.md).

| Tier | Bar | Licenses the sentence |
|---|---|---|
| **Tier 1** — the shipping bar | Renders-the-same, controls, and UI green on browser + Linux desktop + Android emulator; performance and soak green on web + native desktop | *"Runs on browser WebGPU, desktop Linux/macOS/Windows, and the Android emulator; iOS builds and packages."* **Nothing else.** |
| **Tier 2** — deferred, not dropped | Physical Android and iOS: real GPU drivers, arm64, frame-rate parity, device soak, signed distribution | mobile readiness — **unclaimable until executed on hardware** |

**Tier 2 reopen trigger:** the first external user who **installs the framework and asks for a
device build** — an *adopting developer*, which is a different experiment from the five-minute
stranger test and needs its own PRD before it can be claimed. It was written here as a
restatement of that test; it never was one. The stranger test's single definition is
[`docs/product/STRANGER-TEST-PROTOCOL.md`](../product/STRANGER-TEST-PROTOCOL.md), it measures a
*player*, and closing it does not by itself reopen Tier 2.

A physical Android device arriving earlier reopens the Android half alone; it does not reopen
iOS. Until then PRD-056, 057, 058 (device rows), 060 and every **physical** iOS row are parked,
not worked.

**Correction, 2026-08-11 — "no Apple machine" was never true of CI.** The free hosted
`macos-15` runner executes, and simulator-class iOS rows are therefore *not* hardware-blocked;
that is how PRD-045 criterion 7 was first closed, and PRD-065 is the lane that keeps it
honest. Re-read every row still filed under "no Apple machine" against
[`docs/PRDs/BLOCKED/README.md`](../PRDs/BLOCKED/README.md): a row needing only a
simulator may be runnable today, a row needing a *physical* device is not.

Tier 1 stages the charter's ships-to-device criterion and its device matrix; it repeals
neither. The tension is recorded as row 9 in [CONFLICTS.md](CONFLICTS.md).

## Done

| Item | PRD | State |
|---|---|---|
| Monorepo, core, physics, scaffold, entity registry, loop, playtest bridge | `done/PRD-001`…`008` | ✅ shipped |
| Templates, platformer kit, generated render layer, starter kit | `done/PRD-009`…`015` | ✅ shipped |
| Measurement: genre sweep, paired arm, capture/judge/blind, honest LOC, visual baseline | `done/PRD-016`…`020`, `025`, `030` | ✅ shipped |
| Improvement rounds 1–3 + `round:deletions` | [done/PRD-021](../PRDs/done/PRD-021-the-improvement-round.md) | ✅ ran — rounds 1–3 recorded; 167 unreached exports reported and all 167 disposed of by [PRD-063](../PRDs/done/PRD-063-unreached-export-deletion-sweep.md) — 5 deleted, 106 un-exported |
| Authoring-cost and lifecycle work | `done/PRD-022`…`024`, `026`…`029`, `031` | ✅ shipped |
| Playtest semantic depth · operator ergonomics | [done/PRD-033](../PRDs/done/PRD-033-playtest-semantic-depth.md), [PRD-042](../PRDs/done/PRD-042-playtest-operator-ergonomics.md) | ✅ done |
| Hot reload with state preservation | [done/PRD-035](../PRDs/done/PRD-035-hot-reload-state-preservation.md) | ✅ done — consumer-scoped, **not** the paired proof row 3 needs |
| Save/load + deterministic replay | [done/PRD-036](../PRDs/done/PRD-036-save-load-and-deterministic-replay.md) | ✅ done |
| GPU transport and acceleration · scene picking behind `ctx.raycast` | [done/PRD-038](../PRDs/done/PRD-038-gpu-transport-and-acceleration.md), [PRD-056](../PRDs/done/PRD-056-scene-picking-abstraction.md) | ✅ done |
| Terrain / open worlds · physics collision layers | [done/PRD-043](../PRDs/done/PRD-043-terrain-and-open-world.md), [PRD-040](../PRDs/done/PRD-040-physics-collision-layers.md) | ✅ done |
| Animation state machine | [done/PRD-039](../PRDs/done/PRD-039-animation-state-machine.md) | ✅ closed WONTBUILD — reopen only on the recorded rigged-asset triggers |
| Sculpt-from-reference MCP | [done/PRD-049](../PRDs/done/PRD-049-sculpt-from-reference-mcp.md) | ✅ shipped — no human preference or token telemetry supplied; recorded unavailable, not a win |
| Native: runtime absorption, build parity, HUD decision, mobile pathfinding, physics parity | [done](../PRDs/done/) PRD-047, 050, 051, 052, 049 | ✅ done — see the Phase 3 table for what that does *not* cover |
| Native physics closure · distribution | [done/PRD-046](../PRDs/done/PRD-046-physics-native.md), [PRD-048](../PRDs/done/PRD-048-native-distribution.md) | ✅ closed 2026-08-09 — **arm64 hardware, iOS, clean-machine and registry criteria waived by the owner, not met** |
| Multi-touch input | [done/PRD-053](../PRDs/done/PRD-053-core-input-multitouch.md) | ✅ done 2026-08-10 — Android emulator proof passed; physical-device qualification remains out of scope |
| DRY the sweep corpus | [done/PRD-041](../PRDs/done/PRD-041-sweep-corpus-dry.md) | ⚠️ n≥10 adoption rerun and browser proof still missing |
| Navigation and pathfinding | [done/PRD-034](../PRDs/done/PRD-034-navigation-and-pathfinding.md) | ⚠️ browser-only by decision; the platformer uses template-local steering |

## Open

| Item | PRD | State |
|---|---|---|
| **Tier 1 native reliability** | [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md) | ⚠️ executed; **Tier 1 not reached** — [ledger](../verification/tier-1-2026-08-10.md) records Browser `67/0/0/0`, Desktop Linux `65/1/1/1`, and Android emulator `27/40/0/1`; all three Phase 4 controls are observed red with exit `1`, but the positive unmodified-platformer measurement was not reached. The PRD makes no mobile-readiness claim. |
| **Round 4 — the Phase 2 paired proof** | [done/PRD-061](../PRDs/done/PRD-061-round-4-paired-capability-proof.md) | ⚠️ executed; **still not green** — physics-puzzle paired proof tied functionally at 0/1, while the framework won blind visual polish and vanilla won fair authored cost by 2 LOC; the real arms preserve their fail-closed missing-`runtime.physics` result, and the repaired no-op control reached assertion evaluation and failed the physics assertions. The kill switch is recorded; no fifth genre or arm rerun. Evidence: [round-4-2026-08-10.md](../verification/round-4-2026-08-10.md) |
| Asset discovery MCP | [PRD-032](../PRDs/done/PRD-032-asset-discovery-mcp.md) | ⚠️ closed — live-agent gate lost to the no-MCP control; product owner retained the generated asset MCP, so the visual-improvement evidence stays unmet |
| Write-once/run-anywhere parity gate | [PRD-054](../PRDs/BLOCKED/requires-parity-rerun/PRD-054-write-once-run-anywhere.md) | ⚠️ blocked at criterion 1; the rerun is green on Browser (`67/0/0`) and Android emulator (`67/0/0`), while Desktop Linux is `66/0/1` because the desktop registry explicitly blocks native multitouch — [rerun ledger](../verification/parity-2026-08-10-r2.md) |
| The HUD hole on native | [PRD-055](../PRDs/BLOCKED/requires-touch-evidence/PRD-055-native-hud-reopened.md) | ⚠️ open; `25-camera-parented-overlay` passes on desktop and Android, Android multitouch passes, and only the explicit desktop native-multitouch exclusion remains in the matrix — [rerun ledger](../verification/parity-2026-08-10-r2.md) |
| Playtest on device | [PRD-045](../PRDs/done/PRD-045-playtest-on-device.md) | ✅ iOS-simulator criterion met on the hosted `macos-15` runner; this is not physical-device evidence and makes no mobile-readiness claim |
| iOS evidence lane | [PRD-065](../PRDs/BLOCKED/requires-ios-ecossystem/PRD-065-ios-evidence-lane.md) | ⚠️ open, filed 2026-08-10 — Phase 0 landed (the lane was selecting an **Apple Vision Pro**, so every prior "iOS" artifact was visionOS). Phases 1–3 repair the red consumer handoff, widen the trigger and make the report legible; Phase 4 is a time-boxed real-device spike permitted to end `BLOCKED`. Makes no mobile-readiness claim |
| Physical mobile production qualification | [PRD-056](../PRDs/BLOCKED/requires-physical-device/PRD-056-physical-mobile-qualification.md) | ❌ filed under `BLOCKED/requires-physical-device/` — every criterion needs a physical device or an Apple signing identity; an untracked duplicate under `production-readiness/` was removed 2026-08-09 |
| Production readiness: audio parity, profiling, SBOM, promoted distribution | [BLOCKED/](../PRDs/BLOCKED/) | ❌ **Tier 2, parked.** The four PRDs are grouped by blocker. PRD-058 Phase 5 is the one device-free part and is executed by PRD-064; 059 needs a hosted prerelease, 060 needs release credentials |
| **Beta row 4 — reconcile the two contradicting parity ledgers** | [PRD-076](../PRDs/done/PRD-076-tier-1-parity-reconciliation.md) | ⚠️ **desktop lane adjudicated 2026-08-15, Android still open.** A third run with provenance measured `66/0/1`: r2's summary reproduces exactly, r2's `exit 0` cell is still impossible, and tier-1's overlay failure does not reproduce — [tier-1-2026-08-15](../verification/tier-1-2026-08-15.md). Both predecessors carry desktop-scoped superseded banners. Originally, 2026-08-11: `parity-2026-08-10-r2` and `tier-1-2026-08-10` disagree on the same device on the same day (Android `67/0/0` vs `27/40/0`; desktop overlay pass vs GPU-validation fail). The r2 desktop cell `66/0/1 exit 0` is **not producible** — `reportExitCode` returns `2` whenever `blocked > 0`. Phase 0 is provenance, not repair |
| **Beta row 4 — desktop native multitouch** | [PRD-077](../PRDs/BLOCKED/requires-evdev-delivery/PRD-077-desktop-multitouch-injector.md) | ⚠️ proposed 2026-08-11. The desktop host already dispatches `SDL_EVENT_FINGER_*` as multi-contact PointerEvents (`platform/input.cpp:480`); the `desktop-multitouch-input` exclusion exists only because the harness has no injector, and it guarantees the desktop lane can never exit `0` |
| **Beta row 5 — the toolchain-free consumer proof** | [PRD-078](../PRDs/BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md) | ❌ **BLOCKED** on one hosted release run with all five legs green; its own subject, the missing Vulkan ICD, is fixed. Filed 2026-08-11. 10 release tags, 10 runs, **0 published releases** — `cleanup-failed-release` deletes each one after `clean-consumer` fails. Run `31360511081` died in 314 ms: `SDL_CreateWindow failed: Installed Vulkan doesn't implement the VK_KHR_surface extension`. A missing runner ICD, not a framework defect |
| **Beta row 3 — reopen the Phase 2 win criteria** | [PRD-079](../PRDs/done/PRD-079-phase-2-exit-criteria.md) | ⚠️ open; the owner adopted the replacement gate on 2026-08-19 and PRD-162 executed it on 2026-08-20, red with attribution. Consumer web and desktop legs replayed the same browser recording to `stateHash = 1884960806`, and all five declared controls were observed red. The control arm cannot settle exclusivity: plain Three.js has no desktop runtime, so its native leg ran on the framework's own host and matched — a void run under this gate's leakage rule. The desktop instrument also timed out on two of four runs ([PRD-167](../PRDs/PRD-167-desktop-playtest-mailbox-goes-silent.md)). Evidence: [phase-2-2026-08-20](../verification/phase-2-2026-08-20.md) |
| **The five-minute stranger test** | [PRD-080](../PRDs/BLOCKED/requires-external-person/PRD-080-five-minute-stranger-test.md) | ❌ **BLOCKED** on one external person. Filed 2026-08-11; it was specified two mutually inconsistent ways until Phase 0 settled it on 2026-08-15 — the single definition now lives in [product/STRANGER-TEST-PROTOCOL.md](../product/STRANGER-TEST-PROTOCOL.md), one player, own device, at a URL. Run zero times |
| Build-time asset pipeline | none | ❌ deferred behind two measured triggers (`docs/product/ASSET-PIPELINE.md`) |
| Device spikes 0a / 0b | none — forbidden | ❌ never a PRD (`CHARTER.md:364`); both were answered by the native lane instead |

The PRD-054 and PRD-055 rows share the latest evidence file:
`docs/verification/parity-2026-08-10-r2.md`.

## Phases

**✅ Gate 0 — measure before investing.** Round 2 ran to completion on `exploration`; proofs
tie 1/1 and the framework scores higher blind (4/5 vs 3/5). The product is real →
Phase 1. Evidence: `verification/round-2-2026-08-07.md`.

**✅ Phase 1 — win the two unmeasured axes.** Four genres paired on sealed specs: proofs
equal in every genre, framework blind polish strictly higher in two, authored LOC delta
non-positive in two, no genre losing both, budgets green with no cap raised. Evidence:
[phase-1-2026-08-08.md](../verification/phase-1-2026-08-08.md). **+30 → ~60/100.**

**⚠️ Phase 2 — consumer-scoped capability evidence.** Owner decision by Joao Paulo Furtado, 2026-08-19: adopt
PRD-079's replacement gate and execute it once. Phase 2 exits only when all three hold:

1. A capability ships with a user-observable outcome that vanilla Three.js has no answer for;
   the proof is consumer-scoped, so it evaluates the outcome rather than counting framework
   artifacts or package lines.
2. The proof uses an instrument that does not hand the control arm the capability under test.
   The paired benchmark deliberately gives both arms the playtest bridge, so it remains the
   cost-and-polish ratchet and is retired as the instrument for this gate.
3. The same subject and Phase 3 execution include a negative control that is observed red; a missing
   capability must fail closed, not skip or pass vacuously.

The litmus was applied before adoption: a pre-existing measurement cannot close the gate merely
because it already has the right shape, and a build indistinguishable from the previous one is
not new shipping evidence. The platformer composition proof from PRD-081 is therefore retained
as history and rerun for the consumer check, but it is not counted as a new Phase 2 win.

**Phase 3 result, 2026-08-19: RED.** The generated platformer evaluated `settled` without bridge
code, and deleting `rapier()` failed with `TN_PLAYTEST_CAPABILITY_MISSING` on the same scenario.
Those observations prove the composition and its load-bearing control. They do not prove a
post-adoption capability that vanilla cannot match: the composition shipped in PRD-081 before
this decision, and the non-capability control is not a vanilla implementation. The literal
core boundary check also finds pre-existing generic `runtime.rapier` metadata; no new physics
dependency was added to core, but the stronger absolute wording remains unmet. Phase 2 stays
open. Evidence: [phase-2-2026-08-19](../verification/phase-2-2026-08-19.md), with round 4 retained
at [round-4-2026-08-10](../verification/round-4-2026-08-10.md).

No new genre sweep or arm rerun was authorised. **+15 → ~75/100 only if this gate later passes;
no score points are claimed from this red execution.**

**⚠️ Phase 3 — the platform question.** Does not formally start until Phase 2 is green, but
the native lane has already executed most of it. Spike 0a (rendering) and 0b (native physics)
are both **answered on emulated/simulated targets** — PRD-047 absorbed the runtime,
PRD-046/049 proved physics agreement, PRD-050 proved the artifact is the game the author
wrote. Neither was answered on physical hardware. **+5–20 → 80/100 web-honest, higher if
the device path holds.** If 0a had failed, the mobile promise would be deleted from the
charter; if 0b fails, mobile ships without physics.

### Native lane — done and left

Merged from `docs/architecture/NATIVE-RUNTIME.md` and `docs/PRDs/native/README.md` on
2026-08-09; those two keep the design and the evidence pointers, this keeps the state. If
they disagree, the verification files win.

| Native item | State |
|---|---|
| Runtime absorbed as `packages/runtime-native`; render + lifecycle (PRD-047 Phases 0–5) | ✅ done |
| Desktop: 300 frames + screenshot on Linux, macOS, Windows | ✅ done (hosted run `31313092745`) |
| Android: framework-version parity at catalog Three 0.185.1, device playtest with fail-closed controls | ✅ done (emulator) |
| Native physics through the bulk C ABI + web/host/device parity + negative controls | ✅ done (Android); ⚠️ iOS simulator green once on an iOS runtime and red on the rerun — same lane as PRD-045 criterion 7 |
| Native build tells the truth: declared entry, no silent drops, assets staged | ✅ done (Linux + emulator); iOS now launches and runs, not packaging-only |
| Native HUD decision — no framework abstraction ships | ✅ decided (candidate D) |
| Web CLI parity + all 25 packed-template scenarios | ✅ done |
| iOS simulator | ⚠️ executed on a genuine **iOS** runtime only since 2026-08-11 (`iPhone 17 Pro`, `SimRuntime.iOS-26-2`, run `31446340434`); the next run of the same lane failed, so it is flaky, not proved — PRD-045 / PRD-065. Every artifact before PRD-065 Phase 0 was a **visionOS** simulator. **Simulator ≠ device** either way |
| Toolchain-free distribution: published prebuilt artifacts, checksum lock, clean-machine build | ⚠️ desktop passes; Android release rerun open |
| HUD on native (reopened) | ⚠️ blocked — PRD-055 |
| Physical mobile/Apple hardware: real GPU drivers, arm64, frame-rate parity, signing, touch, thermals | ❌ not executed — no physical device here, and the hosted `macos-15` runner never substitutes for one |
| Navmesh pathfinding on native | ❌ never — browser-only by decision (PRD-052) |

**No row above licenses a "mobile works" claim while ❌ and ⚠️ rows stand.** Emulator and
simulator results never become physical-driver, arm64-performance or phone frame-rate
evidence.

## Not on the roadmap

A foundation model · a Blender replacement · visual scripting · a multiplayer backend ·
console export · a plugin marketplace · a second renderer with feature parity · a universal
app-store game player · blank-prompt generation without templates · support for every
Three.js example · **a hosted Studio or Cloud tier before a stranger has played a
ThreeNative game for five minutes** — the project's decisive test, defined in
[`STRANGER-TEST-PROTOCOL.md`](../product/STRANGER-TEST-PROTOCOL.md). Closed with evidence and
not reopened in a feature: an IR, a scene format, an editor, a preset system, a code-first
ECS, a bespoke CLI vocabulary. Each can absorb the entire company; none is reopened in a feature.
