# PRD-528 — Framework loop, Rapier sync, input and services (N15)

**Status:** IN PROGRESS
**Complexity:** 4 — the frame contract, physics sync and platform services all move under native ownership
**Owner:** João
**Work package:** N15 — [native-engine batch](../../native-engine/README.md)
**Depends on:** [PRD-508 (N06)](PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md), [N11 — native animation](../../native-engine/N11-native-animation/README.md), [PRD-499 (N02)](../../native-engine/PRD-499-n02-the-host-links-without-a-js-engine.md); starts only after [PRD-534 (CP1)](../../native-engine/PRD-534-cp1-the-native-engine-earns-the-port.md) passes

## Context

§12 defines the engine-controlled frame: platform input, fixed-step simulation and compiled game
callbacks, events, transforms and animation, bounded streaming admission, a consistent render
snapshot, passes, present, telemetry. Today the loop is TypeScript (`packages/core/src/loop.ts`,
`packages/core/src/game.ts`, `packages/core/src/input.ts`, `packages/core/src/audio.ts`). Physics is
already native Rapier, reached from TS through `packages/physics/src/native/host.ts` and
`packages/runtime-native/src/physics/native_bindings.cpp`; §11.3 keeps it and forbids a second physics
library. Platform input and lifecycle already exist in `packages/runtime-native/src/platform/`.

## Solution

1. Proposed `packages/runtime-native/src/engine/world/loop/` runs the §12 frame. Tick ids, render ids
   and presented-frame ids are tracked separately (§6.4); multiple renders in one tick see the
   mutations between them.
2. Explicit public calls still resolve synchronously (§12): a matrix query or `mixer.update()`
   mid-tick is not deferred, and engine scheduling never evaluates an explicitly updated mixer again.
3. Rapier is stepped from the native loop at the existing fixed step, with the same interpolation and
   the same contact/collision event ordering as `loop.ts` today; body transforms write into native
   scene state with no TS round trip.
4. Errors carry a stable code, subsystem, source location, handle identity and recovery class (§12).
   Async work can be cancelled or abandoned without freeing in-use resources, and no completion
   callback runs after its world is destroyed.
5. Input, audio and the other services the TS loop exposes are bound through N03; WebView UI stays
   optional and outside the strict claim (§11.4).
6. Rollback: the legacy backend keeps `loop.ts`.

## Out of scope

- Streaming admission internals ([N13](../../native-engine/N13-native-streaming-and-world/README.md)).
- Playtest control of the loop ([PRD-529](PRD-529-n16-native-playtest-inspection-telemetry.md)).

## Execution Phases

#### Phase 1: Frame contract
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/world/loop/`, `packages/runtime-native/tests/native-engine/loop_*.cpp`
- [x] Fixed-step count and interpolation alpha match `loop.ts` for the same recorded frame times. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_loop_fixed_step` against fixtures from `pnpm exec vitest run packages/core/__tests__/loop.spec.ts` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact: 8 recorded runs, 836 frames, every update count, tick and alpha bit equal. `FixedStepClock` (`src/engine/world/loop/fixed_step.{h,cpp}`) ports `#advanceSimulation` operation for operation (`Number.EPSILON`, `Math.max` with its NaN rule, the clamp and its reset to zero). `loop.ts` had no alpha, so `FixedStepLoop` gained `interpolationAlpha` (the banked accumulator over `step`) with a `loop.spec.ts` case. The table comes from `FixedStepLoop` itself, driven through its `requestFrame` seam (`tests/native-engine/loop/loop-reference.ts`): 60, 144 and 30 Hz at 1/60, 60 Hz at 1/120, LCG jitter, a 500 ms stall, a clock that repeats and runs backwards, and `maxSteps` 1; `native_engine_loop_reference_current` fails on a stale table. The held and frozen branches are not ported. Red controls: without `+ DBL_EPSILON` 350 of 836 frames differ; without the reset to zero the stall frames from 61 on differ
- [x] Two renders in one tick get distinct render ids and the second sees a mutation made between them. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_loop_render_ids` — 2026-10-05: green on Dawn, ASan and wgpu. One `FixedStepClock` tick, then two headless renders of a white cube with a move off-screen between them: render ids 1 and 2, tick id unchanged, centre pixel (255,255,255) then (0,0,0)
- [x] A cancelled async load frees nothing still in use and no callback fires after world destruction. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_loop_async_cancel` — 2026-10-05: green on Dawn, ASan and wgpu (`native_engine_loop_async_cancel` with `native_engine_admission_cancel`): a world destroyed while its load is still reading runs none of that load's callbacks and ends with 0 live GPU handles; the cancel case shows nothing in use is freed early. Red control: a queue that accepts and drains after destroy runs the callback

#### Phase 2: Rapier sync
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/world/physics_sync.cpp`
- [x] Body transforms after N steps match the TS-driven path for the same scene. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_rapier_sync` — 2026-10-05: green on the Dawn lane (the ASan and wgpu builds carry no native physics). `PhysicsSync` (`src/engine/world/physics_sync.{h,cpp}`) owns a native Rapier world through the existing `tn_physics_*` ABI, is stepped by the engine's `FixedStepClock`, and writes each body's translation and rotation into native `Object3D`s with no TS round trip. Reference: `physics-sync-reference.ts` runs the real `packages/physics` simulation in node (the TS-driven path; WASM Rapier 0.19.3, asserted against the scenario's pin) over the shared `physics-parity.scenario.json` (180 steps). "Match" is the repository's documented physics parity, `native/physics/tests/parity.rs`: 0.02 per axis, 0.05 distance, discrete state exact, because the native side is Rust Rapier 0.30.0 and neither enables enhanced determinism. Measured over 6 checkpoints and 38 body records: 0 error (free-fall and resting states agree to the bit). Red controls: transforms written one step late, max axis error 1.275; the fixed step doubled, 0.823.
- [x] Contact and collision events arrive in the same order as the TS-driven path. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_rapier_events` — 2026-10-05: green on the Dawn lane (`native_engine_rapier_events`): the 3 collision events of the scenario arrive natively in the TS path's set and order (`1-5-1, 1-2-1, 0-1-1`), drained as Rapier reports them. Red control: the delivered sequence reversed, fails. Contact manifolds are outside the documented parity contract and are not compared.

#### Phase 3: Input and services without a JS core
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/services/`
- [x] Injected input reaches a game callback in the same tick on the desktop native-engine player. proof: `node packages/playtest/dist/runner/cli.js native-engine-input.playtest.json --target desktop` — 2026-10-06: green, run as `node packages/playtest/dist/runner/cli.js packages/runtime-native/tests/native-engine/playtests/native-engine-input.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player`. The endpoint stamps each queued input with the tick it is for; the C++ game's per-tick `update(dt)` records the tick it first saw it in (`sample.resources.input`): injected for tick 5, seen in tick 5, and the player moved 0.8. The binary inspects JS-free. Red control: input delivered one tick late, seen in tick 6 and the scenario fails.
- [x] The same input scenario passes on the Android emulator. proof: `node packages/playtest/dist/runner/cli.js native-engine-input.playtest.json --target android` — 2026-10-06: green on the Android emulator: `node packages/playtest/dist/runner/cli.js packages/runtime-native/tests/native-engine/playtests/native-engine-input.playtest.json --target android --native-engine --device emulator-5554 --package com.threenative.nativeengine --activity .NativeEngineActivity` passes.

## Decisions

- No new physics library; Rapier stays (§2.3, §11.3).
- Floating-point and GPU determinism are out of scope; deterministic scheduling and RNG are not a determinism promise (§7.3).
