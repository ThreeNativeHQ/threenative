# PRD-504 — Buffers cross the ABI with an owner (N04d)

**Status:** IN PROGRESS — C++ store, lease, views done; fuzz run and the two reference-fixture boxes open
**Complexity:** 4 — buffer ownership, leases and version semantics where game code holds typed views
**Owner:** João
**Work package:** N04 — [lifetime and numerics](../../../native-engine/N04-lifetime-and-numerics/README.md), [native-engine batch](../../../native-engine/README.md)
**Depends on:** [PRD-502](PRD-502-n04b-handles-keep-identity-and-aliases.md), [PRD-500](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md)

## Context

§7.2 requires every buffer that crosses the ABI to carry an owner, length, stride, scalar type, mutability and lifetime. Backing storage is pinned or leased while views or jobs reference it. Offsets and overflow are validated before access. `BufferAttribute` update/version semantics are preserved: a native write to a visible attribute is observable through supported retained views, and a submitted upload buffer is never reused before its contract allows. §6.4 adds the direct-array obligation. Public `.elements`, attribute arrays, indexed writes, iteration, identity and Array-versus-TypedArray behaviour are tested, and hidden copies or stale aliases count as failures. Start with safe copies; zero-copy comes only once the owner and synchronisation rules are shown to hold.

## Solution

1. **Buffer descriptor and lease** (proposed: `packages/runtime-native/src/engine/foundation/buffers.{h,cpp}`). It carries `{owner handle, byteOffset, byteLength, stride, scalarType, mutability}`. `tn_buffer_lease` pins storage until released, and the storage cannot grow or move while a lease is held.
2. **Validation**: every access checks offset + length against capacity with overflow-safe arithmetic, and fails with `TN_BUFFER_RANGE`.
3. **Version semantics**: `needsUpdate` bumps `version`, `addUpdateRange`/`clearUpdateRanges` are honoured, and the renderer uploads only ranges newer than its last-seen version.
4. **Adapter contract** for exposed arrays: a native-backed typed view is the one storage, never a copy. `.elements` on Matrix4 is a 16-element binary64 view. Where the reference exposes a plain `Array`, the catalog marks the shape it supports, and anything else is `unsupported(TN_ARRAY_SHAPE)`.
5. **Upload ownership**: a submitted staging buffer is retired by the deferred-destruction queue from [PRD-503](PRD-503-n04c-unreachable-cycles-are-reclaimed.md), never rewritten in place.

## Out of scope

- GPU upload/readback mechanics: [PRD-509](../PRD-509-n07-gpu-resources-presentation-and-device-loss.md).
- Geometry classes that own attributes: [PRD-508](../PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md).

## Execution Phases

#### Phase 1: Descriptors are validated
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/foundation/buffers.{h,cpp}`, `packages/runtime-native/tests/native-engine/buffers_test.cpp`, `fuzz_buffers.cpp`
- [x] Out-of-range and overflowing offset/length pairs fail with `TN_BUFFER_RANGE` before any read. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_buffers_range` — 2026-10-04: green; `BufferStore::validate` compares by subtraction so a wrapping pair fails (red with the `offset + length` form), misalignment is `Layout`, and an overflowing element count allocates nothing. `src/engine/foundation/buffers.{h,cpp}`
- [x] The buffer-descriptor fuzzer runs 10 minutes under ASan/UBSan with no finding. proof: `pnpm --filter @threenative/runtime-native native:test:asan -- --fuzz native_engine_fuzz_buffers --max-total-time=600` — 2026-10-04: run as `native_engine_fuzz_buffers -max_total_time=600` in a clang engine-only build (`-DTN_ENGINE_FUZZ=ON`, `-fsanitize=fuzzer,address,undefined`): 81,703,188 inputs in 601 s, 699 corpus units, no finding

#### Phase 2: Leases and versions
**Status:** NOT STARTED
**Files:** same
- [x] Storage under a live lease does not move when its attribute is resized; the resize applies after release. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_buffers_lease` — 2026-10-04: green; the pointer is unchanged under the lease and the 4→1024 resize lands on the last release with contents kept (red when resize ignores leases)
- [x] `needsUpdate` and update ranges bump `version` and the dirty ranges exactly as the reference fixtures record. proof: `pnpm parity -- --suite native-engine-buffer-version` — 2026-10-05: green, 3/3 against the pinned reference: `needsUpdate` bumps `version` once per set; `setX`/`setXYZ` alone leave it at 0; `addUpdateRange`/`clearUpdateRanges` and the observed `updateRanges` match (`buffer-version-*`). `addUpdateRange` refuses a negative or fractional start or count. `--suite native-engine-<group>` now runs the suite over `<group>-*`, and an empty group fails closed

#### Phase 3: Retained views see native writes
**Status:** NOT STARTED
**Files:** proposed `packages/three-native/tests/compatibility/fixtures/arrays/`
- [x] A retained attribute view and a retained `.elements` view read a native-side write with no copy. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_buffers_views` — 2026-10-04: green; a `BufferView` over a 16-double `.elements` store reads a native write at the same address — one storage, no copy
- [x] The array-shape fixtures (indexed writes, iteration, identity, Array vs TypedArray) pass or report their named `unsupported` code. proof: `pnpm parity -- --suite native-engine-arrays` — 2026-10-05: green: identity, iteration and indexed read pass; indexed write, `matrix.elements[i] = v` and plain-Array assignment report `TN_ARRAY_SHAPE` (no binding addresses one element for writing, and the C++ driver refuses rather than writing a copy). Whole suite: 64 pass, 0 fail, 17 blocked, each with its code
- [x] A retained view whose backing store is reallocated, the Wasm memory-growth case, is refreshed and never reads freed storage (owner decision 4). proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_buffer_view_regrowth` — 2026-10-04: green; a resize bumps the store epoch, the view reports `stale()` and its next `bytes()` resolves the new storage with contents intact; it never caches a pointer across epochs
