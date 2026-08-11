# Docs map

**Picking up the native lane?** Start at
[NEXT-STEPS-2026-08-09.md](NEXT-STEPS-2026-08-09.md) — the executable work queue as of
`fd92899`, with its evidence in
[verification/unblocked-2026-08-09-android-touch.md](verification/unblocked-2026-08-09-android-touch.md).

[`CHARTER.md`](architecture/CHARTER.md) is the **only binding document**. Everything
under `docs/` either implements it (PRDs, verification) or explores what comes after it
(strategy, architecture, product). When a doc here disagrees, `CHARTER.md` wins until it is
amended — see [strategy/CONFLICTS.md](strategy/CONFLICTS.md).

| Folder | Holds | Status of contents |
|---|---|---|
| `PRDs/` | Numbered work specs, one per shipped unit | **Binding once merged.** Capped at 10 files |
| `verification/` | Gate results per PRD, dated, plus round ledgers | Historical record |
| `benchmark/` | Protocol, sealed prompts, dated results | Binding protocol, VOID result |
| `strategy/` | Market position, roadmap, money, metrics | **Proposal.** Nothing here is committed |
| `architecture/` | Shape of things not yet built | **Proposal**, except where it records shipped behaviour |
| `product/` | Constraints that will bind the product later | Mixed — store policy is external fact, the rest is proposal |
| `spikes/` | Throwaway de-risking experiments and their results | Not binding, not shipped. Results amend `CHARTER.md` |

Genre sweeps live under [`benchmark/sweeps/`](benchmark/sweeps/). Each archived run keeps
the built `src/`, `playtests/`, `package.json`, sealed `sweep.json` manifest, and framework
declarations used by the measurer. A matching
[`verification/SWEEP-TEMPLATE.md`](verification/SWEEP-TEMPLATE.md) ledger is required for
each run and records the brief hash, reach rate, used and unused exports, and every API that
blocked the build. The `Round` field distinguishes a baseline from a re-measure. Compare two
archives with `pnpm sweep:delta <round-1-archive> <round-2-archive>`; it refuses mismatched
genres, brief hashes, and self-comparisons, then reports reach-rate movement, exports newly
reached, exports still untouched, and repeated friction rows. The delta record is only valid
after its numbers are recomputed from the two archived sweeps.

Each genre also owns a sealed, arm-neutral proof set under `benchmark/genres/<genre>/proof/`.
Run it against either arm with `pnpm sweep:proof <sandbox-or-archive>`; the command verifies
the manifest's `Proof SHA-256`, runs every scenario, and writes `proof.json`. Pair one completed
framework archive with one completed vanilla archive using
`pnpm sweep:pair <framework-archive> <vanilla-archive>`; the command refuses mismatched arms,
genres, brief hashes, proof hashes, and missing proof results before reporting passed/total,
source LOC, source files, and framework reach side by side.
The recomputed round-2 comparison is in
[`benchmark/DELTA-2026-08-05.md`](benchmark/DELTA-2026-08-05.md); the current caller census
is [`verification/arm-census-2026-08-08.md`](verification/arm-census-2026-08-08.md).

The self-improvement loop resumes from the newest round ledger — currently
[`verification/round-3-2026-08-09.md`](verification/round-3-2026-08-09.md), with
[round 2](verification/round-2-2026-08-07.md) and
[round 1](verification/round-1-2026-08-06.md) behind it. Resume with `pnpm round:next`;
persistent unused-export evidence comes from `pnpm round:deletions`.

## Strategy

- [strategy/VALUE-PROPOSITION.md](strategy/VALUE-PROPOSITION.md) — "would I use this instead of vanilla Three.js?" answered per axis, every claim marked earned or unearned against a verification file
- [strategy/POSITIONING.md](strategy/POSITIONING.md) — Runtime / Studio / Cloud, who we serve, what we refuse
- [strategy/ROADMAP.md](strategy/ROADMAP.md) — the path to a production-ready beta, every item marked ✅/⚠️/❌; Gate 0 and Phase 1 closed, Phase 2 active, native lane state merged in
- [strategy/BUSINESS-MODEL.md](strategy/BUSINESS-MODEL.md) — open core, pricing hypotheses, revenue order
- [strategy/METRICS.md](strategy/METRICS.md) — north star and the metrics that are not vanity
- [strategy/CONFLICTS.md](strategy/CONFLICTS.md) — **read first.** Where the strategy contradicts `CHARTER.md`

## Architecture

- [architecture/ENTITY-MODEL.md](architecture/ENTITY-MODEL.md) — the ECS question, closed
- [architecture/THREEJS-CONSTRAINTS.md](architecture/THREEJS-CONSTRAINTS.md) — Three.js gaps, and which ones are ours
- [architecture/NATIVE-RUNTIME.md](architecture/NATIVE-RUNTIME.md) — device path, the owned runtime, the native physics ABI
- [architecture/AGENT-INTERFACE.md](architecture/AGENT-INTERFACE.md) — how an AI agent drives a ThreeNative project
- [architecture/NATIVE-PERF-BOTTLENECKS.md](architecture/NATIVE-PERF-BOTTLENECKS.md) — hypothesis list, superseded in part by the measurements in `PRDs/native-performance-fixes/`
- [architecture/NATIVE-RENDER-TRANSPORT.md](architecture/NATIVE-RENDER-TRANSPORT.md) — the proposed JS shim / command-stream / render-thread stack, layer by layer. **Declined as a roadmap**: it aims three layers of engineering at a boundary measured at 2% of frame
The 2026-08-08 course correction is closed and its file deleted: the `@threenative/physics`
node fork was removed, each public class is one file, and only the `PhysicsSimulation`
backend swaps on the export condition. Write-once/run-anywhere is now owned as a gate by
[PRDs/native/blocked/PRD-054-write-once-run-anywhere.md](PRDs/native/blocked/PRD-054-write-once-run-anywhere.md), which is
**open** — blocked at acceptance criterion 1.

## Product

- [product/PERFORMANCE-BUDGETS.md](product/PERFORMANCE-BUDGETS.md) — frame budgets as test assertions
- [product/ASSET-PIPELINE.md](product/ASSET-PIPELINE.md) — build-time pipeline **still deferred**, neither trigger fired as of 2026-08-09; asset *discovery* is separate and is retained by product-owner decision after its live gate failed in [done/PRD-032-asset-discovery-mcp.md](PRDs/done/PRD-032-asset-discovery-mcp.md)
- [product/STORE-POLICY.md](product/STORE-POLICY.md) — Apple and Google rules that constrain the architecture

## Spikes

- [spikes/0a-mobile-render.md](spikes/0a-mobile-render.md) — **CLOSED 2026-08-09.** Its own run never observed a device render; the question was answered *yes* by PRD-047's owned runtime (300 desktop frames + Android emulator, [verification/PRD-047.md](verification/PRD-047.md)). Retained only because superseded PRD-044 and [strategy/NATIVE-LEVELS-2026-08-08.md](strategy/NATIVE-LEVELS-2026-08-08.md) cite it; the React Native route it prescribes is deleted
- 0b — physics on device: never written as a spike. It became [PRDs/native/PRD-046-physics-native.md](PRDs/native/done/PRD-046-physics-native.md)

A spike is not a PRD. It buys an answer, ships nothing, and is deleted once its answer is
recorded here and nothing else cites it.

`pnpm budgets` fails CI above 10 files in `docs/PRDs/` — files only, so `docs/PRDs/done/`
does not count against the cap. Edit an existing document by preference.

[`PRDs/native/blocked/`](PRDs/native/blocked/) holds PRDs whose every remaining item is
blocked on hardware the operator does not have — as of 2026-08-08, no Apple machine, so no
Xcode, simulator or iOS device. **Blocked is not done.** The criterion stays unmet and the
PRD moves to `done/` only when it is met on real hardware, never by rewriting it to fit
what this machine can run. A PRD with any non-hardware work left stays in `PRDs/native/`.
