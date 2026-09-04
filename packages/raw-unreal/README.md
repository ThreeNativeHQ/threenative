# @threenative/raw-unreal

Loads **raw Unreal editor `.uasset` static meshes** directly into three.js geometry — no glTF/GLB/FBX/OBJ conversion step at any point.

```
raw .uasset → package summary → payload scan → decode → typed arrays → THREE.Mesh
```

Three serialized source-model layouts are decoded, from four payload stores:

| Layout | Engine generation | Where the data lives |
|---|---|---|
| `mesh-description` | UE5.x (`FMeshDescription`, named element containers) | Inline, or inside a UE5 `FCompressedBuffer` package-trailer payload |
| `mesh-description-ue4` | UE4.2x (`FMeshDescription`, fixed-order containers) | `FByteBulkData`, usually zlib-compressed at the end of the package |
| `raw-mesh` | UE4.6–UE4.2x (`FRawMesh` source models) | Inline uncompressed, or `FByteBulkData` |

`FByteBulkData` payloads are read wherever the flags put them: inline after the header, at the end
of the `.uasset` against the summary's `BulkDataStartOffset`, or in a sibling `.ubulk`/`.uptnl`
file whose bytes the caller supplies through `bulkDataFiles`.

Every path is self-validating: a candidate offset is trusted only after a full parse consumes it
exactly with every count agreeing, and the summary walk that anchors bulk data is accepted only
when it ends on the package's own name table. Unsupported layouts throw a typed `UAssetError`
with a code and details; nothing invents fallback geometry.

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

UE4 editor bulk data is stored zlib-compressed, which takes a `zlib(compressed, rawSize)` function
on the same terms — `node:zlib`'s `inflateSync` in Node, any of the small MIT inflate libraries in
the browser:

```ts
import { inflateSync } from "node:zlib";

parseUAssetStaticMesh(bytes, { zlib: (data) => new Uint8Array(inflateSync(data)) });
```

The test suite uses `ooz-wasm` as a **devDependency only** — it decodes the committed fixture and
ships in no published artifact.

## Fixture provenance

`fixtures/SM_cube.uasset` is a real Unreal Engine 5.7 editor package from the MIT-licensed
[uassets](https://github.com/1danielcoelho/uassets) sample set, pinned by SHA-256 in the specs —
see `fixtures/PROVENANCE.md`. The FRawMesh specs run against synthetic packages built in
`__tests__/fixture-builder.ts`; the real-pack conformance spec runs only when the licensed
Landscape Pro pack is present on disk and commits nothing from it.

## Current compatibility

**Decoded:** legacy-tag uncooked editor packages (`.uasset`/`.umap`), the package summary prefix
and the full summary walk (`TotalHeaderSize`, `BulkDataStartOffset`, `FEditorObjectVersion`) for
`LegacyFileVersion` −3 through −8, UE5 `FCompressedBuffer` payloads (uncompressed/Oodle/LZ4
methods), UE5 and UE4.2x `FMeshDescription` serializations, UE4-era `FRawMesh` source models,
`FByteBulkData` payloads stored inline, at the end of the package, or in a supplied sibling file,
`FArchive::SerializeCompressed` zlib containers, per-wedge positions/normals/UVs, polygon-group
sections with their `ImportedMaterialSlotName`s from a MeshDescription, Unreal→three.js coordinate
conversion (`(x, z, −y)`) and winding repair.

**Not decoded (throws, honestly):** IoStore containers (`.utoc`/`.ucas`), PAK archives, cooked
render buffers, Nanite clusters, skeletal meshes and skin weights, textures and material graphs,
`LegacyFileVersion` −9 and below (UE 5.5+ replaced the package GUID with a saved hash; the summary
walk declines rather than guessing, so bulk data in those packages is not reached), material-slot
*names* from FRawMesh packages (the section indices are real; the names need the package name map),
and full `.umap` actor reconstruction.
