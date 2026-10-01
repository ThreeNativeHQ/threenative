// PRD-473 AC-4, asset-cook half: turn each hand-placed world cell's authored chunks into one
// merged, simplified, material-grouped proxy GLB and name it on the cell manifest.
//
// The cook owns only the *bytes*: it writes the proxy as an ordinary model input beside the
// world package and rewrites the world JSON with an optional `cell.proxy` record
// (`{ glb, error, triangles, materialGroups }`). The runtime half that swaps a chunk for its
// proxy is core's, and is deliberately absent here.
//
// Everything a cell needs already ships in the repository — glTF-Transform for reading, merging,
// flattening, joining, un-instancing, welding and simplifying, with `meshoptimizer` as the
// simplifier it drives — so this file adds no dependency and no configuration. A cell it cannot
// reproduce faithfully is declined whole with a diagnostic; it never emits a partial proxy that
// would silently drop scenery.

import path from "node:path";
import { Document, NodeIO, PropertyType, type Scene } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  flatten,
  getBounds,
  join,
  mergeDocuments,
  prune,
  simplifyPrimitive,
  uninstance,
  unpartition,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { createGltfReader, readGltfDocument } from "../gltf-io.js";
import { TNDiscreteLod } from "../lod/extension.js";
import { TNVirtualGeometry } from "../virtual/extension.js";

/**
 * The proxy's requested simplification error, as a fraction of the merged cell's world extent.
 * glTF-Transform's simplifier takes `error` as exactly this kind of relative bound and stops
 * before exceeding it, so the published `error` is that bound lifted into metres — a conservative
 * world-space bound, never a measurement.
 *
 * It bounds *opaque* geometry only: an alpha-tested card is a hole you can see, so MASK and BLEND
 * primitives are merged but never reduced, and the published bound is the coarsest opaque group's
 * requested error. 1% of a cell's extent is roughly one pixel at the distance the proxy takes over.
 */
const HLOD_ERROR_RATIO = 0.01;

/** `Primitive.Mode.TRIANGLES`, without importing the static for one constant. */
const TRIANGLES = 4;

/** A parsed v1 world package, as this cook understands it; anything else is left untouched. */
export interface IWorldPackageSource {
  readonly json: Record<string, unknown>;
  readonly cellSize: number;
  readonly cells: readonly IWorldSourceCell[];
}

export interface IWorldSourceCell {
  /** Package-relative chunk GLB paths, exactly as authored; empty when the cell has none. */
  readonly chunks: readonly string[];
  /** The cell's own JSON node, so a proxy is attached in place without rebuilding the file. */
  readonly raw: Record<string, unknown>;
  readonly x: number;
  readonly z: number;
}

export interface IWorldProxy {
  readonly buffer: Buffer;
  /**
   * Conservative bound on the merged opaque geometry's world-space error, in metres: the requested
   * simplification error as a fraction of the cell's world extent. A bound the simplifier is
   * guaranteed to honour, not a measured value.
   */
  readonly error: number;
  readonly logical: string;
  /**
   * Draw primitives the proxy submits at runtime. It counts merged mesh primitives, which can
   * exceed the number of distinct material identities when vertex layouts keep primitives apart.
   */
  readonly materialGroups: number;
  readonly reference: string;
  readonly triangles: number;
  readonly x: number;
  readonly z: number;
}

export interface IWorldProxyDecline {
  readonly reason: string;
  readonly x: number;
  readonly z: number;
}

export interface IWorldProxyResult {
  readonly declined: readonly IWorldProxyDecline[];
  readonly proxies: readonly IWorldProxy[];
}

export interface IWorldProxyCookOptions {
  /**
   * Reads a chunk by its normalised package-relative logical path. The caller owns the source
   * root, the exclude globs and the collected input set, so it also owns `included` below.
   */
  readonly read: (logical: string) => Promise<Buffer>;
  /**
   * Whether a normalised chunk logical was collected into this bake. Absent means the reader
   * accepts any path; the compile always supplies it so an excluded or out-of-root chunk can
   * never be pulled back through a proxy.
   */
  readonly included?: (logical: string) => boolean;
  readonly world: IWorldPackageSource;
  readonly worldLogical: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict v1 detection. A JSON file that is not exactly a v1 world package returns `undefined`
 * and is left byte-identical by the caller; the checks mirror `validateWorldPackage`'s
 * structure without its error collection, because an unrelated document is not an error here.
 */
export function readWorldPackage(input: Buffer): IWorldPackageSource | undefined {
  let json: unknown;
  try {
    json = JSON.parse(input.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(json) || json.version !== 1) return undefined;
  if (typeof json.cellSize !== "number" || !Number.isFinite(json.cellSize) || json.cellSize <= 0)
    return undefined;
  if (!Array.isArray(json.cells)) return undefined;
  const cells: IWorldSourceCell[] = [];
  for (const cell of json.cells) {
    if (!isRecord(cell)) return undefined;
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.z)) return undefined;
    if (!Array.isArray(cell.runs)) return undefined;
    let chunks: string[] = [];
    if (cell.chunks !== undefined) {
      if (
        !Array.isArray(cell.chunks) ||
        cell.chunks.some((chunk) => typeof chunk !== "string" || chunk.length === 0)
      )
        return undefined;
      chunks = cell.chunks as string[];
    }
    cells.push({
      chunks,
      raw: cell,
      x: cell.x as number,
      z: cell.z as number,
    });
  }
  return { cellSize: json.cellSize, cells, json };
}

/** The deterministic logical path of a cell's proxy, beside its world package. */
export function proxyLogicalFor(worldLogical: string, x: number, z: number): string {
  const directory = path.dirname(worldLogical);
  const stem = path.basename(worldLogical, path.extname(worldLogical));
  const name = `${stem}.cell_${x}_${z}.proxy.glb`;
  return directory === "." ? name : `${directory}/${name}`;
}

/** The proxy's path as the world JSON names it, relative to the world package's own directory. */
function proxyReferenceFor(worldLogical: string, x: number, z: number): string {
  return path.basename(proxyLogicalFor(worldLogical, x, z));
}

/**
 * Resolves an authored chunk reference against the world package's directory into a normalised,
 * package-relative logical path, or `undefined` when it escapes the package (`../../x.glb`, an
 * absolute path, or a bare Windows drive). A safe `../` reference that stays inside the package is
 * allowed; the caller then checks the result against the collected input set.
 */
export function resolveChunkLogical(worldLogical: string, chunk: string): string | undefined {
  if (chunk.length === 0 || chunk.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(chunk))
    return undefined;
  const directory = path.posix.dirname(worldLogical);
  const joined = directory === "." ? chunk : `${directory}/${chunk}`;
  const normalized = path.posix.normalize(joined);
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

/**
 * Why this document cannot be reproduced as a proxy, or `undefined` when it can.
 *
 * Skins, morph targets, animation and non-triangle topology change what a merged mesh would draw.
 * A node-, mesh- or primitive-level extension other than the GPU instancing this cook expands is
 * a visibility or geometry behaviour the merge cannot reproduce, so it too declines the cell
 * rather than approximating it.
 */
function unsupportedReason(document: Document): string | undefined {
  const root = document.getRoot();
  if (root.listAnimations().length > 0) return "animation";
  for (const node of root.listNodes()) {
    if (node.getSkin() !== null) return "skinned";
    const mesh = node.getMesh();
    if (mesh === null) continue;
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.listTargets().length > 0) return "morph";
      if (primitive.getMode() !== TRIANGLES) return "topology";
    }
  }
  for (const node of root.listNodes())
    for (const extension of node.listExtensions())
      if (extension.extensionName !== "EXT_mesh_gpu_instancing") return "extension";
  for (const mesh of root.listMeshes()) {
    if (mesh.listExtensions().length > 0) return "extension";
    for (const primitive of mesh.listPrimitives())
      if (primitive.listExtensions().length > 0) return "extension";
  }
  return undefined;
}

/** Copies one chunk into the target document and moves its nodes under the proxy scene. */
function mergeInto(target: Document, source: Document): void {
  const primary = target.getRoot().listScenes()[0] ?? target.createScene("proxy");
  mergeDocuments(target, source);
  for (const scene of [...target.getRoot().listScenes()]) {
    if (scene === primary) continue;
    for (const node of [...scene.listChildren()]) primary.addChild(node);
    scene.dispose();
  }
  // A source whose nodes sit outside any scene copies them unattached; keep them in the proxy
  // rather than letting flatten's cleanup prune drop authored geometry.
  for (const node of [...target.getRoot().listNodes()])
    if (node.listParents().length === 0) primary.addChild(node);
}

/** The largest world-space axis span of the merged scene, the metre scale of the error bound. */
function sceneExtent(scene: Scene): number {
  const { max, min } = getBounds(scene);
  const span = (low: number, high: number): number => Math.max(0, high - low);
  return Math.max(span(min[0], max[0]), span(min[1], max[1]), span(min[2], max[2]));
}

/**
 * Whether every drawn vertex and every transform above it is finite.
 *
 * `getBounds` composes each mesh node's world matrix with its POSITION accessor, so one NaN or
 * Infinity — an authored transform, a vertex, or a `min`/`max` — flows into the published world
 * error. It is the acceptance boundary for the "finite, conservative error" claim: the bound the
 * simplifier is handed and the metres reported back are only meaningful when the input is finite.
 * A cell that fails is declined whole, so no proxy is emitted with non-finite geometry or an error
 * that `JSON.stringify` would silently turn into `null`.
 */
function finiteGeometry(document: Document): boolean {
  const root = document.getRoot();
  for (const node of root.listNodes()) {
    if (node.getMesh() === null) continue;
    if (!(node.getWorldMatrix() as number[]).every(Number.isFinite)) return false;
  }
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (position === null) return false;
      const array = position.getArray();
      if (array === null || array.length === 0) return false;
      for (let index = 0; index < array.length; index += 1)
        if (!Number.isFinite(array[index] as number)) return false;
      const min = position.getMin([0, 0, 0]);
      const max = position.getMax([0, 0, 0]);
      if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return false;
    }
  }
  return true;
}

/** Clears authored `extras` from every location a runtime import scans for entity metadata. */
function clearExtras(document: Document): void {
  const root = document.getRoot();
  for (const scene of root.listScenes()) scene.setExtras({});
  for (const node of root.listNodes()) node.setExtras({});
  for (const mesh of root.listMeshes()) {
    mesh.setExtras({});
    for (const primitive of mesh.listPrimitives()) primitive.setExtras({});
  }
}

interface ICellBuild {
  readonly buffer: Buffer;
  readonly error: number;
  readonly materialGroups: number;
  readonly triangles: number;
}

/**
 * Merges one cell's chunk GLBs into one proxy GLB. Returns a decline reason instead of throwing
 * for anything the merge cannot reproduce faithfully.
 */
async function buildCellProxy(
  chunkBuffers: readonly Buffer[],
): Promise<ICellBuild | { readonly decline: string }> {
  const writer = new NodeIO().registerExtensions([
    ...ALL_EXTENSIONS,
    TNVirtualGeometry,
    TNDiscreteLod,
  ]);
  const target = new Document();
  target.createScene("proxy");
  for (const bytes of chunkBuffers) {
    let document: Document;
    try {
      const io = await createGltfReader(bytes);
      document = await readGltfDocument(io, bytes);
    } catch {
      return { decline: "unreadable-chunk" };
    }
    const reason = unsupportedReason(document);
    if (reason !== undefined) return { decline: reason };
    // GPU instancing draws one Mesh at N authored transforms, and `join` would skip the batch
    // node silently. Expanding it is installed support: each instance becomes an ordinary child
    // node, so the merge keeps every instance. Done on the source, where the extension property
    // definitely lives, before the document is merged.
    await document.transform(uninstance());
    // A malformed chunk is refused before it reaches the merge: the whole cell is declined, so
    // no half-merged proxy can carry non-finite geometry forward.
    if (!finiteGeometry(document)) return { decline: "malformed-geometry" };
    mergeInto(target, document);
  }
  try {
    // Geometry keeps its authored node matrices: join moves each primitive into the destination
    // node's space through glTF-Transform's `transformPrimitive`, which reverses winding for a
    // mirroring matrix and applies the normal matrix for a nonuniform scale. A mirrored or
    // nonuniform authored transform therefore keeps its visible face winding, normal/tangent
    // orientation and material sidedness without forcing `DoubleSide`.
    await target.transform(dedup({ propertyTypes: [PropertyType.MATERIAL, PropertyType.TEXTURE] }));
    await target.transform(flatten());
    await target.transform(join());
    // Triangle-soup sources have no indices yet; welding gives the simplifier real topology.
    await target.transform(weld({ overwrite: false }));
  } catch {
    return { decline: "merge-failed" };
  }
  clearExtras(target);

  // The extent and every published error are read from this geometry, so malformed input is
  // refused here rather than simplified into a proxy that carries NaN or an error JSON nulls.
  if (!finiteGeometry(target)) return { decline: "malformed-geometry" };
  const scene = target.getRoot().listScenes()[0];
  const extent = scene === undefined ? 0 : sceneExtent(scene);
  if (!Number.isFinite(extent)) return { decline: "malformed-geometry" };

  await MeshoptSimplifier.ready;
  let error = 0;
  for (const mesh of target.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const alphaMode = primitive.getMaterial()?.getAlphaMode();
      if (alphaMode === "MASK" || alphaMode === "BLEND") continue;
      const before =
        primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      if (before < 3) return { decline: "degenerate-primitive" };
      simplifyPrimitive(primitive, {
        simplifier: MeshoptSimplifier,
        error: HLOD_ERROR_RATIO,
        lockBorder: true,
        ratio: 0,
      });
      const after = primitive.getIndices()?.getCount() ?? 0;
      // Never silently drop a primitive that was visible: a degenerate result declines the cell.
      if (after < 3) return { decline: "degenerate-primitive" };
      if (after < before) error = Math.max(error, HLOD_ERROR_RATIO * extent);
    }
  }
  await target.transform(prune());
  // Each merged chunk brings its own buffer; a GLB carries exactly one.
  await target.transform(unpartition());

  let triangles = 0;
  let materialGroups = 0;
  for (const mesh of target.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      materialGroups += 1;
      const position = primitive.getAttribute("POSITION");
      const indices = primitive.getIndices();
      triangles += Math.floor((indices?.getCount() ?? position?.getCount() ?? 0) / 3);
    }
  }
  if (materialGroups === 0) return { decline: "empty-cell" };
  return {
    buffer: Buffer.from(await writer.writeBinary(target)),
    error,
    materialGroups,
    triangles,
  };
}

/** Cooks every eligible cell of one world package; cells without chunks are skipped silently. */
export async function cookWorldProxies(
  options: IWorldProxyCookOptions,
): Promise<IWorldProxyResult> {
  const { included, read, world, worldLogical } = options;
  const proxies: IWorldProxy[] = [];
  const declined: IWorldProxyDecline[] = [];
  for (const cell of world.cells) {
    if (cell.chunks.length === 0) continue;
    const buffers: Buffer[] = [];
    let reason: string | undefined;
    for (const chunk of cell.chunks) {
      const logical = resolveChunkLogical(worldLogical, chunk);
      if (logical === undefined) {
        reason = "outside-chunk";
        break;
      }
      if (included !== undefined && !included(logical)) {
        reason = "excluded-chunk";
        break;
      }
      try {
        buffers.push(await read(logical));
      } catch {
        reason = "missing-chunk";
        break;
      }
    }
    if (reason !== undefined) {
      declined.push({ reason, x: cell.x, z: cell.z });
      continue;
    }
    const built = await buildCellProxy(buffers);
    if ("decline" in built) {
      declined.push({ reason: built.decline, x: cell.x, z: cell.z });
      continue;
    }
    proxies.push({
      buffer: built.buffer,
      error: built.error,
      logical: proxyLogicalFor(worldLogical, cell.x, cell.z),
      materialGroups: built.materialGroups,
      reference: proxyReferenceFor(worldLogical, cell.x, cell.z),
      triangles: built.triangles,
      x: cell.x,
      z: cell.z,
    });
  }
  return { declined, proxies };
}

/** Rewrites the world JSON with `cell.proxy` added to every cell that got one. */
export function applyProxiesToWorld(
  world: IWorldPackageSource,
  proxies: readonly IWorldProxy[],
): Buffer {
  const byCell = new Map(proxies.map((proxy) => [`${proxy.x}_${proxy.z}`, proxy]));
  for (const cell of world.cells) {
    const proxy = byCell.get(`${cell.x}_${cell.z}`);
    if (proxy === undefined) continue;
    cell.raw.proxy = {
      error: proxy.error,
      glb: proxy.reference,
      materialGroups: proxy.materialGroups,
      triangles: proxy.triangles,
    };
  }
  return Buffer.from(`${JSON.stringify(world.json, null, 2)}\n`, "utf8");
}

/** The build line the PRD names: cells considered, proxies written and declines, with reasons. */
export function formatWorldHlod(worldLogical: string, result: IWorldProxyResult): string {
  const maxError = result.proxies.reduce((worst, proxy) => Math.max(worst, proxy.error), 0);
  const declined =
    result.declined.length === 0
      ? ""
      : ` declined=${String(result.declined.length)}:${result.declined
          .map((entry) => `${String(entry.x)}_${String(entry.z)}@${entry.reason}`)
          .join(",")}`;
  return `TN_WORLD_HLOD world=${worldLogical} proxies=${String(result.proxies.length)} maxError=${String(maxError)}${declined}`;
}
