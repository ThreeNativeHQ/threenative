# Clearwater shallow-water integration

Status: PARTIAL — implementation submitted; GPU and full-workspace qualification outstanding.

## Goal and ownership

Expose `createClearwater(ctx, options)` as editable game source. Compose the existing
`SpectralOcean`, `RippleField`, and `WaterSurface3D` mechanisms. Keep materials, TSL, sunlight,
absorption and quality choices in `src/render/`; add no runtime dependency, core look,
renderer wrapper or CLI command. The default game must not silently change appearance.

Delivery is an opt-in source bundle in `packages/create-threenative/template-assets/clearwater/`,
which the existing package already includes in its published files. Its explicit installer copies
source into an existing game and refuses overwrites. No default template source or scaffold hash
changes. This avoids shipping an unqualified visual change into every generated game.

Clearwater is a standalone WebGL2 demonstration, not an embeddable Three.js package. Adapt its
dielectric Fresnel, Beer–Lambert extinction and refracted-grid caustics to Three.js TSL rather than
embedding HTML or taking over the renderer. Reuse ThreeNative's FFT and preserve the upstream
MIT notice (Copyright 2026 Lumaris).

## Phase 1 — numerical and ownership contracts

- [x] Add bounded options, Fresnel/extinction expressions, disposal stack and scoped render-target state.
- [x] Execute regression assertions for invalid inputs, Fresnel endpoints/bounds, extinction,
  reverse/idempotent/error-tolerant cleanup and restoration after a failed draw.
  Evidence: 23/23 assertions passed with Node's test runner against emitted production modules;
  strict TypeScript + noUncheckedIndexedAccess passed for these four dependency-free modules.
  The renderer-state negative control failed before its helper was implemented (22 passed/1 failed).

## Phase 2 — source integration

- [x] Write the composed factory, FFT/ripple sampling, refractive material and RGB ray-grid caustics.
  Evidence is source/syntax inspection only here; real node-graph and GPU gates are below.
- [x] Add disturbance/follow/level/sun/height-query methods and scene-removal teardown.
- [x] Include an opt-in demo, installation/usage/limitation instructions and full upstream MIT notice.
- [x] Verify installation and refusal to overwrite edited game files.
  Evidence: Node child-process installation check passed, including source/license presence and
  preservation of an edited sentinel on a rejected second invocation.

## Phase 3 — integration qualification (not complete)

- [x] Run real-Three graph/factory tests and full workspace typecheck, formatting and tests.
  Evidence: exact-head CI run 36141527525 completed green on 2026-09-25, including typecheck,
  lint, all three unit shards, browser tests, playtests, native tests, build artifacts, budgets,
  performance contracts, benchmark, supply-chain and golden/template coverage.
- [x] Compile the new TSL graph and render the shallow-water scene in browser WebGPU.
  Evidence: exact-head Clearwater source qualification run 36141526854 completed green on
  2026-09-25; the source lane executed the real browser WebGPU fixture and retained its render
  evidence.
- [ ] Run the same fixture on desktop native and compare water/refraction/caustics.
- [ ] Qualify Android separately; no Android execution performed.
- [ ] Qualify iOS separately; no iOS execution performed.

## Review focus and boundaries

Auxiliary passes must restore target/face/mip/MRT/clear/XR state. Foreground objects must not bleed
into refraction. Caustics and geometry must read the same wave/ripple fields. Local interaction
must not tile outside its finite patch. Disposal must stop both callbacks and release resources.
WebGL2 is explicitly rejected instead of silently producing an empty effect.

This is an above-water finite horizontal surface. Refraction reads opaque screen-space scenery;
transparent/offscreen objects are not traced. Caustics focus on a representative planar receiver
and modulate captured colour, not per-light irradiance/shadow visibility. The game's terrain,
sky, lighting and postprocessing replace upstream's baked bed, headland, camera and lens-glare
pipeline. No underwater-camera system or pixel-identical reproduction is claimed.
