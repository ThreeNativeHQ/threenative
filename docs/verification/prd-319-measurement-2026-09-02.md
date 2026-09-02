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

**Measured 2026-09-02, one clean instrumented run:** peak process-tree RSS during the full-pack
concurrent bake (bound 4) was **5,491 MB (~5.4 GB)**, polled once per second over
`/proc/<pid>/stat` across the whole `npx -> tsx -> node -> workers` tree. Same run: 730.1 s wall
clock, 165 written — consistent with the 757.5 s / 751.8 s of the two recorded runs (~4%
faster; run-to-run band holds).

The bound is structural, and the number is what the bound predicts: 4 worker threads, each
holding one input's decode + encode state (~1.3 GB each on this pack), with the queue on disk —
a 1,000-input pack queues through the same resident set. Peak RSS scales with `concurrency`,
not with input count.

Two defects this run surfaced, recorded rather than buried:

1. **The concurrent bake process does not exit after finishing.** The run printed its totals
   (730.1 s) and then kept spinning at ~190% CPU until killed. The sequential path exits
   cleanly. Named suspect: the tsx `register()` bridge the workers enter through holding a
   channel the parent's `dispose()` does not close. Follow-up: diagnose and fix in the pool's
   teardown; the measurement above is unaffected (the peak accrued during encoding).
2. The peak was read at tree death after the kill; a poller that hangs with its subject is the
   same instrumentation story as the first three attempts, this time with the number captured
   before the kill.

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
