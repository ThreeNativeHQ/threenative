import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants, brotliCompressSync, gzipSync } from "node:zlib";

const COMPRESSIBLE_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".wasm"]);
const MIN_BYTES = 1024;

export interface ICompressionReport {
  readonly brotli: number;
  readonly entry: string;
  readonly gzip: number;
  readonly raw: number;
}

async function walk(directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file, files);
    else if (entry.isFile()) files.push(file);
  }
}

function brotli(data: Buffer): Buffer {
  return brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  });
}

function gzip(data: Buffer): Buffer {
  return gzipSync(data, { level: constants.Z_BEST_COMPRESSION });
}

/**
 * Writes `.br` (max brotli) and `.gz` (level 9) sidecars beside every compressible
 * file over 1 KiB in the web output, then reports the main entry chunk's sizes.
 * Compression failures fail the build closed, naming the file.
 */
export async function writeCompressionSidecars(
  outputDirectory: string,
): Promise<ICompressionReport | undefined> {
  const files: string[] = [];
  await walk(outputDirectory, files);
  for (const file of files) {
    if (!COMPRESSIBLE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    try {
      const data = await readFile(file);
      if (data.byteLength <= MIN_BYTES) continue;
      await writeFile(`${file}.br`, brotli(data));
      await writeFile(`${file}.gz`, gzip(data));
    } catch (error) {
      throw new Error(
        `TN_WEB_COMPRESSION_FAILED: ${path.relative(outputDirectory, file)}: ${(error as Error).message}`,
      );
    }
  }
  return mainEntryReport(outputDirectory, files);
}

/** The entry chunk Vite referenced from `index.html`, if the build emitted one. */
async function mainEntryReport(
  outputDirectory: string,
  files: readonly string[],
): Promise<ICompressionReport | undefined> {
  const html = files.find((file) => path.basename(file) === "index.html");
  if (html === undefined) return undefined;
  const match = /<script[^>]+src="([^"]+\.m?js)"/u.exec(await readFile(html, "utf8"));
  const source = match?.[1];
  if (source === undefined) return undefined;
  const entry = path.join(outputDirectory, source.replace(/^\//u, ""));
  const raw = (await stat(entry)).size;
  if (raw <= MIN_BYTES) return undefined;
  return {
    brotli: (await stat(`${entry}.br`)).size,
    entry: path.relative(outputDirectory, entry),
    gzip: (await stat(`${entry}.gz`)).size,
    raw,
  };
}
