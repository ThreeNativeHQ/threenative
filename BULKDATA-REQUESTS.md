# Requests from `packages/raw-unreal` to its callers

`@threenative/raw-unreal` now reads Unreal editor static meshes whose source model lives in
`FByteBulkData` rather than in the export's inline bytes. Two of those payload stores need
something from the caller, because the package is a pure format layer: it bundles no codecs and
opens no files. Neither is a breaking change — both are optional fields on
`IUAssetParseOptions` — but a caller that does not pass them keeps failing on the packs below.

## 1. Pass a `zlib` codec — needed for UE 4.2x packs

UE4 editor bulk data is written through `FArchive::SerializeCompressed` with zlib. Without a
codec the reader throws `MISSING_CODEC` with `details.compression === "zlib"` rather than
guessing, exactly as it already does for Oodle.

```ts
import { inflateSync } from "node:zlib";

parseUAssetStaticMesh(bytes, {
  oodle,
  zlib: (compressed) => new Uint8Array(inflateSync(compressed)),
});
```

In the browser, any MIT inflate (`fflate`, `pako`) fits the same `(compressed, rawSize) =>
Uint8Array` shape. Unlike Oodle there is no licensing reason not to ship one; the codec is
injected only to keep this package free of compression dependencies.

**Measured impact.** Across the seven licensed Fab packs on this machine (885 `.uasset` files
carrying a `StaticMesh` export), 141 meshes — the whole UE 4.26 Office Pack Vol. 1 — failed with
`UNSUPPORTED_STATIC_MESH_LAYOUT` before this change and decode with the codec supplied. They
decode to `layout: "mesh-description-ue4"`.

**Known call sites that need updating**

- `packages/assets/__tests__/unreal-replay.spec.ts:99` — `parseUAssetStaticMesh(bytes, { oodle })`.
  This one only decodes the committed UE 5.7 fixture, which is not bulk data, so it still passes;
  adding `zlib` there would let the replay cover a UE4 pack too.
- The `asset_import_unreal` pipeline that calls this reader outside the repo. It is the caller
  that actually decides whether the paid packs import, and it is the one that must pass `zlib`.

## 2. Optionally pass sibling bulk files

A bulk payload flagged `BULKDATA_PayloadInSeperateFile` was written beside the `.uasset` in a
`.ubulk` (or `.uptnl` for optional payloads). The reader will not open a file; a caller that has
those bytes hands them over:

```ts
parseUAssetStaticMesh(uassetBytes, {
  zlib,
  bulkDataFiles: { ubulk: await readFile(path.replace(/\.uasset$/, ".ubulk")) },
});
```

Without them the reader throws `MISSING_BULK_DATA_FILE` with `details.file` naming the extension
it needs, so a caller can fetch it and retry rather than being told the layout is unsupported.

**Not urgent.** None of the 5,714 packages surveyed here carries this flag — every one is an
uncooked editor package with a single `.uasset` and no siblings on disk. The seam exists so the
failure is actionable, and it is proven only against a synthetic fixture
(`packages/raw-unreal/__tests__/bulk-data.spec.ts`), not against a real pack.

Claude-Session: https://claude.ai/code/session_01WG7DHsvuEd59DwDxFLjjWh
