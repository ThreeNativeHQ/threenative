import { readFile } from "node:fs/promises";
import path from "node:path";
import { Box3, LoadingManager, Vector3 } from "three";

export interface IAssetVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface IAssetBounds {
  readonly center: IAssetVector3;
  readonly size: IAssetVector3;
}

export interface IAssetUnits {
  readonly label: "likely centimetres" | "likely metres";
  readonly longestAxis: number;
}

export interface IAssetForwardAxis {
  readonly axis: "X" | "Y" | "Z" | "unknown";
  readonly basis: "longest geometry axis" | "none";
  readonly direction: "unknown";
}

export interface IAssetInspection {
  readonly file: string;
  readonly path: string;
  readonly bounds: IAssetBounds;
  readonly units: IAssetUnits;
  readonly forwardAxis: IAssetForwardAxis;
  readonly clips: readonly string[];
  readonly bones: readonly string[];
  readonly meshes: number;
  readonly materials: number;
  readonly textures: number;
}

export interface IInspectOptions {
  readonly file: string;
  readonly json: boolean;
}

const SUPPORTED_EXTENSIONS = new Set([".glb", ".gltf"]);
const CENTIMETRE_HEURISTIC_THRESHOLD = 10;
const RESOURCE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

type ProgressEventConstructor = new (type: string, init?: unknown) => object;

interface INodeGltfGlobals {
  createImageBitmap?: (...args: unknown[]) => Promise<unknown>;
  self?: unknown;
}

interface INodeUrl {
  createObjectURL?: (object: Blob) => string;
}

function vector(value: Vector3): IAssetVector3 {
  return { x: value.x, y: value.y, z: value.z };
}

function emptyBounds(): IAssetBounds {
  return {
    center: { x: 0, y: 0, z: 0 },
    size: { x: 0, y: 0, z: 0 },
  };
}

function longestAxis(size: IAssetVector3): { axis: "X" | "Y" | "Z"; value: number } | undefined {
  const axes = [
    { axis: "X" as const, value: size.x },
    { axis: "Y" as const, value: size.y },
    { axis: "Z" as const, value: size.z },
  ];
  const result = axes.reduce((largest, current) =>
    current.value > largest.value ? current : largest,
  );
  return result.value > 0 ? result : undefined;
}

function installNodeGltfGlobals(): () => void {
  const globals = globalThis as unknown as INodeGltfGlobals;
  const nodeGlobals = globals as unknown as Record<string, unknown>;
  const previousSelf = globals.self;
  const previousCreateImageBitmap = globals.createImageBitmap;
  const previousProgressEvent = nodeGlobals.ProgressEvent as ProgressEventConstructor | undefined;
  const nodeUrl = URL as unknown as INodeUrl;
  const previousCreateObjectUrl = nodeUrl.createObjectURL;

  if (globals.self === undefined) globals.self = globalThis;
  if (globals.createImageBitmap === undefined) {
    globals.createImageBitmap = async () => ({ close() {}, height: 1, width: 1 });
  }
  if (previousProgressEvent === undefined) {
    nodeGlobals.ProgressEvent = class {
      constructor(
        readonly type: string,
        readonly init?: unknown,
      ) {}
    };
  }
  if (nodeUrl.createObjectURL === undefined) {
    nodeUrl.createObjectURL = () => "blob:threenative-inspect";
  }

  return () => {
    if (previousSelf === undefined) globals.self = undefined;
    else globals.self = previousSelf;
    if (previousCreateImageBitmap === undefined) globals.createImageBitmap = undefined;
    else globals.createImageBitmap = previousCreateImageBitmap;
    nodeGlobals.ProgressEvent = previousProgressEvent;
    if (previousCreateObjectUrl === undefined) nodeUrl.createObjectURL = undefined;
    else nodeUrl.createObjectURL = previousCreateObjectUrl;
  };
}

function localResourcePath(baseDirectory: string, uri: string): string | undefined {
  if (/^(?:blob|data):/i.test(uri) || /^(?:https?:)?\/\//i.test(uri)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch (error) {
    throw new Error(`Invalid glTF resource URI "${uri}": ${String(error)}`);
  }
  return path.resolve(baseDirectory, decoded);
}

function resourceMimeType(resourcePath: string, declared: string | undefined): string {
  return (
    declared ??
    RESOURCE_MIME_TYPES[path.extname(resourcePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function gltfResourceReferences(document: Record<string, unknown>): IGltfResourceReference[] {
  const references: IGltfResourceReference[] = [];
  for (const section of ["buffers", "images"] as const) {
    const entries = document[section];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || typeof entry.uri !== "string") continue;
      references.push({
        ...(typeof entry.mimeType === "string" ? { declared: entry.mimeType } : {}),
        uri: entry.uri,
      });
    }
  }
  return references;
}

interface IGltfResourceReference {
  readonly declared?: string;
  readonly uri: string;
}

async function readLocalResources(
  baseDirectory: string,
  references: readonly IGltfResourceReference[],
): Promise<Map<string, string>> {
  const resources = new Map<string, string>();
  for (const reference of references) {
    const resourcePath = localResourcePath(baseDirectory, reference.uri);
    if (resourcePath === undefined || resources.has(resourcePath)) continue;
    const resource = await readFile(resourcePath);
    const mimeType = resourceMimeType(resourcePath, reference.declared);
    resources.set(resourcePath, `data:${mimeType};base64,${resource.toString("base64")}`);
  }
  return resources;
}

async function localResourceResolver(file: string, data: Buffer): Promise<(url: string) => string> {
  if (path.extname(file).toLowerCase() !== ".gltf") return (url) => url;

  const document = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
  const references = gltfResourceReferences(document);
  const baseDirectory = path.dirname(path.resolve(file));
  const resources = await readLocalResources(baseDirectory, references);

  return (url) => {
    const resourcePath = localResourcePath(baseDirectory, url);
    return resourcePath === undefined ? url : (resources.get(resourcePath) ?? url);
  };
}

async function parseGltf(
  file: string,
  data: Buffer,
): Promise<{
  scene: import("three").Object3D;
  animations: readonly import("three").AnimationClip[];
  resourceCounts: {
    meshes?: number;
    materials?: number;
    textures?: number;
  };
}> {
  const restoreGlobals = installNodeGltfGlobals();
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const manager = new LoadingManager();
    manager.setURLModifier(await localResourceResolver(file, data));
    const loader = new GLTFLoader(manager);
    const extension = path.extname(file).toLowerCase();
    const payload =
      extension === ".gltf"
        ? data.toString("utf8")
        : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    const parsed = await loader.parseAsync(
      payload,
      `${path.dirname(path.resolve(file))}${path.sep}`,
    );
    const json = parsed.parser.json as {
      meshes?: unknown;
      materials?: unknown;
      textures?: unknown;
    };
    return {
      animations: parsed.animations,
      resourceCounts: {
        ...(Array.isArray(json.meshes) ? { meshes: json.meshes.length } : {}),
        ...(Array.isArray(json.materials) ? { materials: json.materials.length } : {}),
        ...(Array.isArray(json.textures) ? { textures: json.textures.length } : {}),
      },
      scene: parsed.scene,
    };
  } finally {
    restoreGlobals();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countSceneResources(scene: import("three").Object3D): {
  bones: string[];
  materials: number;
  meshes: number;
  textures: number;
} {
  const materials = new Set<object>();
  const textures = new Set<object>();
  const visited = new WeakSet<object>();
  const collectTextures = (value: unknown): void => {
    if (!isObject(value)) return;
    if ((value as { isTexture?: boolean }).isTexture === true) {
      textures.add(value);
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    for (const child of Object.values(value)) collectTextures(child);
  };
  const bones: string[] = [];
  let meshes = 0;

  scene.traverse((object) => {
    const candidate = object as import("three").Object3D & {
      isBone?: boolean;
      isMesh?: boolean;
      material?: unknown;
    };
    if (candidate.isBone === true) bones.push(candidate.name || "(unnamed)");
    if (candidate.isMesh !== true) return;
    meshes += 1;
    const material = candidate.material;
    for (const surface of Array.isArray(material) ? material : [material]) {
      if (isObject(surface)) {
        materials.add(surface);
        collectTextures(surface);
      }
    }
  });

  return { bones, materials: materials.size, meshes, textures: textures.size };
}

function inspectScene(
  file: string,
  scene: import("three").Object3D,
  animations: readonly import("three").AnimationClip[],
  resourceCounts: {
    meshes?: number;
    materials?: number;
    textures?: number;
  },
): IAssetInspection {
  scene.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(scene);
  const bounds = box.isEmpty()
    ? emptyBounds()
    : { center: vector(box.getCenter(new Vector3())), size: vector(box.getSize(new Vector3())) };
  const largest = longestAxis(bounds.size);
  const resources = countSceneResources(scene);
  return {
    bounds,
    bones: resources.bones,
    clips: animations.map((clip) => clip.name || "(unnamed)"),
    file: path.basename(file),
    forwardAxis:
      largest === undefined
        ? { axis: "unknown", basis: "none", direction: "unknown" }
        : { axis: largest.axis, basis: "longest geometry axis", direction: "unknown" },
    materials: resourceCounts.materials ?? resources.materials,
    meshes: resourceCounts.meshes ?? resources.meshes,
    path: path.resolve(file),
    textures: resourceCounts.textures ?? resources.textures,
    units: {
      label:
        largest !== undefined && largest.value > CENTIMETRE_HEURISTIC_THRESHOLD
          ? "likely centimetres"
          : "likely metres",
      longestAxis: largest?.value ?? 0,
    },
  };
}

function inspectionFailure(file: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`TN_ASSET_INSPECT_FAILED: ${file}: ${detail}`);
}

export function parseInspectArgs(argv: readonly string[]): IInspectOptions {
  const positional = argv.filter((argument) => !argument.startsWith("-"));
  const unknown = argv.filter((argument) => argument.startsWith("-") && argument !== "--json");
  if (unknown.length > 0 || positional.length !== 1) {
    throw new Error("Usage: npx create-threenative inspect <file.glb> [--json]");
  }
  const file = positional[0];
  if (file === undefined)
    throw new Error("Usage: npx create-threenative inspect <file.glb> [--json]");
  return { file, json: argv.includes("--json") };
}

export async function inspectAsset(file: string): Promise<IAssetInspection> {
  const extension = path.extname(file).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`TN_ASSET_INSPECT_UNSUPPORTED: ${file}: expected a .glb or .gltf file.`);
  }
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch (error) {
    throw inspectionFailure(file, error);
  }
  try {
    const parsed = await parseGltf(file, data);
    return inspectScene(file, parsed.scene, parsed.animations, parsed.resourceCounts);
  } catch (error) {
    throw inspectionFailure(file, error);
  }
}

function formatVector(value: IAssetVector3, separator: string): string {
  return [value.x, value.y, value.z].map((component) => component.toFixed(3)).join(separator);
}

function listOrNone(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

export function formatAssetInspection(result: IAssetInspection): string {
  const forward =
    result.forwardAxis.axis === "unknown"
      ? "unknown (glTF has no forward-axis metadata)"
      : `${result.forwardAxis.axis} (inferred from geometry; sign unknown)`;
  const bones =
    result.bones.length === 0 ? "(none)" : `${result.bones.join(", ")} (${result.bones.length})`;
  return `${[
    result.file,
    `  bounds     ${formatVector(result.bounds.size, " x ")}   (centre ${formatVector(result.bounds.center, ", ")})`,
    `  units      ${result.units.label} — longest axis ${result.units.longestAxis.toFixed(1)}`,
    `  forward    ${forward}`,
    `  clips      ${listOrNone(result.clips)}`,
    `  bones      ${bones}`,
    `  meshes     ${result.meshes}   materials ${result.materials}   textures ${result.textures}`,
  ].join("\n")}\n`;
}

export function inspectHelp(): string {
  return `${[
    "Usage: npx create-threenative inspect <file.glb> [--json]",
    "",
    "Read a glTF asset and report its bounds, units heuristic, axis observation, clips, bones,",
    "meshes, materials and textures. The command never modifies the asset.",
    "",
    "Options:",
    "  --json  Print the same inspection as machine-readable JSON.",
  ].join("\n")}\n`;
}

export async function inspectCommand(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<IAssetInspection> {
  const options = parseInspectArgs(argv);
  const result = await inspectAsset(options.file);
  write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatAssetInspection(result));
  return result;
}
