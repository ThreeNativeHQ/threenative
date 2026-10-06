# PRD-506 — Three imports bind natively and callbacks are reclaimed (N05b)

**Status:** IN PROGRESS — early spike for gate T; blocks nothing else (owner decision 2)
**Complexity:** 5 — crosses the compiler's module system, the generated ABI and the engine lifetime protocol at once
**Owner:** João
**Work package:** N05 — [native-engine batch](../README.md) · [N05 index](README.md)
**Depends on:** [PRD-505](PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md), [PRD-502 — Handles keep identity and aliases](../N04-lifetime-and-numerics/PRD-502-n04b-handles-keep-identity-and-aliases.md), [PRD-503 — Unreachable cycles are reclaimed](../N04-lifetime-and-numerics/PRD-503-n04c-unreachable-cycles-are-reclaimed.md)

## Context

§2.2 keeps game source unchanged: `import { Scene, Mesh } from "three"`, `WebGPURenderer` from
`three/webgpu`, TSL from `three/tsl`. §8.4 notes the compiler's `tsbindgen` emits C declarations
only, and its example uses generated `.ts` declarations with reference directives — so the
package/module adapter that makes those imports resolve must be qualified explicitly. §7.1 makes
cross-language cycles (a closure capturing a mesh wrapper, registered on that mesh) a qualification
condition: rooting every callback forever is a failure, and a compiler without a working
rooting/tracing path is not qualified. The minimal native object fixture comes from N04
(proposed: `packages/runtime-native/src/engine/scene/`).

## Solution

1. **Module adapter.** proposed: `tools/native-typescript/module-map.json` maps `three`,
   `three/webgpu`, `three/tsl` to the generated native wrapper modules from the N03 catalog
   (proposed: `packages/three-native/generated/native-aot/`). One constructor identity across all
   three specifiers (§2.2): `Mesh` from `three` and from `three/webgpu` is the same class.
2. **Wrappers adapt, never compute (§8.3).** Generated stubs translate names, overloads, option
   objects and return values into ABI calls; no matrix maths, traversal or shader generation in them.
3. **Callback protocol.** A TS closure passed to the engine becomes a callback-plus-context pair on
   the ABI (§8.2). The context is a GC-visible root registered with the engine's reachability layer
   (N04c), not a permanent root: the engine reports the closure as reachable only while its owning
   object is reachable, so a mesh ↔ closure cycle is collectable once the scene drops the mesh.
4. **Unsupported import surface** (a name present upstream but absent from the catalog) fails at
   compile time with `TN_NATIVE_TS_UNSUPPORTED_EXPORT <specifier>#<name>`, never at runtime.
5. **Rollback:** nothing ships yet; the legacy V8/QuickJS host is untouched.

## Out of scope

- The language corpus itself — [PRD-505](PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md).
- Generating the catalog and ABI — [PRD-500 (N03)](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md).
- TSL graphs built from compiled code — [PRD-513 (N08d)](../N08-native-tsl-and-shader-packages/PRD-513-n08d-compute-multipass-and-a-dynamic-graph.md).

## Execution Phases

#### Phase 1: Imports resolve to native wrappers
**Status:** NOT STARTED
**Files:** proposed `tools/native-typescript/module-map.json`, `tools/native-typescript/corpus/three-fixture/`
- [ ] The §2.2 snippet (`Scene`, `Mesh`, `BoxGeometry`, `MeshStandardMaterial`, `mesh.position.x += 1`) compiles unchanged on Linux x64 and prints the same scene dump as the reference build against upstream `three@0.185.1`. proof: `node tools/native-typescript/run-corpus.mjs --native --case three-fixture` — **reopened 2026-10-05: proven with tslang, which decision 11 drops for Perry; re-prove with Perry.** tslang history: 2026-10-05: green with `--reference --native` (the whole corpus stays 12/12 in both modes). `corpus/three-fixture.ts` imports from "three" unchanged; the reference build resolves it to the workspace's pinned three@0.185.1, the native build to `tools/native-typescript/three/three.ts`, which tslang compiles and the runner links with `three/tn_three_shim.c` and the engine's static archives through the host C++ driver (tslang's own link takes no C++ archives). Both print `Scene Mesh MeshStandardMaterial`, `position 2 0 -3`, `found same` (`getObjectById` returns the same wrapper). The shim exists because tslang declarations carry scalars and strings only: `tsbindgen` skips functions taking a struct by value, so engine handles stay in a C table and arguments are staged one at a time
- [ ] `Mesh` imported from `three` and from `three/webgpu` is the same constructor (`instanceof` both ways). proof: `node tools/native-typescript/run-corpus.mjs --native --case import-identity` — open; the tslang blocker is moot under Perry (decision 11), re-prove with Perry. History: blocked by the pinned compiler (tslang v0.0-pre-alpha87), 2026-10-05: a second module cannot re-export `Mesh` with its identity. `export { Mesh } from "../three"`, `export * from "../three"` and `import { Mesh } from "../three"; export { Mesh }` each crash the compiler (exit 139) on that module; the value alias `import { Mesh as M } from "../three"; export const Mesh = M` compiles and constructs (`new Mesh()` from "three/webgpu" works), but the alias is emitted as a global symbol `Mesh` that collides with the class's, and `instanceof` then crashes at run time even against "three"'s own `Mesh` (with only "three" linked, `instanceof` holds). tslang exports carry no module prefix. Needs a compiler fix or a newer pin; the PRD forbids a local patch without a minimized corpus case
- [ ] Importing an uncatalogued export fails the build with `TN_NATIVE_TS_UNSUPPORTED_EXPORT`. proof: `node tools/native-typescript/run-corpus.mjs --native --case unsupported-export --expect-compile-error` — **reopened 2026-10-05: proven with tslang, which decision 11 drops for Perry; re-prove with Perry.** tslang history: 2026-10-05: green. Before compiling, the runner checks every name a case imports from "three" or a "three/..." subpath against the catalog: a name not marked supported fails the build as `TN_NATIVE_TS_UNSUPPORTED_EXPORT <specifier>#<name>`, with the catalog's diagnostic (`three#Raycaster (TN_NATIVE_UNSUPPORTED_RAYCASTER)`) or "not in the catalog". `corpus/unsupported-export.ts` imports `Raycaster`; its `.expected` is `# compile-error ...`, so it passes only when the build fails naming it, and `--expect-compile-error` refuses a selected case that is not such a case. Unit-tested in `run-corpus.spec.ts` (aliases, subpaths, other modules ignored); the whole corpus is 13/13 in both modes (reference `n/a` for the compile-error case)

#### Phase 2: Callbacks cross and come back
**Status:** NOT STARTED
**Files:** proposed `tools/native-typescript/corpus/callbacks/`, `packages/runtime-native/tests/native-engine/aot_callback_test.cpp`
- [ ] A native engine callback invokes a compiled TS closure with the right arguments and the closure's exception surfaces as a status code, not a crash. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_aot_callback` — **reopened 2026-10-05: proven with tslang, which decision 11 drops for Perry; re-prove with Perry.** tslang history: 2026-10-05: green (`native_engine_aot_callback` runs `run-corpus.mjs --native --case aot-callback` against the build's archives). The facade sets `onBeforeRender` through `tn_set_callback` with a C trampoline that calls the exported TypeScript dispatcher; the engine's own stored callback, fired as a renderer fires it, reaches the closure with three's arguments (renderer null, the scene, camera null, the mesh's geometry and material, group null), and a closure that throws comes back as `TN_CALLBACK_FAILED onBeforeRender: boom`, not a crash. The pinned tslang refuses a closure with fewer parameters than the callback type, which TypeScript allows
- [ ] A mesh ↔ closure cycle is reclaimed after the mesh leaves the scene and its last TS reference drops, within the defined safe point. proof: `node tools/native-typescript/run-corpus.mjs --native --case callback-cycle` — **reopened 2026-10-05: proven with tslang, which decision 11 drops for Perry; re-prove with Perry.** tslang history: 2026-10-05: green, 4/4 runs. Each facade wrapper carries a no-order Boehm finalizer (an ordered one never runs on an object that reaches itself) that clears its callbacks and releases its engine object; the shim holds wrappers in unscanned memory (weak) and keeps a callback-bearing one in a scanned table while its object is attached, decided at `safePoint()`. A closure that captures its own mesh: held and still fired while in the scene; after `scene.clear()`, a safe point and a collection, the live engine objects are back to the baseline. The collection scrubs the dead stack below its frame first: the collector scans conservatively, and a pointer left in a returned frame kept the mesh alive
- [ ] 10,000 create/attach/detach cycles hold engine object count and RSS flat. proof: `node tools/native-typescript/run-corpus.mjs --native --case callback-churn` — **reopened 2026-10-05: proven with tslang, which decision 11 drops for Perry; re-prove with Perry.** tslang history: 2026-10-05: green: 10,000 cycles of a mesh whose callback captures it, attached and detached, with a safe point and collection every 1,000: live engine objects back to the baseline at every checkpoint (peak = baseline = 1), resident set 16.4 → 17.5 MB

## Decisions

- **No permanent rooting of callbacks (§7.1).** A compiler that can only pin closures forever is not qualified for this profile; the stop rule in [PRD-505](PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md#decisions) applies.
