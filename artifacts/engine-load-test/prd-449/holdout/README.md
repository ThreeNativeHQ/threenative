# Real-game holdout — the projection perf changes, on the games people actually get

Date: 2026-09-28. Machine: NVIDIA GeForce RTX 2080 (turing, 615.71.09), session display `:0`.
Record: `holdout-2026-09-28.json`. Captures: `*-{b,a}{1,2}-after.png`.

## What was held out

Two engine perf changes in `packages/core` on this branch against `origin/develop`:

1. the projection reconcile skip (`2d856ac19`, `288198dc5`, `projection-stability.ts`)
2. batching meshes whose materials differ only in colour into instanced draws
   (`7f8042277`, `projection-uniform.ts`)

## Lane

Each template's **own shipped** `playtests/performance.playtest.json`, served by the template's own
`pnpm dev`, driven by the repo's playtest CLI with `--browser-recipe webgpu` and
`TN_PLAYTEST_HOST_DISPLAY=1` so the run used the hardware adapter on the session's own display
(`adapter.vendor = nvidia`, never SwiftShader). One step was prepended to each scenario — a
3000-tick `scene-loaded` wait — so the template's own measured steps are steady state rather than
load. The engine's series is a 1024-sample ring holding the run's last 1024 frames; frames before the
world is up render nothing and are dropped.

The runner freezes the game clock, so these are **uncapped fixed-step frame times, not presented
FPS**. Every run passed its template's own frozen budget (racing 330 draws / 105k tris, shooter 420 /
7.2k).

## Templates

Measured renderable counts across all ten kits (`TN_STARTUP_WARMUP` pipeline candidates):
shooter 100, racing 96, action-rpg 81, starter 70. The two heaviest are **shooter** and **racing**.

## Arms

- **BEFORE** — `packages/core/src` at `origin/develop` for exactly the six files the perf commits
  touched (four rewritten, `projection-stability.ts` and `projection-uniform.ts` deleted), core
  rebuilt, fresh `dist` copied into each scaffolded game.
- **AFTER** — `git checkout HEAD -- packages/core/src`, rebuilt, same copy.

The two built `dist`s differ only in the projection code: AFTER adds 15 projection functions and the
`ProjectionStability` class, +627 lines / +24 KB in `index.js`.

## Controls run because the first result looked too clean

- Blocks 1-3 ran BEFORE first, blocks 4-6 ran AFTER first, so block position is separable from arm.
- `bb1`/`bb2`: the BEFORE arm run again after a second rebuild.
- `same1-3`: three back-to-back runs of one identical BEFORE dist, no rebuild.

## Result

| template | p50 before | p50 after | p95 before | p95 after | draws before | draws after |
| --- | --- | --- | --- | --- | --- | --- |
| racing | 7.4 ms | 6.8 ms | 13.0 ms | 11.75 ms | 134-181 | 134-181 |
| shooter | 7.5 ms | 7.8 ms | 13.35 ms | 13.05 ms | 132-184 | 132-184 |

Null controls, same code as BEFORE: racing p50 `7.0, 6.9` (rebuild pair) and `6.8, 8.2, 8.1`
(no rebuild). That spread is wider than the racing arm difference, so the arm difference is inside
the lane's own run-to-run noise.

**The projection declines in every window of every run** — `reasonCode: belowMeshFloor`, "fewer than
200 batchable meshes", 96 and 100 renderables against that 200 floor. On a declining scene the scan
declines, forgets any retained plan and hands the authored scene to the renderer, so neither the
stability skip nor the uniform batching is ever entered. The projection's own whole-run reconcile
total is 1.7-3.9 ms in both arms, and draw calls are identical in all 12 paired runs.

## Visual

`compareCaptures` (`packages/runtime-native/conformance/metrics.mjs`) on the after-frame at the same
tick, 1920x1080. Arm A/B: racing 0.671-0.675 mismatch / ΔE 0.446-0.451; shooter 0.765-0.788 / ΔE
0.603-0.626. The same-arm control pairs land in the same band (racing 0.550 and 0.673, shooter 0.769
and 0.780), so the mismatch is the renderer's own run-to-run temporal post noise, not the change.
Nothing looks different.

## Verdict

**No effect on both templates, and no regression.** Not a gain either: on a real game the projection
never engages, so neither change has anything to do. A real-game holdout cannot confirm these two
changes help; it can only say they do nothing here and break nothing.
