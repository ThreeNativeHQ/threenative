# PRD-501 — Math matches the pinned reference (N04a)

**Status:** IN PROGRESS — phases 1 and 2 done, bit-exact; phase 3 (Android arm64 emulator) open
**Complexity:** 3 — scalar math classes ported against a fixed oracle; wide but shallow
**Owner:** João
**Work package:** N04 — [lifetime and numerics](README.md), [native-engine batch](../README.md)
**Depends on:** [PRD-500](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [PRD-498](../PRD-498-n01-baseline-and-differential-fixture-runner.md) (fixture runner)

## Context

§6.3 requires binary64 for the Three-compatible public math where the reference uses JS numbers. Float32 packing is allowed only on GPU/storage paths that are part of the contract. Matrix layout (column-major `elements`), multiplication order, handedness, quaternion conventions, Euler orders, singular matrices, NaN/Infinity and observable signed zero must match three@0.185.1. Fast-math is not the conformance default. The oracle is the pinned `three` package in the workspace (`pnpm-workspace.yaml` catalog).

## Solution

1. Port Vector2/3/4, Matrix3/4, Quaternion, Euler, Color, Box3, Sphere, Plane, Ray and Frustum as native value classes (proposed: `packages/runtime-native/src/engine/foundation/math/`). Storage is `double`, and the algorithms follow the pinned source line by line where order of operations is observable.
2. Compile the engine targets with `-ffp-contract=off` and no `-ffast-math` in conformance builds. A separate opt-in fast profile is not part of this PRD.
3. Generate fixtures from the reference runner for every public method of the ported classes. Edge cases include singular `invert()`, gimbal-locked Euler, NaN propagation and `-0` in `toArray()`.
4. Unsupported: no class outside the list above. Catalog entries for others stay `unsupported(TN_MATH_UNPORTED)` until a consumer needs them.

## Out of scope

- `Object3D` matrix update semantics (`matrixAutoUpdate`, `updateMatrixWorld`): [PRD-508](../PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md).
- `.elements` retained-array aliasing through bindings: [PRD-502](PRD-502-n04b-handles-keep-identity-and-aliases.md) and [PRD-504](PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md).

## Execution Phases

#### Phase 1: Vectors, matrices and quaternions
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/foundation/math/`, `packages/runtime-native/tests/native-engine/math_test.cpp`
- [x] Vector2/3/4, Matrix3/4 and Quaternion match the reference fixtures bit-for-bit in binary64. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_math_core` — 2026-10-04: green and bit-exact (abs 0): 12 `math-core-*` fixtures; transcendental functions are V8 11.3's fdlibm (`src/engine/foundation/math/ieee754.{h,cpp}`), so results equal the reference's; 158,520 further argument patterns compared against node in every bit (`native_engine_ieee754`)
- [x] Singular-matrix inversion, NaN/Infinity propagation and signed-zero outputs match the reference. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_math_edges` — 2026-10-04: green and bit-exact (abs 0): 4 `math-edges-*` fixtures, 78 observations, through `pnpm parity`-shaped differential runs against the C++ driver (`build/tn-linux`, and the core also runs as Wasm)

#### Phase 2: Euler, colour and geometry primitives
**Status:** DONE
**Files:** same directory
- [x] All six Euler orders round-trip through Matrix4 and Quaternion as the reference does, including gimbal lock. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_math_euler` — 2026-10-04: green and bit-exact: 4 `math-euler-*` fixtures (279 observations) including gimbal lock; the seed fixtures keep their original angles
- [x] Color (including colour-space conversion), Box3, Sphere, Plane, Ray and Frustum match the reference fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_math_primitives` — 2026-10-04: green and bit-exact: 6 `math-primitives-*` fixtures (210 observations); the C++ core also passes as Wasm under node

#### Phase 3: The same results on Android
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/tests/native-engine/CMakeLists.txt`
- [ ] The math fixtures pass on arm64 Android with the same tolerances. proof: `pnpm parity -- --suite native-engine --target android-hardware --only 'math-*'` — open: 2026-10-04 the lane exists and runs: the fixture driver cross-builds with the NDK (`-DTN_ENGINE_CORE_ONLY=ON`, `build/android-core-<abi>`) and runs over adb; on the x86_64 emulator (`--target android`, API 35, bionic) all 26 math and 7 scene fixtures pass bit-exact at abs 0. An arm64 system image cannot run on this x86_64 host, so the arm64 run needs the Pixel (`android-hardware`); the arm64 driver is built

## Decisions

- Binary64 public math and float32 only on GPU/storage paths; fast-math off in conformance mode (§6.3). Fixed by the proposal.
- **libm parity (2026-10-04, agent):** glibc and V8 differ by at most 1 ulp on 3–6% of `sin/cos/tan/asin/acos/atan/atan2/pow` arguments (`sqrt` never), and cancellation amplifies that to 32 ulps in `applyQuaternion`. The engine adopts V8's fdlibm algorithms so math matches the browser and is identical on every platform; until then the affected fixtures carry `{"abs":0,"ulps":1}` with a `toleranceWhy`.
