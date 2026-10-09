# PRD-549 — The engine holds 60 fps on a weak GPU

**Status:** NOT STARTED
**Priority:** P1 — Open: on an Intel Iris Xe, Machinefall's main pass takes 43–110 ms and each shadow redraw 150–365 ms, and the engine's own scalers do not bring it near a playable rate.
**Complexity:** 6 (MEDIUM) — three engine control loops (`resolution-scaler.ts`, the adaptive LOD bias in `world-cells.ts`, shadow redraw cost in `render/virtual-shadow.ts`), measured on two machines
**Owner:** João
**Depends on:** PRD-478 (its RTX 2080 numbers and look are the regression floor here). Work rides on PR 473 (owner: one PR).

## Context

The owner, 2026-10-08: "make sure our engine also works reasonably well on crappy machines." The repository rule is that a value the engine can measure where it is used is decided by the engine. On a weak GPU the engine measures a frame 6–13× over its budget and still under-reacts.

Measured on the LAN laptop (Intel Iris Xe, Mesa Vulkan, Chrome WebGPU on its real display), Machinefall `map-walk`, fixed-step capture, this PRD's base build (PR 473, `d2bb5f649`):

| Fact | Value |
| --- | --- |
| Main-pass GPU, scale 1.0, 4× MSAA | 43–110 ms at 3–6 M GPU-selected triangles; 21–24 ms at 1.7 M late in the route |
| Same, resolution 0.5 and MSAA off (game config, variant A) | 17–23 ms at 4.4–5.0 M triangles; 53–55 ms at 6 M — the frame is largely fill-bound (4× MSAA plus alpha-coverage foliage) |
| Resolution scaler (`resolutionScale: "auto"`, target 120) | stays 1.0 through the early route, then 0.85 and 0.72 late in the walk; never touches the sample count |
| Adaptive LOD bias | at its constant cap, 2.5, for most of the walk, main pass still about 25× over its 4.17 ms share |
| One shadow-map redraw (4096², one ±250 m level) | 150–365 ms of GPU each time; each one is a visible hitch |
| RTX 2080, same build | main 2.8–8.6 ms, shadow redraw 4–6 ms; PRD-478 AC-2 passes |

## Solution

Each control loop already measures its own cost; what is missing is the range and speed of its answer.

1. **Resolution scaler: reach the pixels the GPU needs, then the samples.** The scaler already steps up to 4 rungs at once, sized from the GPU deficit, but on the laptop it held 1.0 through the early route. It acts only after startup readiness, on windows that are not compiling, behind an insensitivity guard, and never below the 0.61 desktop floor. Find which gate held it there, and fix that gate. Then add MSAA as the last rung below the floor (4 → 1, alpha coverage falls back to alpha test), restored with the same hysteresis. Variant A ran at 0.5 without MSAA, below anything the scaler can reach today.
2. **LOD bias: a measured ceiling.** Replace the constant 2.5 cap with "keep rising while the main pass is over its share, until every asset is at its coarsest level". The rise rate stays bounded (no pop), and the decay is unchanged.
3. **Shadow redraw cost follows the GPU.** When one level redraw costs more than a share of the frame, halve that level's map resolution (4096 → 2048 → 1024) and coarsen the caster shape (cast with the coarsest level instead of the finest that casts); restore when it fits. Measured per redraw, reported in `TN_FRAME_BUDGET`.

All three are mechanism in `packages/core`; no game sets anything, and an explicit game value (a pinned scale, `castLevels`, a fixed map size) still wins.

## Acceptance Criteria

- [ ] AC-1: on the laptop's Iris Xe, Machinefall `map-walk` walking GPU p95 ≤ 16.7 ms (60 fps), from the exact `overTarget` count against a 60 fps target, with no game config change. proof: 3 live-clock runs on the laptop's display, laptop load and CPU temperature recorded
- [ ] AC-2: no shadow-redraw hitch on the laptop: walking frame p99 ≤ 33 ms. proof: the same runs
- [ ] AC-3: the RTX 2080 is not worse: PRD-478's AC-1/AC-2 numbers hold and 3 blind raters score the 8 poses at or above PRD-478's tip. proof: quiet-desktop runs and sheets on PR 473

## Execution Phases

#### Phase 1: Resolution and samples
**Status:** NOT STARTED
**Files:** `packages/core/src/resolution-scaler.ts`, `packages/core/src/renderer.ts`; `packages/core/__tests__/`

- [ ] The gate that held the scale at 1.0 through the laptop's early route is named and fixed, so a fill-bound deficit reaches the floor within a few windows of readiness. proof: a laptop run's scaler markers, then a red-green `resolution-scaler.spec.ts` on that gate
- [ ] At the floor scale the sample count drops to 1, and comes back with the hysteresis. proof: red-green spec; laptop run shows the drop in `TN_FRAME_BUDGET.surface`

#### Phase 2: LOD ceiling
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`; `packages/core/__tests__/world-gpu-scene.spec.ts`

- [ ] The bias keeps rising past 2.5 while the main pass is over its share, until every asset sits at its coarsest level. proof: red-green spec
- [ ] Laptop main-pass p95 with Phases 1–2. proof: laptop run, numbers recorded here

#### Phase 3: Shadow cost
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `packages/core/src/world-gpu-scene.ts`; `packages/core/__tests__/`

- [ ] A level whose redraw exceeds its share halves its map and coarsens its casters, and restores both when it fits. proof: red-green `virtual-shadow.spec.ts`
- [ ] AC-1/AC-2 runs on the laptop. proof: recorded here
- [ ] AC-3 on the desktop. proof: quiet runs and raters on PR 473

## Blocked on

- AC-3's timing: the RTX 2080 on a quiet desktop (shared with PRD-478's AC-1 loop).
