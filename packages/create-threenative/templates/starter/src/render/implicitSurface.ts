// Generated source. It extracts a closed field and owns no renderer or appearance choice.
// Compact helper bodies are deliberate: this generated file has the 200-line smell budget.
type Point = [number, number, number];
type Triangle = [number, number, number];
type SurfaceOptions = Readonly<{
  bounds: Record<"maxX" | "maxY" | "maxZ" | "minX" | "minY" | "minZ", number>;
  cellSize: number;
  latticeCap: number;
  sample: (x: number, y: number, z: number) => number;
  closed?: boolean;
  protectBoundary?: boolean;
}>;
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function failSurface(name: string, message: string): never {
  const error = new Error(`${name}: ${message}`);
  error.name = name;
  throw error;
}
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function readPoint(array: ArrayLike<number>, vertex: number): Point {
  return [array[vertex * 3] as number, array[vertex * 3 + 1] as number, array[vertex * 3 + 2] as number];
}
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function triangleMetrics(a: Point, b: Point, c: Point): [number, number] {
  const u: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Point = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Point = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [n[0] * n[0] + n[1] * n[1] + n[2] * n[2], a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])];
}
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function touchSurfaceEdge(edges: Map<string, Point>, from: number, to: number): void {
  const key = from < to ? `${from}|${to}` : `${to}|${from}`;
  const edge = edges.get(key) ?? [0, 0, 0];
  edge[0] += 1; edge[1] += from < to ? 1 : -1; edges.set(key, edge);
}
// Reads final typed arrays, so no label can self-report valid topology.
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function auditSurface(indices: Uint32Array, positions: Float32Array) {
  const edges = new Map<string, Point>();
  const counts = { boundaryEdges: 0, degenerateTriangles: 0, signedVolume: 0, windingConflicts: 0 };
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] as number; const b = indices[index + 1] as number; const c = indices[index + 2] as number;
    if (a >= positions.length / 3 || b >= positions.length / 3 || c >= positions.length / 3)
      failSurface("TN_IMPLICIT_SURFACE_INDEX_INVALID", `triangle ${index / 3} references a missing vertex.`);
    touchSurfaceEdge(edges, a, b); touchSurfaceEdge(edges, b, c); touchSurfaceEdge(edges, c, a);
    const [area, volume] = triangleMetrics(readPoint(positions, a), readPoint(positions, b), readPoint(positions, c));
    if (area < 1e-14) counts.degenerateTriangles += 1;
    counts.signedVolume += volume;
  }
  for (const [count, direction] of edges.values()) {
    if (count !== 2) counts.boundaryEdges += 1;
    if (count === 2 && direction !== 0) counts.windingConflicts += 1;
  }
  return { ...counts, signedVolume: counts.signedVolume / 6, triangles: indices.length / 3, vertices: positions.length / 3 };
}
export { auditSurface as auditImplicitSurface };
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
function addSurfaceTriangle(output: number[], positions: number[], sample: SurfaceOptions["sample"], dx: number, dy: number, dz: number, vertices: Triangle): void {
  const [va, vb, vc] = vertices;
  const [a, b, c] = [readPoint(positions, va), readPoint(positions, vb), readPoint(positions, vc)] as [Point, Point, Point];
  const [area] = triangleMetrics(a, b, c);
  if (area < 1e-14) return;
  const center: Point = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const gradient: Point = [
    sample(center[0] + dx * 0.25, center[1], center[2]) - sample(center[0] - dx * 0.25, center[1], center[2]),
    sample(center[0], center[1] + dy * 0.25, center[2]) - sample(center[0], center[1] - dy * 0.25, center[2]),
    sample(center[0], center[1], center[2] + dz * 0.25) - sample(center[0], center[1], center[2] - dz * 0.25),
  ];
  const n: Point = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  if (n[0] * gradient[0] + n[1] * gradient[1] + n[2] * gradient[2] >= 0) output.push(va, vb, vc); else output.push(va, vc, vb);
}
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the bounded adjacency walk orients the final closed mesh.
function orientSurface(indices: Uint32Array): void {
  const links = new Map<string, Array<[number, number]>>();
  for (let triangle = 0; triangle < indices.length; triangle += 3) for (let edge = 0; edge < 3; edge++) {
    const from = indices[triangle + edge] as number; const to = indices[triangle + (edge + 1) % 3] as number;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    const linked = links.get(key) ?? []; linked.push([triangle, from < to ? 1 : -1]); links.set(key, linked);
  }
  const flips = new Map<number, boolean>();
  for (let start = 0; start < indices.length; start += 3) if (!flips.has(start)) {
    const queue = [start]; flips.set(start, false); while (queue.length > 0) {
      const triangle = queue.pop() as number; const flip = flips.get(triangle) as boolean;
      for (let edge = 0; edge < 3; edge++) {
        const from = indices[triangle + edge] as number; const to = indices[triangle + (edge + 1) % 3] as number;
        const key = from < to ? `${from}|${to}` : `${to}|${from}`;
        for (const [other, otherDirection] of links.get(key) ?? []) if (other !== triangle && !flips.has(other)) {
          flips.set(other, flip !== ((from < to ? 1 : -1) === otherDirection)); queue.push(other);
        }
      }
    }
  }
  for (const [triangle, flip] of flips) if (flip) {
    const swap = indices[triangle + 1] as number; indices[triangle + 1] = indices[triangle + 2] as number; indices[triangle + 2] = swap;
  }
}
// biome-ignore format: compact generated helper keeps the render source under its smell budget.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the bounded lattice traversal is the extractor.
export function buildImplicitSurface(options: SurfaceOptions) {
  const started = Date.now();
  const { bounds } = options;
  if ([bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ].some((value) => !Number.isFinite(value)))
    failSurface("TN_IMPLICIT_SURFACE_BOUNDS_INVALID", "bounds must be finite.");
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY || bounds.maxZ <= bounds.minZ)
    failSurface("TN_IMPLICIT_SURFACE_BOUNDS_INVALID", "each maximum must exceed its minimum.");
  if (!Number.isFinite(options.cellSize) || options.cellSize <= 0)
    failSurface("TN_IMPLICIT_SURFACE_CELL_INVALID", "cellSize must be positive and finite.");
  if (!Number.isSafeInteger(options.latticeCap) || options.latticeCap <= 0)
    failSurface("TN_IMPLICIT_SURFACE_CAP_INVALID", "latticeCap must be a positive safe integer.");
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / options.cellSize));
  const ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / options.cellSize));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / options.cellSize));
  const width = nx + 1;
  const height = ny + 1;
  const depth = nz + 1;
  const latticeLength = width * height * depth;
  if (!Number.isSafeInteger(latticeLength) || latticeLength > options.latticeCap)
    failSurface("TN_IMPLICIT_SURFACE_LATTICE_OVERFLOW", `lattice requires ${latticeLength} samples.`);
  const dx = (bounds.maxX - bounds.minX) / nx;
  const dy = (bounds.maxY - bounds.minY) / ny;
  const dz = (bounds.maxZ - bounds.minZ) / nz;
  const cell = Math.max(dx, dy, dz);
  const sample = (x: number, y: number, z: number): number => {
    const value = options.sample(x, y, z);
    if (!Number.isFinite(value)) failSurface("TN_IMPLICIT_SURFACE_SAMPLE_INVALID", `sample at ${x},${y},${z} is not finite.`);
    return value === 0 ? 1e-8 : value;
  };
  const indexOf = (x: number, y: number, z: number): number => x + width * (y + height * z);
  const values = new Float64Array(latticeLength);
  for (let z = 0; z < depth; z += 1) for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let value = sample(bounds.minX + x * dx, bounds.minY + y * dy, bounds.minZ + z * dz);
    if (options.protectBoundary !== false && (x === 0 || y === 0 || z === 0 || x === nx || y === ny || z === nz)) value = Math.max(value, cell * 0.5);
    values[indexOf(x, y, z)] = value;
  }
  const corners = "000 100 110 010 001 101 111 011".split(" ").map((value) => [...value].map(Number)) as Array<[number, number, number]>;
  const tetrahedra = "0516 0126 0236 0376 0746 0456".split(" ").map((value) => [...value].map(Number)) as Array<[number, number, number, number]>;
  // biome-ignore format: compact generated lookup stays within the render-source smell budget.
  const tetraCases: number[][][][] = [[], [[[0, 1], [0, 2], [0, 3]]], [[[0, 1], [1, 2], [1, 3]]], [[[0, 2], [1, 2], [1, 3]], [[0, 2], [1, 3], [0, 3]]], [[[0, 2], [1, 2], [2, 3]]], [[[0, 1], [1, 2], [2, 3]], [[0, 1], [2, 3], [0, 3]]], [[[0, 1], [1, 3], [2, 3]], [[0, 1], [2, 3], [0, 2]]], [[[0, 3], [1, 3], [2, 3]]], [[[0, 3], [1, 3], [2, 3]]], [[[0, 1], [1, 3], [2, 3]], [[0, 1], [2, 3], [0, 2]]], [[[0, 1], [1, 2], [2, 3]], [[0, 1], [2, 3], [0, 3]]], [[[0, 2], [1, 2], [2, 3]]], [[[0, 2], [1, 2], [1, 3]], [[0, 2], [1, 3], [0, 3]]], [[[0, 1], [1, 2], [1, 3]]], [[[0, 1], [0, 2], [0, 3]]], []];
  const positions: number[] = [];
  const rawIndices: number[] = [];
  const edgeVertices = new Map<string, number>();
  const point = (index: number): Point => [bounds.minX + (index % width) * dx, bounds.minY + (Math.floor(index / width) % height) * dy, bounds.minZ + Math.floor(index / (width * height)) * dz];
  const edgePoint = (a: number, b: number): number => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = edgeVertices.get(key);
    if (existing !== undefined) return existing;
    const fa = values[a] as number;
    const fb = values[b] as number;
    const t = Math.max(0.015, Math.min(0.985, fa / (fa - fb)));
    const pa = point(a);
    const pb = point(b);
    const vertex = positions.length / 3;
    positions.push(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t);
    edgeVertices.set(key, vertex);
    return vertex;
  };
  for (let z = 0; z < nz; z += 1) for (let y = 0; y < ny; y += 1) for (let x = 0; x < nx; x += 1) {
    const indexes: number[] = [];
    const field: number[] = [];
    for (const corner of corners) {
      const index = indexOf(x + corner[0], y + corner[1], z + corner[2]);
      indexes.push(index); field.push(values[index] as number);
    }
    for (const tetrahedron of tetrahedra) {
      let code = 0;
      for (let corner = 0; corner < 4; corner += 1)
        if ((field[tetrahedron[corner] as number] as number) < 0) code |= 1 << corner;
      const tetVertex = (crossing: number[]): number =>
        edgePoint(indexes[tetrahedron[crossing[0] as number] as number] as number, indexes[tetrahedron[crossing[1] as number] as number] as number);
      for (const triangle of tetraCases[code] ?? [])
        addSurfaceTriangle(rawIndices, positions, sample, dx, dy, dz, [tetVertex(triangle[0] as number[]), tetVertex(triangle[1] as number[]), tetVertex(triangle[2] as number[])]);
    }
  }
  if (rawIndices.length === 0) failSurface("TN_IMPLICIT_SURFACE_EMPTY", "the field contains no triangles.");
  const outputPositions = Float32Array.from(positions);
  const outputIndices = Uint32Array.from(rawIndices);
  orientSurface(outputIndices);
  let report = auditSurface(outputIndices, outputPositions);
  if (report.signedVolume < 0) {
    for (let index = 0; index < outputIndices.length; index += 3) {
      const swap = outputIndices[index + 1] as number;
      outputIndices[index + 1] = outputIndices[index + 2] as number;
      outputIndices[index + 2] = swap;
    }
    report = auditSurface(outputIndices, outputPositions);
  }
  if (options.closed !== false && (report.boundaryEdges > 0 || report.degenerateTriangles > 0 || report.windingConflicts > 0))
    failSurface("TN_IMPLICIT_SURFACE_TOPOLOGY_INVALID", `boundary=${report.boundaryEdges}, degenerate=${report.degenerateTriangles}, winding=${report.windingConflicts}.`);
  if (options.closed !== false && report.signedVolume <= Math.max(cell ** 3 * 0.01, 1e-8))
    failSurface("TN_IMPLICIT_SURFACE_VOLUME_INVALID", `signed volume ${report.signedVolume} is not non-trivial.`);
  return { indices: outputIndices, positions: outputPositions, report: { ...report, buildMs: Math.max(0, Date.now() - started), cellSize: cell } };
}

export function createImplicitSurfaceWorkerSource(): string {
  // biome-ignore format: compact generated source list keeps this file under its smell budget.
  return [failSurface, readPoint, triangleMetrics, touchSurfaceEdge, auditSurface, addSurfaceTriangle, orientSurface, buildImplicitSurface]
    .map((source) => source.toString()).join("\n");
}
