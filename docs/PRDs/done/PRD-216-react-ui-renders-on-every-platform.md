---
prd_contract: v1
---

# PRD-216 — a React UI renders on every platform, natively, without a WebView

**Status:** COMPLETED 2026-08-24. Browser, Linux desktop native, and physical Pixel 8 evidence is
recorded in `docs/verification/prd-216-2026-08-24.md`. iOS remains explicitly unproven because no
physical iOS lane exists on this machine.

**Complexity:** +2 new module from scratch (reconciler host config), +2 second new module
(layout), +1 multi-package (core + templates), +2 new capability with no incumbent = **7 → HIGH
mode**.

Owner's requirement, verbatim: *"I need a react UI working on all platforms"*, and *"react in all
platforms, including natively (web is fine already, skip)"*. This overrules PRD-051's candidate D
(`@threenative/ui` stays web-only) and answers PRD-055's *"G now, E next"* with **E now**.

## Context

A game scaffolded from `starter` renders its world on Android and shows **no HUD, no minimap, no
crosshair and no visible touch controls**. The whole UI is React — `src/ui/App.tsx`, `Hud.tsx`,
`Minimap.tsx`, `TouchOverlay.tsx` — mounted from `src/main.ts` through `react-dom`, and
`threenative.config.ts` sets `nativeEntry: "src/game.ts"`, so `main.ts` never executes on native.
`TN_NATIVE_WEB_ONLY_UI` (`packages/create-threenative/src/build.ts:67-72`) exists to make that
loud, and it works.

Bug 2 in `docs/bugs/mobile-stability-2026-08-23.md` has the full history, including that five
templates additionally lost their *geometry* HUD to a line-count reduction round on 2026-08-15.
That regression is a separate, smaller fix. **This PRD is about the React half.**

### Four facts established by investigation on 2026-08-23 — do not re-derive them

1. **`react` is already portable; only `react-dom` is not.** The `react` package is the component
   model — `createElement`, hooks, context, scheduling — with no DOM dependency. `react-dom` is one
   renderer among several: React Native maps to native views, `react-three-fiber` maps to Three.js
   objects, `ink` maps to a terminal. `react-reconciler` is the public, supported API for writing
   another. Templates already carry `react@19.2.0`.

2. **The host surface already exists and already draws on Android.** `packages/core/src/canvas-layer.ts`
   is an `OrthographicCamera` + `Scene` sized in literal screen pixels
   (`camera.left = -width/2`), drawn by `renderer.renderOverlay(canvasLayer.scene,
   canvasLayer.camera)` at `packages/core/src/game.ts:600-602`. No DOM on that path. The template
   loading screen renders through it on the device today.

3. **The native runtime has a DOM shim, and it cannot paint.** `packages/runtime-native/src/runtime.cpp`
   exposes `document`, `window`, `getElementById`, `addEventListener`, `dispatchEvent`,
   `createElement` and `createElementNS`. But `createElement('canvas')` returns an object whose
   `getContext()` is `null`, and `createElement('div')` returns `{ tagName, style, className, id }`
   — **no `appendChild`, no `insertBefore`, no child nodes, no text nodes**. It exists so three.js
   can call `document.createElement("canvas")` internally. Making `react-dom` work against it means
   implementing a DOM *and* a rasteriser, which is building a browser. There is no WebView in the
   Android host, current or historical.

4. **`TN_NATIVE_WASM_ON_MOBILE` refuses WASM in mobile bundles**, which is what killed the inlined
   `KTX2Loader`, `meshopt_decoder` and `DRACOLoader` imports
   (`docs/verification/core-ktx2-android-2026-08-23.md`). **Yoga is therefore unavailable** and
   layout must be pure TypeScript.

   **Correction, and an open question this PRD does not answer.** That KTX2 record explains the gate
   as "Android runs QuickJS, iOS runs JSC without a JIT, so there is no WASM engine at all". The
   first half is wrong: **Android has defaulted to V8 since PRD-130 (2026-08-16)** —
   `android/app/build.gradle.kts:16` reads `providers.gradleProperty("threenativeJsEngine").orElse("v8")`,
   and QuickJS is the documented rollback. V8 does support WebAssembly in general, and
   `src/js/v8_engine.cpp:189` passes `false /* is WASM */` at one call site, which is not proof
   either way about the Android build's capability. So **whether the gate's stated rationale still
   holds is unverified.** It does not change this PRD — pure-TS layout is required for the QuickJS
   rollback path regardless — but anyone widening WASM policy must measure it rather than cite that
   sentence.

### Routes rejected, with the evidence

| Route | Why not |
| --- | --- |
| Extend the DOM shim until `react-dom` works | Requires a DOM *and* a rasteriser. That is a browser. Fact 3. |
| WebView | Explicitly excluded by the owner; none exists in the host. |
| React → canvas2d → texture, rasterised by Skia | Skia is in `desktopDeps` only; `androidDeps` has none (`download-deps.mjs:1050`). Dies on the platform that matters. |
| Yoga for flexbox layout | WASM. Fact 4. |
| Keep React on web, geometry on native, share state | The status quo (PRD-051 candidate D). Explicitly overruled. |

## Solution

A **custom `react-reconciler` host config** mapping React elements to Three.js objects inside
`CanvasLayer`, plus a small pure-TypeScript layout pass. Import `react`; never `react-dom`.

```mermaid
flowchart LR
    J["JSX — one source"] --> R["react (portable)"]
    R -->|web| D["react-dom → DOM"]
    R -->|native + web| N["reconciler host config"]
    N --> L["layout pass (pure TS)"]
    L --> C["CanvasLayer: Ortho camera in screen pixels"]
    C --> O["renderer.renderOverlay()"]
    O --> P["pixels on every platform"]
```

Text reuses the bitmap-glyph mechanism already in
`packages/create-threenative/templates/minimal/src/render/hud.ts`, measured `pixelMismatchRatio` 0
against the browser reference on Linux desktop native, the Android emulator and a physical Pixel 8
(`docs/verification/prd-209-2026-08-23.md`).

**Mechanism goes in `packages/core`; appearance does not.** The reconciler and the layout pass are
plumbing every game would otherwise repeat. Styling decides how things look, so it ships as
generated source in the templates. **Tailwind cannot cross — it is CSS.** Do not write a CSS engine.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|-----------|-------------------------------------|----------|-------------------|------------------|
| 1 | Reconciler host config | template `src/game.ts` mounting UI into `ctx.canvasLayer` | nothing on native; React was absent | no — `react-dom` keeps web | mount with a component that throws → named error, not a silent blank |
| 2 | Layout pass | the host config's commit phase | absolute placement by hand in `render/hud.ts` | no, geometry HUD stays valid | zero-size / cyclic constraint → refuse loudly |
| 3 | Glyph text host node | layout pass leaf nodes | `hud.ts`'s hand-built `InstancedMesh` | no, it is the same mechanism | unknown glyph → refuse rather than draw blank |
| 4 | `TN_NATIVE_WEB_ONLY_UI` stays intact | `build.ts:67-72` | n/a | n/a | plant a `react-dom` import in `game.ts` → build still refuses |

### Reachability

**How is this reached?** `threenative build --target android|desktop` → the portable
`nativeEntry` mounts its React tree into `ctx.canvasLayer` → the reconciler commits Three.js
objects → `renderer.renderOverlay` draws them.

**User-facing?** Yes. It is the difference between a phone showing the game's UI and showing none.

**What does this replace?** Nothing is deleted. Web keeps `react-dom`; the geometry HUD stays a
valid hand-written option; this adds the path that was missing.

## Execution Phases

#### Phase 0: EXECUTED 2026-08-23 — the approach survives

- [x] **`react@19.2.0` + `react-reconciler@0.33.0` mount, update and unmount under QuickJS 0.11.0**
      (the version vendored in `packages/runtime-native/third_party/quickjs`, built with clang).
      **Desktop x86-64 `qjs` only — not a phone.**
- [x] **Cost, measured:** bundle 450.8 KB raw / **71,543 B gzip** (React + reconciler + host config
      + probe, esbuild iife, `NODE_ENV=production`). Mount 0.274 ms for 7 host nodes. **200 state
      changes: p50 0.1837 ms, p95 0.2134 ms.** Per change the host config saw
      `createInstance 0, appendChild 0, removeChild 0, commitUpdate 7, commits 1` — so it updates in
      place rather than rebuilding. **10,000 idle flushes took 4.359 ms total (~0.4 µs each)**, which
      answers the per-frame question: a frame with no state change costs essentially nothing.
      Against PRD-214's measured 46.15 ms `renderer.render()` p50, a ~0.18 ms UI update is noise.
- [x] One error, and it is not a blocker: `ReferenceError: setTimeout is not defined` — standalone
      `qjs` lacks it, while the real runtime already installs `setTimeout`, `performance` and
      `console` (`runtime.cpp`). A 30-line prelude supplying those shapes fixed it.
- [x] **Run the same React renderer on the physical Pixel
      8.** A cross-compiled arm64 `qjs` (NDK 27.1, Android 30) was built for exactly this and never
      used. The shipping V8 runtime executed the fps-framework bundle on Pixel 8 in landscape;
      state-changing UI commits measured p50 2.156 ms and p95 3.655 ms. QuickJS remains the
      rollback proof rather than a claimed Android lane.
- [x] Price the smallest honest layout model: the pure-TS subset plus native mount is 61 normalized
      lines against the 69-line geometry HUD. `count-loc.ts` reports the comparison and its unit
      test fails if the native path grows past the geometry path.

**Artefacts kept** in `docs/verification/prd-216-spike/`: `host.js` (128 lines — a working React 19
host config), `probe.js` (98), `prelude.js` (30).

**React 19 host-config API notes, learned the hard way.** `react-reconciler@0.33` has no
`flushSync`/`prepareUpdate`; the API is `updateContainerSync` + `flushSyncWork` +
`flushSyncFromReconciler`. React 19 additionally requires `resolveUpdatePriority`,
`maySuspendCommit`, `NotPendingTransition` and a `HostTransitionContext` object in the host config,
or it throws at mount.

#### Phase 1: the reconciler renders one component natively

**Files (max 5):** `packages/core/src/react-host.ts` (NEW), its spec (NEW), `canvas-layer.ts`
(EDIT if it needs a mount point), export wiring, evidence record (NEW).

- [x] Red first: the missing native renderer and required React 19 host hooks failed before the
      reconciler host mounted; the red-green record is in the verification file.
- [x] Host config with create/append/remove/commit mapping to Three.js objects in `CanvasLayer`.
- [x] Fail closed: a component that throws names itself, preserves the last good overlay, and can
      recover on the next render.

#### Phase 2: layout

**Files (max 4):** `packages/core/src/react-layout.ts` (NEW), spec (NEW), integration, record.

- [x] Pure TypeScript. No WASM, no Yoga, no CSS parser.
- [x] The shipped subset is **named exhaustively** in the templates' `AGENTS.md`. A game can read
      what is supported without discovering it by failure.

#### Phase 3: one template converted, both targets

**Files (max 5):** one template's `src/ui/` + its native mount, playtest scenario, record.

- [x] The **same components** render on web and native. The FPS crosshair component is authored
      once with web/native paint adapters; the fresh starter browser suite stays green.
- [x] Device proof on physical Pixel 8 `shiba`, serial `192.168.1.192:5555`.
- [x] The starter React cells are covered by cold browser playtests plus desktop/Pixel native
      scenarios; iOS is recorded as unproven instead of inferred.

## Verification Strategy

Record `docs/verification/prd-216-<date>.md`. Every device claim names its lane — physical Pixel 8
vs emulator vs desktop — and no claim is made for a platform that did not execute. **iOS is
unproven: there is no physical lane on this machine.** Gates: `pnpm typecheck && pnpm lint && pnpm
test && pnpm budgets`, plus `count-loc.ts`.

Two machine-specific traps: `packages/playtest/__tests__/orphan-cleanup.sh` matches **any**
Chromium on the box — including another project's — and reds under concurrent work; and
`TN_ANDROID_SETTLE_MS` defaults to 3000, which races this device and surfaces as
`TN_ANDROID_FOREGROUND_WINDOW: 'android' owns focus`, reading exactly like a locked phone.
`TN_ANDROID_SETTLE_MS=12000` passes.

## Acceptance Criteria

- [x] A React component written once renders on web **and** on a physical Pixel 8, with the web
      output unchanged.
- [x] `react-dom` is still refused in native bundles — `TN_NATIVE_WEB_ONLY_UI` observed firing on a
      planted import.
- [x] The frame cost of a UI state change is measured on device and stated, not estimated.
- [x] The supported layout subset is named in the templates' `AGENTS.md`; a convention missing from
      there does not exist.
- [x] `count-loc.ts` shows the framework path costs a game no more than the geometry HUD it
      replaces.
- [x] iOS is explicitly recorded as unproven rather than omitted.

## Out of scope

- Tailwind, CSS, or any stylesheet language on native.
- Making `react-dom` work natively, extending the DOM shim, or any WebView.
- Deleting the geometry HUD path — it stays valid and is what unbreaks templates today.
- iOS claims until a physical lane exists.
