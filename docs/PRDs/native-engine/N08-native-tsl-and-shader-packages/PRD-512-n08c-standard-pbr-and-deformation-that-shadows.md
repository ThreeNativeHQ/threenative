# PRD-512 — Standard PBR and deformation that shadows (N08c)

**Status:** IN PROGRESS — the standard material is ported (BRDF_GGX_Multiscatter with the DFG lookup, Lambert, getRoughness, directional/hemisphere/ambient, sRGB OETF) and renders the grid natively; the browser-parity boxes, tonemapping and the deformation case are open
**Complexity:** 4 — reference-pinned lighting maths plus a shadow pass that must reuse the deformed position
**Owner:** João
**Work package:** N08 — [native-engine batch](../README.md) · [N08 index](README.md)
**Depends on:** [PRD-511](PRD-511-n08b-shader-packages-not-wgsl-text.md)

## Context

§9.4 proofs one and two: standard lit PBR, and a TSL vertex deformation whose shadow follows the
deformed shape. §9.3 pins PBR equations, lighting units, colour conversions, tonemapping,
environment filtering, alpha behaviour, normal handling and material defaults to
`three@0.185.1` (with the repo patch `packages/core/patches/three@0.185.1.patch`). Improving the look
is a separate opt-in change, not parity. Existing native-vs-browser comparison lives in
`pnpm parity` (`packages/runtime-native/conformance/registry.json`, `conformance/browser-reference/`).

## Solution

1. **Native TSL lighting library** (proposed: `src/engine/shader/tsl/lighting/`): the
   `MeshStandardMaterial` node chain — BRDF, punctual lights in physical units, ambient and
   hemisphere, an environment map with the reference PMREM filtering, sRGB/linear conversion, the
   tonemapping operators the catalog lists — ported from the pinned source, not re-derived.
2. **Material defaults** match the reference constructor defaults exactly.
3. **Deformation reaches every pass:** `positionNode` (and `normalNode`) feed the colour pass and
   the shadow/depth variant from one IR graph, so the shadow pass never falls back to undeformed
   geometry.
4. **Comparison method:** the reference scene renders under upstream `WebGPURenderer` in the
   browser lane; the native scene renders through a minimal native draw path (one pass + one shadow
   map; the full renderer is N09). Compare with the existing conformance metrics and a documented
   tolerance.
5. **Unsupported advanced materials** (e.g. `MeshPhysicalMaterial` features not yet ported) report
   `TN_MATERIAL_UNSUPPORTED <feature>`; never mapped silently to a simpler shader (§9.3).

## Out of scope

- The full renderer, alpha paths, multiple cameras — [PRD-514 (N09)](../PRD-514-n09-native-renderer-and-standard-materials.md).
- Physical material features beyond what representative games need — [PRD-514 (N09)](../PRD-514-n09-native-renderer-and-standard-materials.md).

## Execution Phases

#### Phase 1: Standard lit PBR
**Status:** NOT STARTED
**Files:** proposed `src/engine/shader/tsl/lighting/*.cpp`, `packages/runtime-native/conformance/scenes/native-engine-pbr/`
- [ ] A sphere grid (roughness × metalness) under a directional light and an environment map matches the browser reference within the documented tolerance, with no upstream `three` in the native app. proof: `pnpm parity -- --case native-engine-pbr-grid`
- [x] Each catalogued tonemapping operator matches the reference on a luminance ramp. proof: `pnpm parity -- --suite native-engine --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders --only 'tonemap-ramp-*'` — 2026-10-04: green on Dawn, wgpu-native and ASan (`native_engine_render_tonemap`): the six tonemap-ramp fixtures run through the render driver's scene path (fixture ops -> native scene graph -> render database -> output pass) and match their browser golden frames exactly (mismatch 0); red when ACES is built column-major or the sRGB encode is dropped
- [x] An unported physical-material feature raises `TN_MATERIAL_UNSUPPORTED`. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_material_unsupported` — 2026-10-04: green on Dawn, wgpu-native, ASan and Wasm: clearcoat, sheen, transmission, iridescence, anisotropy and dispersion each raise `TN_MATERIAL_UNSUPPORTED <feature>` and produce no shader at all, never a simpler one; defaults match the pinned `MeshStandardMaterial` constructor. `src/engine/shader/standard.{h,cpp}`

#### Phase 2: Deformation that shadows
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/conformance/scenes/native-engine-deform-shadow/`
- [x] A plane deformed by a TSL `positionNode` wave casts a shadow matching the reference silhouette. proof: `pnpm parity -- --case native-engine-deform-shadow` — 2026-10-05: green, pixel-identical at a zero budget, run as `pnpm parity -- --suite native-engine-tsl --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders` (fixture `tsl-wave-shadow`: a double-sided plane bent by `positionLocal + vec3(0, 0, sin(x·2)·0.4)` over a Lambert floor, directional PCF shadow). Two engine fixes it needed: the depth pass builds the caster's positionNode (deformed shadow), and both passes honour `material.side` (three's `_shadowSide`: front-sided casters draw back faces, double-sided both; the main pass culls by side). Red controls: positionNode dropped from the shadow pass, fails; the shadow pass ignoring `material.side`, fails (no shadow at all). Found on the way: a Standard floor at roughness 0.9 differs by one level (of 255) on 13.7% of pixels, a rounding band in its specular gradient; the floor is Lambert so this case measures the shadow. Back-face lighting of double-sided lit materials (`faceDirection`) is not ported.
- [x] The app's linked modules contain no upstream `three` and no JS engine while running that case. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs <native-engine-deform-shadow binary>` — 2026-10-05: `node packages/runtime-native/scripts/inspect-js-free.mjs --binary build/tn-linux/tn-native-engine-render-driver` (the binary that runs the case) prints `JS_FREE_OK … backend=dawn`: no VM symbols, no VM library, no embedded script; no `three.webgpu`/`WebGPURenderer`/`REVISION` string in it. Manifest `artifacts/native-engine/render-driver-js-free.json`. Control: the same inspector on the legacy host `build/tn-linux/mystral` fails (`libjavascriptcoregtk-4.1.so.0`).

## Decisions

- **Parity first; visual improvements are separate opt-in changes (§9.3).**
