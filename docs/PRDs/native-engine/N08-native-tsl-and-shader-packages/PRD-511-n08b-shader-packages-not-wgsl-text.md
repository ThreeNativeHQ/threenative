# PRD-511 — Shader packages, not WGSL text (N08b)

**Status:** DONE 2026-10-04
**Complexity:** 4 — code generation plus the layout/variant/schedule metadata that makes it executable
**Owner:** João
**Work package:** N08 — [native-engine batch](../README.md) · [N08 index](README.md)
**Depends on:** [PRD-510](PRD-510-n08a-a-typed-shader-ir-with-ordered-effects.md), [PRD-509 (N07)](../PRD-509-n07-gpu-resources-presentation-and-device-loss.md)

## Context

§9.2: WGSL alone cannot execute a material. A package carries WGSL plus entry points, vertex
layouts, resource/binding layouts, material variants, uniform data layouts, update schedules, pass
dependencies and temporal-history requirements. Validation and target compilation use Dawn/Tint or
the selected backend's existing pipeline — no new SPIR-V/MSL/HLSL compilers (§9.2, R7). Dawn is in
`packages/runtime-native/third_party/dawn`, wgpu-native (naga) in `third_party/wgpu`. The host
already caches pipelines (`src/webgpu/bindings_pipeline_cache.cpp`) for the JS path.

## Solution

1. **Emitter** (proposed: `src/engine/shader/wgsl/`): IR → WGSL with deterministic naming so the
   same graph always emits the same text (cache key = hash of package).
2. **Package format** (proposed: `include/threenative/engine/shader_package.h`, versioned with the
   shader-package revision from N03): entry points per stage; vertex buffer layouts; bind group
   layouts with group/binding/visibility/type; uniform block layouts with offsets and std alignment;
   variant keys (skinning, morphs, instancing, shadow pass, alpha mode); update schedule per uniform
   (`object`, `material`, `camera`, `frame`, `render`); pass dependencies; history requirements.
3. **Standard updates execute natively** from known data sources (camera, object, material, time);
   a custom update in a strict build is a compiled callback; one that defeats batching marks the
   draw unbatchable rather than wrong (§9.2).
4. **Validation:** each emitted module goes through Tint on Dawn and naga on wgpu-native; a
   validation error is a build-time `TN_SHADER_PACKAGE_INVALID` with the IR node path.
5. **Build-time specialization** for static graphs writes packages into the cooked asset output;
   runtime construction is used only for dynamic graphs (§9.1).

## Out of scope

- PBR/lighting maths — [PRD-512](PRD-512-n08c-standard-pbr-and-deformation-that-shadows.md).
- Pass scheduling across a frame — [PRD-523 (N14a)](../N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md).

## Execution Phases

#### Phase 1: Emit and validate
**Status:** DONE
**Files:** proposed `src/engine/shader/wgsl/emitter.cpp`, `tests/native-engine/shader_emit_test.cpp`
- [x] Every corpus graph emits WGSL that Tint validates. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_shader_emit_tint` — 2026-10-04: green in `build/tn-linux-engine` (Dawn): the three corpus graphs (`tests/native-engine/shader_corpus.h`: compute with storage, loop and branch; lit vertex; lit fragment with discard) create shader modules inside a validation error scope with no error; broken WGSL is refused, proving the validator is live. Red when the loop counter loses its `var`. `src/engine/shader/wgsl.{h,cpp}`
- [x] The same WGSL validates under naga on wgpu-native. proof: `ctest --test-dir packages/runtime-native/build/tn-linux-wgpu -R native_engine_shader_emit_naga` — 2026-10-04: green in the engine-only wgpu-native build (`build/tn-linux-engine-wgpu`, ctest `native_engine_shader_emit_naga`)
- [x] Emission is deterministic: two runs over the corpus produce byte-identical packages. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_shader_emit_stable` — 2026-10-04: green; names derive from IR ids and fixed prefixes, two builds of each graph emit byte-identical WGSL, and a non-finite constant is refused as `TN_SHADER_PACKAGE_INVALID` rather than emitted

#### Phase 2: Layouts, variants, schedules
**Status:** DONE
**Files:** proposed `src/engine/shader/package.cpp`
- [x] Generated bind group and uniform layouts match the WGSL declarations (group, binding, offset, size) for every corpus package. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_shader_layouts` — 2026-10-04: green on Dawn, wgpu-native and ASan: a mixed block (f32, vec3, f32 packed into the vec3 tail, mat4x4, vec2) gets offsets 0/16/28/32/96 and size 112; bytes written at those offsets come back through the device-compiled WGSL, all 23 values exact. Red when vec3 aligns to 12. `src/engine/shader/package.{h,cpp}`
- [x] A package with a skinning and a shadow variant creates both pipelines on a real device with no validation error. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_shader_variants_gpu` — 2026-10-04: green; a skinned vertex stage (bone matrices from read-only storage, two joints) with a fragment stage, and the same vertex stage as a depth-only shadow variant, both create render pipelines inside a validation scope with no error. Red when storage is declared read_write, which a vertex stage may not do
- [x] A shader-package revision mismatch is rejected before pipeline creation. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_shader_package_version` — 2026-10-04: green; `acceptPackage` refuses another revision with `TN_SHADER_PACKAGE_VERSION` and an invalid stage with `TN_SHADER_PACKAGE_INVALID` before any pipeline is made; the revision is the ABI header's `TN_SHADER_PACKAGE_VERSION`, one number

## Decisions

- **Reuse Tint and naga; build no new shader compilers (§9.2).**
