# PRD-170 — physics hot-path allocations: landed as hygiene, measured as below instrument noise

Date: 2026-08-22
Machine: desktop Linux, Node v20.19.6, V8 young generation defaults, `NODE_OPTIONS=--expose-gc`.
Subject: `packages/physics/scripts/bench-allocations.ts` — 120 kinematic platforms + 120
characters + 120 dynamic crates through the shared plugin update loop (`plugin.update`), which is
the production bulk write/read path.
Window: 90 warmup steps, forced GC, then 6,000 measured steps.

## What changed

- One shared checked reader (`transformRecord.ts`) replaces three duplicated `finiteTransform`
  helpers; reads index the buffer directly instead of building an array per body per step.
- All three node classes write kinematic input as scalar buffer stores, no array literal.
- `CharacterBody3D.#desired` and `RigidBody3D.#lastPosition` mutate in place; `kinematicMotion()`
  returns a per-body scratch retained by the plugin only within one pass.
- Web character step reuses module-scope scratch records and one hoisted one-way predicate
  (layers set immediately before the synchronous consumer).
- Collision drain queue flattened from one tuple per event to a stride-4 number array written
  into the caller buffer with an indexed loop.

**Deliberately not done:** numeric contact-pair keys. Body ids are Uint32, so `left * 2^32 +
right` exceeds 2^53 unsafe-integer range and BigInt allocates more than the string it replaces;
the string key stays, noted here so it is not re-derived.

## Behaviour proof

`pnpm exec vitest run --config vitest.config.ts packages/physics` — **136 passed / 136**,
including `determinism.spec.ts` byte-identical `takeSnapshot()` comparisons (same process and
fresh worker) and `parity.spec.ts`. No test expectation was edited.

## Measurement — and what it honestly says

Sampling heap profiler (`--heap-prof --heap-prof-interval=16384`), summed self-size under the
hot-path call frames, 6,000 steps:

| Arm | Hot-path sampled allocations | GC events in window | wall ms |
|---|---|---|---|
| before | ~0.118 MB | 0 | 99,079 |
| after | ≤0.03 MB, remainder indistinguishable from sampler noise | 0 | 96,725–100,418 |

A heap-growth/GC-event instrument at 360 bodies shows nothing either way: the removed garbage
never crossed a scavenge threshold even at 6,000 steps. Wall-clock deltas sit inside run-to-run
variance; the step cost is dominated by Rapier solver work (~16–17 ms/step at this contact load).

**Verdict recorded rather than argued:** the removed allocations were real and structural, but
their end-to-end effect at realistic body counts is below what any instrument available here can
resolve. This change is claimed as code hygiene — one validation helper instead of three diverging
copies, zero-allocation write/read shapes matching what the physics CLAUDE.md already asked for —
and explicitly **not** as a measurable frame-time or battery win. It follows the same honesty rule
as PRD-072: measure first, claim only what the number supports.

The bench script ships so a future higher-count or lower-end-device measurement reruns in one
command: `NODE_OPTIONS=--expose-gc pnpm --filter @threenative/physics exec tsx scripts/bench-allocations.ts`.

Negative control observed: the stashed-before arm produced the profile table above; restoring the
change returns the after row. Reverting individual rows restores their respective allocations
(structural, visible in the profile's function names).
