# PRD-449: ThreeNative vs Godot — one lean benchmark, one scoreboard

**Status:** PARTIAL — repeated scoreboard landed (TN 0 wins, Godot 2, ties 4 on a loaded machine); the can't-batch per-draw fix and an idle-machine rerun remain.
**Date:** 2026-09-25 (scope cut 2026-09-27)
**Target branch:** `develop`
**Owner request:** show clearly whether ThreeNative beats Godot, where it loses, and fix TN where it loses.

## Decisions

**No benchmaxxing — owner, 2026-09-27.** A fix is kept only when it also holds on a real game. Each kept fix gets a before/after on a scaffolded template game on the same machine (the gain, or "no effect" stated plainly, and never a regression). Colour-only batching is a first slice toward batching by any numeric material parameter, never the end state. Render bundles are probed as the scene-general per-draw lever.

**R3 fix path — owner, 2026-09-27.** Profiling (`artifacts/engine-load-test/prd-449/tmp/attribution/l4/`) showed the R3 loss is three.js's per-object JS renderer cost (75% of the frame). Unique materials cost only 1.15× a shared one, and nothing is re-created per frame. Micro-patches recover about 10%. The owner chose to extend the projection to batch meshes that differ only by colour; patching three.js is allowed where needed. It is tracked here rather than as a new PRD to keep the lane lean.

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

## Current result (2026-09-28, quiet machine, load average ~5, both TN fixes in)

TN wins 3, ties 2, and Godot wins 1 (p50 medians of 3 alternating runs):

| Row | 1,024 cubes | 4,096 cubes |
| --- | --- | --- |
| Shipped defaults | TN 1.27 vs Godot 1.53 ms, TN 1.2× | TN 2.65 vs 4.23 ms, TN 1.6× |
| Explicit instancing | 1.11 vs 1.16 ms, tie | 1.48 vs 2.94 ms, TN 2.0× |
| Can't batch | 2.56 vs 1.71 ms, tie (TN spread 1.59) | 11.17 vs 5.37 ms, Godot 2.1× (was ~9× before batch-by-uniforms) |

Real-game holdout (`488bf8791`, racing and shooter templates, 6+6 alternating runs): no effect and no regression. Both templates stay below the projection's 200-renderable floor (96–100), so neither fix runs there; draws, triangles and pixels are unchanged within null-control noise. These fixes pay off for scenes with hundreds to thousands of objects and cost small games nothing.

The remaining loss is the projection's per-frame material-change poll: about 5.6 ms of the 8.4 ms collapse at 4,096 distinct materials.

## Phases

### Phase 1: Already landed

- [x] Pin Godot 4.7.1 (editor and `template_release`, commit `a13da4feb`, SHA-256-verified against the official `SHA512-SUMS.txt`) under ignored `artifacts/engine-load-test/prd-449/`. proof: both binaries ran the upstream benchmark CLI to exit 0; full hashes are in the original PRD text (git link above).
- [x] v2 run-record contract and immutable store (`scripts/engine-load-test/campaign-report.ts`, `campaign-store.ts`). proof: `campaign-report.spec.ts` 13 green, `campaign-store.spec.ts` 7 green, legacy `engine-load-test.spec.ts` 102 green.
- [x] Offline dashboard `artifacts/engine-load-test/prd-449/progress.html` (`pnpm bench:engines:monitor`) opening on the TN-vs-Godot scoreboard: winner banner, one pill and one plain sentence per row, p50 bars, "Where TN loses", raw-JSON links, and caveats collapsed. proof: commits `f2fb9837c`, `f5639d2ac`; `engine-load-test-monitor.spec.ts` 12/12; first screen inspected via Playwright screenshot.

### Phase 2: One command, three fair rows, repeated

- [x] Add R3 as a unique-material mode of the existing scene in both the TN and Godot adapters (one flag each, same placement hash). proof: one TN and one Godot R3 run at 4,096 with matching placement hash and per-cube draw counts. Done 2026-09-27: `84c009343`; TN/Godot L4 placement hash `78812d31` (1,024) and `e9a32f01` (4,096) on both sides; draws 604 vs 606 and 2,375 vs 2,379 (frustum-culled per cube, no batching on either side).
- [x] One command runs R1–R3 × {1,024, 4,096} × 3 alternating runs per arm and writes one JSON per run. proof: the command and its run list. Done 2026-09-28: `pnpm bench:scoreboard 2026-09-28` exit 0, six JSONs `pilots/scoreboard-{tn,godot}-r{1,2,3}-2026-09-28.json`.
- [x] Scoreboard reads the repeats: median of run p50s, spread, and win/tie by the rule above. proof: monitor spec case for win vs tie; screenshot. Done 2026-09-27: `8d7bc5785` + newest-tag pickup; `engine-load-test-monitor.spec.ts` 15/15; screenshot inspected.

### Phase 3: Fix TN where it loses, then close

- [x] Projection reconcile. `SceneRenderProjection.reconcile()` re-walks and re-compares every authored object each frame: 1.66 ms of TN's 3.49 ms R1 frame at 4,096 cubes. Skip the provably unchanged work, keep the "game may change anything" guarantee, and re-run R1. proof: guard specs red-green, a 3+3 run A/B table, and the new R1 row on the scoreboard. Done 2026-09-27: guards `c69143921`, fix `2d856ac19` + `288198dc5`, A/B `bd52da0d7`: TN L3 4,096 median p50 10.93 → 6.08 ms (−44%), faster in 6/6 paired blocks, identical draws/triangles/hash. Core suite 1872 pass; the 6 failures (4 `packaging.spec.ts`, `render-projection-pipeline`, `three-shadow-override-cache`) reproduce at `f5639d2ac` without the fix.
- [ ] Batch by uniforms: the projection merges meshes that share geometry and shader but differ only in material colour into its batched draw with per-instance colour, identical pixels, and per-frame colour changes honoured. proof: guard specs red-green, projection-on/off pixel match, a paired R3 A/B plus a scoreboard rerun, and a template-game before/after with no regression.
- [ ] Close: `pnpm typecheck`, `pnpm lint` and the core suite pass, the scoreboard is linked from `docs/verification/runtime-perf-state.md`, and this PRD moves to `docs/PRDs/done/`. proof: exit codes recorded here; the closing commit.
