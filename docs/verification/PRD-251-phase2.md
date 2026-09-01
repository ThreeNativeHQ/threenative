# PRD-251 Phase 2 verification

Date: 2026-08-30

Baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`

Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-251-exec-20260830`

Status: implementation landed; the CPU reference path is verified, while GPU readback parity and
native execution of the GPU path remain unverified.

## Layer and ownership

This phase is engine mechanism in `packages/core/src/world-passes.ts` and the existing
`@threenative/core/world` subpath. The game supplies erosion tuning and the dispatch budget. Core
only orders numeric passes, keeps the CPU reference finite and deterministic, and exposes TSL
compute nodes; it chooses no terrain appearance.

The fixed physical order is synthesis → erosion → flow → moisture. `BoundedWorldPassQueue` admits
at most the supplied number of dispatches per call, so a field can span frames without a single
unbounded dispatch burst.

## Green unit evidence

Command:

```sh
pnpm exec vitest run packages/core/__tests__/world-erosion.spec.ts
```
Exit code: `0`.

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

The tests cover fixed stage order, per-call dispatch budget, finite deterministic CPU channels,
explicit zero-iteration behavior, invalid tuning, TSL stage order, and the zero-iteration GPU
stage bypass.

## Seeded negative control

For NC-4, the CPU erosion loop was temporarily changed from its normal iteration bound to a
condition that never executes. The source was restored immediately after the run.

```sh
pnpm exec vitest run packages/core/__tests__/world-erosion.spec.ts
```

Exit code: `1`: `1 failed, 6 passed`. The deterministic CPU field unexpectedly equalled the input
because erosion was disabled, so the negative control was observed red.

## GPU and platform evidence

`createWorldGpuPasses` constructs the TSL stage list and queue, but the example deliberately
reports `gpuAvailable: false` until the renderer can provide an explicit adapter identity. The
headed browser traversal therefore exercises the declared reduced CPU fallback (four erosion
iterations), not a GPU readback. No CPU/GPU error bound is claimed. A native world-field execution
and same-seed web/native field hash are also unverified.

The TSL unit arm did execute its bounded queue: the test fixture has stage node counts
`[1, 6, 13, 1]` with a dispatch budget of `3`; the first call dispatched exactly `3` nodes and
left the queue incomplete.

## Checkpoint record

- Exact baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`
- Seeded red: NC-4, exit `1`, one failed test before restoring the loop.
- Headed evidence class: not required for Phase 2; no Phase 2-only capture is claimed.
- Native evidence class: unverified; the later native record documents the blocked conformance row.

Changed files for this phase:

```text
packages/core/src/world-passes.ts
packages/core/src/world.ts
packages/core/__tests__/world-erosion.spec.ts
docs/verification/PRD-251-phase2.md
```
