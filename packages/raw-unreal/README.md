# @threenative/raw-unreal

Loads **raw Unreal editor `.uasset` static meshes** directly into three.js geometry — no glTF/GLB/FBX/OBJ conversion step at any point.

```
raw .uasset → package summary → payload scan → decode → typed arrays → THREE.Mesh
```

Two serialized source-model layouts are decoded:

| Layout | Engine generation | Where the data lives |
|---|---|---|
| `mesh-description` | UE4.26–UE5.x (`FMeshDescription`) | Inline, or inside a UE5 `FCompressedBuffer` package-trailer payload |
| `raw-mesh` | UE4.18 (`FRawMesh` source models) | Inline, uncompressed — the layout most older Fab packs use |

Both paths are self-validating signature scans: a candidate offset is trusted only after a full
parse consumes it exactly with every count agreeing. Unsupported layouts throw a typed
`UAssetError` with a code and details; nothing invents fallback geometry.

## Use

```ts
import { UAssetLoader } from "@threenative/raw-unreal";

const loader = new UAssetLoader(manager, { parse: { oodle } });
const mesh = await new Promise((resolve, reject) =>
  loader.load("/assets/SM_pine01.uasset", resolve, undefined, reject),
);
scene.add(mesh); // materials via mesh.userData.unreal.sections / geometry groups
```

The format layer is independent of three.js until the final adapter:

```ts
import { parseUAssetStaticMesh } from "@threenative/raw-unreal";

const decoded = parseUAssetStaticMesh(bytes, { oodle });
// decoded.positions / normals / uvs / indices / sections / bounds / metadata / unreal
```

## Codec injection and licensing

This package is MIT and **bundles no compression codecs**. UE5 `FCompressedBuffer` payloads are
commonly Oodle-compressed, and every Oodle decompressor that is known to work in JavaScript is
GPL-licensed (`ooz-wasm`). To keep the GPL out of this package while keeping the capability
reachable, the loader takes codecs as call arguments:

```ts
import { decompress as oodle } from "ooz-wasm"; // GPL-3.0-or-later — the game's choice to make

parseUAssetStaticMesh(bytes, { oodle });
```

Adding `ooz-wasm` to a game applies that game's GPL obligations to that game's distribution;
it never touches this package. Uncompressed payloads need no codec, and LZ4 payloads take an
`lz4(compressed, rawSize)` function the same way. A payload whose codec was not supplied throws
`MISSING_CODEC` rather than guessing.

The test suite uses `ooz-wasm` as a **devDependency only** — it decodes the committed fixture and
ships in no published artifact.

## Fixture provenance

`fixtures/SM_cube.uasset` is a real Unreal Engine 5.7 editor package from the MIT-licensed
[uassets](https://github.com/1danielcoelho/uassets) sample set, pinned by SHA-256 in the specs —
see `fixtures/PROVENANCE.md`. The FRawMesh specs run against synthetic packages built in
`__tests__/fixture-builder.ts`; the real-pack conformance spec runs only when the licensed
Landscape Pro pack is present on disk and commits nothing from it.

## Current compatibility

**Decoded:** legacy-tag uncooked editor packages (`.uasset`/`.umap`), package summary prefix
(versions and `FEditorObjectVersion`), UE5 `FCompressedBuffer` payloads (uncompressed/Oodle/LZ4
methods), serialized `FMeshDescription` element containers, UE4.18 `FRawMesh` source models,
per-wedge positions/normals/UVs, polygon-group sections, Unreal→three.js coordinate conversion
(`(x, z, −y)`) and winding repair.

**Not decoded (throws, honestly):** IoStore containers (`.utoc`/`.ucas`), PAK archives, cooked
render buffers, Nanite clusters, skeletal meshes and skin weights, textures and material graphs,
compressed or externally-referenced FRawMesh bulk data, material-slot *names* from FRawMesh
packages (the section indices are real; the names need the package name map), and full `.umap`
actor reconstruction.
