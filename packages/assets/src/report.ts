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

/** One compiled model plus a total, before against after the optimization pass. */
export interface IModelSizeRow {
  readonly after: number;
  readonly before: number;
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
  /** Triangle count of the compiled output, recorded in the manifest. */
  readonly triangles?: number;
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
    if (row.lightmap === undefined) return [model];
    const map = row.lightmap;
    return [
      model,
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
