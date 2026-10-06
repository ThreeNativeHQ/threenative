# PRD-502 — Handles keep identity and aliases (N04b)

**Status:** IN PROGRESS — phase 1 done
**Complexity:** 4 — the handle and identity model every binding and engine module reads
**Owner:** João
**Work package:** N04 — [lifetime and numerics](../../../native-engine/N04-lifetime-and-numerics/README.md), [native-engine batch](../../../native-engine/README.md)
**Depends on:** [PRD-500](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md)

## Context

§6.1 requires public identity and aliasing to survive: `mesh.position` returns the same logical vector across repeated access. A retained vector stays valid when internal storage grows and never points at a different mesh. Handles carry type/context identity and a generation, checked at every external boundary. Raw pointers to movable storage are never exposed. §6.2 separates stable public records from packed execution arrays (transforms, bounds, draw records), which are derived from those records. The host already has a checked-handle precedent for GPU objects in `packages/runtime-native/src/webgpu/checked_handle.cpp`. The engine handles follow its generation-check idea without sharing its storage.

## Solution

1. **Handle table** (proposed: `packages/runtime-native/src/engine/foundation/handles.{h,cpp}`). Slots are generational, with a free list and reuse only after a generation bump. A handle is `{type, context, index, generation}`, as fixed by [PRD-500](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md).
2. **Sub-object identity**: owned value members (`position`, `quaternion`, `scale`, `matrix`, `matrixWorld`, `up`) are addressable as `(owner handle, member id)`. Repeated access returns the same logical object, and writes through either alias are visible to both. Adapters cache one wrapper per logical identity.
3. **Packed data** is derived: public records own state, dense arrays are rebuilt or patched from explicit dirty marks, and hot loops resolve handles once outside the inner loop (§6.2).
4. **Diagnostics**: a stale-generation, wrong-type or wrong-context handle returns `TN_HANDLE_STALE`, `TN_HANDLE_TYPE` or `TN_HANDLE_CONTEXT`.

## Out of scope

- When an unreferenced object is reclaimed: [PRD-503](PRD-503-n04c-unreachable-cycles-are-reclaimed.md).
- Typed-array views over attributes and `.elements`: [PRD-504](PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md).

## Execution Phases

#### Phase 1: Generational handles
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/foundation/handles.{h,cpp}`, `packages/runtime-native/tests/native-engine/handles_test.cpp`
- [x] A freed slot reused for a new object rejects the old handle with `TN_HANDLE_STALE`. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_handles_generation` — 2026-10-04: green in `build/tn-linux-engine`; red when `check()` skips the generation compare. `src/engine/foundation/handles.{h,cpp}`, target `tn_engine_foundation`
- [x] Handles from another context or of another type are rejected with their named codes. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_handles_identity` — 2026-10-04: green; `HandleError::{Context,Type,Stale,Invalid}` — the ABI status names land with PRD-500 phase 2; a forged type field is refused because the slot's type is the truth

#### Phase 2: Member aliases survive growth
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/foundation/members.{h,cpp}`
- [x] Repeated `position` access on one object yields the same identity, and a write through one alias is read through the other. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_alias_identity` — 2026-10-04: green (`build/tn-linux`): `MemberAliases` returns one cached alias handle per (owner, member); a write through it is the owner's own field; a released owner releases its aliases and a reused slot never inherits them. Red without the cache, and with a release that keeps aliases. `src/engine/foundation/members.{h,cpp}`
- [x] A retained member alias still refers to its own object after 100,000 more objects force the storage to grow. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_alias_growth` — 2026-10-04: green; the alias resolves through the owner every time, so 100,000 more objects (and aliases) growing the tables leave it pointing at its own record
- [x] The alias fixtures adapted from the reference runner pass through the differential runner. proof: `pnpm parity -- --suite native-engine-alias` — 2026-10-05: green, 5/5 against the pinned reference (60 observations): member identity for `position`/`scale`/`up`/`quaternion`/`matrix` with writes seen through every alias and the owner path; `rotation`/`quaternion` sync through retained aliases; `copy()` writes into retained aliases; a retained alias names its owner after re-parenting and 40 more objects; chaining methods return the same identity. A `call` with no arguments on a member object (`call dst position -> p`) retains that member, on the reference and the native driver alike; a name that is neither a method nor a member object still fails. Whole suite 69 pass, 0 fail, 17 blocked
