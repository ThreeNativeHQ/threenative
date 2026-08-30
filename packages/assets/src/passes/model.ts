import {
  Accessor,
  type Document,
  type GLTF,
  type Node as GltfNode,
  type Primitive as GltfPrimitive,
  NodeIO,
  type Skin,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { type IAssetPass, type IAssetPassOutput, classify } from "../compile.js";

/**
 * Optimizes compiled models: dedup → prune → reorder → quantize → meshopt, in that fixed
 * order, each individually switchable in config. Output declares `KHR_mesh_quantization` and
 * `EXT_meshopt_compression`; the runtime lazily wires three's own MeshoptDecoder for exactly
 * those files (see `core/src/assets.ts`).
 *
 * The pass verifies its own output before shipping it: the result is re-read and its
 * triangle, vertex, joint and clip counts and bounding box are compared against the source,
 * throwing and naming the drift beyond tolerance. A pipeline that silently loses a mesh is
 * worse than no pipeline. Counts are taken over scene-reachable content only, so `prune`
 * dropping DCC leftovers is not drift — losing *referenced* geometry is. Joint indices and
 * weights are never quantized below what the source declared.
 *
 * Draco stays an input, never an output: a Draco `.glb` is decoded here (the codec loads
 * only when one is seen, so no project pays for it) and re-emitted as Meshopt. Animation
 * channels are compressed but never resampled — resampling changes timing, which is gameplay.
 */

export interface IModelPassesOptions {
  readonly dedup?: boolean;
  readonly meshopt?: boolean;
  readonly prune?: boolean;
  readonly quantize?: boolean;
  readonly reorder?: boolean;
}

export interface IModelQuantizeOptions {
  /** Normal precision in bits, default 8. */
  readonly normalBits?: number;
  /** Position precision in bits, default 16. */
  readonly positionBits?: number;
  /** UV precision in bits, default 12. */
  readonly uvBits?: number;
}

export interface IModelPassOptions {
  readonly passes?: IModelPassesOptions;
  /** Preserve generated TEXCOORD_1 data that is consumed by a runtime-attached lightmap. */
  readonly preserveLightmapUv?: boolean;
  readonly quantize?: IModelQuantizeOptions;
}

export interface IModelPassOutputEntry {
  readonly extensions: readonly string[];
  readonly triangles: number;
  readonly vertices: number;
}

const DRACO_EXTENSION = "KHR_draco_mesh_compression";

/** Relative bounding-box tolerance of the self-verify check (PRD: 0.1%). */
const BBOX_TOLERANCE = 0.001;

const DEFAULT_POSITION_BITS = 16;
const DEFAULT_NORMAL_BITS = 8;
const DEFAULT_UV_BITS = 12;

type RootOf = ReturnType<Document["getRoot"]>;

interface IModelStats {
  readonly boundingBox: { readonly max: number[]; readonly min: number[] } | undefined;
  readonly clips: number;
  readonly joints: number;
  readonly triangles: number;
  readonly vertices: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the glTF JSON header out of a `.glb`/`.gltf` buffer without full parsing. */
function peekExtensions(input: Buffer): ReadonlySet<string> {
  try {
    const json =
      input.subarray(0, 4).toString("ascii") === "glTF"
        ? (JSON.parse(
            input.subarray(20, 20 + input.readUInt32LE(12)).toString("utf8"),
          ) as GLTF.IGLTF)
        : (JSON.parse(input.toString("utf8")) as GLTF.IGLTF);
    return new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
  } catch {
    // Full parsing reports malformed input with a proper named error; the peek only
    // decides which codecs to prepare.
    return new Set();
  }
}

function jsonOfGlb(binary: Buffer): GLTF.IGLTF {
  return JSON.parse(
    binary.subarray(20, 20 + binary.readUInt32LE(12)).toString("utf8"),
  ) as GLTF.IGLTF;
}

async function createIo(): Promise<NodeIO> {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io;
}

async function readDocument(input: Buffer, logicalPath: string): Promise<Document> {
  let io = await createIo();
  if (peekExtensions(input).has(DRACO_EXTENSION)) {
    // Loaded only when a Draco input actually appears, so projects without one never pay
    // for the codec.
    const { createDecoderModule } = await import("draco3dgltf");
    io = io.registerDependencies({ "draco3d.decoder": await createDecoderModule() });
  }
  try {
    // readJSON resolves to the Document itself; binaryToJSON only unwraps the container.
    const document =
      input.subarray(0, 4).toString("ascii") === "glTF"
        ? await io.readJSON(await io.binaryToJSON(input))
        : await io.readJSON({
            json: JSON.parse(input.toString("utf8")) as GLTF.IGLTF,
            resources: {},
          });
    return document;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `TN_ASSETS_MODEL_UNREADABLE: could not parse '${logicalPath}' for the model pass: ${detail}. External buffer or image URIs are not supported; use a self-contained .glb.`,
    );
  }
}

async function writeDocument(
  document: Document,
  logicalPath: string,
): Promise<{ buffer: Buffer; extensions: readonly string[] }> {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  try {
    const buffer = Buffer.from(await io.writeBinary(document));
    return { buffer, extensions: jsonOfGlb(buffer).extensionsUsed ?? [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`TN_ASSETS_MODEL_WRITE_FAILED: could not write '${logicalPath}': ${detail}`);
  }
}

function primitiveTriangles(primitive: GltfPrimitive): number {
  const drawn =
    primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
  return Math.floor(drawn / 3);
}

/**
 * Decodes one POSITION element into the value a vertex shader sees: raw floats on
 * unquantized data, or the normalized [-1, 1] fraction on quantized ones. The metric scale
 * is NOT restored here — quantization folds it into node transforms (static meshes) or the
 * joint × inverse-bind chain (skinned meshes), both applied by the caller.
 */
function decodeElement(accessor: Accessor, index: number): [number, number, number] {
  const array = accessor.getArray();
  const base = index * accessor.getElementSize();
  const x = array[base] ?? 0;
  const y = array[base + 1] ?? 0;
  const z = array[base + 2] ?? 0;
  if (!accessor.getNormalized()) return [x, y, z];
  switch (accessor.getComponentType()) {
    case Accessor.ComponentType.BYTE:
      return [Math.max(x / 127, -1), Math.max(y / 127, -1), Math.max(z / 127, -1)];
    case Accessor.ComponentType.UNSIGNED_BYTE:
      return [x / 255, y / 255, z / 255];
    case Accessor.ComponentType.SHORT:
      return [Math.max(x / 32767, -1), Math.max(y / 32767, -1), Math.max(z / 32767, -1)];
    case Accessor.ComponentType.UNSIGNED_SHORT:
      return [x / 65535, y / 65535, z / 65535];
    default:
      return [x, y, z];
  }
}

/**
 * Evaluates a vertex exactly as the GPU does at bind pose and returns its world position.
 * Unskinned vertices go through the node transform; skinned ones through the weighted
 * joint × inverse-bind matrices — which is precisely where quantization's volume
 * compensation cancels out for skinned meshes.
 */
/** glTF normalized-accessor decode scale per component type, as the GPU applies it. */
function normalizedWeightScale(accessor: Accessor): number {
  switch (accessor.getComponentType()) {
    case Accessor.ComponentType.BYTE:
      return 1 / 127;
    case Accessor.ComponentType.UNSIGNED_BYTE:
      return 1 / 255;
    case Accessor.ComponentType.SHORT:
      return 1 / 32767;
    case Accessor.ComponentType.UNSIGNED_SHORT:
      return 1 / 65535;
    default:
      return 1;
  }
}

function evaluateVertex(
  position: Accessor,
  index: number,
  joints: Accessor | null,
  weights: Accessor | null,
  jointMatrices: readonly number[][] | undefined,
  fallbackMatrix: readonly number[],
): [number, number, number] {
  const [x, y, z] = decodeElement(position, index);
  if (jointMatrices === undefined || joints === null || weights === null) {
    return transformPoint(fallbackMatrix, x, y, z);
  }
  const jointArray = joints.getArray();
  const weightArray = weights.getArray();
  const weightScale = weights.getNormalized() ? normalizedWeightScale(weights) : 1;
  let wx = 0;
  let wy = 0;
  let wz = 0;
  for (let slot = 0; slot < 4; slot += 1) {
    const base = index * 4 + slot;
    const weight = (weightArray[base] ?? 0) * weightScale;
    if (weight === 0) continue;
    const matrix = jointMatrices[jointArray[base] ?? 0];
    if (matrix === undefined) continue;
    const point = transformPoint(matrix, x, y, z);
    wx += point[0] * weight;
    wy += point[1] * weight;
    wz += point[2] * weight;
  }
  // A vertex whose weights do not sum to one keeps its rigid position as a fallback.
  if (wx === 0 && wy === 0 && wz === 0) return transformPoint(fallbackMatrix, x, y, z);
  return [wx, wy, wz];
}

/** Column-major 4x4 transform of a point (glTF convention). */
function transformPoint(
  m: readonly number[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const c = (index: number): number => m[index] ?? 0;
  return [
    c(0) * x + c(4) * y + c(8) * z + c(12),
    c(1) * x + c(5) * y + c(9) * z + c(13),
    c(2) * x + c(6) * y + c(10) * z + c(14),
  ];
}

/** Column-major 4x4 matrix product `a * b`. */
function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      const c = (index: number): number => a[index] ?? 0;
      const d = (index: number): number => b[index] ?? 0;
      out[column * 4 + row] =
        c(row) * d(column * 4) +
        c(4 + row) * d(column * 4 + 1) +
        c(8 + row) * d(column * 4 + 2) +
        c(12 + row) * d(column * 4 + 3);
    }
  }
  return out;
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Stats over scene-reachable content only; DCC leftovers dropped by prune are not drift.
 * The bounding box is taken over bind-pose vertex positions evaluated the way the GPU
 * evaluates them — node transforms for static meshes, weighted joint matrices for skinned
 * ones — because quantization replaces accessor arrays with normalized integers whose
 * metric scale lives in exactly those transforms.
 */
export function reachableStats(root: RootOf): IModelStats {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let triangles = 0;
  let vertices = 0;
  const skins = new Set<Skin>();
  const visited = new Set<GltfNode>();

  const walk = (node: GltfNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const skin = node.getSkin();
    if (skin !== null) skins.add(skin);
    const mesh = node.getMesh();
    if (mesh !== null) {
      const worldMatrix = node.getWorldMatrix();
      // Bind-pose joint matrices: joint world transform composed with the inverse bind.
      let jointMatrices: number[][] | undefined;
      if (skin !== null) {
        const inverseBinds = skin.getInverseBindMatrices();
        jointMatrices = skin.listJoints().map((joint, index) => {
          const jointWorld = joint.getWorldMatrix();
          const ibm =
            inverseBinds?.getElement(index, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) ??
            IDENTITY_MATRIX;
          return multiplyMatrices(jointWorld, ibm);
        });
      }
      for (const primitive of mesh.listPrimitives()) {
        triangles += primitiveTriangles(primitive);
        const position = primitive.getAttribute("POSITION");
        if (position === null) continue;
        vertices += position.getCount();
        for (let index = 0; index < position.getCount(); index += 1) {
          const [wx, wy, wz] = evaluateVertex(
            position,
            index,
            primitive.getAttribute("JOINTS_0"),
            primitive.getAttribute("WEIGHTS_0"),
            skin !== null ? jointMatrices : undefined,
            worldMatrix,
          );
          minX = Math.min(minX, wx);
          minY = Math.min(minY, wy);
          minZ = Math.min(minZ, wz);
          maxX = Math.max(maxX, wx);
          maxY = Math.max(maxY, wy);
          maxZ = Math.max(maxZ, wz);
        }
      }
    }
    node.listChildren().forEach(walk);
  };
  root
    .listScenes()
    .flatMap((scene) => scene.listChildren())
    .forEach(walk);

  let joints = 0;
  const seenJoints = new Set<GltfNode>();
  for (const skin of skins) {
    for (const joint of skin.listJoints()) {
      if (seenJoints.has(joint)) continue;
      seenJoints.add(joint);
      joints += 1;
    }
  }
  const finite = Number.isFinite(minX) && Number.isFinite(maxZ);
  return {
    boundingBox: finite ? { max: [maxX, maxY, maxZ], min: [minX, minY, minZ] } : undefined,
    // A clip survives when something reachable is still animated by it.
    clips: root.listAnimations().filter((animation) =>
      animation.listChannels().some((channel) => {
        const targetNode = channel.getTargetNode();
        return targetNode !== null && visited.has(targetNode);
      }),
    ).length,
    joints,
    triangles,
    vertices,
  };
}

/** Smallest per-semantic joint-index/weight component storage, tracked separately so a
 * narrow WEIGHTS accessor cannot hide behind an already-narrow JOINTS one. */
function jointComponentSizes(root: RootOf): {
  joints: number;
  weights: number;
} {
  let joints = 0;
  let weights = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const jointsAccessor = primitive.getAttribute("JOINTS_0");
      if (jointsAccessor !== null) {
        const size = jointsAccessor.getComponentSize();
        joints = joints === 0 ? size : Math.min(joints, size);
      }
      const weightsAccessor = primitive.getAttribute("WEIGHTS_0");
      if (weightsAccessor !== null) {
        const size = weightsAccessor.getComponentSize();
        weights = weights === 0 ? size : Math.min(weights, size);
      }
    }
  }
  return { joints, weights };
}

function bboxDrift(left: IModelStats, right: IModelStats): number | undefined {
  const leftBox = left.boundingBox;
  const rightBox = right.boundingBox;
  if (leftBox === undefined || rightBox === undefined) {
    return leftBox === rightBox ? 0 : undefined;
  }
  const component = (
    box: IModelStats["boundingBox"],
    corner: "max" | "min",
    axis: number,
  ): number => box?.[corner][axis] ?? 0;
  const scale = Math.max(
    ...[0, 1, 2].map((axis) => component(leftBox, "max", axis) - component(leftBox, "min", axis)),
    1e-6,
  );
  return Math.max(
    ...[0, 1, 2].map(
      (axis) =>
        Math.max(
          Math.abs(component(leftBox, "min", axis) - component(rightBox, "min", axis)),
          Math.abs(component(leftBox, "max", axis) - component(rightBox, "max", axis)),
        ) / scale,
    ),
  );
}

/** Compares the re-read output against the source and throws naming the drift. */
export function assertNoDrift(source: IModelStats, output: IModelStats, logicalPath: string): void {
  const failures: string[] = [];
  if (source.triangles !== output.triangles) {
    failures.push(`triangles ${source.triangles} -> ${output.triangles}`);
  }
  if (source.vertices !== output.vertices) {
    failures.push(`vertices ${source.vertices} -> ${output.vertices}`);
  }
  if (source.joints !== output.joints) {
    failures.push(`joints ${source.joints} -> ${output.joints}`);
  }
  if (source.clips !== output.clips) {
    failures.push(`animation clips ${source.clips} -> ${output.clips}`);
  }
  const bbox = bboxDrift(source, output);
  if (bbox === undefined) {
    failures.push("bounding box lost");
  } else if (bbox > BBOX_TOLERANCE) {
    failures.push(
      `bounding box drifted ${(bbox * 100).toFixed(3)}% (tolerance ${(BBOX_TOLERANCE * 100).toFixed(1)}%)`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `TN_ASSETS_MODEL_DRIFT: self-verification failed for '${logicalPath}': ${failures.join("; ")}.`,
    );
  }
}

/**
 * Snaps every scene-reachable POSITION accessor onto a uniform `2^bits` grid spanning its
 * own bounds — the destructive low-precision quantization the underlying library refuses
 * to express. Used only for configured depths below its 8-bit floor; the self-verify is
 * expected to reject the result.
 */
function snapPositions(root: RootOf, bits: number): void {
  const levels = 2 ** bits - 1;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (position === null || position.getNormalized()) continue;
      const array = position.getArray();
      const min = position.getMin([0, 0, 0]);
      const max = position.getMax([0, 0, 0]);
      const stride = position.getElementSize();
      const output = new Float32Array(array.length);
      for (let index = 0; index < position.getCount(); index += 1) {
        for (let axis = 0; axis < stride; axis += 1) {
          const source = array[index * stride + axis] ?? 0;
          const low = min[axis] ?? 0;
          const high = max[axis] ?? 0;
          const span = high - low;
          const fraction = span === 0 ? 0 : (source - low) / span;
          output[index * stride + axis] = low + (Math.round(fraction * levels) / levels) * span;
        }
      }
      position.setArray(output);
    }
  }
}

export function modelPass(options: IModelPassOptions = {}): IAssetPass {
  return {
    configuration: {
      passes: {
        dedup: options.passes?.dedup ?? true,
        meshopt: options.passes?.meshopt ?? true,
        prune: options.passes?.prune ?? true,
        quantize: options.passes?.quantize ?? true,
        reorder: options.passes?.reorder ?? true,
      },
      quantize: {
        normalBits: options.quantize?.normalBits ?? DEFAULT_NORMAL_BITS,
        positionBits: options.quantize?.positionBits ?? DEFAULT_POSITION_BITS,
        uvBits: options.quantize?.uvBits ?? DEFAULT_UV_BITS,
      },
    },
    name: "model",
    apply: async (input: Buffer, logicalPath: string): Promise<Buffer | IAssetPassOutput> => {
      if (classify(logicalPath) !== "model") return input;
      const passes = options.passes ?? {};
      const enabled = {
        dedup: passes.dedup ?? true,
        meshopt: passes.meshopt ?? true,
        prune: passes.prune ?? true,
        quantize: passes.quantize ?? true,
        reorder: passes.reorder ?? true,
      };
      if (!Object.values(enabled).some(Boolean)) return input;

      const document = await readDocument(input, logicalPath);
      // Draco is an input format only: the extension was consumed by the reader's decode,
      // so it never reaches the writer — the output re-emits as Meshopt further below.
      for (const extension of document.getRoot().listExtensionsUsed()) {
        if (extension.extensionName === DRACO_EXTENSION) extension.dispose();
      }
      const source = reachableStats(document.getRoot());
      const jointFloor = jointComponentSizes(document.getRoot());

      // Fixed order: dedup → prune → reorder → quantize → meshopt. None is reorderable.
      if (enabled.dedup) await dedup()(document);
      if (enabled.prune)
        await prune({ keepAttributes: options.preserveLightmapUv === true })(document);
      if (enabled.reorder || enabled.meshopt) await MeshoptEncoder.ready;
      if (enabled.reorder) await reorder({ encoder: MeshoptEncoder })(document);
      if (enabled.quantize) {
        // Depths below the library's 8-bit floor are honoured by pre-rounding the floats
        // onto the coarser grid first; the self-verify then fails the build on the drift.
        const requestedBits = options.quantize?.positionBits ?? DEFAULT_POSITION_BITS;
        if (requestedBits < 8) snapPositions(document.getRoot(), requestedBits);
        // Joint indices and weights are excluded outright: quantizing them below the
        // exporter's declaration is where skinned meshes visibly break, and the library's
        // own default narrows weights to 8 bits unless told otherwise.
        await quantize({
          quantizeColor: 8,
          quantizeNormal: options.quantize?.normalBits ?? DEFAULT_NORMAL_BITS,
          quantizePosition: Math.max(requestedBits, 8),
          quantizeTexcoord: options.quantize?.uvBits ?? DEFAULT_UV_BITS,
          pattern: /^(?!JOINTS|WEIGHTS)/u,
          normalizeWeights: false,
        })(document);
      }
      if (enabled.meshopt) {
        document
          .createExtension(EXTMeshoptCompression)
          .setRequired(true)
          // Compression runs at write time; QUANTIZE pre-processing is ours above.
          .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
      }

      const narrowed = jointComponentSizes(document.getRoot());
      const narrowedSemantics: string[] = [];
      if (jointFloor.joints > narrowed.joints) {
        narrowedSemantics.push(
          `JOINTS (${String(jointFloor.joints)} -> ${String(narrowed.joints)} bytes)`,
        );
      }
      if (jointFloor.weights > narrowed.weights) {
        narrowedSemantics.push(
          `WEIGHTS (${String(jointFloor.weights)} -> ${String(narrowed.weights)} bytes)`,
        );
      }
      if (narrowedSemantics.length > 0) {
        throw new Error(
          `TN_ASSETS_MODEL_JOINT_QUANTIZED: '${logicalPath}' narrowed joint data storage for ${narrowedSemantics.join(", ")} per component; joint data is never quantized below the source declaration.`,
        );
      }

      const { buffer, extensions } = await writeDocument(document, logicalPath);
      const output = reachableStats((await readDocument(buffer, logicalPath)).getRoot());
      assertNoDrift(source, output, logicalPath);
      const entry: IModelPassOutputEntry = {
        extensions: [...extensions].sort(),
        triangles: output.triangles,
        vertices: output.vertices,
      };
      return { buffer, entry: { ...entry } };
    },
  };
}
