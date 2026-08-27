# PRD-226 arm A2 — null backend: harness ready, **not measured**

**Date:** 2026-08-27. **Verdict: NOT MEASURED.** The arm is built, smoke-tested and staged; the
machine never went quiet enough to record a number, and this lane fails closed rather than publish
one taken under load. Everything below is what the next lane needs to finish it in one command.

## What the arm is

`TN_ABLATE_BACKEND` (landed `dfa05228`, fixed `a468986c`) no-ops the hot backend command entry
points — render-pass `setPipeline`/`setBindGroup`/`setVertexBuffer`/`setIndexBuffer`/`draw`/
`drawIndexed`/`setViewport`/`setScissorRect` and `wgpuQueueWriteBuffer` — through a variadic sink
that still evaluates every argument. JavaScript, the trampoline, wrapper creation and argument
parsing run exactly as at HEAD. `begin`/`end`/`submit` and all resource creation are untouched.

So the cut is:

```
T0 − A2  =  backend command recording + the GPU work those commands cause
A2       =  everything on the JavaScript and bridge side
```

That is the fork PRD-226 exists to resolve, and it is the first measurement in this whole effort
that can name the owner rather than infer it.

## Staged and ready

| Arm | sha256 (first 32) | Build |
| --- | --- | --- |
| A0 control | `0a1fc92c5ddad9e5e748f488d56fe46f` | `build/tn-linux-wgpu`, HEAD, unprofiled, `TN_ABLATE_BACKEND=OFF` |
| A2 null backend | `25a7e09314f3e7d58b0ab92710e7d9bd` | same dir, same HEAD, `TN_ABLATE_BACKEND=ON` |

Both binaries are copied to the session scratchpad as `mystral-a0` / `mystral-a2`; the runner is
`a2-ladder.sh` (6 runs per arm, interleaved, `:0`, 900 frames, load stamped per run, aborts if the
1-minute load never falls below 3.0 within 45 minutes). The parser applies the F15 warm-up rule —
discard the first two whole runs, then window 1 of each remaining run.

**Liveness proven:** the fixed arm runs 300 frames to exit 0 with no panic and produces a blank
screenshot. Blank is this arm's *expected* output — the draws are gone by construction — so the
screenshot proves the process lived and presented, never that the picture is right. An ablation arm
is never a visual gate.

## Why nothing is published

Three attempts, none admissible:

| Attempt | Machine state | Outcome |
| --- | --- | --- |
| 11:09 | load 2.6 → 8.2 | A2 arm **aborted on every run** — the mis-wiring below |
| 11:22 | load 8.2 → 19.0 | Both arms completed, **discarded**: the A0 arm read 13.34 ms against 11.36 ms measured quiet an hour earlier, so the load drift is larger than the effect |
| 11:36 | load 23.4 | Runs hit the 400 s timeout (`exit=124`) without finishing 900 frames |

The load is a sibling agent lane in `.claude/worktrees/`: a full `pnpm build` (tsup at 216% CPU),
`pnpm -r run test`, and a `rustc` dependency build, with `kswapd0` active — the box is swapping, and
swap noise is worse for a frame timer than CPU contention alone.

**The discarded pair, recorded so it is not re-derived and not mistaken for a result:** A0
`render.p50` 13.34 ms against A2 11.14 ms, which would put backend+GPU at ~2.2 ms of a 13.3 ms frame
and leave ~83% on the JavaScript and bridge side. **That direction is plausible and unproven.** It
is consistent with F14 (the binding-install tax is ~0.3 ms) and with A1 (the backend is not the
owner), which is exactly why it must not be adopted on a contaminated run — a number that agrees
with the current hypothesis is the one most in need of a clean measurement.

## The mis-wired arm, and what it proves about the harness

The first A2 build no-oped `wgpuRenderBundleEncoderSetPipeline` while
`wgpuRenderBundleEncoderDraw` still recorded. wgpu validation rejected the stream:

```
thread '<unnamed>' panicked at src/lib.rs:598:5:
Error in wgpuRenderBundleEncoderFinish: Validation Error
Caused by:
  In a draw command, kind: Draw
    Render pipeline must be set
fatal runtime error: failed to initiate panic, error 5, aborting
```

All five A2 runs died in ~2 s; the A0 arm was unaffected. Fixed at `a468986c` by not ablating render
bundles at all — they cost nothing on this scene (`bundleDrawIndexed` 0, `executeBundles` 0 per
frame), so ablating them bought no signal. **The rule it encodes: an arm removes a complete
recording path or none of it, never half of one.** A subtler half-ablation would have returned a
plausible wrong number instead of crashing, which is the failure the ladder's sum gate exists to
catch.

## To finish this arm

1. Wait for the sibling lane's build and test sweep to end, or run on a machine it is not using.
2. `sh a2-ladder.sh <scratchpad>` — it self-gates on load and aborts rather than measuring dirty.
3. Publish `T0 − A2` and `A2` in PRD-226's budget table. If A2 lands near 11 ms against a quiet A0
   of ~11.4 ms, the backend term is **under 0.5 ms** and the entire frame is JavaScript and bridge;
   if it lands materially lower, the backend term is real and A4 must confirm it independently.
