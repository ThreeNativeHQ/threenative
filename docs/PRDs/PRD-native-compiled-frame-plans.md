# Native compiled frame plans

Status: PARTIAL. Experimental, default off. Transport landed and measured; the recorder is 43–45%
cheaper and the packet 94.8–99.5% smaller on draw-heavy frames in the original measurement. Desktop
A/B is recorded; activation, visual, device-recreation and mobile proof remain open. Base: f8d6da914 (develop synced after #273).

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
  record count that moved, a host that reports a dropped plan, or a frame that rewrote more than
  half of itself above a 64 KiB floor sends a capture instead. Partial drains consume only submitted
  prefixes and keep the remainder v2; oversized bodies also use v2. Both invalidate reuse. The host
  reports its plan generation (`epoch`) on every drain; a recorder that sees it move captures.

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
  Follow-up below repairs plan-mode partial consumption and oversized fallback; mostly-rewritten
  frames still capture. The earlier 14-test recorder result predates these repairs. A local
  differential check now compares the default-off recorder against `3d316925c` across 1,000 frames
  and 2,868 drains: byte-identical, including eager uploads and partial encoder tails (exit 0).
- [x] Observe a behavioral red, then pass recorder regression tests.
  Original implementation evidence: with it stashed, 5 of the 6 new `tests/frame-plan-transport.test.mjs` cases fail
  (`expected 2 to be 3`, `expected 9 to be 1`, missing `FramePlanState::maxBytes`); with it, both
  recorder suites pass 22/22, including a frame in which nothing moved carrying a 24-byte packet
  with no entries. That historical Vitest result is not a rerun of the follow-up below.
- [x] Consume partial drains exactly once while preserving unfinished encoder tails.
  Repeated partial drains now return null; materialized tails remain v2, with live wrappers until
  the actual boundary. An empty final drain expires old wrappers. Regression tests pass locally.
- [x] Enforce the native retained-body bound before choosing v3 capture.
  A body of exactly 32 MiB still captures; eight bytes over uses v2 and then recovers capture/patch.
  Both boundary cases pass locally, with upload endpoint bytes preserved.
- [x] Invalidate stale or failed value snapshots before a record can be reused.
  Render/compute wide-to-narrow bind groups, opcode replacement, coercion failure and failed-emit
  retry pass; 300 deterministic mixed frames reconstruct byte-identically to fresh v2 records.
- [x] Preserve earlier patch entries when the patch buffer grows.
  Two changed 40 KiB uploads in a draw-heavy frame cross the 64 KiB packet capacity. The regression
  failed before the growth-copy fix; afterwards applying the patch matches a forced capture.

Follow-up verification (2026-09-17): the original eight transport tests passed first; ten added or
strengthened behavioral cases failed before repairs, and the packet-growth case failed separately.
After repairs, all 19 `frame-plan-transport.test.mjs` cases pass using Node 22.16.0 `node:test` and
`node:assert/strict` through a temporary Vitest-API adapter (exit 0). Test bodies and production
recorder were unchanged by that adapter; the native bound declaration was read from a fetched
header excerpt. `node --check` passes for both changed JS files. Reproduction in a full checkout:
`pnpm exec vitest run packages/runtime-native/tests/frame-plan-transport.test.mjs`.
**Actual Vitest, workspace gates, native replay, GPU rendering and device lanes were not rerun in
this follow-up environment.** The downloaded source files were verified against Git blob hashes.
The temporary adapter and header excerpt are not repository changes.

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
  Historical pre-follow-up result: `pnpm typecheck`, `pnpm lint`, `pnpm check:docs`, `pnpm quality`,
  `pnpm budgets` (after
  re-stamping the native coverage record for the new source digest) and `pnpm prd:progress` all
  exit 0. `pnpm test` in this worktree fails 19 runtime-native tests whose own message is
  `<target> is not built. Run: cmake --build build/tn-linux-quickjs …` — the other native presets
  were not built there. This does not establish a successful full test gate. The follow-up
  snapshot has no installed workspace dependencies/native build; full gates need a fresh run.
- [ ] Build the native host and run an enabled/disabled visual and lifecycle conformance case.
  The `tn-linux` host is built and the plan-enabled lifecycle contract runs (above); the
  enabled/disabled *visual* case is not run.
- [ ] Measure equivalent scenes on physical Android hardware.
  No device is attached to this workstation; not attempted rather than reported as passing.
- [x] Measure equivalent scenes on desktop.
  Run: `mystral run examples/native-smoke/dist/native-smoke.js --frames 300` on Xvfb, three runs per
  arm, `TN_FRAME_PLANS=1` in one. Plan off 9160/9180/9349 ms, on 9470/9401/9527 ms — **+2.6%**,
  because that scene is GPU-bound (9.2 s for 300 frames) and the recorder's saving is hidden behind
  it. Recorded in `docs/verification/runtime-perf-state.md`; it is the reason the flag stays off.
- [ ] Run the changed path on iOS and verify JSC compatibility.
  Requires a macOS/iOS lane. The recorder script uses only `DataView`, typed arrays, closures and
  `arguments` — all JSC-legal — and the JSC engine passes arguments through the same `call` path,
  but that is reasoning, not a run.

## Acceptance criteria
- [ ] All preceding checks have executed successfully.
  Full workspace success, enabled/disabled visual proof, mobile runs and activation remain open.
- [ ] No queue-order regression on the repaired recorder through native replay.
  Historical native order/census proof remains above; local prefix/tail byte equality passes, but
  the changed partial-drain path still needs the native contract rerun.
- [ ] No resource-lifetime regression on the repaired recorder through native replay.
  The local tests preserve unfinished wrappers and expire them at the boundary. Native resource
  lifetime and GPU readback still need revalidation after these repairs.
- [ ] No visual regression on an enabled/disabled conformance case.
  Not run (no desktop lane with the flag on and off).
- [ ] No device-recreation regression.
  Not exercised; the recorder is rebuilt with the device, so a recreated device starts with no
  retained plan and sends a capture, but nothing measures that here.
- [ ] Measured total CPU/frame-time improvement justifies production activation.
  Measured twice. The transport lane says yes: the recorder is 43–45% cheaper and the packet
  94.8–99.5% smaller on draw-heavy frames, at ~8% more recorder time on the default path and a
  bounded +26% when a frame's bytes are all new uploads. The desktop lane says not yet: +2.6% on the
  one scene available, which is GPU-bound and hides the recorder entirely. Activation needs a
  recorder-bound lane to show the saving end to end, so the flag stays off by default.

## Environment

Original implementation and performance evidence came from the workstation: Linux, AMD Ryzen 9 5900X, NVIDIA RTX 2080 (Vulkan), Node
20.19.6, `tn-linux` native build (V8 + Dawn). Android hardware and iOS are not available here.

Follow-up recorder repairs were exercised in a Linux source snapshot with Node 22.16.0, not the
workstation/native build above. Direct repository/package downloads failed DNS resolution, so no
workspace install, native build, new GPU result or new performance claim is made. The existing
`scripts/prd-progress.ts` runs directly with Node type stripping; the acceptance heading now uses
its recognized `Acceptance criteria` spelling rather than silently reporting 0/0 acceptance boxes.
