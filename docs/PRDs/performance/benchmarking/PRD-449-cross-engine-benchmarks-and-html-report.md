# PRD-449: ThreeNative vs Godot — one lean benchmark, one scoreboard

**Status:** PARTIAL — scoreboard and first TN-vs-Godot pilots landed; repeated runs, the can't-batch row and the TN fixes remain.
**Date:** 2026-09-25 (scope cut 2026-09-27)
**Target branch:** `develop`
**Owner request:** show clearly whether ThreeNative beats Godot, where it loses, and fix TN where it loses.

## Decisions

**Scope cut — owner, 2026-09-27.**

The original PRD planned six benchmark families (Bevy cubes, plain-Three meshes, foxes, Godot culling, Godot lights, City), browser and native arms, a seven-block publication protocol, CSV, checksummed bundles and clean-directory reproduction. After a day it stood at 3/48 boxes. The owner cut it to the work that answers the question. The full original text is in git: `git show 42de4feb1:docs/PRDs/performance/benchmarking/PRD-449-cross-engine-benchmarks-and-html-report.md`.

**Kept:** one scene (the existing `examples/engine-load-test` cube scene and its Godot twin), native desktop on one physical machine (RTX 2080, 1280×720, uncapped), and apples-to-apples rows only. Each row is a mode of the same scene, so a new row is a flag rather than a new project.

**Cut, not deferred:** Bevy, plain Three.js, the browser arms, Godot web, foxes/skinning, City, the Godot upstream culling/lights ports, the seven-block protocol, second-session stability, slowdown sensitivity, CSV, bundle checksums, clean-directory reproduction, and print/keyboard report checks. Any of these returns only as its own PRD with a named question.

## The experiment

| Row | TN | Godot | Question it answers |
| --- | --- | --- | --- |
| R1 Same scene, shipped defaults | L3 (default projection batches) | L1 (auto-batches) | Does a naive game run faster on TN? |
| R2 Explicit instancing | L2 | L2 | Is TN's instanced path faster? |
| R3 Can't batch | unique material per cube, defaults on | same | What is TN's per-draw cost when no engine can batch? |

Each row runs at 1,024 and 4,096 cubes. Protocol: 40 warm-up frames, 120 measured frames, and 3 alternating runs per arm (TN, Godot, TN, Godot…). A row is a **win** only when the gap between the medians of the run p50s exceeds the larger arm's run-to-run spread; otherwise it is a **tie**. Never pair TN-with-an-optimization-off against Godot-with-it-on: that run is TN profiling data, not a row.

## Phases

### Phase 1: Already landed

- [x] Pin Godot 4.7.1 (editor and `template_release`, commit `a13da4feb`, SHA-256-verified against the official `SHA512-SUMS.txt`) under ignored `artifacts/engine-load-test/prd-449/`. proof: both binaries ran the upstream benchmark CLI to exit 0; full hashes are in the original PRD text (git link above).
- [x] v2 run-record contract and immutable store (`scripts/engine-load-test/campaign-report.ts`, `campaign-store.ts`). proof: `campaign-report.spec.ts` 13 green, `campaign-store.spec.ts` 7 green, legacy `engine-load-test.spec.ts` 102 green.
- [x] Offline dashboard `artifacts/engine-load-test/prd-449/progress.html` (`pnpm bench:engines:monitor`) opening on the TN-vs-Godot scoreboard: winner banner, one pill and one plain sentence per row, p50 bars, "Where TN loses", raw-JSON links, and caveats collapsed. proof: commits `f2fb9837c`, `f5639d2ac`; `engine-load-test-monitor.spec.ts` 12/12; first screen inspected via Playwright screenshot.

### Phase 2: One command, three fair rows, repeated

- [ ] Add R3 as a unique-material mode of the existing scene in both the TN and Godot adapters (one flag each, same placement hash). proof: one TN and one Godot R3 run at 4,096 with matching placement hash and per-cube draw counts.
- [ ] One command runs R1–R3 × {1,024, 4,096} × 3 alternating runs per arm and writes one JSON per run. proof: the command and its run list.
- [ ] Scoreboard reads the repeats: median of run p50s, spread, and win/tie by the rule above. proof: monitor spec case for win vs tie; screenshot.

### Phase 3: Fix TN where it loses, then close

- [ ] Projection reconcile. `SceneRenderProjection.reconcile()` re-walks and re-compares every authored object each frame: 1.66 ms of TN's 3.49 ms R1 frame at 4,096 cubes. Skip the provably unchanged work, keep the "game may change anything" guarantee, and re-run R1. proof: guard specs red-green, a 3+3 run A/B table, and the new R1 row on the scoreboard.
- [ ] Per-draw cost, only if R3 is a TN loss: the native replay costs ~2.3 µs/draw (`replayPackedFrameOpStream`); three.js per-object bookkeeping costs ~8.8 µs/draw and is not TN's to rewrite. proof: R3 A/B before/after, or "not needed: R3 is a TN win or tie".
- [ ] Close: `pnpm typecheck`, `pnpm lint` and the core suite pass, the scoreboard is linked from `docs/verification/runtime-perf-state.md`, and this PRD moves to `docs/PRDs/done/`. proof: exit codes recorded here; the closing commit.
