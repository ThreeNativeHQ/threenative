# Docs map

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
The current caller census and recomputed round-2 comparison are recorded in
[`benchmark/DELTA-2026-08-05.md`](benchmark/DELTA-2026-08-05.md).

The self-improvement loop is recorded in
[`verification/round-2-2026-08-07.md`](verification/round-2-2026-08-07.md). Resume it with
`pnpm round:next`; persistent unused-export evidence comes from `pnpm round:deletions`.

## Strategy

- [strategy/POSITIONING.md](strategy/POSITIONING.md) — Runtime / Studio / Cloud, who we serve, what we refuse
- [strategy/ROADMAP.md](strategy/ROADMAP.md) — the measured path from 30/100 to 80/100, gated on round 2
- [strategy/BUSINESS-MODEL.md](strategy/BUSINESS-MODEL.md) — open core, pricing hypotheses, revenue order
- [strategy/METRICS.md](strategy/METRICS.md) — north star and the metrics that are not vanity
- [strategy/CONFLICTS.md](strategy/CONFLICTS.md) — **read first.** Where the strategy contradicts `CHARTER.md`

## Architecture

- [architecture/ENTITY-MODEL.md](architecture/ENTITY-MODEL.md) — the ECS question, closed
- [architecture/THREEJS-CONSTRAINTS.md](architecture/THREEJS-CONSTRAINTS.md) — Three.js gaps, and which ones are ours
- [architecture/NATIVE-RUNTIME.md](architecture/NATIVE-RUNTIME.md) — device path, the owned runtime, the native physics ABI
- [architecture/AGENT-INTERFACE.md](architecture/AGENT-INTERFACE.md) — how an AI agent drives a ThreeNative project

## Product

- [product/PERFORMANCE-BUDGETS.md](product/PERFORMANCE-BUDGETS.md) — frame budgets as test assertions
- [product/ASSET-PIPELINE.md](product/ASSET-PIPELINE.md) — deferred, with the trigger to start; asset *discovery* shipped separately in [PRDs/done/PRD-032-asset-discovery-mcp.md](PRDs/done/PRD-032-asset-discovery-mcp.md)
- [product/STORE-POLICY.md](product/STORE-POLICY.md) — Apple and Google rules that constrain the architecture

## Spikes

- [spikes/0a-mobile-render.md](spikes/0a-mobile-render.md) — `CHARTER.md` §7 Phase 0a, unresolved after execution

A spike is not a PRD. It buys an answer, ships nothing, and is deleted after its result is
recorded here.

`pnpm budgets` fails CI above 10 files in `docs/PRDs/` — files only, so `docs/PRDs/done/`
does not count against the cap. Edit an existing document by preference.
