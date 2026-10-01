import { type BufferGeometry, Group, type Mesh, type Object3D, Quaternion, Vector3 } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

import { JOINT_STRIDE } from "./abi.js";
import {
  type IMetaHumanBindings,
  type IMetaHumanGltfFacts,
  type IMetaHumanRigFacts,
  validateMetaHumanAssets,
} from "./asset-contract.js";
import { type IMetaHumanBasis, metaHumanBasis } from "./coordinates.js";
import { MetaHumanAssetError, type MetaHumanErrorCode } from "./errors.js";
import { sha256Hex } from "./sha256.js";
import type { IRigEvaluator } from "./wasm-evaluator.js";

/**
 * The slice of `ctx.assets` this package uses, declared here rather than imported from core.
 *
 * Structural, so `ctx.assets` satisfies it without this package depending on core, and so a test
 * can pass a fake with the same two shapes. The model goes through the loader's own cache, the
 * way every other asset does; nothing here keeps a competing copy of a model.
 */
export interface IMetaHumanAssets {
  model<T = unknown>(path: string): Promise<T>;
  /** Where a logical path is served from, in the order worth trying. */
  resolve(path: string): Promise<readonly string[]>;
}

/**
 * What a glTF loader hands back: the scene, the JSON it was parsed from, and the association
 * table that says which glTF mesh and primitive each scene object came from.
 *
 * The associations are the only authority for that mapping. A glTF mesh node is routinely
 * unnamed — MetaHuman's own export puts its mesh on an unnamed node — so matching scene objects
 * by name would silently bind to nothing.
 */
export interface IMetaHumanModel {
  readonly scene: Object3D;
  readonly parser?: {
    readonly json?: unknown;
    readonly associations?: ReadonlyMap<unknown, { meshes?: number; primitives?: number }>;
  };
}

/** Which evaluator a handle crosses to, and what it was built from. */
export interface IMetaHumanBackend {
  /** `"wasm"` or `"native"`, reported verbatim by `diagnostics()`. */
  readonly name: string;
  create(dna: Uint8Array): Promise<IRigEvaluator> | IRigEvaluator;
  /** The pinned OpenRigLogic revision this backend was built from. */
  openRigLogic(): Promise<string> | string;
}

/** One declared control, as the specimen's sidecar pinned it. */
export interface IMetaHumanControl {
  readonly alias: string;
  readonly gui: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** What the handle actually is, for a diagnostics panel or a bug report. */
export interface IMetaHumanDiagnostics {
  readonly backend: string;
  readonly openRigLogic: string;
  readonly lod: number;
  readonly joints: number;
  readonly blendShapes: number;
  readonly animatedMaps: number;
  readonly controls: number;
}

export interface ILoadMetaHumanOptions {
  readonly assets: IMetaHumanAssets;
  /** Logical path of the prepared GLB, through the asset loader. */
  readonly model: string;
  /** Logical path of the specimen's original head DNA. */
  readonly dna: string;
  /** Logical path of the binding metadata sidecar. */
  readonly bindings: string;
  /** Source LOD to start on. Defaults to LOD0, the authored source level. */
  readonly lod?: number;
}

export interface IMetaHuman {
  /** Add this to a scene. It is a plain `Object3D`; its child is the model's own graph. */
  readonly root: Object3D;
  /** The declared controls, in the sidecar's order. Read-only. */
  readonly controls: readonly IMetaHumanControl[];
  /** Names of the rig's animated maps, index-aligned with `animatedMaps()`. */
  animatedMapNames(): readonly string[];
  /**
   * The last evaluation's animated-map weights, a copy in the rig's own order.
   *
   * A getter rather than a push, because a game binds these to its own material inputs and owns
   * that binding: the handle drives joints and morphs and never writes a material.
   */
  animatedMaps(): Float32Array;
  /**
   * Set controls by declared alias. Applied on the next `update()`.
   *
   * An alias the specimen does not declare throws `TN_MH_UNKNOWN_CONTROL`; a value outside the
   * declared domain throws `TN_MH_BAD_DOMAIN`, a non-finite one `TN_MH_NON_FINITE`. Nothing is
   * clamped or coerced — a control reporting 1.5 for a 0..1 domain is a bug in the game, and a
   * silently clamped face is a worse bug report than a throw.
   */
  setControls(values: Readonly<Record<string, number>>): void;
  /** Every control back to the default its bindings declared. Applied on the next `update()`. */
  reset(): void;
  /**
   * Switch LOD, atomically with the rig.
   *
   * The evaluator's LOD, the visible mesh set, the active mappings and the current expression
   * change together, and the replacement is evaluated *before* it is shown, so a switch never
   * shows a neutral frame. A LOD the specimen does not declare throws `TN_MH_BAD_LOD`.
   */
  setLod(lod: number): void;
  /**
   * Feed the effective GUI vector through the rig and apply its output to the scene.
   *
   * Call it once per frame, after any base/body animation and before the renderer draws: the
   * rig writes the face joints, its output is applied, and the skeleton updates as it always
   * does. There is deliberately no `dt` — facial evaluation has no time step, and a body
   * mixer's update position belongs to the caller.
   */
  update(): void;
  diagnostics(): IMetaHumanDiagnostics;
  /** Idempotent. Every other method throws `TN_MH_DISPOSED` afterwards. */
  dispose(): void;
}

/** One bound joint: the node it drives, and the rest pose it composes onto. */
interface IJointBinding {
  readonly node: Object3D;
  readonly joint: number;
  readonly restPosition: Vector3;
  readonly restQuaternion: Quaternion;
  readonly restScale: Vector3;
}

/** One bound morph target: where its influence goes, and which LOD it belongs to. */
interface IMorphBinding {
  readonly mesh: Mesh;
  readonly index: number;
  readonly channel: number;
  readonly lod: number;
}

function fail(code: MetaHumanErrorCode, message: string): never {
  throw new MetaHumanAssetError(code, message);
}

/**
 * The bytes behind a logical path, through the loader's own resolution.
 *
 * Same walk the core world loaders use: the authored name first, then whatever else the
 * manifest offers, and an error that names every url tried rather than the first.
 */
async function readBytes(assets: IMetaHumanAssets, path: string): Promise<Uint8Array> {
  const candidates = await assets.resolve(path);
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(`${url} (status ${String(response.status)})`);
        continue;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      failures.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return fail(
    "TN_MH_WASM_LOAD",
    `'${path}' is not served from any of ${String(candidates.length)} candidate url(s): ${failures.join("; ")}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The glTF JSON, narrowed to the two arrays a bindings sidecar is allowed to point into. */
function gltfFactsOf(model: IMetaHumanModel): IMetaHumanGltfFacts {
  const json = model.parser?.json;
  if (!isRecord(json) || !Array.isArray(json.nodes) || !Array.isArray(json.meshes))
    fail(
      "TN_MH_SCHEMA",
      "the model did not come from a glTF loader, so its bindings cannot be checked against it",
    );
  // The validator reads three optional fields off these entries and treats everything else as
  // absent, which is exactly what an unparsed glTF JSON is.
  // quality-allow: the glTF JSON is untrusted input by definition; the validator is the reader
  return { nodes: json.nodes, meshes: json.meshes } as unknown as IMetaHumanGltfFacts;
}

function isMesh(node: unknown): node is Mesh {
  return (node as Mesh | null)?.isMesh === true;
}

function collect(root: Object3D): Object3D[] {
  const found: Object3D[] = [];
  const walk = (node: Object3D): void => {
    found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

/**
 * glTF mesh index to the geometry each of its primitives produced, read from the loader.
 *
 * Geometry is the join between the loader's table and the cloned graph: `SkeletonUtils.clone`
 * shares geometry with the source and copies the morph arrays per instance, so a clone's mesh is
 * the one using the geometry the loader built for that glTF primitive.
 */
function geometryByMeshIndex(model: IMetaHumanModel): Map<number, BufferGeometry[]> {
  const byIndex = new Map<number, BufferGeometry[]>();
  for (const [object, mapping] of model.parser?.associations ?? []) {
    if (!isMesh(object) || mapping.meshes === undefined) continue;
    const primitives = byIndex.get(mapping.meshes) ?? [];
    primitives[mapping.primitives ?? 0] = object.geometry;
    byIndex.set(mapping.meshes, primitives);
  }
  return byIndex;
}

/** The cloned graph's meshes, by the geometry they share with the loaded model. */
function meshesByGeometry(root: Object3D): Map<BufferGeometry, Mesh[]> {
  const byGeometry = new Map<BufferGeometry, Mesh[]>();
  for (const node of collect(root)) {
    if (!isMesh(node)) continue;
    const existing = byGeometry.get(node.geometry);
    if (existing === undefined) byGeometry.set(node.geometry, [node]);
    else existing.push(node);
  }
  return byGeometry;
}

function setInfluence(morph: IMorphBinding, weight: number): void {
  const influences = morph.mesh.morphTargetInfluences;
  if (influences === undefined || morph.index >= influences.length)
    fail("TN_MH_INDEX_RANGE", `${morph.mesh.name} has no morph target ${String(morph.index)}`);
  influences[morph.index] = weight;
}

/** Which declared LOD a glTF mesh index belongs to, or -1 when no LOD claims it. */
function lodOfMesh(bindings: IMetaHumanBindings, mesh: number): number {
  return bindings.lods.find((entry) => entry.meshes.includes(mesh))?.lod ?? -1;
}

/**
 * One driven MetaHuman head: a model, its rig, and the controls that move it.
 *
 * Every table is built once, at load — joints, morph targets, LOD mesh sets, control indices — so
 * `update()` is a straight-line pass over pre-resolved slots with no name lookup and no
 * allocation inside the frame loop.
 */
class MetaHuman implements IMetaHuman {
  readonly root: Group;
  readonly controls: readonly IMetaHumanControl[];

  readonly #evaluator: IRigEvaluator;
  readonly #backend: string;
  readonly #openRigLogic: string;
  readonly #basis: IMetaHumanBasis;
  readonly #joints: readonly IJointBinding[];
  readonly #morphs: readonly IMorphBinding[];
  readonly #lodMeshes: readonly (readonly Mesh[])[];
  readonly #meshes: readonly Mesh[];
  readonly #animatedMapNames: readonly string[];
  readonly #gui: Float32Array;
  readonly #defaultGui: Float32Array;
  readonly #controlByAlias: ReadonlyMap<string, IMetaHumanControl & { readonly index: number }>;
  readonly #mapWeights: Float32Array;
  #lod: number;
  #disposed = false;

  /** Per-frame scratch, so a head with hundreds of joints allocates nothing per frame. */
  readonly #translation = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #deltaRotation = new Quaternion();
  readonly #deltaScale = new Vector3();

  constructor(input: {
    readonly loader: IMetaHumanModel;
    readonly evaluator: IRigEvaluator;
    readonly bindings: IMetaHumanBindings;
    readonly backend: string;
    readonly openRigLogic: string;
    readonly lod: number;
  }) {
    const { bindings, evaluator } = input;
    this.#evaluator = evaluator;
    this.#backend = input.backend;
    this.#openRigLogic = input.openRigLogic;
    this.#basis = metaHumanBasis(bindings.coordinates);

    // The loader's model is cached and shared, so the rig is cloned per instance: two characters
    // get two joint graphs over one set of geometries, and neither can write the other's face.
    this.root = new Group();
    this.root.name = "metahuman";
    this.root.add(cloneSkeleton(input.loader.scene));

    const nodes = new Map<string, Object3D>();
    for (const node of collect(this.root)) if (node.name.length > 0) nodes.set(node.name, node);

    const jointIndex = new Map(evaluator.names("joint").map((name, index) => [name, index]));
    this.#joints = bindings.joints.map((entry) => {
      const joint = jointIndex.get(entry.dna);
      const node = nodes.get(entry.node);
      if (joint === undefined || node === undefined)
        fail("TN_MH_UNKNOWN_NODE", `${entry.dna} -> ${entry.node} is not in the loaded rig`);
      // Captured here, at load: the exported node's bind-time local transform is the neutral the
      // rig's deltas compose onto, and nothing else in the file is that value.
      return {
        node,
        joint,
        restPosition: node.position.clone(),
        restQuaternion: node.quaternion.clone(),
        restScale: node.scale.clone(),
      };
    });

    const geometry = geometryByMeshIndex(input.loader);
    const meshes = meshesByGeometry(this.root);
    this.#meshes = [...meshes.values()].flat();
    const meshOf = (mesh: number, primitive: number): Mesh => {
      const where = `glTF mesh ${String(mesh)} primitive ${String(primitive)}`;
      const source = geometry.get(mesh)?.[primitive];
      if (source === undefined) fail("TN_MH_INDEX_RANGE", `the model has no ${where}`);
      const found = meshes.get(source)?.[0];
      if (found === undefined) fail("TN_MH_INDEX_RANGE", `the model has no mesh for ${where}`);
      return found;
    };
    const channelIndex = new Map(evaluator.names("blendShape").map((name, index) => [name, index]));
    this.#morphs = bindings.morphs.map((entry) => {
      const mesh = meshOf(entry.mesh, entry.primitive);
      const channel = channelIndex.get(entry.channel);
      if (channel === undefined) fail("TN_MH_UNKNOWN_CHANNEL", `the rig has no ${entry.channel}`);
      // The sidecar carries the target index and the loader built the name->index dictionary
      // from the same export, so the one check worth making here is that the target at that index
      // really is this channel: exports name a target `<dnaMesh>__<channel>`, and the prefix is
      // the exporter's, not something this package may assume.
      const name = Object.keys(mesh.morphTargetDictionary ?? {})[entry.target];
      if (name === undefined || !name.endsWith(`__${entry.channel}`))
        fail(
          "TN_MH_UNKNOWN_CHANNEL",
          `glTF mesh ${String(entry.mesh)} target ${String(entry.target)} is ${String(name)}, not ${entry.channel}`,
        );
      return { mesh, index: entry.target, channel, lod: lodOfMesh(bindings, entry.mesh) };
    });

    // A LOD binding names its meshes; every primitive of a named mesh belongs to that level.
    this.#lodMeshes = bindings.lods.map((entry) =>
      entry.meshes.flatMap((mesh) =>
        Array.from({ length: geometry.get(mesh)?.length ?? 0 }, (_, primitive) =>
          meshOf(mesh, primitive),
        ),
      ),
    );
    if (input.lod < 0 || input.lod >= this.#lodMeshes.length)
      fail("TN_MH_BAD_LOD", `${String(input.lod)} is not one of this specimen's LODs`);
    if (input.lod !== 0) this.#evaluator.setLod(input.lod);
    this.#lod = input.lod;
    this.#showLod(input.lod);

    this.controls = Object.freeze(
      bindings.controls.map((entry) =>
        Object.freeze({
          alias: entry.alias,
          gui: entry.gui,
          min: entry.min,
          max: entry.max,
          default: entry.default,
        }),
      ),
    );
    const gui = evaluator.names("gui");
    this.#gui = new Float32Array(gui.length);
    const byAlias = new Map<string, IMetaHumanControl & { readonly index: number }>();
    for (const control of this.controls) {
      const index = gui.indexOf(control.gui);
      if (index < 0) fail("TN_MH_UNKNOWN_CONTROL", `the rig has no GUI control ${control.gui}`);
      byAlias.set(control.alias, Object.freeze({ ...control, index }));
      this.#gui[index] = control.default;
    }
    this.#controlByAlias = byAlias;
    this.#defaultGui = Float32Array.from(this.#gui);
    this.#mapWeights = new Float32Array(evaluator.counts().animatedMaps);
    this.#animatedMapNames = Object.freeze(
      bindings.animatedMaps?.map((entry) => entry.map) ?? evaluator.names("animatedMap"),
    );
  }

  animatedMapNames(): readonly string[] {
    this.#live();
    return this.#animatedMapNames;
  }

  animatedMaps(): Float32Array {
    this.#live();
    return Float32Array.from(this.#mapWeights);
  }

  setControls(values: Readonly<Record<string, number>>): void {
    this.#live();
    if (!isRecord(values)) fail("TN_MH_SCHEMA", "setControls takes a record of alias to number");
    for (const [alias, value] of Object.entries(values)) {
      const control = this.#controlByAlias.get(alias);
      if (control === undefined)
        fail("TN_MH_UNKNOWN_CONTROL", `no control is declared as ${alias}`);
      if (typeof value !== "number")
        fail("TN_MH_BAD_DOMAIN", `${alias} was given a ${typeof value}`);
      if (!Number.isFinite(value)) fail("TN_MH_NON_FINITE", `${alias} was given ${String(value)}`);
      if (value < control.min || value > control.max)
        fail(
          "TN_MH_BAD_DOMAIN",
          `${alias} was given ${String(value)}, outside [${String(control.min)}, ${String(control.max)}]`,
        );
      this.#gui[control.index] = value;
    }
  }

  reset(): void {
    this.#live();
    this.#gui.set(this.#defaultGui);
  }

  setLod(lod: number): void {
    this.#live();
    if (!Number.isInteger(lod) || lod < 0 || lod >= this.#lodMeshes.length)
      fail(
        "TN_MH_BAD_LOD",
        `${String(lod)} is not one of this specimen's ${String(this.#lodMeshes.length)} LODs`,
      );
    if (lod === this.#lod) return;
    for (const mesh of this.#lodMeshes[this.#lod] as readonly Mesh[]) mesh.visible = false;
    this.#evaluator.setLod(lod);
    this.#lod = lod;
    // Outputs that no longer apply are cleared before the new level is evaluated, so a target
    // only LOD0 has cannot keep deforming a hidden mesh and reappear on the way back.
    for (const morph of this.#morphs) if (morph.lod !== lod) setInfluence(morph, 0);
    this.#evaluate();
    this.#showLod(lod);
  }

  update(): void {
    this.#live();
    this.#evaluate();
  }

  diagnostics(): IMetaHumanDiagnostics {
    this.#live();
    const counts = this.#evaluator.counts();
    return Object.freeze({
      backend: this.#backend,
      openRigLogic: this.#openRigLogic,
      lod: this.#lod,
      joints: counts.joints,
      blendShapes: counts.blendShapes,
      animatedMaps: counts.animatedMaps,
      controls: this.controls.length,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    // The rig and the scene graph are this handle's own. The model's geometry, materials and
    // textures are borrowed from the asset loader and outlive every character, so they are left
    // alone: disposing them would break whatever else still holds the same cached model.
    this.#evaluator.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }

  #live(): void {
    if (this.#disposed) fail("TN_MH_DISPOSED", "this MetaHuman handle is disposed");
  }

  #showLod(lod: number): void {
    const active = new Set(this.#lodMeshes[lod]);
    for (const mesh of this.#meshes) mesh.visible = active.has(mesh);
  }

  /** Effective GUI vector in, joint and morph output out. The rig maps GUI to raw itself. */
  #evaluate(): void {
    const evaluator = this.#evaluator;
    evaluator.setGuiControls(this.#gui);
    evaluator.evaluate(true);

    const joints = evaluator.jointOutputs();
    for (const binding of this.#joints) {
      const at = binding.joint * JOINT_STRIDE;
      if (at + JOINT_STRIDE > joints.length)
        fail("TN_MH_LENGTH", `the rig returned ${joints.length} floats, too few for its joints`);
      const { node, restPosition, restQuaternion, restScale } = binding;
      this.#translation.set(
        joints[at] as number,
        joints[at + 1] as number,
        joints[at + 2] as number,
      );
      this.#rotation.set(
        joints[at + 3] as number,
        joints[at + 4] as number,
        joints[at + 5] as number,
        joints[at + 6] as number,
      );
      this.#deltaScale.set(
        joints[at + 7] as number,
        joints[at + 8] as number,
        joints[at + 9] as number,
      );
      // Every output is a delta from the rig's own bind pose, and upstream composes one by
      // addition on translation and scale and by quaternion product on rotation
      // (OpenRigLogic `examples/Advanced.cpp`: bind * delta, bind on the left). Converting each factor is exact, because the
      // axis map is a similarity: it maps a product of rotations to the product of the images.
      this.#basis.vector(this.#translation, node.position).add(restPosition);
      this.#basis.quaternion(this.#rotation, this.#deltaRotation);
      node.quaternion.copy(restQuaternion).multiply(this.#deltaRotation);
      this.#basis.scaleTriple(this.#deltaScale, node.scale).add(restScale);
    }

    const shapes = evaluator.blendShapeOutputs();
    for (const morph of this.#morphs) {
      const weight = shapes[morph.channel];
      if (weight === undefined)
        fail("TN_MH_LENGTH", `the rig returned ${shapes.length} blend shape weights`);
      if (morph.lod === this.#lod) setInfluence(morph, weight);
    }
    this.#mapWeights.set(evaluator.animatedMapOutputs());
  }
}

/**
 * Load a prepared MetaHuman head: its GLB through the game's asset loader, its DNA and binding
 * sidecar through the same loader's resolved paths.
 *
 * The bindings are checked against the rig and the loaded model before anything is driven: a name
 * that does not exist, an index past the end of its array, a control domain that does not hold and
 * a DNA whose bytes are not the ones the sidecar names are all refusals here, never a half-driven
 * face. Two calls with the same paths produce two independent characters.
 *
 * Call `update()` once per frame after any body animation, and `dispose()` on teardown. Nothing
 * outside the handle is retained: the model, its geometries and its textures belong to
 * `ctx.assets` and outlive it.
 *
 * Shared by both entries through a `backend` argument, so the native entry can hand in the C++
 * evaluator and never pull the browser binary in.
 */
export async function createMetaHuman(
  backend: IMetaHumanBackend,
  options: ILoadMetaHumanOptions,
): Promise<IMetaHuman> {
  const { assets, model, dna, bindings: bindingsPath } = checkOptions(options);
  const [dnaBytes, bindingsBytes] = await Promise.all([
    readBytes(assets, dna),
    readBytes(assets, bindingsPath),
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bindingsBytes));
  } catch (error) {
    return fail(
      "TN_MH_SCHEMA",
      `'${bindingsPath}' is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const evaluator = await backend.create(dnaBytes);
  try {
    const loaded = await assets.model<IMetaHumanModel>(model);
    const gltf = gltfFactsOf(loaded);
    const rig: IMetaHumanRigFacts = {
      gui: evaluator.names("gui"),
      raw: evaluator.names("raw"),
      joints: evaluator.names("joint"),
      blendShapes: evaluator.names("blendShape"),
      animatedMaps: evaluator.names("animatedMap"),
      lodCount: evaluator.counts().lodCount,
    };
    // The GLB's own sha256 is a preparation-time contract: the asset pipeline already serves a
    // content-addressed model, and hashing it here would download the file a second time to
    // learn what the sidecar says about the file it shipped beside. The DNA is not
    // pipeline-hashed, so the one that can be checked for free is.
    const bindings = validateMetaHumanAssets({
      bindings: parsed,
      dnaSha256: await sha256Hex(dnaBytes),
      rig,
      gltf,
    });
    return new MetaHuman({
      loader: loaded,
      evaluator,
      bindings,
      backend: backend.name,
      openRigLogic: await backend.openRigLogic(),
      lod: options.lod ?? 0,
    });
  } catch (error) {
    // The rig is this call's own, so a failure after it was created must not leak it.
    evaluator.dispose();
    throw error;
  }
}

function checkOptions(options: ILoadMetaHumanOptions): ILoadMetaHumanOptions {
  if (!isRecord(options)) fail("TN_MH_SCHEMA", "loadMetaHuman requires an options object");
  for (const [name, value] of [
    ["model", options.model],
    ["dna", options.dna],
    ["bindings", options.bindings],
  ])
    if (typeof value !== "string" || value.length === 0)
      fail("TN_MH_SCHEMA", `${name} must be a non-empty logical asset path`);
  if (typeof options.assets?.model !== "function" || typeof options.assets?.resolve !== "function")
    fail("TN_MH_SCHEMA", "assets must be the game's asset loader (model and resolve)");
  if (options.lod !== undefined && !Number.isInteger(options.lod))
    fail("TN_MH_BAD_LOD", `lod ${String(options.lod)} is not an integer`);
  return options;
}
