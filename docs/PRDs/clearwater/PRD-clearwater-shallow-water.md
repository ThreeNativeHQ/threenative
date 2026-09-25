# Clearwater shallow-water integration

Status: PARTIAL — implementation in progress; platform evidence is not yet claimed.

## Goal and ownership

Expose `createClearwater(ctx, options)` as generated, editable game source. Compose the existing `SpectralOcean`, `RippleField`, and `WaterSurface3D` mechanisms. Keep all materials, TSL, sunlight, absorption, and quality choices in `src/render/`; add no runtime dependency, core look, renderer wrapper, or CLI command. The default game must not silently change appearance.

Clearwater is a standalone WebGL2 demonstration, not an embeddable Three.js package. Port its dielectric Fresnel, Beer–Lambert extinction and refracted-grid caustic transport to Three.js TSL rather than embedding its HTML or taking over the game's renderer. Reuse ThreeNative's FFT rather than duplicating the upstream spectral solver. Preserve the upstream MIT notice.

## Implementation plan

### Phase 1 — contract and numerical regression tests

- [ ] Add validated options and renderer-state/lifecycle contracts with failing tests first.
- [ ] Verify normal-incidence/grazing Fresnel, extinction, finite input handling and state restoration.

### Phase 2 — composed water

- [ ] Implement the factory, FFT/ripple sampling, transparent refractive material and RGB ray-grid caustics.
- [ ] Provide bounded quality controls, disturbance and water-level APIs, and idempotent teardown.
- [ ] Ship usage instructions and upstream attribution without replacing an existing game's look.

### Phase 3 — integration evidence

- [ ] Run the package tests, typecheck and formatting checks.
- [ ] Compile the new TSL graph and render the shallow-water scene in browser WebGPU.
- [ ] Run the same fixture on desktop native and compare its visible water/refraction/caustics.
- [ ] Record Android and iOS status separately; do not infer either from desktop success.

## Review focus

Renderer target/clear/MRT state must survive a failed auxiliary pass. Foreground objects must not bleed into refracted water. Caustics must use the same heightfield as the visible surface and must not tile local interaction outside its patch. No GPU work may continue after disposal or scene removal. Unsupported renderer paths must fail explicitly, not produce a nominally successful empty effect.

## Explicit scope boundaries

The game's real terrain, sky, lighting and postprocessing replace Clearwater's baked pebble bed, procedural headland, camera, adaptive full-screen resolution and lens-glare pipeline. This is a reusable shallow-water surface, not an underwater camera/postprocessing system. Planar caustic receivers are an approximation on strongly varying terrain; platform and visual-parity claims require executed evidence.
