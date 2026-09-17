# Native compiled frame plans

Status: PARTIAL. Experimental, default off. Transport landed and measured; the recorder is 43–45%
cheaper and the packet 94.8–99.5% smaller on draw-heavy frames, and the device and desktop
measurements below are still open. Base: f8d6da914 (develop synced after #273).

## Goal and boundary

Retain the native packed-frame record layout and send changed record payloads instead of
resending every command. Upstream Three.js remains the renderer. No Object3D mirror, custom
renderer, language/runtime replacement, or per-object native crossing is introduced.

This increment does **not** remove Three.js traversal, sorting, wrapper calls, native resource
validation, or GPU command encoding. A smaller packet is not evidence of a faster game.
Production activation requires equivalent-scene CPU/frame-time and visual measurements.

## Design

The existing v1/v2 stream remains the fallback. An explicitly enabled v3 transport carries
one full v2 capture, then monotonically sequenced replacements for changed record payloads.
Native state owns one bounded plan and a compiled opcode/boundary index. Patches cannot change
record headers, cross record boundaries, or apply to a missing/stale plan. The complete packet
is structurally validated before any patch is applied. GPU objects are resolved from the live
registries on each replay; no cached surface handles or resubmitted command buffers.

The recorder compares values while recording, not in a second full-frame byte scan. Structural
changes recapture. Partial mapAsync drains and oversized frames use v2 and invalidate the plan.
Encoding failures invalidate reuse. Frame-local wire IDs must not let stale JS wrappers alias
objects in a new frame. Uploads keep their enqueue-time snapshots and original queue order.

Implemented as:

- a 24-byte v3 header (magic, version, declared bytes, mode, sequence, count) whose capture body is
  the v2 record stream, and patch entries of `record index, run count` plus `offset, length, bytes`
  runs restricted to 8-byte words inside one record's payload;
- **per-frame wire ids**: encoder, render pass, compute pass and command buffer ids restart every
  frame, so an untouched record is the same bytes as last frame's. A stale holder from an earlier
  frame is refused by name instead of naming whatever inherited its id. Resource ids stay monotonic;
- **a value check at the call site**: the values that decide a record's bytes are compared against
  the ones the retained plan was recorded from, in one allocation-free call. Equal means the plan
  already holds the record, so nothing is encoded and nothing is sent. Only the records that moved
  are written, and the word diff drops even those out of the packet when their bytes are unchanged;
- **fail-towards-capture**: an opcode or length that does not match the plan's at that index, a
  record count that moved, a host that reports a dropped plan, a partial drain, or a frame that
  rewrote more than half of itself above a 64 KiB floor, each send the whole frame instead. The
  host reports its plan generation (`epoch`) on every drain; a recorder that sees it move captures.

## Implementation and verification

### Phase 1: Native transport and compiled layout
- [x] Implement bounded, state-owned capture/delta decoding and immutable record boundaries.
  `FramePlanState` in `src/webgpu/bindings_state.h` (32 MiB bound, compiled `Record` index);
  `compileFramePlanRecords`, `walkFramePlanPatch`, `replayCompiledFramePacket` in
  `src/webgpu/bindings_frame_stream.cpp`. A rejected patch validates before it writes, so the
  retained frame is never half-updated.
- [x] Wire the compiled layout into production replay without replacing opcode validation.
  `replayFrameRecords` takes the compiled index for the record *boundaries* and keeps the whole
  opcode switch, per-opcode handle guards and body validation untouched; a packet still derives
  its own boundaries.
- [x] Run native protocol tests, including malformed packets, stale sequences and recovery.
  `threenative-frame-op-stream-replay-test` → `frame op stream replay contract passed` (exit 0),
  which now also runs a plan-enabled runtime: one capture, patched frames that replay the whole
  plan in order, thirteen rejected packets (mode, bound, capture layout, index, ordering, header,
  alignment, record escape, overlap, empty entry, trailing bytes, stale sequence, no plan), and a
  capture-plus-patch recovery afterwards. Each rejection asserts it never entered a backend call.

### Phase 2: Recorder
- [x] Add default-off retained recording, dirty payload packets and structural recapture.
  `frame-op-stream.js` under `host.compiledFramePlans` (set only by `TN_FRAME_PLANS=1`): captures,
  value-checked reuse, word-diff patches, and recapture when the layout moves or the delta would be
  larger than the frame it replaces.
- [x] Preserve v2 fallback, partial drains, eager uploads and stale-wrapper safety.
  The partial-drain path still cuts at `safeCursor` and sends the prefix as v2; oversized and
  mostly-rewritten frames fall back the same way; the pre-existing 14 recorder tests (eager Canvas2D
  snapshot, upload ordering, arena reuse, split flush) pass unchanged. Wire ids stay monotonic
  without plans, so the default path has nothing a stale holder could alias.
- [x] Observe a behavioral red, then pass recorder regression tests.
  With the implementation stashed, 5 of the 6 new `tests/frame-plan-transport.test.mjs` cases fail
  (`expected 2 to be 3`, `expected 9 to be 1`, missing `FramePlanState::maxBytes`); with it, both
  recorder suites pass 22/22, including a frame in which nothing moved carrying a 24-byte packet
  with no entries.

### Phase 3: Review and measurement
- [x] Exercise JS-generated packets through the actual C++ decoder and compare canonical bytes.
  The native contract drives the production recorder through the real decoder and reads a patched
  `writeBuffer` back off the GPU as `[3,4,5,6]`; the vitest lane patches a retained frame with the
  recorder's own packet and asserts byte equality with the frame a forced capture sends instead.
- [x] Run adversarial/property checks and review lifecycle, bounds and ordering.
  Thirteen malformed v3 packets, an empty patch, unchanged-word patches, plan-index ascent, the
  per-opcode guard table (retargeted at `replayFrameRecords`), and the equivalence property above.
- [x] Record a reproducible CPU-only microbenchmark without extrapolating to game FPS.
  `node packages/runtime-native/scripts/measure-frame-plan-transport.mjs --frames=120`, recorded in
  `docs/verification/runtime-perf-state.md`: **0.902 → 0.518 ms per frame and 338,120 → 17,432
  bytes** on a 2000-draw scene, **9.672 → 5.297 ms and 3,218,120 → 17,432 bytes** at 20000 draws,
  and a bounded **+26%** on a frame whose bytes are all new uploads. No GPU, no renderer, no
  frame-rate claim.

### Phase 4: Integration proof before promotion
- [ ] Run the full workspace typecheck/lint/test/budgets and PRD progress gates.
  `pnpm typecheck` exit 0, `pnpm lint` clean for the changed files, `pnpm check:docs`, `pnpm quality`
  and `pnpm prd:progress` exit 0. `pnpm test` in this worktree fails 19 runtime-native tests whose
  own message is `<target> is not built. Run: cmake --build build/tn-linux-quickjs …` — the other
  native presets are not built here, and those lanes are environment, not this change.
- [ ] Build the native host and run an enabled/disabled visual and lifecycle conformance case.
  The `tn-linux` host is built and the plan-enabled lifecycle contract runs (above); the
  enabled/disabled *visual* case is not run.
- [ ] Measure equivalent scenes on physical Android hardware.
  No device is attached to this workstation; not attempted rather than reported as passing.
- [ ] Measure equivalent scenes on desktop.
  Not run: needs the desktop starter lane with `TN_FRAME_PLANS=1` against the same scene.
- [ ] Run the changed path on iOS and verify JSC compatibility.
  Requires a macOS/iOS lane. The recorder script uses only `DataView`, typed arrays, closures and
  `arguments` — all JSC-legal — and the JSC engine passes arguments through the same `call` path,
  but that is reasoning, not a run.

## Acceptance
- [ ] All preceding checks have executed successfully.
  Everything except the Android hardware, desktop and iOS measurement boxes above.
- [x] No queue-order regression: the native contract asserts the exact operation order and census
  for a patched frame, and the vitest lane asserts a patched plan is byte-identical to its frame.
- [x] No resource-lifetime regression: the v2 path's own contract passes unchanged, a rejected patch
  leaves the retained frame intact and the plan invalid rather than half-applied, and every call
  site still retains the resources its record names before the reuse check can skip the record.
- [ ] No visual regression on an enabled/disabled conformance case.
  Not run (no desktop lane with the flag on and off).
- [ ] No device-recreation regression.
  Not exercised; the recorder is rebuilt with the device, so a recreated device starts with no
  retained plan and sends a capture, but nothing measures that here.
- [ ] Measured total CPU/frame-time improvement justifies production activation.
  Measured on the CPU-only transport lane and it is a real win where games are: the recorder is
  43–45% cheaper and the packet 94.8–99.5% smaller on draw-heavy frames, at the cost of ~8% of the
  recorder's own frame on the default path (≈7.5 ns per record for the plan check, under 1% of a
  16 ms frame) and a bounded +26% on a frame whose bytes are all new uploads. Activation still wants
  the desktop and device rows above, so the flag stays off by default.

## Environment

Landed and measured on the workstation: Linux, AMD Ryzen 9 5900X, NVIDIA RTX 2080 (Vulkan), Node
20.19.6, `tn-linux` native build (V8 + Dawn). Android hardware and iOS are not available here.
