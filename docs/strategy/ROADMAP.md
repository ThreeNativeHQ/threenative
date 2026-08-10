# Roadmap — get ThreeNative to a production-ready beta

**Goal of v1:** a beta a stranger can install, build a game with, and ship — on web first,
on device where the evidence allows. Everything below is either done, partially done, or
not done; nothing here is aspirational prose.

**Legend:** ✅ done · ⚠️ partially done · ❌ not done.

**Status (reconciled 2026-08-10):** Gate 0 ✅ closed 2026-08-07 · Phase 1 ✅ passed
2026-08-08 · Phase 2 ⚠️ active, gate not green · Phase 3 ⚠️ started out of order by the
native lane. 52 PRDs archived (44 `docs/PRDs/done/`, 8 `docs/PRDs/native/done/`).
**Charter authority:** `CHARTER.md` §3, §5b, §7, §10, §12 — it wins if this file disagrees.

Phases are gated, not scheduled. A phase starts because the previous gate passed.

## The score — "would I use this instead of vanilla Three.js?"

Out of 100, five axes of 20, each tied to an instrument that already exists.

| Axis | Instrument | Where we are |
|---|---|---|
| Ships working | `pnpm sweep:pair` → `passed/total` | ⚠️ **tie** — 4 sealed genre proofs tie; round 3 open-world ties at 0/1 |
| Looks good | `pnpm sweep:judge`, blind session | ⚠️ **wins 2/5** — platformer and exploration win, endless ties, topdown and open-world lose |
| Costs less | `pnpm sweep:pair` → `authoredLoc` | ⚠️ **wins 2/5** — platformer −187, topdown −695; endless +442, exploration +95, open-world +8 |
| Does what vanilla can't | package inventory, reach rate | ⚠️ **12/20** — `physics` and `playtest` ship; `playtest` is given to the vanilla arm by §3 so it wins no comparison |
| Survives the platform | `CHARTER.md` §7 device matrix | ⚠️ **web + emulator/simulator** — no physical hardware, ever, on this machine |

**Why LOC cannot get us to 80:** plumbing is ~30% of a game and is already halved
(138 → 68 on the static control); §5b permanently assigns the rest to the user. The ceiling
on the cost axis alone is roughly 40/100. The win condition is the paired arm, not the
static `abyss` ratio — that one is a regression ratchet (`docs/benchmark/PROTOCOL.md`).

## The beta bar — what "production ready" has to mean

**Proposed here, not charter-binding.** Each row is a gate someone can run.

| # | Beta requirement | State |
|---|---|---|
| 1 | `pnpm typecheck && pnpm lint && pnpm test` green, budgets green, no cap raised | ✅ held on every landed change |
| 2 | Three templates scaffold, build, and pass their playtests from a clean machine | ✅ `pnpm test:templates`, scaffold-smoke in CI |
| 3 | A paired result the vanilla arm cannot match — the Phase 2 exit gate | ⚠️ not yet; round 3 lost visual and cost |
| 4 | Web/native parity is *checkable*, not asserted — PRD-054's matrix passes aggregate | ⚠️ 66/66 visual rows on 3 targets; current aggregate rerun is non-green |
| 5 | A user with no C++ toolchain ships a native game from published artifacts | ⚠️ PRD-048 desktop passes; Android release rerun and prebuilt distribution open |

Rows 3–5 are the beta blockers. Rows 1–2 are held, not finished — they stay green or the
change does not land.

## Native reliability tiers — owner decision, 2026-08-10

"Reliable" is split into what this machine can prove and what only physical hardware can.
Owned by [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md); see
[UNBLOCK-CHAIN.md](UNBLOCK-CHAIN.md) for the dependency order.

| Tier | Bar | Licenses the sentence |
|---|---|---|
| **Tier 1** — the shipping bar | Renders-the-same, controls, and UI green on browser + Linux desktop + Android emulator; performance and soak green on web + native desktop | *"Runs on browser WebGPU, desktop Linux/macOS/Windows, and the Android emulator; iOS builds and packages."* **Nothing else.** |
| **Tier 2** — deferred, not dropped | Physical Android and iOS: real GPU drivers, arm64, frame-rate parity, device soak, signed distribution | mobile readiness — **unclaimable until executed on hardware** |

**Tier 2 reopen trigger, from `CHARTER.md` §12 criterion 3:** a stranger has played a
ThreeNative game for five minutes — concretely, the first external user who installs the
framework and asks for a device build. A physical Android device arriving earlier reopens the
Android half alone; it does not reopen iOS. Until then PRD-056, 057, 058 (device rows), 060
and every iOS reliability row are parked, not worked.

Tier 1 is a *staging* of `CHARTER.md` §3 criterion 3 and §7, not a repeal of them. The tension
is recorded as row 9 in [CONFLICTS.md](CONFLICTS.md).

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
| **Tier 1 native reliability** | [PRD-064](../PRDs/PRD-064-tier-1-native-reliability.md) | ❌ not started — **every phase is executable on this host.** Finishes PRD-054 criterion 1, PRD-055 criterion 2 and PRD-058 Phase 5; defines the tier split above |
| **Round 4 — the Phase 2 paired proof** | [PRD-061](../PRDs/PRD-061-round-4-paired-capability-proof.md) | ❌ not started — **the only PRD pointing at beta row 3**; needs no hardware. Round 3's `budget` stop condition must clear first |
| Asset discovery MCP | [PRD-032](../PRDs/done/PRD-032-asset-discovery-mcp.md) | ⚠️ closed — live-agent gate lost to the no-MCP control; product owner retained the generated asset MCP, so the visual-improvement evidence stays unmet |
| Write-once/run-anywhere parity gate | [PRD-054](../PRDs/native/blocked/PRD-054-write-once-run-anywhere.md) | ⚠️ blocked at criterion 1; current aggregate rerun remains non-green |
| The HUD hole on native | [PRD-055](../PRDs/native/blocked/PRD-055-native-hud-reopened.md) | ⚠️ blocked at touch playability and row 25 |
| Playtest on physical device | [native/blocked/PRD-045](../PRDs/native/blocked/PRD-045-playtest-on-device.md) | ❌ no hardware on this machine |
| Physical mobile production qualification | [native/blocked/PRD-056](../PRDs/native/blocked/PRD-056-physical-mobile-qualification.md) | ❌ filed under `native/blocked/` — every criterion needs a physical device or an Apple signing identity; an untracked duplicate under `production-readiness/` was removed 2026-08-09 |
| Production readiness: audio parity, profiling, SBOM, promoted distribution | [native/blocked/PRD-057…060](../PRDs/native/blocked/) | ❌ **Tier 2, parked.** Moved out of `production-readiness/` (now empty) on 2026-08-10. PRD-058 Phase 5 is the one device-free part and is executed by PRD-064; 059 needs a hosted prerelease, 060 needs release credentials |
| Build-time asset pipeline | none | ❌ deferred behind two measured triggers (`docs/product/ASSET-PIPELINE.md`) |
| Device spikes 0a / 0b | none — forbidden | ❌ never a PRD (`CHARTER.md:364`); both were answered by the native lane instead |

The PRD-054 and PRD-055 blocked rows share one evidence file:
`docs/verification/probe-real-game-cross-platform-2026-08-09.md`.

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
the device path holds.** If 0a had failed, §7's mobile promise would be deleted from the
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
| Native physics through the bulk C ABI + web/host/device parity + negative controls | ✅ done (Android, iOS simulator) |
| Native build tells the truth: declared entry, no silent drops, assets staged | ✅ done (Linux + emulator; iOS packaging-only) |
| Native HUD decision — no framework abstraction ships | ✅ decided (candidate D) |
| Web CLI parity + all 25 packed-template scenarios | ✅ done |
| iOS simulator + macOS + Windows | ✅ executed once — **simulator ≠ device** |
| Toolchain-free distribution: published prebuilt artifacts, checksum lock, clean-machine build | ⚠️ desktop passes; Android release rerun open |
| HUD on native (reopened) | ⚠️ blocked — PRD-055 |
| Physical mobile/Apple hardware: real GPU drivers, arm64, frame-rate parity | ❌ not executed — no hardware here |
| Navmesh pathfinding on native | ❌ never — browser-only by decision (PRD-052) |

**No row above licenses a "mobile works" claim while ❌ and ⚠️ rows stand.** Emulator and
simulator results never become physical-driver, arm64-performance or phone frame-rate
evidence.

## Not on the roadmap

A foundation model · a Blender replacement · visual scripting · a multiplayer backend ·
console export · a plugin marketplace · a second renderer with feature parity · a universal
app-store game player · blank-prompt generation without templates · support for every
Three.js example · **a hosted Studio or Cloud tier before a stranger has played a
ThreeNative game for five minutes** (`CHARTER.md` §12 criterion 3). `CHARTER.md` §2 also
closes, with evidence: an IR, a scene format, an editor, a preset system, a code-first ECS,
a bespoke CLI vocabulary. Each can absorb the entire company; none is reopened in a feature.
