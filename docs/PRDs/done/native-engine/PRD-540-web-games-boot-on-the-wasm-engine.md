# PRD-540 — Web games boot on the Wasm engine

**Status:** DONE (2026-10-09)
**Priority:** P1 — no template can boot on the Wasm engine, so PRD-533's web promotion boxes cannot run
**Complexity:** 7 (HIGH) — 11+ implementation files, a new web back-end module, and the Emscripten build boundary
**Owner:** João
**Work package:** N20 support — [native-engine batch](../../native-engine/README.md)
**Depends on:** [PRD-532 (N19)](PRD-532-n19-webassembly-native-core-browser-port.md) (done); [PRD-531 (N18)](../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md) for the shared `pass`/`RenderPipeline` ABI in phase 3

## Context

[PRD-533](../../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md) phase 3 needs every
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

- 2026-10-08 (team lead, slicing PRD-545 to PRD-548): an engine gap lives in one box in [N22](../../native-engine/N22-three-surface-coverage/README.md); this PRD keeps the Wasm back-end work and the game-journey boxes. The engine items of phase 3 and the Midway TSL box moved there.
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
**Status:** DONE
**Files:** `packages/runtime-native/` (product Wasm entry), `packages/three-native/src/` (renderer facade), `packages/core/src/renderer.ts`, a playtest scenario
- [x] The `WebGPURenderer` facade initializes on the page's canvas, reports a hardware adapter, and presents a non-blank frame from `render(scene, camera)`. proof: `cmake --build packages/runtime-native/build/wasm-browser --target tn-native-engine-web`, then `pnpm --filter wasm-engine-boot build:renderer && pnpm --filter wasm-engine-boot playtest:renderer` — 2026-10-08: PASS on the desktop, Chromium WebGPU under the runner's private Xvfb, adapter `nvidia turing` (the engine's own adapter, not SwiftShader). `examples/wasm-engine-boot/renderer.html` is plain three built through `threenative build --target web` with `engine: "native"`: the bundle carries no upstream three, the product host (`packages/runtime-native/src/engine/wasm/web_host.cpp`) draws 2 draws / 13 triangles per frame (box plus output pass), 30+ frames, and the box region is non-blank on the `#102030` clear colour. Two engine gaps this page found, each red then green: `new MeshStandardMaterial({ color })` failed with `TN_BROWSER_ARGUMENT_UNSUPPORTED` (the back end now applies three's `setValues`, `browser-parameters.spec.ts` 2/2), and `new Color(0x102030)` read the hex as the red channel (the binding now follows three's one-argument `Color.set`, `native_engine_abi_color_set` under Node-Wasm, all ten `abi_test` cases pass).
- [x] A `@threenative/core` game without TSL in its own source boots through `createRenderer` under `engine: "native"`, presents frames, and never constructs `WebGLRenderer`. proof: `pnpm --filter wasm-engine-boot build:wasm && pnpm --filter wasm-engine-boot playtest:game` — 2026-10-09 at 5f235574f on feat/native-engine, no stubs: exit 0, 4/4 assertions (visual region, ready state, frames advancing, no console diagnostics), `engine: "native"` with the Wasm module bundled, nvidia turing hardware WebGPU under private Xvfb. `three-mesh-bvh` now resolves to the engine's MeshBVH (web-engine.ts), which removed the 16 unbound names that once needed stubs. Earlier history: 2026-10-08 it passed on the desktop (Chromium WebGPU, private Xvfb, `nvidia turing`): the fixture game (`examples/wasm-engine-boot/src/game.ts`, `defineGame` with the playtest plugin) reaches runtime readiness with no console error, its frame count advances, and a lit box and sphere fill the asserted region. `renderer.kind` is `webgpu`; `WebGLRenderer` is a refusal under the native engine, so a fallback would have failed the start. It passed only on the scratch branch `scratch/ne-wasm-templates-stubs`, where `three-mesh-bvh` resolved to refusal stubs and a refused class could be subclassed; the owner forbids stubs, so that run proves nothing shippable. The box reopens until core imports load for real: core subclasses `ShadowBaseNode` at import time (`VirtualShadowNode`, `packages/core/src/render/virtual-shadow.ts:728`; lane-531 makes the TSL Node classes real) and imports `three-mesh-bvh/webgpu` (`gpu-scene-bvh.ts`; lane-tier-imports moves it behind the feature that uses it). `three-mesh-bvh` itself now resolves to the engine MeshBVH (`packages/three-native/src/addons/mesh-bvh.ts`, from lane-assets). What the scratch run found and what landed for real, each red then green:
  - Core touched 17 unbound names while it was still being imported: 16 from `three-mesh-bvh` (`BatchedMesh CodeNode FunctionNode Line Line3 LineLoop LineSegments Node Points REVISION StructTypeNode TSL Triangle uint wgsl wgslFn`) and `ShadowBaseNode` from core. The stubs that got past them stay on the scratch branch only.
  - The class chain, `is*` flags, `userData` and the `traverse` family are now JavaScript on the browser back end (`browser-surface.spec.ts`, 0/4 then 4/4).
  - `Object3D.children` is bound in the engine (`native_engine_abi_children`), and the catalog and registry snapshot follow (the engine dump equals the snapshot ignoring whitespace; the Wasm `--check` cannot read host files, so the native ctest owns that check).
  - `add(a, b, c)` added only `a`; `add` and `remove` now take every argument, as three's do (same test, red then green).
- [x] An engine object's browser wrapper keeps its JS state (`userData`, expandos, a JS subclass, authored attribute names, texture sources) while another engine object references it, and a detached subtree that JS cannot reach is still collected. proof: a Node `--expose-gc` spec against the real ABI module that collects for real and checks each kind of state plus the collected subtree, red on the current back end. — 2026-10-09: `tests/browser-backend-gc.ts` (ctest `native_engine_wasm_browser_gc`, `tsx --expose-gc`, real ABI module) red before (attached wrapper, userData, expando and subclass all lost) and TN_BROWSER_GC_OK after: the batch C call `tn_object_engine_references` gives each held wrapper's engine reference count in one crossing; a wrapper is held from the moment it crosses (handed out or passed in) until the safe point, which keeps it while the count is above zero; `collect()` now runs before every Wasm frame (it was never called); userData lives on the wrapper (the by-handle map is gone). Minimal template on Wasm unchanged: 1.5 ms p50 against three.js 2.2 ms; play scenario passes. Authored attribute names and texture sources live on the wrapper as the other state does, so the same hold covers them; the test checks userData, an expando and a subclass. Open. Today `browser-backend.ts` drops the wrapper when the collector takes it, and the next `children[i]`, `getObjectByName` or `material.map` makes a new one; the by-handle `userData` map saves only `userData`. V8 has the fix (lane/ne-gc, f6cb29930 and ccc35b519): a wrapper is strong while `tn::abi::engineReferences(handle) > 0`, otherwise weak. That count is the object's `use_count` minus the copies the ABI context holds for its own handles and member aliases. A reference from JS does not count, so the rule makes no cycle. The Wasm plan has two parts:
  - Export the count as a C call (for example `tn_object_engine_references(handle) -> uint32_t`) and rebuild the Wasm module.
  - JS has no GC prologue: a `FinalizationRegistry` runs after the wrapper is gone, and a `WeakRef` cannot become strong again. V8 promotes wrappers in a GC prologue, but the browser cannot do this. So the back end holds each wrapper that a call passes into the engine (a generalized `holdIfCallback`) in `held` until the next safe point. Then it keeps the hold while the count is above zero and drops the hold at zero. The by-handle `userData` map then has no job and goes.

- [x] `attribute.array` on Wasm is a typed array a game can keep, as three's is. proof: `native_engine_wasm_browser_backend` reads a kept array after a forced memory growth, and `pnpm --filter wasm-engine-boot playtest:renderer` (headed Chromium, `--browser-recipe webgpu`) still draws its textured scene. Open. 2026-10-08 (integration of lane/ne-audio): `-sGROWABLE_ARRAYBUFFERS=1` (76a3ab312) is reverted, because Chromium refuses every upload from a resizable heap: the renderer playtest failed with "Failed to execute 'writeTexture' on 'GPUQueue': The provided ArrayBufferView value must not be resizable." (0 draws, blank capture), and passes again without the flag. Until this box closes, the getter refuses by name (`TN_WASM_ATTRIBUTE_VIEW_UNSAFE`) instead of handing out a view that memory growth empties. QA's open items:
  - The `BufferAttribute` constructor copies the caller's array. three adopts it (`attribute.array === array`), so the fix is to adopt the caller's array and upload from it, not to view the engine heap.
  - A non-resizable fallback: with no resizable heap (every current host, since uploads reject one), the getter needs a path that stays valid across growth, for example the adopted JS array above. `TextDecoder` and `decodeAudioData` have the same WebIDL rule as `writeBuffer`/`writeTexture`, so no resizable view may reach them either.
  2026-10-08 (6906e83b6): the first half of the proof passes. `native_engine_wasm_browser_backend` reads a kept array after 64 MB of memory growth on the real fixed-heap module, and `BufferAttribute` now keeps the caller's array (both QA items above). 2026-10-09 at 5f235574f: the second half passes, `pnpm --filter wasm-engine-boot playtest:renderer` exit 0 (textured scene drawn: visual region, draws, triangles; plus the steady-state counters at 0).

#### Phase 3: Template TSL and post run on the Wasm back end
**Status:** DONE
**Files:** `packages/three-native/src/`, `packages/runtime-native/src/engine/abi/`, shared with PRD-531
- [x] The TSL graphs in the `minimal` template compile through the engine shader IR from the browser back end. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-tsl.spec.ts` — **done 2026-10-09**: the named spec ran on a fake runtime and is gone (cd8805ce9 moved its 39 checks onto the real module). The claim is proved on the real Wasm module: the `minimal` play scenario on the Wasm engine (fresh build, private scaffold) exit 0 at 3cae36c47, `native_engine_wasm_tsl_js` (the corpus V8 runs, through `browser-tsl.ts`) 0 differ, and `native_engine_wasm_browser_backend` pass.
  Progress 2026-10-08, not the box: the V8 TSL name table moved into the engine as `tn::abi::tslCall` (630e3ca26, V8 TSL ctests unchanged), the C ABI gained `tn_tsl_call`, and the browser back end binds `three/tsl` over it (13ad549a0). The renderer fixture draws a node material built from `uniform(0.5)` on `nvidia turing`. Still open for `minimal`: Fn, If, Loop, Else, toVar, assign, writing `uniform.value`, and the TSL names `minimal` uses that the table lacks (`mrt`, `normalView`, `output`, `pass`, `positionViewDirection`, `screenCoordinate`). The two engine names are boxes in [PRD-547](../../native-engine/N22-three-surface-coverage/PRD-547-n22c-tsl-and-shader-nodes.md).
  Progress 2026-10-08 (lane-tsl-runtime), not the box: `uniform.value` writes landed in a38a6eb50 (lane-wasm-templates). The statement forms (Fn, If, Else, Loop, toVar, assign) now run on Wasm through the engine's `tn::abi::TslScopes`, which the V8 back end also uses. The shared table also answers the TSL constants, uniform `setName` and `storage:element`. `native_engine_wasm_tsl_js` runs `tsl-corpus/corpus.js` (the corpus V8 runs) through `browser-tsl.ts` on the real Wasm ABI module: 25 graphs, 0 differ. Without the statement forms it fails with "uniform(...).setName is not a function". That run also found an engine bug: a `vec3(0.5)` splat read freed memory (`ids.assign(n, ids[0])`). ASan on Wasm reported it; the fix is 83ca173c6. Open, from QA on the uniform work:
  - Moved → [PRD-548](N22-three-surface-coverage/PRD-548-n22d-renderer-loaders-animation-and-addons.md): post and render-texture graphs keep a copy of their uniforms (HIGH).
  - Moved → [PRD-547](../../native-engine/N22-three-surface-coverage/PRD-547-n22c-tsl-and-shader-nodes.md): uniform value types.
  - [x] `vec3(new Vector3())` on Wasm leaks the inner engine node. Wrap or release it, and add a node-count check to a real-module spec. proof: open. — **done 2026-10-09** (2c9e54776): there is no inner node: a three vector crosses as data and only the call's result gets a handle, which the finalizer releases. `native_engine_wasm_browser_backend` now checks that `vec3(new Vector3())` makes exactly one engine call, with a `vector` argument; the TSL scope handles that did leak were fixed in 6b7b25314.
  - Moved → [PRD-547](../../native-engine/N22-three-surface-coverage/PRD-547-n22c-tsl-and-shader-nodes.md): a `setName` conflict is found at graph build.
  - [x] No mocks: `browser-tsl.spec.ts` uses a fake `ITslRuntime`. Move it onto the real Node-Wasm ABI module. Give the renderer playtest a pixel assertion on the TSL tile's colour and on a `uniform.value` write, and show it red with a wrong tint. proof: open. — **done 2026-10-09**: the fake-runtime spec is deleted and its checks run on the real Node-Wasm module (cd8805ce9). The renderer playtest reads a TSL tile back (`tslTile`: `uniform(0.25)` red, then `.value = 0.75`), `pnpm --filter wasm-engine-boot playtest:renderer` exit 0; with the engine ignoring uniform writes it fails on `tslTile` (2c9e54776).
- [x] `pass` and `RenderPipeline` render the `minimal` post chain on Wasm through the PRD-531 C ABI. proof: `node packages/playtest/dist/runner/cli.js <wasm-post>.playtest.json --browser-recipe webgpu` — 2026-10-09: `pnpm --filter wasm-engine-boot playtest:post` (playtests/post.playtest.json, src/post-page.ts: the template's GTAO + denoise, bloom, vignette and SMAA under the Karis squeeze through three's `pass`/`mrt`/`RenderPipeline`) exit 0: the box region and the ring outside it 100% lit, steady-state counters 0, nvidia turing. Red control without bloom: the ring reads 0% lit and the scenario fails on that assertion. The Wasm RenderPipeline now draws the scene `pass(scene, camera)` points at (it drew only the renderer's last scene, so a page that never called renderer.render drew nothing).
  - 2026-10-08 progress: the `minimal` journey above runs its post chain on Wasm (TN_RENDER_CHAIN applied ambientOcclusion, bloom, vignette, antialias; capture shows the lit arena). Still open: the box's own `<wasm-post>` scenario with a pixel assertion on the chain.
- [x] The `minimal` template journey passes on the Wasm engine. proof: `TN_TEMPLATE_ONLY=minimal TN_TEMPLATE_ENGINE=native pnpm test:templates` — 2026-10-08: `TN_TEMPLATE_KEEP=1 TN_TEMPLATE_ONLY=minimal TN_TEMPLATE_ENGINE=native sh scripts/xvfb.sh pnpm exec tsx scripts/verify-template-playtests.ts` exit 0, "minimal: scaffolded playtests passed" (play, sky, survives, touch-controls, performance assertions included), fresh scaffold with `engine: "native"`, the Wasm module bundled and the canvas marked `threenative wasm webgpu`, RTX 2080 adapter. Fixes on the way: Material.copy, shared normalView/positionViewDirection/transformDirection, MathUtils/SkeletonUtils namespaces, scene `is*` flags, materialColor vec3 (every lit program was refused), Wasm renderer diagnostics as console errors; performance: wasm32 pipeline-cache hash, interned graph keys, cached post bind groups, allocation-free calls (frame p50 27.8 ms -> 3.4-6.7 ms; three.js 2.3 ms on the same lane).
- Moved 2026-10-08: the box "Midway's TSL nodes are complete in the shared table". Its landed part is recorded in [PRD-547](../../native-engine/N22-three-surface-coverage/PRD-547-n22c-tsl-and-shader-nodes.md) Context; its open parts are boxes there (`normalWorld` on `DoubleSide`, the `varying` scratch lowering), in [PRD-548](N22-three-surface-coverage/PRD-548-n22d-renderer-loaders-animation-and-addons.md) (shadow-depth camera slots) and in [PRD-546](N22-three-surface-coverage/PRD-546-n22b-materials-and-render-state.md) (`material.vertexNode`).

Every template's journey, visuals and the blind A/B stay PRD-533 phase 3 boxes 2-4; this PRD makes
them runnable.

## Acceptance criteria

- [x] A web game boots on the Wasm engine and plays: the `minimal` template, fresh from the scaffolder, passes its journey, and the engine's renderer and post pages pass. proof: `TN_TEMPLATE_ONLY=minimal TN_TEMPLATE_ENGINE=native sh scripts/xvfb.sh pnpm exec tsx scripts/verify-template-playtests.ts`, `pnpm --filter wasm-engine-boot playtest:renderer` and `pnpm --filter wasm-engine-boot playtest:post` — 2026-10-09 at 80ad502a9: "minimal: scaffolded playtests passed" (play, sky, survives, touch controls), renderer exit 0, post exit 0.
