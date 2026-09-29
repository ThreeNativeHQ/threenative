# PRD-464: A realistic-scene ladder — does a real game frame run faster on ThreeNative or Godot?

**Status:** NOT STARTED
**Date:** 2026-09-28
**Target branch:** `develop`
**Owner request:** the PRD-449 cube scoreboard measures draw submission only. Add the best-value real-game costs, stay lean, and make one step prove a lot.

## The ladder

It is the same scene as `pnpm bench:scoreboard` (the PRD-449 cube scene, `examples/engine-load-test` and `benchmark/godot-load-test`), with 4,096 cubes on each engine's defaults (TN L3, Godot L1). Each rung is a mode flag, and each adds one cost on top of the rung below, identically in both engines:

| Rung | Adds | Why it earns a slot |
| --- | --- | --- |
| R1 Sun | one directional light casting shadows (one shadow map, same size and range in both engines) | shadows re-draw the scene; almost every game has them |
| R2 Lights | 8 moving point lights, no shadows | every real level has local lights |
| R3 Characters | 50 Khronos Fox glTF instances, each playing its run clip at a staggered time | skinning and animation are the per-character CPU/GPU cost |
| R4 Post | tonemapping and bloom at matched settings | most shipped games have them |
| **R5 Full scene at 1920×1080** | R4 at 1080p | **the headline: the closest thing here to a real game frame, reported as FPS** |

The Fox asset is already pinned in `benchmark/engine-load-test/sources.lock.json`. Appearance parity is approximate by design (cost, not look). Each rung asserts in both engines the counts that matter: shadow casters, light count, skinned-mesh count, and post passes present.

## Phases

### Phase 1: Ladder in both engines

- [x] Rungs R1–R5 as mode flags in the TN load test and the Godot load test, reusing the existing scene and placement. proof: headless or short smoke runs on both engines record the rung's asserted counts (casters, lights, skinned meshes, post passes) in the result JSON. Result 2026-09-29: desktop smoke, 256 cubes, all five rungs on both engines under a private Xvfb, asserted counts identical per rung (casters 256→306, lights 0→8, skinned 0→50, post passes 0→1, R5 at 1920x1080), Fox 0.5 m and 1.58% of the viewport in both (TN 0.015826, Godot 0.015826). Smoke only: no timing claimed, machine load was above 10.
- [x] `pnpm bench:scoreboard` runs the ladder rows after the cube rows (3 alternating runs per engine) and the report shows them, with R5 first as FPS. proof: `engine-load-test-monitor.spec.ts` covers the ladder rows and the R5 headline; screenshot. Result 2026-09-29: run `prd464c-0928-2136` produced 18 pilot JSONs (3 alternating runs per engine, R1–R4 at 1280x720, R5 at 1920x1080) and `progress.html` opens on the R5 headline in FPS with the ladder beneath it; the monitor spec (148 tests across the two specs) passes. Screenshot of that report taken headless with Brave (`report-c.png`, not committed).

### Phase 2: Measure and explain

- [x] Quiet-machine run (1-minute load below 10 before every run) of the full scoreboard, including the ladder. proof: the scoreboard JSONs and the report banner. Result 2026-09-29: scoreboard run `prd464c-0928-2136` on the tree at `48ec20cf1`, which includes PRD-462; the 1-minute load, sampled every 15 s across the run, stayed between 4.2 and 7.0 (start 4.2, 5-minute average 5.0). Full-scene row: ThreeNative 9.58 ms (104.4 fps) vs Godot 5.13 ms (195.5 fps), Godot 1.87x. Ladder at 4,096 cubes: R1 tie, R2 TN 1.46x, R3 tie, R4 Godot 1.35x, R5 Godot 1.87x. Cube rows: TN wins 3 (defaults 1.72x, instancing 1.82x, every-colour-differs 1.52x at 4,096), Godot wins 1 (instancing at 1,024, 1.18x), 2 ties. The every-colour row is PRD-462's win confirmed on a quiet machine: the earlier run `prd464b-0928-2122`, taken before `develop` was merged, still had Godot ahead 1.97x there and is superseded. This run's JSONs predate the source-hash fix (the tree is `48ec20cf1`); `scoreboard.sh` now passes `--source-sha` and the runner stamps it on both arms, checked on a 256-cube smoke of each. Not run: the Pixel and the other three targets.
- [x] For each rung where Godot wins, name the TN cost with a profile (JS render, projection, native replay, GPU). proof: a short attribution note per losing rung in this PRD. Result 2026-09-29, R4 and R5 are the only ladder rungs Godot wins. **R5 steady state** (1920x1080, 1,200 frames, `TN_HOST_GAP`, merged tree): period p50 8.96 ms = JS animation callbacks 7.35 ms (p50 over the 300 detail samples) + native frame replay 1.29 ms + present 0.18 ms; GPU drain 0, so the GPU is not the limit. A second profile of the same rung before the merge read period 7.24 ms and callbacks 4.57 ms: the shape is stable, the absolute numbers move with load. The harness's split of R5 (`prd464c-0928-2136`, run 2) is frame 9.58 ms = step 4.76 (projection `reconcile` = `collapseMs` 3.15) + render and present 4.8; **R4** is frame 6.88 = step 3.29 (projection 2.25) + render and present 3.6. Attribution: the projection reconcile (2.3–3.2 ms, JS) is the largest single cost and Godot has no equivalent; against a 4.45 ms R5 gap and a 1.75 ms R4 gap (well past the +/-0.67 ms spread) it accounts for most of both. Native replay is about 1.3 ms and the GPU is not a measurable cost. Fixes are follow-up PRDs. One ladder-arm bug found on the way and fixed here: R4's post scene pass drew the authored scene (2,437 unbatched draws, 37.5 ms) instead of the projection root (116 draws, about 7 ms).

## Acceptance criteria

- [x] The report opens on "Full scene at 1080p: TN N fps vs Godot M fps", with the ladder beneath it showing where each engine gains or loses. proof: `progress.html` banner plus the monitor spec. Result 2026-09-29: `progress.html` from run `prd464c-0928-2136` opens on "Full scene at 1080p: ThreeNative 104.4 fps vs Godot 195.5 fps" with R1–R5 beneath it and a per-rung verdict; the monitor spec asserts the banner and its position (`engine-load-test-monitor.spec.ts`, passing).

## Decisions

**Lean scope — owner, 2026-09-28.** Out of scope: textured PBR (needs identical assets), phones (a Godot Android export plus the device lane is its own PRD), and further post effects (SSGI, TRAA). Fixes for losing rungs are follow-up PRDs, not this one.
