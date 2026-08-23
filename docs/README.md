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
  container, session broker, and production path — for the private Studio repository, not this one.
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

The repository currently records 148 done PRD files and 17 blocked PRD files. Active batches are
[`agent-leverage/`](PRDs/agent-leverage/), [`asset-pipeline/`](PRDs/asset-pipeline/),
[`batch-26-08-16/`](PRDs/batch-26-08-16/README.md), [`experiments/`](PRDs/experiments/),
[`native-performance-fixes/`](PRDs/native-performance-fixes/),
[`starter-kits/`](PRDs/starter-kits/), and [`studio-hosting/`](PRDs/studio-hosting/).
`batch-2026-08-22-defects/` closed on 2026-08-22 as
[`done/batch-2026-08-22-defects/`](PRDs/done/batch-2026-08-22-defects/README.md).
`batch-26-08-18/`, `native/` and `production-readiness-26-08-14/` were deleted on 2026-08-22 as
outdated documentation; their PRDs live in [`done/`](PRDs/done/) or
[`BLOCKED/`](PRDs/BLOCKED/README.md).
`alpha-readiness/` was deleted on 2026-08-18 and `batch-26-08-17/` closed as
[`done/fps-friction-26-08-17/`](PRDs/done/fps-friction-26-08-17/README.md).

**Studio is no longer in this repository.** It is the local agent-and-preview surface — a server
plus one self-contained page — and on 2026-08-16 it became the paid product and moved to a private
repository, along with the `hosting/` service that serves it (PRD-129). Nothing in this repository
is anything but MIT. The Studio PRDs stay here as the record of how it was built:
[PRD-084](PRDs/done/PRD-084-threenative-studio.md),
[PRD-085](PRDs/done/PRD-085-studio-wiring.md),
[PRD-086](PRDs/PRD-086-studio-self-improvement-loop.md), and the
[Studio hosting series](PRDs/studio-hosting/README.md) — all of them now describing work that
lives elsewhere.

## Verification

A verification file is dated evidence for a gate, PRD, device run, or benchmark; it records what
was executed and what remains unproven. Native claims are evidence-bound: hosted `macos-15`
execution can produce iOS-simulator evidence, while physical-device, signing, thermal, battery,
and performance-parity claims remain open.

The [technical-debt audit](verification/tech-debt-audit-2026-08-20.md) is a dated sweep of the whole
repository rather than of one PRD: measured gate state, the code the gates do not fail, the friction
recorded in builder sessions, and the defect shapes reviewers keep re-finding.

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

- [ENTITY-MODEL](architecture/ENTITY-MODEL.md) — the ECS question and its closed decision
- [THREEJS-CONSTRAINTS](architecture/THREEJS-CONSTRAINTS.md) — Three.js gaps and framework
  ownership
- [NATIVE-RUNTIME](architecture/NATIVE-RUNTIME.md) — device path, owned runtime, and physics ABI
- [AGENT-INTERFACE](architecture/AGENT-INTERFACE.md) — how an agent drives a project
- [NATIVE-PERF-BOTTLENECKS](architecture/NATIVE-PERF-BOTTLENECKS.md) — performance hypotheses
- [NATIVE-RENDER-TRANSPORT](architecture/NATIVE-RENDER-TRANSPORT.md) — proposed render-thread
  layers and why they are not a roadmap

Write-once/run-anywhere is owned as a gate by
[PRD-054](PRDs/BLOCKED/requires-parity-rerun/PRD-054-write-once-run-anywhere.md); it remains
blocked at acceptance criterion 1.

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
