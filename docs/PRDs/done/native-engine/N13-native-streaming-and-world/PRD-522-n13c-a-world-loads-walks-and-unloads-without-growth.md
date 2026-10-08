# PRD-522 — A world loads, walks and unloads without growth (N13c)

**Status:** PROPOSED
**Complexity:** 3 — integration proof over N13a/N13b; the new work is the fixture, the memory accounting and the failure injection
**Owner:** João
**Work package:** N13 — [native-engine batch](../../../native-engine/README.md) · [N13 umbrella](../../../native-engine/N13-native-streaming-and-world/README.md)
**Depends on:** [PRD-521 (N13b)](PRD-521-n13b-worldcells-and-worldtiles-run-native.md)

## Context

§16 sets N13's acceptance as a world-load/walk/unload fixture with budgets and failure/recovery behaviour. §15.4 requires no sustained memory growth across repeated bounded load/unload cycles, with CPU and GPU allocation accounting published. §15.3 names streaming Machinefall content as a representative workload. Its current baseline (`?scene=map-walk`) is recorded in `docs/verification/runtime-perf-state.md`, measured in a browser under Xvfb, so it must be reproduced on the native host before it counts as a native baseline (§3 R4). Machinefall is a game outside this repository. The fixture runs through the N01 runner ([PRD-498](../../../native-engine/PRD-498-n01-baseline-and-differential-fixture-runner.md)).

## Solution

1. **Fixture.** A scripted camera path loads a streamed world, walks it across cell boundaries and unloads it, on the native desktop host. It runs as a playtest scenario through `packages/playtest --target desktop`, driven over the N16 endpoint.
2. **Budgets.** Per-frame admission time and bytes come from PRD-520 telemetry and are asserted in the scenario.
3. **Memory accounting.** CPU heap, GPU buffer and texture bytes, and live handle counts are sampled after each of N load/unload cycles. The slope over the cycles is asserted to be flat within a documented noise band.
4. **Failure and recovery.** A missing or corrupt cell file is injected. The world reports a coded error for that cell, keeps walking, and the cell is retried or held visibly absent according to its recovery class (§12).

## Out of scope

- Device performance claims against current ThreeNative: [PRD-533 (N20)](../../../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md)

## Execution Phases

#### Phase 1: Load, walk, unload
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/scenarios/native-engine-world-walk.playtest.json`
- [x] The world fixture loads, walks the scripted path and unloads on the native desktop host with no unsupported-feature diagnostic. proof: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-walk.playtest.json --target desktop` — 2026-10-06: green on Dawn (NVIDIA Turing): `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-walk.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player --host-arg world-walk` passes: the native player's `world-walk` game loads the committed world fixture (tests/native-engine/world/walk/, 7.7 KB: heightmap terrain, four cooked cells, lit), walks 24 m over 168 ticks (4 cells visited, 6 loads, 4 evictions, peak 2 resident) and unloads to 0 resident cells, no unsupported-feature diagnostic. A first version rendered a flat unlit terrain and tripped the blank-capture guard; the guard was kept and the world lit.
- [x] Per-frame admission time and bytes stay within the configured allowance for the whole walk. proof: the same scenario's `TN_FRAME_BUDGET` admission assertions — 2026-10-06: green in the same walk run: TN_FRAME_BUDGET max admission 0.60 ms of 4 ms and 144 bytes of 1,024, 0 violations, cumulative over every rendered frame. The fixture's cells are small, so the byte margin is wide. The ten-cycle run (box 35) measured one 6.27 ms reload frame; it is open there.

#### Phase 2: Memory and failure
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/scenarios/native-engine-world-cycles.playtest.json`, `.../native-engine-world-fault.playtest.json`
- [x] Ten load/unload cycles show a flat CPU, GPU and handle-count slope within the documented noise band. proof: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-cycles.playtest.json --target desktop` — 2026-10-06: green on Dawn (NVIDIA Turing): `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-cycles.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player --host-arg world-cycles` passes: CPU slope 11,751 bytes per cycle (allowed ±65,536), GPU bytes and handles flat, admission max 0.19 ms (allowance 4). The first run failed with real growth (+177,505 bytes per cycle, one 6.27 ms admission frame); root causes fixed in the engine: the shared WebGPU Context kept every swapchain texture and view (every native player grew per frame; on wgpu the texture is now released once after present), and the loader created and joined worker threads inside the admission timer on each reload (workers now persist, parked by a reviewed worker-only wait). CPU tests: 300 surface frames retain 0 texture and 0 view references; LeakSanitizer clean with only Dawn's null device/queue suppressed.
- [x] A corrupt cell file produces a coded error, the walk continues, and recovery follows the documented class. proof: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-fault.playtest.json --target desktop` — 2026-10-06: green on Dawn: `node packages/playtest/dist/runner/cli.js packages/runtime-native/scenarios/native-engine-world-fault.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player --host-arg world-fault` passes: the corrupt cell fails its load with a coded error (5 attempts, 4 completed), the walk continues to its end (24 m, 4 evictions) and the documented recovery class applies; budget max 1.2 ms, 0 violations.

## Blocked on

- The native Machinefall map-walk baseline on physical Android hardware needs the device attached (owner).
