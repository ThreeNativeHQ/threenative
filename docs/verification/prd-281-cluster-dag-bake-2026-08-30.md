# PRD-281 — a dense mesh bakes to a crack-free cluster DAG

Date: 2026-08-30. Subject: `packages/assets/src/virtual/` at `c21e70e0` and the pipeline wiring that
follows it. Phase 1 of the [virtual geometry batch](../PRDs/done/nanite-like/README.md).

**Verdict: the invariant holds.** A cut taken at any threshold on a baked DAG leaves **zero** open
interior edges and zero doubly covered ones, on a connected body and on a body of disconnected
shells. Both mutations PRD-281 names crack it, and both are kept as permanent tests that assert the
crack rather than as a paragraph claiming one was seen.

**One acceptance criterion changed its answer, and §5's AC6 is amended rather than forced.**
meshoptimizer will not take a closed shell below about 64 triangles, so a body of twelve
disconnected shells cannot become one root cluster whatever the level budget. The escape —
the simplifier's `Prune` flag — deletes whole components, measured below. The bake now reports
*why* it stopped instead of claiming convergence.

Everything here executed on this machine, in Node 20.19.6, through `vitest`. No browser, no device,
no native run: this phase writes no runtime code, and PRD-281 §6's native requirement lands with
PRD-282's runtime.

## What was measured

`TorusKnotGeometry(1, 0.4, 512, 64)` — 65,536 triangles over 33,345 vertices, closed, indexed — and
a body of twelve `SphereGeometry(0.5, 32, 16)` shells that touch nothing (11,520 triangles).

```
DAG bake 230 ms, 1063 clusters, 11 levels, 262 groups, stop=root, roots=1
L0=65536t/512c  L1=32768t/261c  L2=16384t/136c  L3=8192t/71c   L4=4114t/39c  L5=2128t/20c
L6=1156t/12c    L7=576t/6c      L8=318t/3c      L9=158t/2c     L10=78t/1c
group error range 0.00034 .. 0.38025 (object-space units; the body is ~2.8 across)
```

Every level sheds at least half its triangles until the last, and the loop ends at one cluster of 78
triangles.

## AC1 — no cracks, at any threshold

The test takes the cut at every group error in the DAG, at ±0.1% either side of each, and at 41
points across the whole error range — about 130 thresholds — and counts, in welded position space,
interior edges used by exactly one selected triangle and edges used by more than two. A hole is an
edge the source mesh used twice and the cut uses once.

| threshold | triangles in the cut | open interior edges | doubly covered |
| --- | --- | --- | --- |
| 0.0000 | 65,536 | 0 | 0 |
| 0.0010 | 46,912 | 0 | 0 |
| 0.0050 | 14,576 | 0 | 0 |
| 0.0100 | 8,288 | 0 | 0 |
| 0.0500 | 4,004 | 0 | 0 |
| 0.1000 | 3,048 | 0 | 0 |
| 0.3000 | 1,450 | 0 | 0 |
| 0.5704 | 78 | 0 | 0 |

`packages/assets/__tests__/virtual-dag.spec.ts` runs the full sweep on both bodies and fails on the
first threshold that cracks.

## AC2 — red-green, monotonic error

The mutation is exactly the line PRD-281 §1 names: `parentError = groupSimplifyError` instead of
`max(groupSimplifyError, max(childErrors))`. Nothing else about the bake changes — the same DAG is
re-read with the parent errors substituted, so the only variable is the invariant.

```
AC2 mutation (parentError = groupSimplifyError): 3/8 thresholds crack, worst 476 open edges
```

Kept as a permanent test that asserts the crack appears
(`virtual-dag.spec.ts` → *AC2 red — dropping the children's errors from the parent's cracks the
cut*). A green run of that test is the proof; a future change that made the mutation harmless would
fail it and say so.

## AC3 — red-green, the locked boundary

`buildClusterDag(..., { unlockGroupBoundary: true })` drops `LockBorder` from the group simplify and
changes nothing else.

```
AC3 mutation (rim unlocked): 6/7 thresholds crack, worst 969 open edges
```

These are the only two ways a DAG cracks, and both are now load-bearing under test.

## AC4 — the bake is deterministic

Two bakes of the same bytes return identical index buffers, cluster tables and group tables; two
full pipeline compiles of the same `.glb` return byte-identical files. There is no seed in the
partition and nothing to disagree about: the group seed is always the lowest ungrouped cluster and
ties break on the lower index. *Two machines* is not proven here — one machine, twice.

## AC5 — the payload is bounded

Measured on the torus knot, uncompressed:

| | bytes |
| --- | --- |
| source `.glb` (float positions, uint32 indices) | 1,587,624 |
| compiled without the bake (quantized + meshopt) | 257,720 |
| compiled with the bake | 877,896 |
| extension payload, before compression | 1,638,348 |

- Payload against the source index buffer (786,432 B): **2.08×**. Every level's triangles sum to
  about twice level 0's — that is the technique, not an encoding choice.
- Compiled file growth: **3.41×**. Meshopt compresses the payload about 2.6:1.
- Per-cluster tables are 56 bytes: ranges, errors, sphere, cone, groups. 1,056 clusters is 59 KB of
  the 1.6 MB, so the index buffer is the whole cost.

The guard is fixed at 2.5× the source index bytes and 4× the compiled file, and a regression fails
`virtual-pass.spec.ts`.

## AC6 — the levels converge, and where they do not

**Amended by measurement.** The probe that forced it:

```
no-prune step 0: 960 -> 480 tris, err 0.01346      prune step 0: 960 -> 480 tris
no-prune step 1: 480 -> 240 tris, err 0.02887      prune step 1: 480 -> 240 tris
no-prune step 2: 240 -> 120 tris, err 0.05495      prune step 2: 240 -> 120 tris
no-prune step 3: 120 ->  64 tris, err 0.44588      prune step 3: 120 ->   0 tris, err 0.59362
no-prune step 4:  64 ->  64 tris, err 0.00000      prune step 4: Error: Assertion failed
```

A closed shell bottoms out at 64 triangles. `Prune` gets past that by deleting the component
outright — 960 triangles to nothing — and then the simplifier throws on the empty index buffer. This
bake will not delete geometry to reach a tidier root, so twelve shells stop at ten clusters and 750
triangles.

The DAG therefore reports `stopReason`:

- `root` — one cluster left. The torus knot, and every connected body tested.
- `stalled` — nothing left will simplify. The twelve-shell body, still watertight at every
  threshold, which the AC1 sweep above covers.
- `cap` — `maxLevels` ran out. The only value that means the payload is unfinished, and the report
  line says so in words.

The triangle-count fall is asserted per level on the connected body: each level is at most 98% of
the one below, and in practice each is ~50%.

## AC7 — off by default, and it reports when on

- `modelPass()` with no `virtual` key writes no `TN_virtual_geometry` and no summary.
- `assets.models.virtual` is validated by `packages/create-threenative/src/config.ts`'s key checker:
  unknown sub-keys fail `TN_CONFIG_ASSETS_INVALID`, `simplifyRatio` must lie strictly inside (0, 1),
  and the rest must be positive integers.
- The report line, pinned by a spec:

      virtual quarry-face.glb: 512 cluster(s) over 6 level(s) on 1 primitive(s), 2 skipped,
      4096 payload bytes, bake 12.3 s, stopped at root

  and when a DAG ran out of levels it ends `— a DAG hit the level cap and is unfinished`.

The compile cache keys on the options *and* on `VIRTUAL_BAKE_VERSION`, so a better partition
invalidates every stale entry rather than hiding behind one.

## AC8 — it is still a glTF

`TN_virtual_geometry` is written to `extensionsUsed` and never to `extensionsRequired`. A reader
with only the standard extensions registered opens the file, logs `Missing optional extension,
"TN_virtual_geometry"`, and returns the primitive with its full 65,536 triangles and its own index
buffer untouched. The six accessors the extension adds are referenced by nothing else in the file.

## Two things the bake had to be told, that the specs now hold

1. **The extension's accessor refs need a `usage`.** Without it the graph warns `Missing attribute
   ".usage" on edge` six times per primitive and the writer lays the payload out as if it were
   nothing.
2. **The bake runs after `reorder` and before `quantize`.** `reorder` is the last stage that moves a
   vertex, and the DAG's index buffer names vertices. A test asserts that the level-0 clusters are
   exactly the primitive's own triangle set *after* the whole chain has run, so a future stage that
   started reordering vertices would fail here rather than in a game.

## What is not proven

- **Two machines.** AC4 is one machine twice.
- **A 2M-triangle body.** The bake is 230 ms on 65k triangles; PRD-281 §4's minutes-long case and
  its cache behaviour under CI are untested until the quarry's cliff face goes through it.
- **Anything at run time.** No cut is drawn on a GPU by this phase. That is PRD-282.
