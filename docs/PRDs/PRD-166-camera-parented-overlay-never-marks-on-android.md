---
prd_contract: v1
---

# PRD-166 — One conformance scene never reaches its marker on the Android emulator, and the harness kills it rather than the scene failing

**Status:** PROPOSED, 2026-08-19. Nothing below has executed as a repair. §1 is the observed
result of [PRD-160](./done/PRD-160-android-emulator-lane-repair-and-parity-adjudication.md)'s
adjudicating run and its logcat, quoted verbatim. **No physical-device, iOS, or mobile-readiness
claim is made or licensed by anything in this file.**

**Outcome:** `25-camera-parented-overlay` either completes on the Android emulator like the other
66 rows, or its failure is attributed to a named defect with an owner — so the Android lane can
reach `67 / 0 / 0` on this machine instead of `66 / 1 / 0`.

**Depends on:** nothing. The emulator lane runs unattended here and PRD-160 repaired the guard
that used to hide this row behind `TN_ANDROID_FOCUS_UNKNOWN`.

**Blocks:** the Android lane exiting `0`. It does not block beta row 4's adjudication, which
[PRD-160](./done/PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) settled.

**Complexity: 4 → MEDIUM mode.** One scene, one timeout path, one seam between the harness's
marker wait and the scene's own render loop.

**Blast radius: ~4 files.** `packages/runtime-native/conformance/scenes/shared/camera-parented-overlay.js`,
`packages/runtime-native/conformance/run-conformance.mjs`, and their tests.

---

## 1. What was observed

The 2026-08-19 adjudicating run measured `66 / 0 / 0` passing rows against the browser reference
set with a worst `pixelMismatchRatio` of `0.0038` against a `0.01` tolerance. One row failed:

```text
25-camera-parented-overlay: Android process exited before the conformance marker.
```

It reproduces in isolation — `--only-tests 25-camera-parented-overlay` fails the same way — so it
is deterministic and not a scheduling artifact of the full sweep.

**The process did not crash.** Logcat for the run shows the app starting, evaluating, and
rendering:

```text
I/MystralJS       : [info] TN_NATIVE_SMOKE_READY:webgpu
I/MystralRuntime  : Script executed successfully
I/MystralJS       : [info] TN_NATIVE_SMOKE_FIRST_FRAME
I/ActivityManager : Force stopping com.threenative.game appid=10479 user=0: from pid 14233
I/ActivityManager : Killing 14058:com.threenative.game/u0a479 (adj 0): stop com.threenative.game due to from pid 14233
```

`pid 14233` is the harness. There is no ANR, no `libc` fatal signal, no `AndroidRuntime` exception
and no GPU validation error. The app reached first frame and was then killed from outside because
its conformance marker never arrived inside the timeout.

## 2. Why this scene and not the other 66

The scene loops over several viewports, and each iteration resizes the real renderer, re-derives a
pixel-space layout, renders, and then asserts:

```js
for (const size of overlayRenderPlan(dimensions)) {
  renderer.setSize(size.width, size.height, false);
  layoutInPixelSpace(camera, root, overlay, size);
  renderer.render(scene, camera);
  assertRenderedSize(size, { height: canvas.height, width: canvas.width });
  assertAnchorHeld(size, screenPosition(camera, overlay, size));
}
```

No other conformance scene resizes the swapchain mid-scene. That makes the resize path the first
place to look, and it has form: `docs/verification/tier-1-2026-08-10.md` recorded **this same
scene** failing the *desktop* lane on GPU validation — "mismatched depth and colour attachment
sizes after resize" — and a 2026-08-15 desktop run measured it passing with zero validation errors.
The desktop defect was fixed or became environment-specific; nothing ever re-measured Android.

Three readings are open and this PRD does not pre-judge which:

- **Engine bug.** The Android swapchain resize blocks or never completes, so the loop never exits
  and the marker is never emitted. Home: `packages/runtime-native/`.
- **Scene bug.** `assertRenderedSize` or `assertAnchorHeld` throws inside the loop and the throw is
  swallowed before it can be reported, leaving the harness to time out instead of reading a failure.
  Home: the scene and its assertion helpers.
- **Harness bug.** The marker timeout is simply too short for a multi-resize scene on an emulator,
  and the row is a slow pass being reported as a death. Home: `run-conformance.mjs`.

**Attribution comes before repair.** The third reading is cheap to eliminate first — raise
`TN_ANDROID_TIMEOUT_MS` for one run and see whether the row completes — and doing so decides
between "slow" and "stuck" without touching any code.

## 3. Execution phases

A later phase does not start on an unrun earlier one.

### Phase 0 — Separate slow from stuck

Re-run the single row with a materially larger `TN_ANDROID_TIMEOUT_MS`. If it completes, the defect
is the timeout and Phase 1 is a harness change. If it still dies at the new deadline, the loop is
stuck and Phase 1 is an engine or scene change. Record the observation either way.

### Phase 1 — Attribute the failure to a layer, in writing, before touching code

Name it engine, scene, or harness, with the observation that decides it. Minimum evidence: whether
the scene's loop advances at all on Android — instrument each viewport iteration so the log shows
which resize it reached — and whether a throw inside the loop reaches the harness or is lost.

An assertion that fails and is reported as a death is its own defect, and it is the one that would
hide every future failure in this scene behind the same message.

### Phase 2 — Fix it in the layer Phase 1 named

With a test in the same commit. If it is an engine bug, the fix is in `packages/runtime-native/`
and this row is the proof. If it cannot be decided without a phone, the PRD moves to
`docs/PRDs/BLOCKED/requires-physical-device/` with the attribution attached — that is a result.

### Phase 3 — Re-run the Android lane once

Same lane, same reference set, provenance recorded as PRD-160 recorded it. The row passes or its
failure is a named defect, not a timeout.

## 4. Verification

| # | Check | Expected |
|---|---|---|
| 1 | The row with a raised timeout | completes, or dies again at the new deadline |
| 2 | Phase 1 attribution | names engine, scene, or harness, with the deciding observation |
| 3 | A throw inside the scene loop | reaches the harness as a failure, never as "exited before the marker" |
| 4 | Regression test | fails on the unfixed tree, passes on the fixed one |
| 5 | Android lane re-run | `67 / 0 / 0`, or one named defect that is not a timeout |
| 6 | `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` | green |

## 5. Acceptance criteria

1. Slow and stuck are separated by an executed run, not by reading the scene.
2. The failure is attributed to a layer in writing before any code changes.
3. A failing assertion inside this scene reports as a failure rather than as a process death.
4. The fix ships with a test in the same commit, **or** the PRD is filed under
   `docs/PRDs/BLOCKED/requires-physical-device/` with the attribution attached.
5. No sentence anywhere in the output claims mobile-readiness, arm64, real-driver, or frame-rate
   parity evidence. The emulator proves the emulator.
