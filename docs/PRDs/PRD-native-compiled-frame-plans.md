# Native compiled frame plans

Status: NOT STARTED. Experimental, default off. Base: d292da4225186e6ec395be551d49c7a26a1770be.

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

## Implementation and verification

### Phase 1: Native transport and compiled layout
- [ ] Implement bounded, state-owned capture/delta decoding and immutable record boundaries.
- [ ] Wire the compiled layout into production replay without replacing opcode validation.
- [ ] Run native protocol tests, including malformed packets, stale sequences and recovery.

### Phase 2: Recorder
- [ ] Add default-off retained recording, dirty payload packets and structural recapture.
- [ ] Preserve v2 fallback, partial drains, eager uploads and stale-wrapper safety.
- [ ] Observe a behavioral red, then pass recorder regression tests.

### Phase 3: Review and measurement
- [ ] Exercise JS-generated packets through the actual C++ decoder and compare canonical bytes.
- [ ] Run adversarial/property checks and review lifecycle, bounds and ordering.
- [ ] Record a reproducible CPU-only microbenchmark without extrapolating to game FPS.

### Phase 4: Integration proof before promotion
- [ ] Run the full workspace typecheck/lint/test/budgets and PRD progress gates.
- [ ] Build the native host and run an enabled/disabled visual and lifecycle conformance case.
- [ ] Measure equivalent scenes on physical Android hardware.
- [ ] Measure equivalent scenes on desktop.
- [ ] Run the changed path on iOS and verify JSC compatibility.

## Acceptance
- [ ] All preceding checks have executed successfully.
- [ ] No visual, queue-order, resource-lifetime or device-recreation regression.
- [ ] Measured total CPU/frame-time improvement justifies production activation.

## Environment

The initial sandbox has Node 22.16.0, GCC and Clang, but no pnpm or native GPU SDK checkout.
Direct Git clone failed with `Could not resolve host: github.com`; connected GitHub reads and
writes work. Source copied into an isolated local test workspace is checked against Git blob
SHAs. Unavailable workspace and hardware checks remain unchecked, not reported as passing.
