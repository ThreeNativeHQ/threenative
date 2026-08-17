# Docs map

This directory holds product constraints, work specifications, architecture notes, measured
verification, and experiments; [`architecture/CHARTER.md`](architecture/CHARTER.md) is the
binding document.

## Start here

- [ROADMAP](strategy/ROADMAP.md) explains the product path and the claims that still need
  evidence.
- [CONFLICTS](strategy/CONFLICTS.md) records decisions where strategy and the binding document
  disagree.
- [Latest round ledger](verification/round-10-2026-08-16.md) gives the current self-improvement
  state. The [Studio hosting series](PRDs/studio-hosting/README.md) describes the proposed
  container, session broker, and production path.
- [Engine-load summary](verification/engine-load-test-summary-2026-08-15.md) is the current
  external performance comparison; [per-object cost](verification/three-webgpu-per-object-cost-2026-08-15.md)
  records the Three.js submission-cost finding.

| Folder | Holds | Status of contents |
|---|---|---|
| `PRDs/` | Numbered work specs, active proposals, and archived delivery records | Status follows the owning folder; `pnpm budgets` reports counts but does not enforce a PRD-file cap |
| `verification/` | Gate results per PRD, dated, plus round ledgers | Historical record |
| `benchmark/` | Protocol, sealed prompts, dated results | Binding protocol, VOID result |
| `strategy/` | Market position, roadmap, money, metrics | **Proposal.** Nothing here is committed |
| `architecture/` | Shape of things not yet built | **Proposal**, except where it records shipped behaviour |
| `product/` | Constraints that will bind the product later | Mixed — store policy is external fact, the rest is proposal |
| `spikes/` | Throwaway de-risking experiments and their results | Not binding, not shipped. Results amend the binding document |

## PRDs

- **Active work:** top-level `PRD-*.md` files remain active; grouped work lives in the active
  batches below.
- **Done work:** completed PRDs live in [`done/`](PRDs/done/).
- **Blocked work:** PRDs blocked on a named external dependency live in
  [`BLOCKED/<reason>/`](PRDs/BLOCKED/), where blocked is not done.
- **Archive rule:** a PRD moves to `done/` in the same commit that finishes its acceptance
  evidence.

The repository currently records 88 done PRDs and 16 blocked PRDs. Active batches are
[`agent-leverage/`](PRDs/agent-leverage/), [`alpha-readiness/`](PRDs/alpha-readiness/),
[`asset-pipeline/`](PRDs/asset-pipeline/), [`experiments/`](PRDs/experiments/),
[`native/`](PRDs/native/), [`native-performance-fixes/`](PRDs/native-performance-fixes/),
[`production-readiness-26-08-14/`](PRDs/production-readiness-26-08-14/),
[`starter-kits/`](PRDs/starter-kits/), and [`studio-hosting/`](PRDs/studio-hosting/).

**Studio** is the local agent-and-preview surface — `@threenative/studio`, a server plus one
self-contained page, driven by `pnpm studio:inspect`, `studio:probe` and `studio:loop`. It shipped
in [PRD-084](PRDs/done/PRD-084-threenative-studio.md) and
[PRD-085](PRDs/done/PRD-085-studio-wiring.md); [PRD-086](PRDs/PRD-086-studio-self-improvement-loop.md)
is the standing brief handed to the agent iterating on it. The
[Studio hosting series](PRDs/studio-hosting/README.md) tracks the container, session broker,
and production path for running it against durable game repositories.

## Verification

A verification file is dated evidence for a gate, PRD, device run, or benchmark; it records what
was executed and what remains unproven. Native claims are evidence-bound: hosted `macos-15`
execution can produce iOS-simulator evidence, while physical-device, signing, thermal, battery,
and performance-parity claims remain open.

A round ledger records one self-improvement round's inputs, decisions, evidence, and resulting
state. `pnpm round:next` resumes from the latest ledger, and `pnpm round:deletions` reports
persistent unused-export evidence. The [newest ledger is round 10](verification/round-10-2026-08-16.md);
[rounds 1–9](verification/) are the earlier ledger range.

## Benchmark

The [benchmark protocol](benchmark/PROTOCOL.md), [sealed genre briefs](benchmark/genres/), and
[LOC report](benchmark/LOC.md) define the comparison. The dated result remains
[VOID](benchmark/RESULTS-2026-08-02.md); it is a measurement result, not a product claim.

Genre sweeps live under [`benchmark/sweeps/`](benchmark/sweeps/). Each archive retains the
built source, playtests, package manifest, sealed sweep manifest, and framework declarations
used by the measurer. Every run has a matching [sweep ledger](verification/SWEEP-TEMPLATE.md)
with the brief hash, reach rate, used and unused exports, and blocking APIs. `Round` distinguishes
a baseline from a re-measure.

Compare archives with `pnpm sweep:delta <round-1-archive> <round-2-archive>`; pair completed
framework and vanilla archives with `pnpm sweep:pair <framework-archive> <vanilla-archive>`.
Proof sets under `benchmark/genres/<genre>/proof/` run with
`pnpm sweep:proof <sandbox-or-archive>`. The [round-2 delta](benchmark/DELTA-2026-08-05.md)
and [caller census](verification/arm-census-2026-08-08.md) are the current supporting records.
Vendored package tarballs under each archive's `vendor/` directory are not archived; they are
reproducible with `pnpm pack`, and sweep tests build their own temporary fixtures.

## Strategy

- [VALUE-PROPOSITION](strategy/VALUE-PROPOSITION.md) — the framework's earned and unearned
  claims compared with vanilla Three.js
- [POSITIONING](strategy/POSITIONING.md) — Runtime, Studio, Cloud, audience, and refusals
- [ROADMAP](strategy/ROADMAP.md) — production path and evidence-bound status
- [BUSINESS-MODEL](strategy/BUSINESS-MODEL.md) — open-core and pricing hypotheses
- [METRICS](strategy/METRICS.md) — north star and supporting measures
- [CONFLICTS](strategy/CONFLICTS.md) — resolved disagreements with the binding document

## Architecture

*Every file below was re-checked against the tree on 2026-08-16; where one now describes something
built, it says so and names the file.*

- [architecture/ENTITY-MODEL.md](architecture/ENTITY-MODEL.md) — the ECS question, closed
- [architecture/THREEJS-CONSTRAINTS.md](architecture/THREEJS-CONSTRAINTS.md) — Three.js gaps, and which ones are ours
- [architecture/NATIVE-RUNTIME.md](architecture/NATIVE-RUNTIME.md) — device path, the owned runtime, the native physics ABI
- [architecture/AGENT-INTERFACE.md](architecture/AGENT-INTERFACE.md) — how an AI agent drives a ThreeNative project
- [architecture/NATIVE-PERF-BOTTLENECKS.md](architecture/NATIVE-PERF-BOTTLENECKS.md) — hypothesis list, superseded in part by the measurements in `PRDs/native-performance-fixes/`
- [architecture/NATIVE-RENDER-TRANSPORT.md](architecture/NATIVE-RENDER-TRANSPORT.md) — the proposed JS shim / command-stream / render-thread stack, layer by layer. **Declined as a roadmap**: it aims three layers of engineering at a boundary measured at 2% of frame
The 2026-08-08 course correction is closed and its file deleted: the `@threenative/physics`
node fork was removed, each public class is one file, and only the `PhysicsSimulation`
backend swaps on the export condition. Write-once/run-anywhere is now owned as a gate by
[PRDs/BLOCKED/requires-parity-rerun/PRD-054-write-once-run-anywhere.md](PRDs/BLOCKED/requires-parity-rerun/PRD-054-write-once-run-anywhere.md), which is
**open** — blocked at acceptance criterion 1.

## Product

- [PERFORMANCE-BUDGETS](product/PERFORMANCE-BUDGETS.md) — frame budgets as test assertions
- [ASSET-PIPELINE](product/ASSET-PIPELINE.md) — deferred build-time pipeline and its triggers
- [STORE-POLICY](product/STORE-POLICY.md) — Apple and Google constraints
- [STRANGER-TEST-PROTOCOL](product/STRANGER-TEST-PROTOCOL.md) — the single definition of the
  five-minute player experiment

## Spikes

- [0a-mobile-render](spikes/0a-mobile-render.md) — closed mobile-render question and retained
  evidence
- [studio-loop-2026-08-12](spikes/studio-loop-2026-08-12.md) — Studio-loop de-risking experiment

A spike buys an answer and ships nothing; it is not a PRD. Its result remains here when later
documents still cite it.
