export type UEFormatErrorCode =
  | "TRUNCATED_FILE"
  | "INVALID_MAGIC"
  | "INVALID_IDENTIFIER"
  | "UNSUPPORTED_VERSION"
  | "INVALID_LENGTH"
  | "INVALID_COUNT"
  | "INVALID_COMPRESSION"
  | "DECOMPRESSION_FAILED"
  | "SIZE_MISMATCH"
  | "ATTRIBUTE_SIZE_MISMATCH"
  | "INVALID_GEOMETRY";

export class UEFormatError extends Error {
  readonly code: UEFormatErrorCode;
  readonly offset: number;

  constructor(code: UEFormatErrorCode, message: string, offset = -1, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UEFormatError";
    this.code = code;
    this.offset = offset;
  }
}
