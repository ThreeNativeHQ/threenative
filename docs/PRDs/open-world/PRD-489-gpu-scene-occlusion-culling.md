# PRD-489 — Occlusion culling re-tested on the GPU scene

**Status:** PROPOSED
**Complexity:** 5 (MEDIUM) — 1–5 engine files (+1), a depth pyramid is a new mechanism (+2), previous-frame visibility is temporal GPU state (+2); risk override: none
**Owner:** João
**Depends on:** [PRD-478](./PRD-478-open-world-frame-architecture.md) (its Phase 2 moves shadow levels onto GPU-scene keys; occlusion must not reach them), [PRD-477](./PRD-477-worldcells-auto-on-measured-budgets.md) (the pop gate)

## Context

No occlusion culling exists: no depth pyramid, no HZB, nothing in `packages/core/src` reads a previous frame's depth to skip geometry. It was declined twice:
- [PRD-284](../done/nanite-like/PRD-284-the-frame-does-not-draw-what-the-frame-already-hid.md) declined two-pass occlusion on the quarry because the clustered arm's whole GPU cost was 1.28 ms at 1080p; it left open how much of three's WebGPU path a depth pyramid can reach without a fork, and said reopening needs "a scene where the cut is still expensive".
- [WORLD-STREAMING.md](./WORLD-STREAMING.md) lists occlusion culling as out of scope for 2 km worlds.

Machinefall's `?scene=map-walk` may be that scene. [PRD-475](./PRD-475-open-world-120-fps-without-visual-loss.md) records the main pass drawing 16–27 M triangles, with GPU p95 11.3 ms (main 5.6 ms) against an 8.3 ms target. Since PRD-473, the world's scattered props are drawn by the GPU scene in `packages/core/src/world-gpu-scene.ts` (`WorldGpuScene`, on by default for `WorldCells`): a compute kernel (`#buildKernel`, dispatched in `renderer.compute(kernel.cull)`) tests each placement's bounding sphere against six frustum planes, picks a level by distance, and writes the indirect args. That kernel is the place an occlusion test goes. It only removes GPU work, though: a GPU-scene key with zero visible instances still submits its indirect draw, so occlusion saves no per-draw JS, which is the CPU tail [PRD-478](./PRD-478-open-world-frame-architecture.md) is working on.

A newer probe says occlusion is not on the 120 fps critical path today. Source: probe 2026-10-03, scratch, 3 runs, noisy host (develop `4d5e07c98`, RTX 2080, headed WebGPU nvidia/turing, 1280×720, MSAA 4).

| Walking map-walk | Value | Gap to 8.3 ms |
| --- | --- | --- |
| GPU p50 | 7.0 ms | |
| GPU p95 | 10.1 ms (range 5.3–17.9) | 1.8 ms |
| CPU render p95 | 21.2 ms | 12.9 ms |

The main pass draws 10.4 M GPU-scene triangles while walking and 8.7 M standing still, over about 323 main draws. Per-pass GPU p95 is unmeasured: only about 15 of 300 frames carry timestamps. Phase 1 may well conclude that the decline stands.

## Solution

**Phase 1 decides whether this PRD continues.** A `?tnOcclusion=measure` flag builds a depth pyramid from the previous frame's scene-pass depth and runs the test in the cull kernel. It reports what would be culled without culling anything. The PRD continues only if, on map-walk, *(would-cull share of GPU-scene main-pass triangles × measured `gpuMain` p95) − pyramid build p95 ≥ 1.0 ms*. The answer goes under `## Decisions` either way. A decline deletes Phases 2–3 (R4) and adds a line to WORLD-STREAMING.md giving the number.

If it continues:
- **One pass.** The test reprojects each sphere into last frame's pyramid and is conservative: a sphere that touches the near plane, falls off-screen last frame, or arrives on a camera cut (a teleport or a projection change) is kept. A cut skips the test for that frame. A second in-frame pass is added only if the pop gate fails without one.
- **Main camera only.** Shadow levels keep their own light-frustum visibility. A caster hidden from the eye still casts.
- **Mechanism only.** Pyramid, test and reset live in `packages/core`. Nothing here decides a look. With no scene-pass depth (no render chain installed), the cull reports `refused: no scene depth` instead of silently doing nothing.
- **Not covered:** terrain blocks, `ClusteredBatch` and skinned draws stay frustum-only. If Phase 1 shows they hold the triangles, that is a separate PRD.

Risk: three's pass node may not expose last frame's depth to a compute dispatch without a copy. Phase 1 measures that copy's cost as part of the pyramid build.

## Acceptance Criteria

- [ ] AC-1 [local]: map-walk `gpuMain` p95 falls by at least the Phase 1 prediction minus 25%, and walking CPU render p95 does not rise, over 3 interleaved runs on the RTX 2080. proof: `TN_FRAME_BUDGET` walk/idle split from `node packages/playtest/dist/runner/cli.js perf`.
- [ ] AC-2 [local]: no late object, missing shadow or pop that develop does not have. proof: `pnpm visuals:world` same-pose plus walk series, exit 0.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Occlusion test in the GPU-scene cull | `WorldCells` → `WorldGpuScene` cull dispatch (`world-gpu-scene.ts`, `#buildKernel`) | Frustum-only test stays the fallback and the refused path | AC-1, Phase 2 |

## Execution Phases

#### Phase 1: Measure whether occlusion still declines
**Status:** NOT STARTED
**Files:** `packages/core/src/render/depth-pyramid.ts` (new), `packages/core/src/world-gpu-scene.ts`; `packages/core/__tests__/`
- [ ] The CPU reference `cullAndSelect` gains the pyramid test, and a spec pins it: an occluded sphere is rejected, while a near-plane sphere, a sphere off-screen last frame, and any sphere on a camera-cut frame are all kept. proof: red-green `pnpm exec vitest run packages/core/__tests__/world-gpu-scene.spec.ts`.
- [ ] map-walk under `?tnOcclusion=measure` reports would-cull triangles and instances per frame, pyramid build GPU p50/p95 including any depth copy, and `gpuMain` p95, over 3 runs. Each window must carry enough timestamped frames for a p95; the 2026-10-03 probe had about 15 in 300. proof: `TN_FRAME_BUDGET` from `node packages/playtest/dist/runner/cli.js perf` with the flag.

#### Phase 2: Cull on the GPU without popping
**Status:** NOT STARTED
**Files:** `packages/core/src/world-gpu-scene.ts`, `packages/core/src/render/depth-pyramid.ts`, `packages/core/src/render/virtual-shadow.ts`
- [ ] The cull kernel applies the test by default, and the GPU indirect counts match the CPU reference within the existing validation. proof: the `gpuSceneValidate` readback comparison in `world-gpu-scene.spec.ts` plus a map-walk run with `?tnGpuSceneValidate=1`.
- [ ] A caster hidden from the camera still renders into every shadow level. proof: red-green spec counting a hidden caster's instances in the shadow-level draw.
- [ ] A camera cut and a fast turn show no frame with a missing object. proof: `pnpm visuals:world` walk series on map-walk plus a cut pose.

#### Phase 3: Native runs the same cull
**Status:** NOT STARTED
**Files:** `packages/runtime-native/conformance/scenes/shared/gpu-scene-occlusion.js` (new), `packages/runtime-native/conformance/registry.json`
- [ ] A conformance case puts a wall in front of GPU-scene instances: those instances read back as culled and the capture matches the browser reference. proof: `pnpm parity --target desktop --only-tests gpu-scene-occlusion`.
