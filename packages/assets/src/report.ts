/**
 * The person-readable size report the compile step prints after encoding: one line per
 * compressed texture and optimized model plus a total, before against after. Pure formatting
 * so tests can pin the exact lines a build prints.
 */
export interface ITextureSizeRow {
  readonly after: number;
  readonly before: number;
  readonly format: string | undefined;
  readonly logicalPath: string;
}

export function formatTextureSizes(rows: readonly ITextureSizeRow[]): readonly string[] {
  if (rows.length === 0) return [];
  const lines = rows.map(
    (row) =>
      `texture ${row.logicalPath}${row.format === undefined ? "" : ` (${row.format})`}: ${row.before} -> ${row.after} bytes ${deltaLabel(row.before, row.after)}`,
  );
  const before = rows.reduce((total, row) => total + row.before, 0);
  const after = rows.reduce((total, row) => total + row.after, 0);
  lines.push(`textures total: ${before} -> ${after} bytes ${deltaLabel(before, after)}`);
  return lines;
}

/** What the model pass did to the images inside one `.glb`. */
export interface IEmbeddedTextureRow {
  readonly bytesAfter: number;
  readonly bytesBefore: number;
  readonly count: number;
  /** Chosen codec per embedded image, keyed by texture name. */
  readonly formats?: Readonly<Record<string, string>>;
  readonly gpuBytesAfter: number;
  readonly gpuBytesBefore: number;
  readonly resized: number;
}

/** What simplification delivered against what the config asked for. */
export interface ISimplifyRow {
  readonly achievedRatio: number;
  readonly error: number;
  readonly requestedRatio: number;
  readonly trianglesAfter: number;
  readonly trianglesBefore: number;
}

/** One compiled model plus a total, before against after the optimization pass. */
export interface IModelSizeRow {
  readonly after: number;
  readonly before: number;
  /** Embedded-image compression, when the model carried any. */
  readonly embeddedTextures?: IEmbeddedTextureRow;
  /** glTF extensions declared by the compiled output, e.g. EXT_meshopt_compression. */
  readonly extensions?: readonly string[];
  readonly logicalPath: string;
  readonly lightmap?: {
    readonly atlasHeight: number;
    readonly atlasWidth: number;
    readonly bakeMs: number;
    readonly bytesAfter: number;
    readonly bytesBefore: number;
    readonly dilatedTexels: number;
    readonly occludedTexels: number;
    readonly validTexels: number;
  };
  /** LOD simplification, when it was configured for this model. */
  readonly simplify?: ISimplifyRow;
  /** Triangle count of the compiled output, recorded in the manifest. */
  readonly triangles?: number;
}

/**
 * Names the ratio simplification reached next to the one requested. When the error tolerance
 * held it short, the line says so — asking for 5% and silently shipping 15% is exactly the
 * quiet the pipeline exists to remove.
 */
function simplifyLine(row: IModelSizeRow): readonly string[] {
  const simplify = row.simplify;
  if (simplify === undefined) return [];
  const kept = simplify.achievedRatio * 100;
  const requested = simplify.requestedRatio * 100;
  // 1% of the requested ratio is encoder rounding; anything wider is the error bound biting.
  const short =
    simplify.achievedRatio > simplify.requestedRatio * 1.01
      ? ` — the error tolerance ${simplify.error} stopped it short`
      : "";
  return [
    `simplified ${row.logicalPath}: ${simplify.trianglesBefore} -> ${simplify.trianglesAfter} triangles (${kept.toFixed(1)}% kept, requested ${requested.toFixed(1)}%)${short}`,
  ];
}

function extensionLabel(row: IModelSizeRow): string {
  const extensions = row.extensions ?? [];
  return extensions.length === 0 ? "" : ` (${extensions.join(", ")})`;
}

export function formatModelSizes(rows: readonly IModelSizeRow[]): readonly string[] {
  if (rows.length === 0) return [];
  const lines = rows.flatMap((row) => {
    const geometry = row.triangles === undefined ? "" : `, ${String(row.triangles)} triangle(s)`;
    const model = `model ${row.logicalPath}${extensionLabel(row)}: ${row.before} -> ${row.after} bytes ${deltaLabel(row.before, row.after)}${geometry}`;
    const embedded = row.embeddedTextures;
    // GPU bytes are the number that decides whether a phone keeps the app alive; the file
    // size only decides how long the download takes.
    const images =
      embedded === undefined
        ? []
        : [
            `embedded textures ${row.logicalPath}: ${embedded.count} image(s), ${embedded.bytesBefore} -> ${embedded.bytesAfter} bytes ${deltaLabel(embedded.bytesBefore, embedded.bytesAfter)}, GPU ${embedded.gpuBytesBefore} -> ${embedded.gpuBytesAfter} bytes ${deltaLabel(embedded.gpuBytesBefore, embedded.gpuBytesAfter)}, ${embedded.resized} resized`,
          ];
    const reduced = simplifyLine(row);
    if (row.lightmap === undefined) return [model, ...reduced, ...images];
    const map = row.lightmap;
    return [
      model,
      ...reduced,
      ...images,
      `lightmap ${row.logicalPath}: atlas ${map.atlasWidth}x${map.atlasHeight}, ${map.validTexels} valid + ${map.dilatedTexels} dilated texels, ${map.occludedTexels} occluded, ${map.bytesBefore} -> ${map.bytesAfter} bytes ${deltaLabel(map.bytesBefore, map.bytesAfter)}, bake ${map.bakeMs.toFixed(1)} ms`,
    ];
  });
  const before = rows.reduce((total, row) => total + row.before, 0);
  const after = rows.reduce((total, row) => total + row.after, 0);
  lines.push(`models total: ${before} -> ${after} bytes ${deltaLabel(before, after)}`);
  return lines;
}

function deltaLabel(before: number, after: number): string {
  if (before <= 0) return `(${after} bytes)`;
  const percent = ((1 - after / before) * 100).toFixed(1);
  return `(-${percent}%)`;
}
