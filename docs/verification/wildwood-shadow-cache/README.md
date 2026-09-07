# Wildwood shadow-material performance investigation

The engine's pinned Three.js renderer copied each shadow caster's `alphaTest` into one shared
override material. Alternating opaque and cutout casters repeatedly advanced that shared material's
version. The next caster then rebuilt a material cache key even when its own material had not
changed.

A hardware Wildwood trace found `getMaterialCacheKey` and `customProgramCacheKey` consuming 11.1%
of sampled CPU. Instrumentation isolated approximately 162 redundant material-key calls per frame;
lighting and clipping cache keys remained stable. An in-memory diagnostic control reduced key calls
from 23,352 to 128 over separate 10-second windows. This is mechanism evidence, not a packaged-game
FPS improvement claim.

The fix belongs in the existing Three.js dependency patch: preserve the public alpha-test value
through an internal scratchpad write, restore it after the draw, and invalidate cached render
objects when their actual source material's version or identity changes. The root, core-package,
and scaffold patch files carry identical bytes; a regression test now enforces that relationship.

## Correctness evidence

- `packages/core/__tests__/three-shadow-override-cache.spec.ts`: 10 tests passed. Against isolated
  stock Three.js, 6 fail and 4 pass. Coverage includes real `RenderObjects.get` source changes,
  replacement at the same version, override updates, settling, and independent casters.
- The expanded `17-shadow-map` browser/native case passed with identical pixels. See
  [native-conformance.json](native-conformance.json) for hashes and limitations and
  [shadow-materials.png](shadow-materials.png) for the inspected frame.
- Wildwood's existing `loadAll`, `addInSlices`, startup holds, and bulk physics paths were already
  installed/adopted. Its foliage assets have no virtual-geometry metadata and are below the bake
  threshold, so no speculative `ClusteredBatch` conversion was made.

## Final verification

- Repository typecheck passed. Full test run: **391 files passed, 1 skipped; 4,283 tests passed,
  4 skipped**. Lint was rerun after formatting the new receipt; eight unrelated ignored
  `.linchpin` JSON formatting errors remain.
- Installed-package timing captures and their limitations are in [performance.json](performance.json).
  They do not establish a causal FPS percentage gain; the cache-work reduction above is verified.
- Updated Wildwood web walking playtest passed: 1,035 frames, over 30 metres travelled, zero
  diagnostics.
- The contact-shading speckle reported against this work was a separate defect and is resolved in
  [BUG-contact-noise-and-texture-blur.md](BUG-contact-noise-and-texture-blur.md): the GI gather was
  rotating its sample noise every frame with no TRAA stage to average it. That report supersedes
  [noise.md](noise.md), whose sharpening change the owner rejected. **The shadow-material cache
  work on this page was never implicated in it and is untouched.**
- The native Wildwood package rebuilt successfully, but its full-game render-chain playtest
  failed with zero observed frames and a missing semantic bridge diagnostic. This does not
  establish the underlying startup cause. Whole-game native verification remains open; the
  selected engine shadow conformance case above is the passing native rendering proof.
