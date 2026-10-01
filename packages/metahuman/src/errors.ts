/**
 * One error class, one code union, for both halves of the contract.
 *
 * The asset validator and the WASM evaluator fail the same way: a stable machine-readable
 * `code` a caller can branch on, plus a human sentence. Codes are part of the public
 * surface; renaming one is a breaking change.
 */
export type MetaHumanErrorCode =
  | "TN_MH_SCHEMA"
  | "TN_MH_HASH_MISMATCH"
  | "TN_MH_NON_FINITE"
  | "TN_MH_UNKNOWN_JOINT"
  | "TN_MH_UNKNOWN_NODE"
  | "TN_MH_UNKNOWN_CHANNEL"
  | "TN_MH_UNKNOWN_MAP"
  | "TN_MH_INDEX_RANGE"
  | "TN_MH_BAD_LOD"
  | "TN_MH_UNKNOWN_CONTROL"
  | "TN_MH_BAD_DOMAIN"
  | "TN_MH_DUPLICATE_ALIAS"
  | "TN_MH_PATH_ESCAPE"
  | "TN_MH_LENGTH"
  | "TN_MH_DISPOSED"
  | "TN_MH_ABI"
  | "TN_MH_WASM_LOAD"
  | "TN_MH_WASM_CHECKSUM";

/** Every rejection raised by this package carries one of these codes. */
export class MetaHumanAssetError extends Error {
  readonly code: MetaHumanErrorCode;

  constructor(code: MetaHumanErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "MetaHumanAssetError";
    this.code = code;
  }
}
