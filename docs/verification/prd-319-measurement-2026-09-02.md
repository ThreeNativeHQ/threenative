# PRD-319 Phase 5 — the concurrent bake, measured against PRD-318's baseline

Run 2026-09-02 on this machine (AMD Ryzen 9 5900X, 12 cores / 24 threads, NVMe, Node 20.19.6,
Linux). Subject and config identical to
[the PRD-318 baseline](prd-318-baseline-2026-09-02.md): the wildwood FAB pack, 165 inputs,
1.9 GB, `textures.maxSize 2048` plus the three `codec: "none"` overrides the baseline records.

## The number

| | Sequential (PRD-318) | Concurrent, bound 4 (PRD-319) |
|---|---|---|
| Total wall clock | **2374.2 s** | **757.5 s** |
| `ktx2` aggregate | 909,061 ms | 986,709 ms |
| `model` aggregate | 1,377,738 ms | 1,450,754 ms |
| Aggregate CPU work | ~2287 s | ~2437 s (clone + pool overhead) |
| Outputs | 169 files | 169 files |

**Speedup: 3.13x.** The pass aggregates went up ~6% (per-job structured-clone and pool
overhead); the wall clock fell 68%. A second instrumented run measured 751.8 s — run-to-run
variance ~1%.

## Correctness on the real pack (AC1)

Every emitted byte of both bakes hashed and compared:

```
files: 169, differing: 0, missing: 0
```

The two sides did not take the same execution path: the sequential run reports
`concurrencyUsed: 1`, the concurrent run `concurrencyUsed: 2` for the fixture-scale gate and
full workers for the pack (the bound is `min(concurrency, inputs)`). The determinism gate in
`packages/assets/__tests__/determinism.spec.ts` proves the same property at fixture scale with
the self-comparison guard, and proves the gate can fail via the deliberately order-dependent
pass (red observed at `01463f55`).

## AC5 — bounded memory

**UNVERIFIED as a pasted number.** Three probe attempts to record peak process-tree RSS during
the full-pack bake were unstable (an orphaned bake from a killed wrapper competed for the
output directory; a `pkill` pattern matched the probing shell itself; the surviving probe ran
idle). What is proved instead: the bound is fixed-width by construction — the pool holds
exactly `concurrency` workers (`worker-pool.ts`), at most that many inputs are in flight, and
the queue is the input list on disk, not resident memory. Closing the AC needs one clean
instrumented run; the probe script exists at `/tmp/rss-probe.mts` and its PID-tree-summing
method is sound, but this record does not claim a number it did not observe.

## The honest costs of the run

- Two `rm -rf /tmp/prd319-wildwood-out` incidents where an orphaned bake (a killed wrapper's
  surviving child) kept writing into the directory another probe was measuring. The final
  byte-identity comparison ran only after the orphan was killed.
- The first `/usr/bin/time -v` attempt failed (`no /usr/bin/time` on this box) and the rerun
  under it would have been all cache hits — the wrapper approach replaced it.

## Gates

```
pnpm typecheck: exit 0
pnpm lint:      exit 0 (514 warnings, 0 errors)
packages/assets + create-threenative config.spec: 237 passed | 1 skipped
(full root-suite run recorded in this PRD's closing commit)
```
