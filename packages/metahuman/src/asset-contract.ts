import { MetaHumanAssetError, type MetaHumanErrorCode } from "./errors.js";

/** The only schema version this build understands. */
export const METAHUMAN_BINDINGS_SCHEMA_VERSION = 1;

/** What the rig actually contains, read from the DNA through the evaluator. */
export interface IMetaHumanRigFacts {
  readonly gui: readonly string[];
  readonly raw: readonly string[];
  readonly joints: readonly string[];
  readonly blendShapes: readonly string[];
  readonly animatedMaps: readonly string[];
  readonly lodCount: number;
}

/** The parts of the exported GLB the bindings are allowed to point at. */
export interface IMetaHumanGltfNode {
  readonly name?: string;
}

export interface IMetaHumanGltfPrimitive {
  readonly targets?: readonly unknown[];
  readonly extras?: { readonly targetNames?: readonly string[] };
}

export interface IMetaHumanGltfMesh {
  readonly name?: string;
  readonly primitives: readonly IMetaHumanGltfPrimitive[];
}

export interface IMetaHumanGltfFacts {
  readonly nodes: readonly IMetaHumanGltfNode[];
  readonly meshes: readonly IMetaHumanGltfMesh[];
}

export interface IMetaHumanAssetInput {
  /** The parsed bindings sidecar. `unknown` because it is untrusted JSON. */
  readonly bindings: unknown;
  readonly dnaSha256: string;
  /**
   * SHA-256 of the prepared GLB, when the caller has its bytes.
   *
   * Optional because a loaded model is not re-downloaded to be hashed: the asset pipeline
   * already serves a content-addressed file, so the preparation step is where that hash belongs.
   * Omitted, every other check below still runs — this weakens the tamper check, not the
   * name, index, domain or bounds checks.
   */
  readonly glbSha256?: string;
  readonly rig: IMetaHumanRigFacts;
  readonly gltf: IMetaHumanGltfFacts;
}

export interface IMetaHumanJointBinding {
  readonly dna: string;
  readonly node: string;
}

export interface IMetaHumanMorphBinding {
  readonly channel: string;
  readonly mesh: number;
  readonly primitive: number;
  readonly target: number;
}

export interface IMetaHumanLodBinding {
  readonly lod: number;
  readonly meshes: readonly number[];
}

export interface IMetaHumanControlBinding {
  readonly alias: string;
  readonly gui: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export interface IMetaHumanAnimatedMapBinding {
  readonly map: string;
}

/** A bindings sidecar that passed every check. Its names exist and its indices are in range. */
export interface IMetaHumanBindings {
  readonly schemaVersion: typeof METAHUMAN_BINDINGS_SCHEMA_VERSION;
  readonly specimen: { readonly id: string; readonly source: string; readonly license: string };
  readonly hashes: { readonly dna: string; readonly glb: string };
  readonly coordinates: {
    readonly sourceUnits: "cm" | "m";
    readonly sourceUp: "y" | "z";
    readonly handedness: "left" | "right";
  };
  readonly joints: readonly IMetaHumanJointBinding[];
  readonly morphs: readonly IMetaHumanMorphBinding[];
  readonly lods: readonly IMetaHumanLodBinding[];
  readonly controls: readonly IMetaHumanControlBinding[];
  readonly animatedMaps?: readonly IMetaHumanAnimatedMapBinding[];
}

const SHA256 = /^[0-9a-f]{64}$/u;

function fail(code: MetaHumanErrorCode, message: string): never {
  throw new MetaHumanAssetError(code, message);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("TN_MH_SCHEMA", `${what} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail("TN_MH_SCHEMA", `${what} must be a non-empty string`);
  return value;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("TN_MH_SCHEMA", `${what} must be an array`);
  return value;
}

/** A count that indexes something. A non-integer here is a broken export, not a rounding. */
function index(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail("TN_MH_SCHEMA", `${what} must be a non-negative integer`);
  return value;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("TN_MH_NON_FINITE", `${what} must be a finite number`);
  return value;
}

function sha256(value: unknown, what: string): string {
  if (typeof value !== "string" || !SHA256.test(value))
    fail("TN_MH_SCHEMA", `${what} must be a lowercase hex sha256`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail("TN_MH_SCHEMA", `${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

/**
 * Reject anything that could leave the asset directory: absolute paths, Windows drive
 * letters, backslash separators and any `..` segment. Called on every path a game hands
 * the loader, before the path is joined onto a root.
 */
export function assertAssetPath(path: string): string {
  if (typeof path !== "string" || path.length === 0)
    fail("TN_MH_PATH_ESCAPE", "an asset path must be a non-empty string");
  if (path.includes("\\")) fail("TN_MH_PATH_ESCAPE", `${path} uses a backslash separator`);
  if (path.startsWith("/") || /^[a-zA-Z]:/u.test(path))
    fail("TN_MH_PATH_ESCAPE", `${path} is absolute`);
  if (path.split("/").some((segment) => segment === ".."))
    fail("TN_MH_PATH_ESCAPE", `${path} walks out with ".."`);
  return path;
}

/**
 * Check one prepared specimen — bindings sidecar, DNA, GLB — against the rig it claims to
 * drive. Fails closed: a missing key, a wrong type, a hash that does not match the bytes on
 * disk and an index past the end of its array are all rejections, never warnings.
 */
export function validateMetaHumanAssets(input: IMetaHumanAssetInput): IMetaHumanBindings {
  const { bindings, dnaSha256, glbSha256, rig, gltf } = input;
  const root = record(bindings, "bindings");

  if (root.schemaVersion !== METAHUMAN_BINDINGS_SCHEMA_VERSION)
    fail("TN_MH_SCHEMA", `schemaVersion must be ${METAHUMAN_BINDINGS_SCHEMA_VERSION}`);

  const specimen = record(root.specimen, "specimen");
  const hashes = record(root.hashes, "hashes");
  const coordinates = record(root.coordinates, "coordinates");

  // Format before equality: a malformed hash is a schema error, not a mismatch.
  const dnaHash = sha256(hashes.dna, "hashes.dna");
  const glbHash = sha256(hashes.glb, "hashes.glb");
  if (dnaHash !== dnaSha256)
    fail("TN_MH_HASH_MISMATCH", "the loaded DNA is not the one this bindings sidecar names");
  if (glbSha256 !== undefined && glbHash !== glbSha256)
    fail("TN_MH_HASH_MISMATCH", "the loaded GLB is not the one this bindings sidecar names");

  const nodeNames = new Set<string>();
  for (const node of gltf.nodes) {
    if (typeof node.name === "string") nodeNames.add(node.name);
  }
  const jointNames = new Set(rig.joints);
  const channelNames = new Set(rig.blendShapes);
  const guiNames = new Set(rig.gui);
  const mapNames = new Set(rig.animatedMaps);

  const joints = list(root.joints, "joints").map((entry) => {
    const joint = record(entry, "a joint binding");
    const dna = text(joint.dna, "joints[].dna");
    const node = text(joint.node, "joints[].node");
    if (!jointNames.has(dna)) fail("TN_MH_UNKNOWN_JOINT", `the DNA has no joint named ${dna}`);
    if (!nodeNames.has(node)) fail("TN_MH_UNKNOWN_NODE", `the GLB has no node named ${node}`);
    return { dna, node };
  });

  const morphs = list(root.morphs, "morphs").map((entry) => {
    const morph = record(entry, "a morph binding");
    const channel = text(morph.channel, "morphs[].channel");
    if (!channelNames.has(channel))
      fail("TN_MH_UNKNOWN_CHANNEL", `the DNA has no blend shape channel named ${channel}`);
    const mesh = index(morph.mesh, "morphs[].mesh");
    const meshEntry = gltf.meshes[mesh];
    if (meshEntry === undefined) fail("TN_MH_INDEX_RANGE", `mesh ${mesh} is not in the GLB`);
    const primitive = index(morph.primitive, "morphs[].primitive");
    const meshPrimitive = meshEntry.primitives[primitive];
    if (meshPrimitive === undefined)
      fail("TN_MH_INDEX_RANGE", `mesh ${mesh} has no primitive ${primitive}`);
    const target = index(morph.target, "morphs[].target");
    if (target >= (meshPrimitive.targets?.length ?? 0))
      fail(
        "TN_MH_INDEX_RANGE",
        `mesh ${mesh} primitive ${primitive} has ${meshPrimitive.targets?.length ?? 0} targets`,
      );
    // A mesh's local morph order is its own; a global channel index is not a target index.
    // When the exporter recorded the target names, they are the only authority.
    const targetNames = meshPrimitive.extras?.targetNames;
    if (Array.isArray(targetNames) && targetNames[target] !== channel)
      fail(
        "TN_MH_UNKNOWN_CHANNEL",
        `mesh ${mesh} primitive ${primitive} target ${target} is ${String(targetNames[target])}, not ${channel}`,
      );
    return { channel, mesh, primitive, target };
  });

  const lods = list(root.lods, "lods").map((entry) => {
    const lodEntry = record(entry, "a LOD binding");
    const lod = index(lodEntry.lod, "lods[].lod");
    if (lod >= rig.lodCount) fail("TN_MH_BAD_LOD", `lod ${lod} is not below ${rig.lodCount}`);
    const meshes = list(lodEntry.meshes, "lods[].meshes").map((mesh, position) => {
      const value = index(mesh, `lods[${lod}].meshes[${position}]`);
      if (value >= gltf.meshes.length) fail("TN_MH_INDEX_RANGE", `mesh ${value} is not in the GLB`);
      return value;
    });
    return { lod, meshes };
  });

  const aliases = new Set<string>();
  const controls = list(root.controls, "controls").map((entry) => {
    const control = record(entry, "a control binding");
    const alias = text(control.alias, "controls[].alias");
    if (aliases.has(alias)) fail("TN_MH_DUPLICATE_ALIAS", `${alias} is bound twice`);
    aliases.add(alias);
    const gui = text(control.gui, "controls[].gui");
    if (!guiNames.has(gui))
      fail("TN_MH_UNKNOWN_CONTROL", `the DNA has no GUI control named ${gui}`);
    const min = finite(control.min, `${alias}.min`);
    const max = finite(control.max, `${alias}.max`);
    const value = finite(control.default, `${alias}.default`);
    if (!(min < max)) fail("TN_MH_BAD_DOMAIN", `${alias} has min ${min} and max ${max}`);
    if (value < min || value > max)
      fail("TN_MH_BAD_DOMAIN", `${alias} defaults to ${value}, outside [${min}, ${max}]`);
    return { alias, gui, min, max, default: value };
  });

  const animatedMaps =
    root.animatedMaps === undefined ? undefined : mapBindings(root.animatedMaps, mapNames);

  return Object.freeze({
    schemaVersion: METAHUMAN_BINDINGS_SCHEMA_VERSION,
    specimen: Object.freeze({
      id: text(specimen.id, "specimen.id"),
      source: text(specimen.source, "specimen.source"),
      license: text(specimen.license, "specimen.license"),
    }),
    hashes: Object.freeze({ dna: dnaHash, glb: glbHash }),
    coordinates: Object.freeze({
      sourceUnits: oneOf(coordinates.sourceUnits, ["cm", "m"] as const, "coordinates.sourceUnits"),
      sourceUp: oneOf(coordinates.sourceUp, ["y", "z"] as const, "coordinates.sourceUp"),
      handedness: oneOf(
        coordinates.handedness,
        ["left", "right"] as const,
        "coordinates.handedness",
      ),
    }),
    joints,
    morphs,
    lods,
    controls,
    ...(animatedMaps === undefined ? {} : { animatedMaps }),
  });
}

function mapBindings(
  value: unknown,
  mapNames: ReadonlySet<string>,
): readonly IMetaHumanAnimatedMapBinding[] {
  return list(value, "animatedMaps").map((entry) => {
    const map = record(entry, "an animated map binding");
    const name = text(map.map, "animatedMaps[].map");
    if (!mapNames.has(name)) fail("TN_MH_UNKNOWN_MAP", `the DNA has no animated map named ${name}`);
    return { map: name };
  });
}
