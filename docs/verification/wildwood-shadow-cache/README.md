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

## Remaining verification

Installed-package A/B and the full repository test gate are still pending. Typecheck and
tracked-file lint passed; unrestricted `pnpm lint` also inspected unrelated ignored `.linchpin`
JSON files and reported eight formatting errors there.
