# Docs map

[`CHARTER.md`](../CHARTER.md) at the repo root is the **only binding document**. Everything
under `docs/` either implements it (PRDs, verification) or explores what comes after it
(strategy, architecture, product). When a doc here disagrees, `CHARTER.md` wins until it is
amended — see [strategy/CONFLICTS.md](strategy/CONFLICTS.md).

| Folder | Holds | Status of contents |
|---|---|---|
| `PRDs/` | Numbered work specs, one per shipped unit | **Binding once merged.** Capped at 10 files |
| `verification/` | Gate results per PRD, dated | Historical record |
| `benchmark/` | Protocol, sealed prompts, dated results | Binding protocol, VOID result |
| `strategy/` | Market position, roadmap, money, metrics | **Proposal.** Nothing here is committed |
| `architecture/` | Shape of things not yet built | **Proposal**, except where it records shipped behaviour |
| `product/` | Constraints that will bind the product later | Mixed — store policy is external fact, the rest is proposal |
| `spikes/` | Throwaway de-risking experiments and their results | Not binding, not shipped. Results amend `CHARTER.md` |

## Strategy

- [strategy/POSITIONING.md](strategy/POSITIONING.md) — Runtime / Studio / Cloud, who we serve, what we refuse
- [strategy/ROADMAP.md](strategy/ROADMAP.md) — phases against what is already shipped
- [strategy/BUSINESS-MODEL.md](strategy/BUSINESS-MODEL.md) — open core, pricing hypotheses, revenue order
- [strategy/METRICS.md](strategy/METRICS.md) — north star and the metrics that are not vanity
- [strategy/CONFLICTS.md](strategy/CONFLICTS.md) — **read first.** Where the strategy contradicts `CHARTER.md`

## Architecture

- [architecture/ENTITY-MODEL.md](architecture/ENTITY-MODEL.md) — the ECS question, closed
- [architecture/THREEJS-CONSTRAINTS.md](architecture/THREEJS-CONSTRAINTS.md) — Three.js gaps, and which ones are ours
- [architecture/NATIVE-RUNTIME.md](architecture/NATIVE-RUNTIME.md) — device path, thread split, JSI
- [architecture/AGENT-INTERFACE.md](architecture/AGENT-INTERFACE.md) — how an AI agent drives a ThreeNative project

## Product

- [product/PERFORMANCE-BUDGETS.md](product/PERFORMANCE-BUDGETS.md) — frame budgets as test assertions
- [product/ASSET-PIPELINE.md](product/ASSET-PIPELINE.md) — deferred, with the trigger to start
- [product/STORE-POLICY.md](product/STORE-POLICY.md) — Apple and Google rules that constrain the architecture

## Spikes

- [spikes/0a-mobile-render.md](spikes/0a-mobile-render.md) — `CHARTER.md` §7 Phase 0a, unresolved after execution

A spike is not a PRD. It buys an answer, ships nothing, and is deleted after its result is
recorded here.

`pnpm budgets` fails CI above 10 files in `docs/PRDs/` — files only, so `docs/PRDs/done/`
does not count against the cap. Edit an existing document by preference.
