# Roadmap — get ThreeNative to a production-ready beta

**Goal of v1:** a beta a stranger can install, build a game with, and ship — on web first,
on device where the evidence allows. Everything below is either done, partially done, or
not done; nothing here is aspirational prose.

**Legend:** ✅ done · ⚠️ partially done · ❌ not done.

**Status (reconciled 2026-08-11):** Gate 0 ✅ closed 2026-08-07 · Phase 1 ✅ passed
2026-08-08 · Phase 2 ⚠️ active, gate not green · Phase 3 ⚠️ started out of order by the
native lane. 54 PRDs archived (46 `docs/PRDs/done/`, 8 `docs/PRDs/native/done/`).
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
| 2 | Three templates scaffold, build, and pass their playtests from a clean machine | ✅ `pnpm test:templates`, scaffold-smoke in CI |
| 3 | A paired result the vanilla arm cannot match — the Phase 2 exit gate | ⚠️ not yet; round 3 lost visual and cost |
| 4 | Web/native parity is *checkable*, not asserted — PRD-054's matrix passes aggregate | ⚠️ Tier 1 not reached — [PRD-064 ledger](../verification/tier-1-2026-08-10.md) records the measured browser, desktop, and Android outcomes; the aggregate remains non-green |
| 5 | A user with no C++ toolchain ships a native game from published artifacts | ⚠️ Tier 1 not reached — [PRD-064 ledger](../verification/tier-1-2026-08-10.md) records the Phase 4 performance gate as **UNVERIFIED** because `profile:production` is not present in this checkout |

Rows 3–5 are the beta blockers. Rows 1–2 are held, not finished — they stay green or the
change does not land.

## Native reliability tiers — owner decision, 2026-08-10

"Reliable" is split into what this machine can prove and what only physical hardware can.
Owned by [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md); the blocked-PRD dependency
order lives in [`docs/PRDs/native/blocked/README.md`](../PRDs/native/blocked/README.md).

| Tier | Bar | Licenses the sentence |
|---|---|---|
| **Tier 1** — the shipping bar | Renders-the-same, controls, and UI green on browser + Linux desktop + Android emulator; performance and soak green on web + native desktop | *"Runs on browser WebGPU, desktop Linux/macOS/Windows, and the Android emulator; iOS builds and packages."* **Nothing else.** |
| **Tier 2** — deferred, not dropped | Physical Android and iOS: real GPU drivers, arm64, frame-rate parity, device soak, signed distribution | mobile readiness — **unclaimable until executed on hardware** |

**Tier 2 reopen trigger — the project's decisive test:** a stranger has played a
ThreeNative game for five minutes — concretely, the first external user who installs the
framework and asks for a device build. A physical Android device arriving earlier reopens the
Android half alone; it does not reopen iOS. Until then PRD-056, 057, 058 (device rows), 060
and every **physical** iOS row are parked, not worked.

**Correction, 2026-08-11 — "no Apple machine" was never true of CI.** The free hosted
`macos-15` runner executes, and simulator-class iOS rows are therefore *not* hardware-blocked;
that is how PRD-045 criterion 7 was first closed, and PRD-065 is the lane that keeps it
honest. Re-read every row still filed under "no Apple machine" against
[`docs/PRDs/native/blocked/README.md`](../PRDs/native/blocked/README.md): a row needing only a
simulator may be runnable today, a row needing a *physical* device is not.

Tier 1 stages the charter's ships-to-device criterion and its device matrix; it repeals
neither. The tension is recorded as row 9 in [CONFLICTS.md](CONFLICTS.md).

## Done

| Item | PRD | State |
|---|---|---|
| Monorepo, core, physics, scaffold, entity registry, loop, playtest bridge | `done/PRD-001`…`008` | ✅ shipped |
| Templates, platformer kit, generated render layer, starter kit | `done/PRD-009`…`015` | ✅ shipped |
| Measurement: genre sweep, paired arm, capture/judge/blind, honest LOC, visual baseline | `done/PRD-016`…`020`, `025`, `030` | ✅ shipped |
| Improvement rounds 1–3 + `round:deletions` | [done/PRD-021](../PRDs/done/PRD-021-the-improvement-round.md) | ✅ ran — rounds 1–3 recorded; 167 unreached exports reported, **zero deleted** |
| Authoring-cost and lifecycle work | `done/PRD-022`…`024`, `026`…`029`, `031` | ✅ shipped |
| Playtest semantic depth · operator ergonomics | [done/PRD-033](../PRDs/done/PRD-033-playtest-semantic-depth.md), [PRD-042](../PRDs/done/PRD-042-playtest-operator-ergonomics.md) | ✅ done |
| Hot reload with state preservation | [done/PRD-035](../PRDs/done/PRD-035-hot-reload-state-preservation.md) | ✅ done — consumer-scoped, **not** the paired proof row 3 needs |
| Save/load + deterministic replay | [done/PRD-036](../PRDs/done/PRD-036-save-load-and-deterministic-replay.md) | ✅ done |
| GPU transport and acceleration · scene picking behind `ctx.raycast` | [done/PRD-038](../PRDs/done/PRD-038-gpu-transport-and-acceleration.md), [PRD-056](../PRDs/done/PRD-056-scene-picking-abstraction.md) | ✅ done |
| Terrain / open worlds · physics collision layers | [done/PRD-043](../PRDs/done/PRD-043-terrain-and-open-world.md), [PRD-040](../PRDs/done/PRD-040-physics-collision-layers.md) | ✅ done |
| Animation state machine | [done/PRD-039](../PRDs/done/PRD-039-animation-state-machine.md) | ✅ closed WONTBUILD — reopen only on the recorded rigged-asset triggers |
| Sculpt-from-reference MCP | [done/PRD-049](../PRDs/done/PRD-049-sculpt-from-reference-mcp.md) | ✅ shipped — no human preference or token telemetry supplied; recorded unavailable, not a win |
| Native: runtime absorption, build parity, HUD decision, mobile pathfinding, physics parity | [native/done](../PRDs/native/) PRD-047, 050, 051, 052, 049 | ✅ done — see the Phase 3 table for what that does *not* cover |
| Native physics closure · distribution | [native/done/PRD-046](../PRDs/native/done/PRD-046-physics-native.md), [PRD-048](../PRDs/native/done/PRD-048-native-distribution.md) | ✅ closed 2026-08-09 — **arm64 hardware, iOS, clean-machine and registry criteria waived by the owner, not met** |
| Multi-touch input | [done/PRD-053](../PRDs/done/PRD-053-core-input-multitouch.md) | ✅ done 2026-08-10 — Android emulator proof passed; physical-device qualification remains out of scope |
| DRY the sweep corpus | [done/PRD-041](../PRDs/done/PRD-041-sweep-corpus-dry.md) | ⚠️ n≥10 adoption rerun and browser proof still missing |
| Navigation and pathfinding | [done/PRD-034](../PRDs/done/PRD-034-navigation-and-pathfinding.md) | ⚠️ browser-only by decision; the platformer uses template-local steering |

## Open

| Item | PRD | State |
|---|---|---|
| **Tier 1 native reliability** | [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md) | ⚠️ executed; **Tier 1 not reached** — [ledger](../verification/tier-1-2026-08-10.md) records Browser `67/0/0/0`, Desktop Linux `65/1/1/1`, and Android emulator `27/40/0/1`; all three Phase 4 controls are **UNVERIFIED** with exit `254`. The PRD makes no mobile-readiness claim. |
| **Round 4 — the Phase 2 paired proof** | [PRD-061](../PRDs/PRD-061-round-4-paired-capability-proof.md) | ❌ not started — **the only PRD pointing at beta row 3**; needs no hardware. Round 3's `budget` stop condition must clear first |
| Asset discovery MCP | [PRD-032](../PRDs/done/PRD-032-asset-discovery-mcp.md) | ⚠️ closed — live-agent gate lost to the no-MCP control; product owner retained the generated asset MCP, so the visual-improvement evidence stays unmet |
| Write-once/run-anywhere parity gate | [PRD-054](../PRDs/native/blocked/PRD-054-write-once-run-anywhere.md) | ⚠️ blocked at criterion 1; the rerun is green on Browser (`67/0/0`) and Android emulator (`67/0/0`), while Desktop Linux is `66/0/1` because the desktop registry explicitly blocks native multitouch — [rerun ledger](../verification/parity-2026-08-10-r2.md) |
| The HUD hole on native | [PRD-055](../PRDs/native/blocked/PRD-055-native-hud-reopened.md) | ⚠️ open; `25-camera-parented-overlay` passes on desktop and Android, Android multitouch passes, and only the explicit desktop native-multitouch exclusion remains in the matrix — [rerun ledger](../verification/parity-2026-08-10-r2.md) |
| Playtest on device | [PRD-045](../PRDs/PRD-045-playtest-on-device.md) | ⚠️ **REOPENED 2026-08-11, criterion 7 UNVERIFIED.** Criteria 1–6 and 8 MET. Closed on iOS-simulator run `31446340434` (`iPhone 17 Pro`, `SimRuntime.iOS-26-2`), reopened when `31447449669` failed the same lane on the same device class — one pass, one fail is not closed. **Needs no hardware; the defect was ours** (attach race, fixed by `playtest({ holdUntilAttached: true })` in `0e4897a`). Closes on consecutive green iOS-simulator runs |
| iOS evidence lane | [PRD-065](../PRDs/PRD-065-ios-evidence-lane.md) | ⚠️ open, filed 2026-08-10 — Phase 0 landed (the lane was selecting an **Apple Vision Pro**, so every prior "iOS" artifact was visionOS). Phases 1–3 repair the red consumer handoff, widen the trigger and make the report legible; Phase 4 is a time-boxed real-device spike permitted to end `BLOCKED`. Makes no mobile-readiness claim |
| Physical mobile production qualification | [native/blocked/PRD-056](../PRDs/native/blocked/PRD-056-physical-mobile-qualification.md) | ❌ filed under `native/blocked/` — every criterion needs a physical device or an Apple signing identity; an untracked duplicate under `production-readiness/` was removed 2026-08-09 |
| Production readiness: audio parity, profiling, SBOM, promoted distribution | [native/blocked/PRD-057…060](../PRDs/native/blocked/) | ❌ **Tier 2, parked.** Moved out of `production-readiness/` (now empty) on 2026-08-10. PRD-058 Phase 5 is the one device-free part and is executed by PRD-064; 059 needs a hosted prerelease, 060 needs release credentials |
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

**⚠️ Phase 2 — capabilities vanilla does not have.** *Gate to exit:* hot reload/state
preservation or physics reach ships with consumer-scoped proof the paired vanilla arm cannot
match inside the same brief. *Not green:* round 3 was that instrument and the framework arm
**lost** visual and cost on `open-world` while tying functionally
(`verification/round-3-2026-08-09.md`). Hot reload is built; the paired comparison is not
done. **+15 → ~75/100.**

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
ThreeNative game for five minutes** — the project's decisive test. Closed with evidence and
not reopened in a feature: an IR, a scene format, an editor, a preset system, a code-first
ECS, a bespoke CLI vocabulary. Each can absorb the entire company; none is reopened in a feature.
