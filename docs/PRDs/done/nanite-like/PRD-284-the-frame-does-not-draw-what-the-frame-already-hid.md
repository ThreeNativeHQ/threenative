---
prd_contract: v1
---

# PRD-284 — the frame does not draw what the frame already hid

**Status: DECLINED on the measured headroom — 2026-08-30. Phase 4 of the
[virtual geometry batch](./README.md). This phase declines alone and the batch stays open.**

**The number.** After PRD-282, the quarry's `virtual` arm costs **1.28 ms of GPU time** per frame at
1080p on browser WebGPU, out of a 16.7 ms budget. Occlusion culling can win at most that whole
1.28 ms and realistically a fraction of it, against a depth pyramid and a second submission inside
three.js's render path — the largest unknown in the batch by this PRD's own §2. On native the arm's
problem is not overdraw at all: it is 89 draws and a 649.6 ms arrival hitch
([PRD-283's file](../../../verification/prd-283-native-and-the-kernel-2026-08-30.md)), neither of which
occlusion touches.

**§2's open question is left open, honestly.** How much of three.js's WebGPU renderer exposes a
depth pyramid and a second in-frame submission without a fork was *not* investigated, because the
phase never opened. AC4 asks this PRD to name the missing API if it declines; it cannot, and says so
rather than inventing one. Reopening this needs a scene where the cut is still expensive after
PRD-282 — a deeper bowl, a denser interior, or a resolution where fragments dominate again.

**Goal: a cluster behind the quarry wall is not drawn, decided on the GPU, without a round trip and
without a frame of lag that a walking camera can see.**

**Complexity:** +2 a depth pyramid and a second pass inside three.js's render path, +1 the
re-projection correctness that makes two-pass occlusion honest = **3 → MEDIUM mode**, with the
largest unknown in the batch: how much of three.js's pipeline this can reach without owning it.

## 1. Why occlusion is a separate phase and comes late

The quarry is exactly the scene where it pays — a bowl whose far wall hides most of its own
geometry — and exactly the scene that would make an earlier phase look better than it is. Measuring
LOD selection and occlusion together produces one number that neither technique earned.

The standard shape, and the one every mined source uses: draw what was visible last frame, build a
hierarchical depth buffer from that, test everything else against it, draw what passed. Re-projected
last-frame depth is why this does not lag: a cluster that becomes visible this frame is tested
against a depth buffer that already knows the camera moved.

**The false-negative is the failure that matters.** A cluster wrongly culled is a hole in the world,
and on a walking camera it is a hole that appears and disappears. The test is not "fewer clusters
drawn" — it is "the same pixels".

## 2. The open question

Two-pass occlusion needs a depth pyramid built from the frame's own depth, and a second submission
inside the same frame. How much of that three.js's WebGPU renderer exposes without a fork is
unknown at filing, and finding out is the first task. Owning a copy of the render loop to get it is
a decline: the game's material must keep drawing through the ordinary path.

## 3. Acceptance criteria

- [ ] **AC1 — the same pixels.** With occlusion on and off, the quarry route renders within a stated
      per-frame pixel difference on every frame. A single frame with a hole fails.
- [ ] **AC2 — red-green, the re-projection.** Removing the camera re-projection from the depth
      pyramid lookup fails AC1 on the frames where the camera turns, and the failing frame index and
      difference are pasted.
- [ ] **AC3 — it pays.** Clusters drawn and `render.p50` on the quarry, with and without, on browser
      WebGPU and packed desktop native. If it does not pay on the route, it does not ship.
- [ ] **AC4 — no fork.** The depth pyramid and second pass are built through three.js's public
      surface, or this PRD declines and says which API was missing.
