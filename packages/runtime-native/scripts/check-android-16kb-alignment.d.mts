// Types for `check-android-16kb-alignment.mjs`, for the same reason `core/mcp/servers.d.mts`
// exists: that file is plain JavaScript by design — it is what a packaged consumer's build runs
// through Node directly — so it can never be a `.ts`. Only the archive reader is declared here, the
// one thing a TypeScript caller outside this package reuses; the rest stays internal to the script.

export interface IZipEntry {
  /** The ZIP general-purpose compression method: 0 stored, 8 deflated. */
  readonly compression: number;
  readonly compressedSize: number;
  /** Where the entry's bytes start in the archive, past its local header and extra field. */
  readonly dataOffset: number;
  readonly name: string;
  readonly size: number;
}

export interface IZipArchive {
  readonly bytes: Buffer;
  readonly entries: readonly IZipEntry[];
}

export declare function readZipEntries(archivePath: string): IZipArchive;
