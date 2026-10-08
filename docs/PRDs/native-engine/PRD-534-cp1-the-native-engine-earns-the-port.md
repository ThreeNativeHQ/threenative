# PRD-534 — The native engine earns the port (CP1)

**Status:** IN PROGRESS — the three arms report CPU/GPU time on one workload; physical-desktop and Pixel verdict runs are open
**Complexity:** 3 — measurement only, on existing workloads; the verdict can stop the program
**Owner:** João
**Work package:** CP1 — [native-engine batch](README.md)
**Depends on:** [PRD-498 (N01)](PRD-498-n01-baseline-and-differential-fixture-runner.md), [PRD-508 (N06)](../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md), [PRD-514 (N09)](../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md), [PRD-531 (N18)](PRD-531-n18-v8-game-runtime-adapter.md) phases 1–2

## Context

Owner decision 3 ([PRD-497](../done/native-engine/PRD-497-n00-architecture-decision-and-compatibility-inventory.md)): after the native scene graph (N06) and renderer (N09) exist, measure before porting the framework systems (N11–N15), which are most of the work. §15.3 sets the comparison: current optimized ThreeNative, projection and batching included, never vanilla Three.js alone. The decision to keep game code on V8 (decision 2) means the result only counts through the V8 adapter (N18). A C++-driver number alone would hide the crossing cost.

Workloads that already exist: `examples/engine-load-test` (heterogeneous renderables, `skinned-crowd.html`, projection conformance), `examples/native-cpu-load-test`, driven by `pnpm bench:engines` and `pnpm profile:native-cpu`. Skinned content is out of reach until N11, so CP1 uses the static heterogeneous scene only.

## Solution

1. **Arms**, on the same scene, resolution, camera path and presented workload:
   - `current`: today's ThreeNative on the legacy native host.
   - `native-v8`: the native engine with game code on the V8 adapter (the shipping shape).
   - `native-cpp`: the native engine driven by a C++ fixture (the control that isolates crossing cost).
2. **Meters:** CPU time of scene update plus render submission per frame (p50/p95), GPU time, total frame time, and crossings per frame. Cold and warm runs are reported apart.
3. **Verdict rule** (Decisions): the engine hot-path CPU time in `native-v8` must be at most half of `current` on the heterogeneous workload, on desktop and on the Pixel 8. Otherwise N11–N15 stay unstarted and the owner re-plans. When `native-cpp` passes and `native-v8` fails, the cause is crossing cost, and bulk paths (decision 9) are the re-plan.
4. Results go into `docs/verification/runtime-perf-state.md` in place.

## Out of scope

- The full §15.4 gate set across all workloads ([PRD-533 (N20)](PRD-533-n20-platform-qualification-performance-default-promotion.md)).

## Execution Phases

#### Phase 1: Three arms on one workload
**Status:** IN PROGRESS
**Files:** `scripts/engine-load-test/`, `examples/engine-load-test/src/`
- [x] `pnpm bench:engines` runs the heterogeneous workload under `current`, `native-v8` and `native-cpp` with identical presented draws and triangles. proof: `pnpm bench:engines -- --arms current,native-v8,native-cpp --workload heterogeneous` — 2026-10-05: green (`scripts/engine-load-test/cp1.ts`). The three arms draw L4 (unique material per cube) at one object count, size and camera path, and the run fails closed (`TN_BENCH_CP1_WORKLOAD_MISMATCH`) unless every arm submits the same triangles by three's `renderer.info` count; the native renderer now counts its output pass as three does. GPU draw calls differ by design: `current` batches the scene (§15.3 includes batching), so at 4,096 cubes it submits 3 draws and the native engine 4,098, both 49,155 triangles. Functional reading (Xvfb and headless Dawn, not the verdict): hot path p50 `current` 10.26 ms, `native-v8` 23.60 ms (12,290 crossings per frame), `native-cpp` 13.28 ms
- [x] Each arm reports hot-path CPU p50/p95, GPU time, frame time and crossings per frame. proof: the same command's JSON report — 2026-10-05: green (`artifacts/engine-load-test/cp1/cp1-report.json`). Every arm reports hot path p50/p95, GPU time from timestamp queries (the native renderer's scene-to-output pass; three's `trackTimestamp` in `current`, enabled for CP1 only), frame time and crossings per frame; `current` has no C ABI, so its crossings are `null`. Dawn quantizes timestamps to 65.536 µs. Second functional reading at 4,096 cubes (load lower than the first): hot path p50 `current` 3.46 ms, `native-v8` 14.41 ms, `native-cpp` 9.43 ms; GPU 0.131 ms in every arm, so the workload is CPU-bound. The first reading under load average 24–30 was 10.26 / 23.60 / 13.28 ms: absolute numbers move with host load, the ratio stays far from the bar, and the verdict runs need a quiet physical-display host

#### Phase 2: The measurement
**Status:** NOT STARTED
**Files:** `docs/verification/runtime-perf-state.md`
- [x] Desktop result for all three arms, on physical hardware with a real display. proof: `pnpm bench:engines -- --arms current,native-v8,native-cpp --workload heterogeneous --target desktop` — 2026-10-07, Ryzen 9 5900X + NVIDIA RTX 2080, KDE Wayland session, real display (Xwayland `:0`, no Xvfb), CI runners fenced off the benchmark cores: L4 heterogeneous @4096, 1280×720, 600 frames, equal presented work (3 draws, 49,155 triangles per arm). Hot path p50/p95: current (legacy host) 3.09/4.18 ms; native-v8 4.21/4.62 ms with 12,290 ABI crossings per frame; native-cpp 1.01/1.07 ms. GPU p50 0.066 ms in every arm. `current` presented to the display; both native arms render offscreen by the harness's design, so the comparison is the CPU hot path, which excludes presentation. Report `artifacts/engine-load-test/cp1/cp1-report.json`.
- [ ] Pixel 8 result for all three arms. proof: `pnpm bench:engines -- --arms current,native-v8,native-cpp --workload heterogeneous --target android --device <serial>`
  The lane exists (2026-10-08) and each arm has been smoke-run on the Pixel 8 with the phone on its charger (not measurements; the preflight refuses a charging phone, as it must): `native-cpp` and `native-v8` run from `adb shell` as `tn-native-engine-host` built for arm64 (`node packages/runtime-native/scripts/build-native-engine-host-android.mjs`; offscreen on the Mali-G715 Vulkan device, timestamp-query granted), and `current` is the legacy APK built from this checkout (`com.threenative.game`, V8 11.0.226.16 source-built with the 16 KB receipt) with the CP1 bundle. All three present 4096 cubes and 49,155 triangles. Open: the measured run, which needs the phone unplugged (discharging over Wi-Fi ADB, battery at or above 50%, thermal NONE, battery at or below 31.5 C between arms).
- [ ] The verdict, proceed or stop, is written into this PRD and the batch index with both numbers. proof: the two runs above

## Decisions

- The pass bar is the §15.4 hot-path target (about 2× lower CPU), applied early and only to the hot paths that exist at N09. Xvfb and SwiftShader runs are functional checks, not the verdict (§15.3). Owner, 2026-10-04.
- A failed verdict stops N11–N15 but not N19's Wasm build, which is a correctness port, and not N05's spike.
