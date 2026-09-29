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
- [ ] `pnpm bench:scoreboard` runs the ladder rows after the cube rows (3 alternating runs per engine) and the report shows them, with R5 first as FPS. proof: `engine-load-test-monitor.spec.ts` covers the ladder rows and the R5 headline; screenshot.

### Phase 2: Measure and explain

- [ ] Quiet-machine run (1-minute load below 10 before every run) of the full scoreboard, including the ladder. proof: the scoreboard JSONs and the report banner.
- [ ] For each rung where Godot wins, name the TN cost with a profile (JS render, projection, native replay, GPU). proof: a short attribution note per losing rung in this PRD.

## Acceptance criteria

- [ ] The report opens on "Full scene at 1080p: TN N fps vs Godot M fps", with the ladder beneath it showing where each engine gains or loses. proof: `progress.html` banner plus the monitor spec.

## Decisions

**Lean scope — owner, 2026-09-28.** Out of scope: textured PBR (needs identical assets), phones (a Godot Android export plus the device lane is its own PRD), and further post effects (SSGI, TRAA). Fixes for losing rungs are follow-up PRDs, not this one.
