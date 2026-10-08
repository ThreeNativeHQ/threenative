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

## Execution Phases

#### Phase 1: The opt-in routes a web build to the Wasm back end
**Status:** DONE
**Files:** `packages/core/src/config.ts`, `packages/create-threenative/src/build.ts`, the back-end entry, `scripts/verify-template-playtests.ts`
- [x] `engine: "native"` aliases `three`, `three/webgpu` and `three/tsl` in the generated web build driver; an absent or `"legacy"` setting leaves the driver byte-identical. proof: `pnpm exec vitest run packages/create-threenative/__tests__/web-engine.spec.ts` — 2026-10-08: 5/5 passed. `engine` is validated in `loadConfig` (`TN_CONFIG_ENGINE_INVALID`, default `"legacy"`, `config.spec.ts`). The legacy driver equals the pinned pre-change text; under `"native"` the driver always runs and adds `createWebEnginePlugin` (`packages/create-threenative/src/web-engine.ts`), and a named `--config` fails with `TN_WEB_ENGINE_CONFIG_NAMED`. A real Vite build of a game importing all three entry points bundles the binding and no upstream `Vector3`, while the same game built as legacy bundles upstream `Vector3` (the negative control). `three/src/*` and `three/build/*` fail with `TN_NATIVE_UPSTREAM_IMPORT`; a missing Wasm entry fails with `TN_WASM_ENGINE_MISSING`. `create-threenative` now ships `dist/web-engine-runtime.js` (678 KB, the catalog included).
- [x] Every upstream export the back end does not bind throws its catalog diagnostic on first use, and no export resolves to upstream three. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-entry.spec.ts` — 2026-10-08: 3/3 passed (three-native suite 77/77). `bindUpstreamExports` (`packages/three-native/src/browser-entry.ts`) binds all 1,265 upstream names: the 62 registry classes, catalog constants by value, and a refusal for every other name that throws its catalog diagnostic (`TN_NATIVE_UNSUPPORTED_WEBGPURENDERER`, `TN_NATIVE_UNCATALOGUED_<NAME>`) on any call, construction or property access. No name is identical to an upstream object. The binding found two malformed catalog constants (`RGB_BPTC_*_Format` = `"X = N"`); `semanticErrors` now rejects a published constant whose value is not its type (red on the committed catalog, then fixed).
- [x] `TN_TEMPLATE_ENGINE=native` scaffolds templates with `engine: "native"`, and no other value is accepted. proof: `pnpm exec vitest run scripts/__tests__/verify-template-playtests.spec.ts` — 2026-10-08: 11/11 passed. `templateEngine` refuses any value except `legacy`/`native`. Under `native` the gate writes `engine: "native"` into the scaffold config (a config without its opening fails with `TN_TEMPLATE_ENGINE_OPT_IN_FAILED`) and boots the built output with `vite preview`, not `pnpm dev`; legacy scaffolds are unchanged.

Known gap, not claimed: `pnpm dev` reads the project's own Vite config, which does not add the
plugin, so the dev server still bundles upstream three under `engine: "native"`. The template gate
judges native boots on the built output for that reason. Gates on 2026-10-08: `pnpm typecheck`
passed; `pnpm lint` has no error; the `create-threenative` and `three-native` suites pass, with two
asset-compile cases that timed out at load 30 and passed when rerun alone. `pnpm budgets` fails on
a stale native coverage digest. This lane changed no `packages/runtime-native` file.

#### Phase 2: A core game presents a frame on the Wasm renderer
**Status:** NOT STARTED
**Files:** `packages/runtime-native/` (product Wasm entry), `packages/three-native/src/` (renderer facade), `packages/core/src/renderer.ts`, a playtest scenario
- [ ] The `WebGPURenderer` facade initializes on the page's canvas, reports a hardware adapter, and presents a non-blank frame from `render(scene, camera)`. proof: `node packages/playtest/dist/runner/cli.js <wasm-renderer>.playtest.json --browser-recipe webgpu`
- [ ] A `@threenative/core` game without TSL in its own source boots through `createRenderer` under `engine: "native"`, presents frames, and never constructs `WebGLRenderer`. proof: the same runner on a core fixture scenario

#### Phase 3: Template TSL and post run on the Wasm back end
**Status:** NOT STARTED
**Files:** `packages/three-native/src/`, `packages/runtime-native/src/engine/abi/`, shared with PRD-531
- [ ] The TSL graphs in the `minimal` template compile through the engine shader IR from the browser back end. proof: `pnpm exec vitest run packages/three-native/__tests__/browser-tsl.spec.ts`
- [ ] `pass` and `RenderPipeline` render the `minimal` post chain on Wasm through the PRD-531 C ABI. proof: `node packages/playtest/dist/runner/cli.js <wasm-post>.playtest.json --browser-recipe webgpu`
- [ ] The `minimal` template journey passes on the Wasm engine. proof: `TN_TEMPLATE_ONLY=minimal TN_TEMPLATE_ENGINE=native pnpm test:templates`

Every template's journey, visuals and the blind A/B stay PRD-533 phase 3 boxes 2-4; this PRD makes
them runnable.
