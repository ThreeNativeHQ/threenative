# PRD-190 — a projected scene reuses its plan, and its status line was four commits behind

**Executed 2026-09-04** on branch `quickwins/2026-09-04-five-closes`. Row 5 of
the `quickwins-2026-09-04` batch. That batch's README is deleted by the commit that closes its
last row, per its own rule; `git log --diff-filter=D -- docs/PRDs/quickwins-2026-09-04/README.md`
finds it, and the outcome table is in that commit's message.

## What the re-measurement found

The PRD reads **NOT STARTED**. It is not. `perf(core): reuse projected scene workspace`
(`f7335878`, replayed as `e2ed6379`) implemented all three Integration Ledger rows, and each of the
four *Required tests* the PRD names exists under that exact name in
`packages/core/__tests__/renderProjection.spec.ts`. Nobody moved the status line — the same thing
row 3 of this batch found on PRD-296, and the batch README's warning that this tree moves under you.

Measured at `2f0d2170`:

| Ledger row | PRD's incumbent | At HEAD |
| --- | --- | --- |
| 1 — reusable scan workspace | fresh scan collections and a recursive closure per frame | `IProjectionScanWorkspace`, created once in `renderProjection.ts:140` and cleared by `releaseProjectionScanWorkspace`; the walk uses an explicit `walkStack`, not a closure |
| 2 — allocation-free batch identity | `[uuid,…].join("\|")` per mesh | `groupsByGeometry`: `WeakMap<Geometry, WeakMap<Material, Map<flags, group>>>`. `grep 'join("\|")' projection-plan.ts` returns nothing |
| 3 — reusable mirror apply scratch | copied arrays, rebuilt tally maps, a new light set | pooled scratch entries and a persistent `#lightMembership` WeakMap with a generation counter (`projection-apply.ts:213-218`) |

So row 5 is a verification and an archive, not an implementation.

## How this is measured, and how it is not

The acceptance criterion is *"no mesh-count-proportional JS allocation after warmup"*. That is
**not** measured here with a GC observer. The one this repository had was retired precisely because
it never yielded a reading and therefore certified whatever it was pointed at.

What the shipped tests use instead are direct instruments, and they are what the PRD's own ledger
asks for — identity and write counts, not bytes:

- `countCollectionConstructors` — counts `Map`/`Set` construction inside the measured window.
- an `Array.prototype.join` spy that counts five-element `"|"` joins, which is the exact shape of
  the batch key that was removed.
- `trackArrayLengthWrites` proxies over the nine workspace arrays and a batch group's `members`,
  counting every `length` write, so a re-created or truncated-and-refilled array is visible.
- counters on `Set.prototype.clear` and `Set.prototype.add`.

At the 2,000-mesh workload over five settled scans, `lengthWrites` is 0, `setClears` is 0 and
`setAdds` is 0. At 250 meshes over ten reconciles, `maps` and `sets` are both 0 and the batch-key
join count is 0.

## The three red controls

Each mutation is the one the PRD's Integration Ledger names, applied to the shipped code and then
reverted. Run against the full 61-test projection suite:

| Mutation | Result |
| --- | --- |
| 1 — `renderProjection.ts` allocates a fresh scan workspace every `reconcile()` instead of clearing one | **2 failed**: `should reuse projected-plan storage across settled frames`, and `names slot exhaustion as slot exhaustion rather than as an unsupported geometry` |
| 2 — restore the joined string batch key (`[geometry.uuid, material.uuid, …].join("\|")`) per mesh | **1 failed**: `should reuse projected-plan storage across settled frames` |
| 3 — `projection-apply.ts` rebuilds `#lightMembership` and a light `Set` on every apply | **2 failed**: the reuse test, and `should retire removed lights with reused membership storage` |
| all three reverted | **61 passed** |

Control 1's second failure is worth naming: rebuilding the workspace loses the slot-exhaustion
bookkeeping, so the projection reports the wrong *reason* for declining. The workspace is not only
an allocation optimisation — the diagnosis rides on it.

## Acceptance criteria

- **A stable 2,000-mesh projected scene performs no mesh-count-proportional JS allocation after
  warmup.** `should not churn settled scan storage at the 2,000-mesh workload`: zero array-length
  writes across nine workspace arrays and a group's members, zero `Set` clears and adds, over five
  settled scans after a warmup scan. Red control 1 makes it fail.
- **The renderer receives the correct mirror in the same frame after each supported mutation.** The
  `SceneRenderProjection reconciliation after settling` block mutates one property at a time against
  a scene left stable for 600 frames — deliberately one property per test, because a single
  "something changed" test passes as soon as any one field reconciles.
- **Draw candidates and appearance are unchanged; no look parameter moved into package code.** The
  reuse test asserts `projectedObjects: 250` and `resultDrawCandidates: 1` alongside the allocation
  counts, so a change that reused storage by drawing something different fails on the same line.
- **PRD-169's decline tests remain green without changing its 60-frame bound.**
  `DECLINE_RESCAN_FRAMES = 60` is unchanged at `renderProjection.ts:131`, and the ten decline tests
  pass.

## Gates

```
$ pnpm vitest run packages/core/__tests__/renderProjection.spec.ts
 Test Files  1 passed (1)
      Tests  61 passed (61)

$ pnpm vitest run packages/core/__tests__
 Test Files  102 passed (102)
      Tests  1084 passed (1084)
```

## Not done here

The PRD's §Verification asks for a benchmark extended to 0, 250 and 2,000 meshes for 300 frames
with p95 reconcile times and before/after draw candidates, and a browser WebGPU scenario that
moves, hides and removes a projected object. **Neither was run in this session.** The unit
instruments above prove the storage is reused and the classification is correct; they do not
produce a p95 reconcile time, and no timing number is claimed here. `examples/engine-load-test`'s
`projection-conformance.playtest.json` is the browser lane that would carry the second, and it was
not executed.

That is a gap in evidence, not in the implementation: the acceptance criteria are about allocation
and correctness and are met by direct measurement. A timing record for the projected path belongs
with whoever next opens the GPU lane.
