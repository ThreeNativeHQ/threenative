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
- [x] `pnpm bench:scoreboard` runs the ladder rows after the cube rows (3 alternating runs per engine) and the report shows them, with R5 first as FPS. proof: `engine-load-test-monitor.spec.ts` covers the ladder rows and the R5 headline; screenshot. Result 2026-09-29: run `prd464b-0928-2122` produced 18 pilot JSONs (3 alternating runs per engine, R1–R4 at 1280x720, R5 at 1920x1080) and `progress.html` opens on the R5 headline in FPS with the ladder beneath it; the monitor spec (148 tests across the two specs) passes. Screenshot taken from that `progress.html`.

### Phase 2: Measure and explain

- [x] Quiet-machine run (1-minute load below 10 before every run) of the full scoreboard, including the ladder. proof: the scoreboard JSONs and the report banner. Result 2026-09-29: scoreboard run `prd464b-0928-2122` on the tree at `4b2c7a7e0`; the 1-minute load, sampled every 15 s across the run, stayed between 6.7 and 9.2 (start 9.6 with a 5-minute average of 10.4, so the margin was thin). Full-scene row: ThreeNative 9.18 ms (108.9 fps) vs Godot 6.03 ms (165.8 fps), Godot 1.5x. Ladder: R1 tie, R2 TN 1.5x, R3 TN 1.2x, R4 Godot 1.2x, R5 Godot 1.5x. Not run: the Pixel and the other three targets, and the run records no `--source-sha` (`scoreboard.sh` does not pass one).
- [x] For each rung where Godot wins, name the TN cost with a profile (JS render, projection, native replay, GPU). proof: a short attribution note per losing rung in this PRD. Result 2026-09-29, R4 and R5 are the only ladder rungs Godot wins. **R5 steady state** (1920x1080, 1,200 frames, `TN_HOST_GAP` 300-frame window): period p50 7.24 ms = JS animation callbacks 4.57 ms + native frame replay 1.18 ms + present 0.16 ms + about 1.3 ms unmetered; GPU drain 0, so the GPU is not the limit. The callbacks are the harness's `stepMs` (4.1 ms, of which the projection's `reconcile` is `collapseMs` 2.8 ms) plus the three.js render encode. **R4** by the same harness split: frame 7.4 ms = step 3.7 (projection 2.4) + render and present 3.7. Attribution: the projection reconcile (2.4–2.8 ms, JS) is the largest single cost, and the R5 gap to Godot is 3.2 ms; native replay is about 1.2 ms and the GPU is not measurable as a cost. R4's 1.0 ms gap (7.15 vs 6.15 ms) is just past the wider run-to-run spread (+/-0.77 ms), so the report calls it a Godot win, but it is a narrow one. Fixes are follow-up PRDs. One ladder-arm bug found on the way and fixed here: R4's post scene pass drew the authored scene (2,437 unbatched draws, 37.5 ms) instead of the projection root (116 draws, about 7 ms).

## Acceptance criteria

- [x] The report opens on "Full scene at 1080p: TN N fps vs Godot M fps", with the ladder beneath it showing where each engine gains or loses. proof: `progress.html` banner plus the monitor spec. Result 2026-09-29: `progress.html` from run `prd464b-0928-2122` opens on "Full scene at 1080p: ThreeNative 108.9 fps vs Godot 165.8 fps" with R1–R5 beneath it and a per-rung verdict; the monitor spec asserts the banner and its position (`engine-load-test-monitor.spec.ts`, passing).

## Decisions

**Lean scope — owner, 2026-09-28.** Out of scope: textured PBR (needs identical assets), phones (a Godot Android export plus the device lane is its own PRD), and further post effects (SSGI, TRAA). Fixes for losing rungs are follow-up PRDs, not this one.
