---
prd_contract: v1
---

# PRD-284 — the frame does not draw what the frame already hid

**Status: NOT STARTED — filed 2026-08-30. Phase 4 of the [virtual geometry batch](./README.md),
blocked on [PRD-283](./PRD-283-the-cut-moves-to-the-gpu-and-native-runs-it.md). Nothing measured.
This phase declines alone: failing it does not close the batch.**

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
