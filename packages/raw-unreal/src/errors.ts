/**
 * The stable error codes a `UAssetError` can carry.
 * @situation switch on a raw .uasset failure without parsing error strings
 * @constraint codes are part of the public surface; new failure modes add codes rather than reusing them
 * @example if (error.code === "MISSING_CODEC") hintAtOodleSetup();
 */
export type UAssetErrorCode =
  | "INVALID_PACKAGE_TAG"
  | "TRUNCATED_PACKAGE"
  | "INVALID_PACKAGE_SUMMARY"
  | "INVALID_COMPRESSED_BUFFER"
  | "UNSUPPORTED_COMPRESSION_METHOD"
  | "MISSING_CODEC"
  | "CODEC_SIZE_MISMATCH"
  | "INCOMPLETE_DECOMPRESSION"
  | "INVALID_MESH_DESCRIPTION"
  | "INVALID_RAW_MESH"
  | "MISSING_MESH_ATTRIBUTE"
  | "INVALID_MESH_REFERENCE"
  | "UNSUPPORTED_STATIC_MESH_LAYOUT"
  | "INVALID_GEOMETRY_OPTIONS";

/**
 * The error thrown for every malformed, truncated, or unsupported `.uasset` input, carrying a
 * stable `code` and structured details instead of invented fallback geometry.
 * @situation tell why a raw .uasset failed to load, by code, before any geometry is shown
 * @situation branch on an unsupported Unreal layout instead of shipping broken geometry
 * @constraint every parse, decompression, and geometry failure surfaces as this error; the loader never invents fallback geometry
 * @example catch (error) { if (error instanceof UAssetError) log(error.code, error.details); }
 */
export class UAssetError extends Error {
  readonly code: UAssetErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: UAssetErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "UAssetError";
    this.code = code;
    this.details = details;
  }
}

export function assertUAsset(
  condition: boolean,
  code: UAssetErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): asserts condition {
  if (!condition) throw new UAssetError(code, message, details);
}
