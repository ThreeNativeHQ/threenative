# PRD-573 — The performance bar is a scorecard on named scenes

**Status:** NOT STARTED
**Priority:** P1 — no command reports frame, load and memory together for the native and three.js pages, so the epic has no bar to pass (Phases 1–2 open).
**Complexity:** 3 (LOW) — 1–5 tooling files (+1), memory and host-load readings are new report fields (+2); risk override: none
**Owner:** João
**Depends on:** None
**Estimate:** Phase 1 ≈ 6 h; Phase 2 ≈ 3 h of runs. No box here is a quick win: this PRD measures and changes no frame.

## Context

The epic goal is a production-engine frame cost and load time on native, and the best on browser
WebGPU. No Unreal binary runs on this machine, so the bar must be absolute numbers and same-run
ratios on named scenes. Today the instruments exist, but each reports a different part:

- `pnpm profile:wasm-page` (`scripts/profile-wasm-page.ts` on `origin/feat/native-engine`) runs a
  subject page and a control page in one run. Its flags are `--calls`, `--gpu-calls`, `--gpu-time`,
  `--gpu-passes`, `--cpu-work`, `--load`, `--json` and `--allow-software`. It reports no memory.
- `perf` in `packages/playtest/src/runner/perf.ts` reads `--file`, `--executable` or
  `--logcat <serial>`, and reports gpuMs, draws and triangles per pass. It reports no memory.
- `pnpm bench:engines` runs engine arms (`current`, `native`, `native-v8`, `native-cpp`,
  `native-aot`; web `current`, `wasm-js`, `wasm-perry`) on workloads (`heterogeneous`,
  `skinned-crowd`, `holdout`) and Godot arms (`godot-web`, `godot-desktop`, `godot-android`).
- [PRD-222](../performance/critical/PRD-222-performance-targets-per-platform.md) sets frame-rate
  floors per platform. [PRD-533](../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md)
  owns the qualification gate. This PRD adds the scorecard that both read, and does not move their
  thresholds.

Midway's baseline from the profile that opened this epic is in the [epic README](./README.md).
No reading records memory or host load.

## Solution

1. **One scorecard, two harnesses.** `profile:wasm-page` gains `--memory`: Wasm linear memory bytes
   (`WebAssembly.Memory.buffer.byteLength`), JS heap used (CDP `Runtime.getHeapUsage`), and the
   engine's GPU buffer and texture bytes from its own allocation counter, for subject and control.
   `perf --executable` gains peak process RSS (read from `/proc/<pid>/status` `VmHWM` on Linux and
   the matching call on Android through `--logcat`).
2. **Host load on every report.** Each report carries the one-minute load average and the core
   count. A run with load above half the core count marks its absolute numbers `invalid-absolute`.
   Its same-run ratios stay valid.
3. **Named scenes.** Midway Open Pacific (sandbox game in its own repository) on web and, when it
   runs there, native desktop. The `heterogeneous` and `skinned-crowd` workloads of
   `bench:engines` on native desktop with the `godot-desktop` arm as the outside comparator.
4. **The proposed bar** (owner decision, see `## Blocked on`): steady-state CPU busy per frame at
   most one third of the three.js control on Midway web (today 1/2.32); `enter` and `ready` at most
   0.5x of the control (today 0.96–1.09x and 0.73–1.05x); native desktop frame p50 on
   `heterogeneous` no slower than `godot-desktop` (unverified today); Android floors from PRD-222.

Unreal reference for what a scorecard reads (design only): per-pass mesh draw command counts in
`UE 5.8.3: Engine/Source/Runtime/Engine/Public/MeshDrawCommandStatsDefines.h`.

## Execution Phases

#### Phase 1: The scorecard reports memory and host load
**Status:** NOT STARTED
**Files:** `scripts/profile-wasm-page.ts`, `packages/playtest/src/runner/perf.ts`, their specs under `scripts/__tests__/` and `packages/playtest/__tests__/`
- [ ] `profile:wasm-page --memory` reports Wasm memory, JS heap and engine GPU bytes for subject and control, and fails closed when a reading is missing. proof: a red-green case in the profile-wasm-page spec, then `pnpm profile:wasm-page -- --url <native Midway> --control <three.js Midway> --memory --json` with every field non-zero on both pages
- [ ] `perf --executable` reports peak RSS for the native desktop player. proof: a red-green case in `packages/playtest/__tests__/perf.spec.ts`, then `node packages/playtest/dist/runner/cli.js perf --executable <native player> --target desktop --text` printing a non-zero peak RSS
- [ ] Every report carries load average and core count, and marks absolutes `invalid-absolute` above half the core count. proof: a red-green case in each spec with a stubbed load reading

#### Phase 2: The baseline is recorded
**Status:** NOT STARTED
**Files:** `docs/verification/runtime-perf-state.md` (the owner's in-place exemption for runtime performance findings)
- [ ] Midway web scorecard (CPU busy, frame p50, first frame, `enter`, `ready`, memory, engine calls and WebGPU calls per frame) recorded as subject/control ratios with load average. proof: `pnpm profile:wasm-page -- --url <native Midway> --control <three.js Midway> --cpu-work --gpu-calls --load --memory --json`
- [ ] Native desktop `heterogeneous` and `skinned-crowd` recorded against `godot-desktop` and `current` in one invocation. proof: `pnpm bench:engines -- --arms current,native --workloads heterogeneous,skinned-crowd` and `pnpm bench:engines -- --arm godot-desktop` in the same load window, load average recorded

## Blocked on

- The bar numbers in Solution 4 are a proposal. João sets or changes them; the decision goes under `## Decisions`.
- The Android column needs the Pixel 8 attached (the emulator cannot hold a performance claim). Unblocked when João attaches the device.
- Midway on the native desktop player is unverified: it may need engine API that is not there yet (PRD-530 Phase 4 lists three check scripts that need missing engine API). The desktop Midway column waits for that.
