# PRD-529 — Native playtest, inspection and telemetry (N16)

**Status:** IN PROGRESS
**Complexity:** 3 — new native endpoint behind the existing playtest protocol
**Owner:** João
**Work package:** N16 — [native-engine batch](README.md)
**Depends on:** [PRD-499 (N02)](PRD-499-n02-the-host-links-without-a-js-engine.md), [PRD-500 (N03)](../done/native-engine/PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [PRD-508 (N06)](../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md)

## Context

§11.4 requires native playtest commands, scene inspection, deterministic input injection, telemetry,
screenshots and state snapshots. A Node driver outside the application is fine; a JS mailbox inside
the native-engine player is not. Today the in-game side is JavaScript (`packages/core/src/playtest.ts`) and
the runner speaks the protocol in `packages/playtest/src/protocol.ts`. The native host already has a
debug server (`packages/runtime-native/src/debug/debug_server.cpp`) and a screenshot gate
(`packages/runtime-native/src/screenshot_gate.cpp`).

## Solution

1. Proposed `packages/runtime-native/src/engine/inspect/` implements the existing playtest protocol
   natively: commands, input injection at tick boundaries, scene/component inspection over the native
   object graph, state snapshots, screenshots and telemetry frames.
2. The runner (`packages/playtest`) connects to it unchanged; scenarios written for the web or legacy
   native path run against the native-engine player where the capability exists, and fail closed where it
   does not.
3. Telemetry reports which artifact profile is running (engine profile plus game runtime: V8, browser JS or native AOT, §17),
   so a crash report or a perf frame never confuses the two.
4. Rollback: the legacy native path keeps the JS bridge.

## Out of scope

- Packaging (N17, N20). The perf meters themselves (N20 uses them).

## Execution Phases

#### Phase 1: Protocol endpoint
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/inspect/`, `packages/runtime-native/tests/native-engine/inspect_*.cpp`
- [x] Every protocol message type in `protocol.ts` decodes and gets a defined reply or a named unsupported error. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_inspect_protocol` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm. `Endpoint` (`src/engine/inspect/endpoint.{h,cpp}`) answers the device transport three/device.ts defines: the 11 message types (describe, ready, sample, advance, applySetup, drainEvents, focus, input.keyDown, input.keyUp, input.pointer, input.pointers) read from device.ts itself (`protocol-methods.ts`, so a new method fails `--check`) each answer 26 valid and invalid requests with a result of the protocol shape or an error whose message starts with a named code (`TN_INSPECT_MALFORMED`, `_PAYLOAD_TOO_LARGE`, `_UNKNOWN_METHOD`, `_INVALID_ARGUMENT`, `_UNSUPPORTED` for sample fields, setup resources and frozen entities not carried yet); the id is echoed and malformed or oversized frames are refused by name. It rides on the engine's new JSON reader and writer (`src/engine/foundation/json.h`), which matches JSON.parse, JSON.stringify and Number::toString on 89 texts and 160 numbers. Red control: `focus` unhandled fails
- [x] Input injected for tick N is observed by game code in tick N, not N+1. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_inspect_input_tick` — 2026-10-05: green on the same lanes: input methods queue events (device.ts's key and pointer translation, touch sets diffed into down, move and up) that the host takes at the start of the next tick; after `advance 3`, an `input.keyDown KeyW` is read as `w` by tick 4's game code and by no other tick. Red control: a one-tick delay in the queue (seen at tick 5)

#### Phase 2: Runner drives the native-engine player
**Status:** NOT STARTED
**Files:** `packages/playtest/src/` (target wiring only)
- [x] A scene-inspection scenario passes against the native-engine desktop player with no engine JS loaded. proof: `node packages/playtest/dist/runner/cli.js native-engine-inspect.playtest.json --target desktop` — 2026-10-05: green, run as `node packages/playtest/dist/runner/cli.js packages/runtime-native/tests/native-engine/playtests/native-engine-inspect.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player`. `tn-native-engine-player` (`src/engine/player/`) runs the engine loop in an SDL window, polls the desktop file mailbox into the native `Endpoint` and answers screenshot requests; its built-in C++ game `inspect-demo` moves a named `player` box by input. The scenario inspects `player` and `beacon`, injects input and sees `player` move. `inspect-js-free.mjs` prints `JS_FREE_OK` for the binary. Red control: input applied one tick late, the scenario fails (`TN_PLAYTEST_AXIS_DELTA_ASSERT_FAILED`).
- [x] Screenshot and state-snapshot steps return non-blank, stable results. proof: `node packages/playtest/dist/runner/cli.js native-engine-capture.playtest.json --target desktop` — 2026-10-05: green, run as `node packages/playtest/dist/runner/cli.js packages/runtime-native/tests/native-engine/playtests/native-engine-capture.playtest.json --target desktop --executable packages/runtime-native/build/tn-linux/tn-native-engine-player`: three screenshots (936 distinct colours, luminance σ 0.148) and a state snapshot. Red control: the screenshot answered with a cleared frame fails as `TN_CAPTURE_BLANK`.
- [x] Startup telemetry names the engine profile as native and the game runtime. proof: `node packages/playtest/dist/runner/cli.js native-engine-inspect.playtest.json --target desktop` (asserts the profile field) — 2026-10-05: green in the inspect scenario: `describe` carries `profile: {engine: "native", gameRuntime: "cpp"}`, mirrored into `sample.resources.profile`, which the scenario asserts (no runner path reads a describe field).
- [ ] The inspection scenario passes on the Android emulator. proof: `node packages/playtest/dist/runner/cli.js native-engine-inspect.playtest.json --target android`
