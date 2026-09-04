# First-use pipeline compilation

**Current action:** reconcile the overlapping warm-up implementation in
[PR #99](https://github.com/ThreeNativeHQ/threenative/pull/99) with the measured native failure in
[PR #98](https://github.com/ThreeNativeHQ/threenative/pull/98) before either merges. PR #99 adds a
second `warmUpScene()` after startup holds, but that is the same path PR #98 measured blocking the
native main thread. Land PR #98's findings after renumbering its compile-walk follow-up from
`PRD-339` to **PRD-349**; keep PR #99's second warm-up off the native path until PRD-349's yield and
off-loop gates pass. Do not open another PRD for the same stall.

`PRD-339` is already assigned to
[automatic exposure](../../AAA-visuals/PRD-339-the-frame-sets-its-own-exposure.md) on `main`.

## The target

| Gate | Required result |
| --- | --- |
| Player wait | Three process-cold Pixel 8 launches, tap to a moving first frame **≤ 8 s median** |
| First present | `TN_STALL_SEGMENTS.pipelineCompile.ms ≤ 500` |
| Compile walk | One real host yield per walked item while launch is held; no 30 s silent window |
| Warm-up | `TN_WARMUP.compiled` covers the first frame's distinct pipelines and `timedOut:false` |
| Relaunch | Second cold launch `pipelineCompile` **≤ 25%** of the first, or the cache is rejected with evidence |

## Related PRDs and records

| Document | Role | Current state |
| --- | --- | --- |
| [PRD-218 — the original Bayview stall](../critical/PRD-218-fps-framework-native-load-fps-heat.md) | Owns the user-visible acceptance: launch ≤ 8 s with live progress | **PARTIAL**; criteria 1–2 remain open |
| [PRD-327 — first-use pipeline compilation leaves the main loop](../critical/PRD-327-first-use-pipeline-compilation-leaves-the-main-loop.md) | Built the native async pipeline entry, warm-up contract and late-compile attribution | Phases 0–2 and 4 implemented; its Pixel 8 acceptance failed in PR #98 |
| [PRD-328 — launch is measured on the engine that ships](../../done/PRD-328-launch-is-measured-on-the-engine-that-ships.md) | Supplies `TN_COLD_START` and the repeatable reader | **DONE**; prerequisite, not more work |
| Compile-walk follow-up in [PR #98](https://github.com/ThreeNativeHQ/threenative/pull/98) | Owns real yielding, moving the walk off the main thread, and persisted pipelines | **PROPOSED**; rename to PRD-349 before merge |
| Startup/warm-up implementation in [PR #99](https://github.com/ThreeNativeHQ/threenative/pull/99) | Adds `startup.hold()`, honest readiness, a post-hold second warm-up and pre-ready scaler gating | **OVERLAPS**; its second warm-up must not run on native before PRD-349 is green |
| [PRD-335 — the JavaScript bundle is not parsed twice](../PRD-335-the-bundle-is-not-parsed-as-source-twice.md) | Separate V8 source-code cache, worth about 54 ms on the smoke bundle | Later work; it does not reduce the 8.2 s GPU pipeline compile |

The canonical measurements live in
[runtime-perf-state.md](../../../verification/runtime-perf-state.md). The priority ledger remains
[performance/critical/README.md](../critical/README.md), and architecture status belongs in
[NATIVE-PERF-BOTTLENECKS.md](../../../architecture/NATIVE-PERF-BOTTLENECKS.md).

## The red that chooses the work

The 2026-09-03 Pixel 8 run in PR #98 measured three separate failures:

```text
without warm-up: first frame 14.4–14.8 s
pipelineCompile: 8.2–8.3 s, 103 calls, unchanged across six launches
with warm-up: approximately 35 s to first frame
whole-scene compileAsync walk: approximately 33 s over 835 renderables
host yields: 1 for 892 items; TN_WARMUP compiled:0, timedOut:true
```

The native async pipeline binding itself passed: work reached the pool, finished and drained after
release. The blocking defect is before that entry point: Three.js walks the whole scene and builds
node graphs synchronously, then its fallback yield waits for a rendered frame that cannot occur
while launch is held. The unchanged second through sixth launches also reject the assumption that
the driver persists enough pipeline state automatically.

## Execute in this order

1. **Reconcile PR #98 and PR #99, then land the evidence.** In PR #98, rename the compile-walk
   document and every reference from PRD-339 to PRD-349. In PR #99, either disable the new
   post-hold `warmUpScene()` on native or stack it after PRD-349. Its desktop/browser success is not
   a native gate: first observe a native red proving the bounded second pass cannot trap launch,
   then require `TN_STARTUP_WARMUP_HELD` to finish or fail open inside its stated budget. Rebase and
   merge the docs-only findings first. Preserve the recorded reds above; they are the baseline for
   every later phase.
2. **Make the yield real.** Trace why Three.js cannot see or complete `scheduler.yield` through
   `packages/runtime-native/src/runtime-scripts/scheduler-yield.js` and the `runtime.cpp` install.
   Red is 1 yield for 892 items; green is one host-pump yield per item while launch is held. If that
   requires a Three.js fork, stop and use the existing object-granularity warm-up instead.
3. **Move the walk off the main-thread critical path.** Prefer the already-available object
   granularity in `packages/core/src/warmup.ts`; otherwise feed backend creation into the Phase 1
   compile pool in `bindings_pipelines.cpp`. Accept only when the walk frees at least 2 ms of main
   thread time and total walk time does not regress by 20% or more. Keep `warmUp` opt-in until this
   gate is green.
4. **Run the physical-device acceptance.** Build one Bayview commit, verify the installed bundle
   and runtime contain the candidate, then run three process-cold launches on the unplugged,
   thermal-`NONE` Pixel 8:

   ```sh
   node packages/runtime-native/scripts/measure-cold-start.mjs \
     --device <serial> --config <bayview>/threenative.config.ts \
     --launches 3 --optimization -O2 \
     --report artifacts/first-use-pipeline/pixel8.json
   ```

   The run is green only when all target-table gates above are present. Also run the same APK with
   `warmUp: false`; it must reproduce the multi-second first-present compile as the negative
   control. Do not claim success from desktop or an emulator.
5. **Persist, observe, and close.** After the walk is off-loop, compare the first launch with a
   second launch using the same bundle and engine build. If `pipelineCompile` is not ≤ 25%, add the
   backend pipeline cache described by PRD-349; reject the cache if it still misses that bar. Make
   a material introduced after first present appear in `TN_FRAME_HITCH.pipelineCompile`, then close
   PRD-327 and PRD-218 criteria 1–2 in the same commit that archives the finished follow-up.

## Boundaries

- [PR #99](https://github.com/ThreeNativeHQ/threenative/pull/99) is part of this chain: its startup
  accounting and held-work seam are useful, and its second warm-up is a consumer of the pipeline
  path. It does **not** move the native whole-scene compile walk off-thread or persist native
  pipelines. Its 25 → 60 fps result is browser steady-state evidence, not native launch evidence.
- PRD-335 caches V8-compiled JavaScript, not WebGPU render pipelines. It follows this work and has
  a much smaller measured ceiling.
- Texture upload, TSL-to-WGSL generation, steady-state GPU frame time and anything that changes
  appearance are separate investigations.
- A default change needs the Pixel 8 acceptance above; a passing unit or desktop contract proves
  mechanism only.

## Done means

PRD-218 criteria 1–2 are checked, PRD-327 is archived, the renamed follow-up is archived, the
critical queue links the final Pixel 8 table, and `runtime-perf-state.md` contains the red and green
launch series plus the cache verdict. Until all five are true, first-use pipeline compilation is
still open.
