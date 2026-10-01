# @threenative/terrain

Optional, headless terrain authoring recovered from Strata. One seeded recipe produces
height/splat arrays, resolved placements, baked LOD chunks and numerical exports.
Games consume baked data and own appearance, collision registration and disposal.

```ts
import { Terrain, Mask, bakeMesh } from '@threenative/terrain';
import { toGeometry } from '@threenative/terrain/three';

const terrain = new Terrain({ size: 512, resolution: 257, seed: 73 })
  .noise({ id: 'hills', amplitude: 35 })
  .flatten({ id: 'camp', height: 12, mask: Mask.circle([20, 30], 15) });
const geometry = toGeometry(bakeMesh(terrain.evaluate()));
// Your game creates the Mesh/material and disposes geometry.
```

Repeating an operation ID replaces that layer in place. `applyPatch` batches edits
atomically; malformed writes preserve the previous recipe. Evaluation is synchronous
and belongs in authoring/build jobs. Browser/editor dependencies are absent from
root and geometry imports. Three.js is a peer, never a bundled second copy.

The recovered `makeExport` GLB/runtime archives contain terrain geometry; a complete
world export including props, portable PBR images and water is not yet delivered.
No browser/native terrain-game acceptance result is claimed by these library tests.

See [agent guide](AGENT_GUIDE.md) and [source provenance](THIRD_PARTY_NOTICES.md).
