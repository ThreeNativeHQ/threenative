import { UAssetError } from "./errors.js";

/** Unreal's legacy package tag: every editor `.uasset`/`.umap` starts with it, little-endian. */
export const PACKAGE_FILE_TAG = 0x9e2a83c1;

/** FEditorObjectVersion's GUID as serialized bytes — four little-endian uint32 words:
 * E4B068ED-F494-42E9-A231-DA0B2E46BB41. The custom-version list's position in
 * `FPackageFileSummary` varies with `LegacyFileVersion`, so instead of modeling every variant
 * the entry is located by scanning the summary prefix for these exact 16 bytes — the same
 * approach the engine-free asset importer uses. */
const EDITOR_OBJECT_VERSION_GUID_BYTES = Uint8Array.from([
  0xed,
  0x68,
  0xb0,
  0xe4, // E4B068ED
  0xe9,
  0x42,
  0x94,
  0xf4, // F49442E9
  0x0b,
  0xda,
  0x31,
  0xa2, // A231DA0B
  0x41,
  0xbb,
  0x46,
  0x2e, // 2E46BB41
]);

/** How far into the package the GUID scan reaches: the summary and its custom-version list sit
 * well inside the first 4 KiB of a header. */
const SUMMARY_SCAN_BYTES = 4096;

export interface IPackageSummary {
  packageTag: number;
  legacyFileVersion: number;
  legacyUE3Version: number;
  fileVersionUE4?: number;
  fileVersionUE5?: number;
  licenseeVersion?: number;
  editorObjectVersion?: number;
}

function findEditorObjectVersion(bytes: Uint8Array, from: number): number | undefined {
  const limit = Math.min(bytes.byteLength - 20, from + SUMMARY_SCAN_BYTES);
  for (let position = from; position >= 0 && position < limit; position += 1) {
    let matched = true;
    for (let index = 0; index < 16; index += 1) {
      if (bytes[position + index] !== EDITOR_OBJECT_VERSION_GUID_BYTES[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getInt32(position + 16, true);
    }
  }
  return undefined;
}

/** Reads the fixed prefix of `FPackageFileSummary` — the legacy tag and the engine version
 * fields — and locates the `FEditorObjectVersion` custom-version entry. The rest of the summary
 * (name map, export map, dependency graph) belongs to a full package index; this package's
 * payload readers locate data by self-validating signature scans instead. */
export function readPackageSummary(bytes: Uint8Array): IPackageSummary {
  if (bytes.byteLength < 4) {
    throw new UAssetError("TRUNCATED_PACKAGE", "Unreal package is too small", {
      byteLength: bytes.byteLength,
    });
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packageTag = view.getUint32(0, true);
  if (packageTag !== PACKAGE_FILE_TAG) {
    throw new UAssetError(
      "INVALID_PACKAGE_TAG",
      "Input is not a legacy Unreal package (.uasset/.umap)",
      {
        tag: `0x${packageTag.toString(16)}`,
      },
    );
  }
  if (bytes.byteLength < 16) {
    throw new UAssetError("TRUNCATED_PACKAGE", "Unreal package summary is truncated", {
      byteLength: bytes.byteLength,
    });
  }

  const legacyFileVersion = view.getInt32(4, true);
  const legacyUE3Version = view.getInt32(8, true);
  const fileVersionUE4 = view.getInt32(12, true);
  // FileVersionUE5 exists only from LegacyFileVersion −8 onward.
  const fileVersionUE5 = legacyFileVersion <= -8 ? view.getInt32(16, true) : undefined;
  const licenseeOffset = legacyFileVersion <= -8 ? 20 : 16;
  const licenseeVersion = view.getInt32(licenseeOffset, true);

  const afterLicensee = licenseeOffset + 4;
  const editorObjectVersion = findEditorObjectVersion(bytes, afterLicensee);

  return {
    packageTag,
    legacyFileVersion,
    legacyUE3Version,
    fileVersionUE4,
    ...(fileVersionUE5 === undefined ? {} : { fileVersionUE5 }),
    ...(licenseeVersion === undefined ? {} : { licenseeVersion }),
    ...(editorObjectVersion === undefined ? {} : { editorObjectVersion }),
  };
}
