# PRD-531 — Optional V8 compatibility adapter (N18)

**Status:** PROPOSED
**Complexity:** 3 — generated bindings over the same engine; lifetime is the hard part
**Owner:** João
**Work package:** N18 — [native-engine batch](README.md)
**Depends on:** [PRD-500 (N03)](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [N04 — lifetime and numerics](N04-lifetime-and-numerics/README.md), [PRD-508 (N06)](PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md)

## Context

§2.1 allows optional JS scripting as a separate distribution profile over the same C++ engine; it
must not bring JavaScript implementations of animation, traversal, batching or materials, and it
never satisfies gate T. §8.2 forbids carrying 64-bit handles as plain JS numbers. §7.1 requires the
adapter to take part in the lifetime protocol: callbacks capturing wrappers form cross-language
cycles, and rooting them forever is not acceptable. The host already embeds V8
(`packages/runtime-native/src/js/v8_engine.cpp`) for the legacy path.

## Solution

1. Generate V8 bindings from the N03 catalog into proposed `packages/runtime-native/src/adapters/v8/`;
   wrappers adapt names, overloads and lifetimes and implement no engine algorithm (§8.3).
2. Handles live in internal fields or a lossless representation, never a JS number.
3. Wrappers and captured callbacks register as roots and edges with the N04c reachability layer, so a
   cycle through JS and native objects is reclaimed at a safe point.
4. The adapter is its own build target; no target below it includes V8 headers (§13), and telemetry
   and crash reports name the scripting profile (§17).
5. Rollback: not needed — the profile is opt-in and the strict artifact never contains it.

## Out of scope

- The legacy engine backend, which keeps its own V8 path unchanged until N20 retires it.

## Execution Phases

#### Phase 1: Generated bindings
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/adapters/v8/`, `packages/runtime-native/tests/native-engine/v8_*.cpp`
- [ ] The generated bindings cover every catalog entry marked supported, and nothing else. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_catalog_coverage`
- [ ] A handle round-trips through JS without losing bits. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_handles`
- [ ] The adapter target builds while every engine target below it has no V8 include or link. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs --binary <each engine target>`

#### Phase 2: Same engine, same lifetime
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/adapters/v8/lifetime.cpp`
- [ ] A JS-to-native cycle through a captured callback is reclaimed at a safe point. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_cycle_reclaim`
- [ ] Repeated whole-runtime create/destroy shows no native object or GPU resource growth. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_runtime_churn`
- [ ] The N06 scene-semantics fixtures pass through the V8 adapter with the same results as the C++ driver. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_scene_fixtures`

## Decisions

- The scripting profile never satisfies gate T and is never called JS-free (§2.1).
