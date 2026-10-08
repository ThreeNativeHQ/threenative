# PRD-540 — Web games boot on the Wasm engine

**Status:** IN PROGRESS
**Priority:** P1 — no template can boot on the Wasm engine, so PRD-533's web promotion boxes cannot run
**Complexity:** 7 (HIGH) — 11+ implementation files, a new web back-end module, and the Emscripten build boundary
**Owner:** João
**Work package:** N20 support — [native-engine batch](README.md)
**Depends on:** [PRD-532 (N19)](../done/native-engine/PRD-532-n19-webassembly-native-core-browser-port.md) (done); [PRD-531 (N18)](PRD-531-n18-v8-game-runtime-adapter.md) for the shared `pass`/`RenderPipeline` ABI in phase 3

## Context

[PRD-533](PRD-533-n20-platform-qualification-performance-default-promotion.md) phase 3 needs every
template journey and visual baseline on the Wasm engine. On 2026-10-08 no template could boot there
(PRD-533 phase 3 records the per-template catalog scan):

- No setting selects the Wasm engine for a web build. `resolveNativeProfile`
  (`packages/create-threenative/src/native-profile.ts`) has no caller and covers desktop artifacts.
- Nothing points a web game's `three*` imports at the browser-JS back end
  (`packages/three-native/src/browser-backend.ts`). Only Wasm test pages and the
  `engine-load-test` web bench construct it.
- The Wasm module is a test host (`packages/runtime-native/tests/native-engine/wasm/browser.cpp`):
  a fixed `#c` canvas selector, a fixed size, and `tnw_render` for a `PerspectiveCamera` only.
- The catalog marks `WebGPURenderer`, `RenderPipeline`, `pass` and every TSL node `unsupported`.
  Every template boots through `packages/core/src/renderer.ts`, which constructs `WebGPURenderer`
  and silently falls back to `WebGLRenderer` when that throws. Even `minimal` builds TSL graphs in
  `src/render/` (environment, auto exposure, backlight material).

## Solution

1. **Opt-in.** `engine?: "legacy" | "native"` in `threenative.config.ts`, typed with the existing
   `ThreeNativeEngine`, defaults to `"legacy"`. `webBuildDriver` (`packages/create-threenative/src/build.ts`)
   and the dev server alias `three`, `three/webgpu` and `three/tsl` to one back-end entry only when
   it is `"native"`. The legacy driver output stays byte-identical. The template gate scaffolds
   with `TN_TEMPLATE_ENGINE=native`. No default changes; promotion stays PRD-533's owner decision.
2. **Back-end entry.** A top-level-await module boots the Wasm module, then exports the registry
   classes from `defineBrowserClasses`. Every other upstream export name is a stub that throws its
   catalog diagnostic (`TN_NATIVE_UNSUPPORTED_<NAME>`, or `TN_NATIVE_UNCATALOGUED_<NAME>`) on first
   use, so the game bundles and an unbound symbol fails loudly instead of falling back to upstream.
3. **Renderer.** A `WebGPURenderer` facade over a product Wasm entry: canvas element, resize,
   pixel ratio, `init()` with the real adapter facts, `render(scene, camera)`, `info`. Under the
   native engine `createRenderer` never falls back to `WebGLRenderer`. The packed tarballs carry the
   Wasm module so a scaffolded project resolves it.
4. **TSL and post.** The template TSL graphs and `pass`/`RenderPipeline` reach the engine's shader
   IR (`tsl.cpp`) and the PRD-526 post-graph compiler through the C ABI that PRD-531 adds for the V8
   back end. One ABI, two language back ends; nothing is compiled twice.

Rollback: delete `engine: "native"` from the config. Risks: core reads renderer internals
(`backend.trackTimestamp`, the pipeline census, the draw hook), so the facade must answer them or
core must skip them by name; `three-mesh-bvh` and `@threenative/physics` also import `three` and
reach geometry arrays directly.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Web engine selection | `threenative build --target web` and `vite` dev → `webBuildDriver` | Legacy path unchanged, default | Phase 1 |
| Wasm renderer | `createRenderer` in `packages/core/src/renderer.ts` | `WebGLRenderer` fallback refused under `native` | Phase 2 |
| TSL and post on Wasm | template `src/render/` → back-end entry → C ABI | Shared with the PRD-531 V8 back end | Phase 3 |

## Decisions

- 2026-10-08 (owner, relayed by the coordinator): no stubs or mocks for unreached imports. A symbol a game reaches is made real by its owner (TSL Node classes: lane-531; MeshBVH: lane-assets); an import nothing reaches leaves the bundle (lane-tier-imports).

## Execution Phases

#### Phase 1: The opt-in routes a web build to the Wasm back end
**Status:** DONE
**Files:** `packages/core/src/config.ts`, `packages/create-threenative/src/build.ts`, the back-end entry, `scripts/verify-template-playtests.ts`
- [x] `engine: "native"` aliases `three`, `three/webgpu` and `three/tsl` in the generated web build driver; an absent or `"legacy"` setting leaves the driver byte-identical. proof: `pnpm exec vitest run packages/create-threenative/__tests__/web-engine.spec.ts` — 2026-10-08: 5/5 passed. `engine` is validated in `loadConfig` (`TN_CONFIG_ENGINE_INVALID`, default `"legacy"`, `config.spec.ts`). The legacy driver equals the pinned pre-change text; under `"native"` the driver always runs and adds `createWebEnginePlugin` (`packages/create-threenative/src/web-engine.ts`), and a named `--config` fails with `TN_WEB_ENGINE_CONFIG_NAMED`. A real Vite build of a game importing all three entry points bundles the binding and no upstream `Vector3`, while the same game built as legacy bundles upstream `Vector3` (the negative control). `three/src/*` and `three/build/*` fail with `TN_NATIVE_UPSTREAM_IMPORT`; a missing Wasm entry fails with `TN_WASM_ENGINE_MISSING`. `create-threenative` now ships `dist/web-engine-runtime.js` (678 KB, the catalog included).
- [x] Every upstream export the back end does not bind throws its catalog diagnostic on first use, and no export resolves to upstream three. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-entry.spec.ts` — 2026-10-08: 3/3 passed (three-native suite 77/77). `bindUpstreamExports` (`packages/three-native/src/browser-entry.ts`) binds all 1,265 upstream names: the 62 registry classes, catalog constants by value, and a refusal for every other name that throws its catalog diagnostic (`TN_NATIVE_UNSUPPORTED_WEBGPURENDERER`, `TN_NATIVE_UNCATALOGUED_<NAME>`) on any call, construction or property access. No name is identical to an upstream object. The binding found two malformed catalog constants (`RGB_BPTC_*_Format` = `"X = N"`); `semanticErrors` now rejects a published constant whose value is not its type (red on the committed catalog, then fixed).
- [x] `TN_TEMPLATE_ENGINE=native` scaffolds templates with `engine: "native"`, and no other value is accepted. proof: `pnpm exec vitest run scripts/__tests__/verify-template-playtests.spec.ts` — 2026-10-08: 11/11 passed. `templateEngine` refuses any value except `legacy`/`native`. Under `native` the gate writes `engine: "native"` into the scaffold config (a config without its opening fails with `TN_TEMPLATE_ENGINE_OPT_IN_FAILED`) and boots the built output with `vite preview`, not `pnpm dev`; legacy scaffolds are unchanged.

2026-10-08 follow-up: `pnpm dev` now follows the setting too. Every template's Vite config lists
`createWebEnginePlugin({ engine: config.engine })`, which does nothing for a legacy project; the
fixture's renderer scenario passes against the dev server (`playtest:renderer:dev`). The template
gate still judges native boots on the built output. Gates on 2026-10-08: `pnpm typecheck`
was first reported as passing, which was wrong: colour codes hid a TS2741 in a `build.spec.ts`
fixture (the new required `engine` field) and one in the example; both fixed, and the root
`pnpm typecheck` exits 0; `pnpm lint` has no error; the `create-threenative` and `three-native` suites pass, with two
asset-compile cases that timed out at load 30 and passed when rerun alone. `pnpm budgets` fails on
a stale native coverage digest. This lane changed no `packages/runtime-native` file.

#### Phase 2: A core game presents a frame on the Wasm renderer
**Status:** PARTIAL
**Files:** `packages/runtime-native/` (product Wasm entry), `packages/three-native/src/` (renderer facade), `packages/core/src/renderer.ts`, a playtest scenario
- [x] The `WebGPURenderer` facade initializes on the page's canvas, reports a hardware adapter, and presents a non-blank frame from `render(scene, camera)`. proof: `cmake --build packages/runtime-native/build/wasm-browser --target tn-native-engine-web`, then `pnpm --filter wasm-engine-boot build:renderer && pnpm --filter wasm-engine-boot playtest:renderer` — 2026-10-08: PASS on the desktop, Chromium WebGPU under the runner's private Xvfb, adapter `nvidia turing` (the engine's own adapter, not SwiftShader). `examples/wasm-engine-boot/renderer.html` is plain three built through `threenative build --target web` with `engine: "native"`: the bundle carries no upstream three, the product host (`packages/runtime-native/src/engine/wasm/web_host.cpp`) draws 2 draws / 13 triangles per frame (box plus output pass), 30+ frames, and the box region is non-blank on the `#102030` clear colour. Two engine gaps this page found, each red then green: `new MeshStandardMaterial({ color })` failed with `TN_BROWSER_ARGUMENT_UNSUPPORTED` (the back end now applies three's `setValues`, `browser-parameters.spec.ts` 2/2), and `new Color(0x102030)` read the hex as the red channel (the binding now follows three's one-argument `Color.set`, `native_engine_abi_color_set` under Node-Wasm, all ten `abi_test` cases pass).
- [ ] A `@threenative/core` game without TSL in its own source boots through `createRenderer` under `engine: "native"`, presents frames, and never constructs `WebGLRenderer`. proof: `pnpm --filter wasm-engine-boot build:wasm && pnpm --filter wasm-engine-boot playtest:game` — open. 2026-10-08 it passed on the desktop (Chromium WebGPU, private Xvfb, `nvidia turing`): the fixture game (`examples/wasm-engine-boot/src/game.ts`, `defineGame` with the playtest plugin) reaches runtime readiness with no console error, its frame count advances, and a lit box and sphere fill the asserted region. `renderer.kind` is `webgpu`; `WebGLRenderer` is a refusal under the native engine, so a fallback would have failed the start. It passed only on the scratch branch `scratch/ne-wasm-templates-stubs`, where `three-mesh-bvh` resolved to refusal stubs and a refused class could be subclassed; the owner forbids stubs, so that run proves nothing shippable. The box reopens until core imports load for real: core subclasses `ShadowBaseNode` at import time (`VirtualShadowNode`, `packages/core/src/render/virtual-shadow.ts:728`; lane-531 makes the TSL Node classes real) and imports `three-mesh-bvh/webgpu` (`gpu-scene-bvh.ts`; lane-tier-imports moves it behind the feature that uses it). `three-mesh-bvh` itself now resolves to the engine MeshBVH (`packages/three-native/src/addons/mesh-bvh.ts`, from lane-assets). What the scratch run found and what landed for real, each red then green:
  - Core touched 17 unbound names while it was still being imported: 16 from `three-mesh-bvh` (`BatchedMesh CodeNode FunctionNode Line Line3 LineLoop LineSegments Node Points REVISION StructTypeNode TSL Triangle uint wgsl wgslFn`) and `ShadowBaseNode` from core. The stubs that got past them stay on the scratch branch only.
  - The class chain, `is*` flags, `userData` and the `traverse` family are now JavaScript on the browser back end (`browser-surface.spec.ts`, 0/4 then 4/4).
  - `Object3D.children` is bound in the engine (`native_engine_abi_children`), and the catalog and registry snapshot follow (the engine dump equals the snapshot ignoring whitespace; the Wasm `--check` cannot read host files, so the native ctest owns that check).
  - `add(a, b, c)` added only `a`; `add` and `remove` now take every argument, as three's do (same test, red then green).
- [ ] An engine object's browser wrapper keeps its JS state (`userData`, expandos, a JS subclass, authored attribute names, texture sources) while another engine object references it, and a detached subtree that JS cannot reach is still collected. proof: a Node `--expose-gc` spec against the real ABI module that collects for real and checks each kind of state plus the collected subtree, red on the current back end. Open. Today `browser-backend.ts` drops the wrapper when the collector takes it, and the next `children[i]`, `getObjectByName` or `material.map` makes a new one; the by-handle `userData` map saves only `userData`. V8 has the fix (lane/ne-gc, f6cb29930 and ccc35b519): a wrapper is strong while `tn::abi::engineReferences(handle) > 0`, otherwise weak. That count is the object's `use_count` minus the copies the ABI context holds for its own handles and member aliases. A reference from JS does not count, so the rule makes no cycle. The Wasm plan has two parts:
  - Export the count as a C call (for example `tn_object_engine_references(handle) -> uint32_t`) and rebuild the Wasm module.
  - JS has no GC prologue: a `FinalizationRegistry` runs after the wrapper is gone, and a `WeakRef` cannot become strong again. V8 promotes wrappers in a GC prologue, but the browser cannot do this. So the back end holds each wrapper that a call passes into the engine (a generalized `holdIfCallback`) in `held` until the next safe point. Then it keeps the hold while the count is above zero and drops the hold at zero. The by-handle `userData` map then has no job and goes.

#### Phase 3: Template TSL and post run on the Wasm back end
**Status:** NOT STARTED
**Files:** `packages/three-native/src/`, `packages/runtime-native/src/engine/abi/`, shared with PRD-531
- [ ] The TSL graphs in the `minimal` template compile through the engine shader IR from the browser back end. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-tsl.spec.ts`
  Progress 2026-10-08, not the box: the V8 TSL name table moved into the engine as `tn::abi::tslCall` (630e3ca26, V8 TSL ctests unchanged), the C ABI gained `tn_tsl_call`, and the browser back end binds `three/tsl` over it (13ad549a0). The renderer fixture draws a node material built from `uniform(0.5)` on `nvidia turing`. Still open for `minimal`: Fn, If, Loop, Else, toVar, assign, writing `uniform.value`, and the TSL names `minimal` uses that the table lacks (`mrt`, `normalView`, `output`, `pass`, `positionViewDirection`, `screenCoordinate`).
- [ ] `pass` and `RenderPipeline` render the `minimal` post chain on Wasm through the PRD-531 C ABI. proof: `node packages/playtest/dist/runner/cli.js <wasm-post>.playtest.json --browser-recipe webgpu`
- [ ] The `minimal` template journey passes on the Wasm engine. proof: `TN_TEMPLATE_ONLY=minimal TN_TEMPLATE_ENGINE=native pnpm test:templates`
- [ ] Midway's TSL nodes are complete in the shared table. `cameraPosition`, `cameraProjectionMatrix`, `cameraWorldMatrix`, `positionGeometry`, `normalWorld` and `varying` landed on `lane/ne-tsl-a` (52b7950c0, 5c2af603c, 1d55dd1d6, 43fcde0f3). Result: tsl-ir corpus "32 graphs, 0 differ" on tsl-js, tsl-graph and tsl-corpus; V8 `tsl_api` passes. proof: `node packages/runtime-native/tests/native-engine/differential.mjs --suite tsl-ir --native <tsl-js>` plus a shadow-pass and a vertexNode render check. Open, so the box stays open:
  - Shadow-depth pass (`renderer.cpp`, shadow caster loop): the three camera slots stay 0 there, so a `positionNode` that reads them (a billboard) casts a wrong shadow. Plan: in that block, fill `kCameraWorldMatrix` with the inverse of the shadow `view`, `kCameraPosition` with that inverse's translation, and `kCameraProjectionMatrix` with `page->projection` or `shadow.projection`. Prove it red-green with a shadow caster whose `positionNode` reads them. The TRAA velocity pass needs nothing: it refuses every `positionNode` draw (`TN_TRAA_VELOCITY_UNSUPPORTED`) and its program reads none of these uniforms.
  - A carried `varying(node)` whose graph type is unknown is typed by a scratch vertex lowering with no inputs. If that node reads `positionLocal` or another linked input, the material can refuse. Give the scratch program the inputs that `linkNodes` gives. Not reproduced yet.
  - `normalWorld` on a `DoubleSide` material does not flip back faces (three's `negateOnBackSide`). It also ignores `normalNode` and a normal map. `BackSide` is handled.
  - `material.vertexNode` has no graph slot. Midway's particles and water effects set it (`cameraProjectionMatrix.mul(...)`), so these materials do not draw as authored.

Every template's journey, visuals and the blind A/B stay PRD-533 phase 3 boxes 2-4; this PRD makes
them runnable.
