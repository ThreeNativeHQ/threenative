import "./file-fetch.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

import { loadMetaHuman } from "../src/index.js";
import type { IMetaHumanAssets, IMetaHumanModel } from "../src/metahuman.js";
import { RigEvaluator } from "../src/wasm-evaluator.js";

/**
 * The synthetic specimen the binding and lifecycle lanes drive.
 *
 * Redistributable and always run: the DNA is the committed fixture, the model is built here, and
 * the expected poses come from `fixtures/synthetic.reference.json`, which the standalone upstream
 * evaluator wrote. Those expectations are derived below *independently* of the conversion the
 * package implements: the specimen declares centimetres, a z-up axis and a left-handed basis, and
 * the exporter's component form of that map is written out by hand in `convertedVector` and
 * `convertedRotation`, so a failure means the implementation and the export disagree rather than
 * one implementation agreeing with itself.
 */

export const DNA = new Uint8Array(
  readFileSync(fileURLToPath(new URL("../fixtures/synthetic.dna", import.meta.url))),
);
export const REFERENCE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/synthetic.reference.json", import.meta.url)),
    "utf8",
  ),
) as {
  readonly counts: Readonly<Record<string, number>>;
  readonly names: Readonly<Record<string, readonly string[]>>;
  readonly cases: readonly {
    readonly name: string;
    readonly lod: number;
    readonly mode: string;
    readonly joints: readonly number[];
    readonly blendshapes: readonly number[];
    readonly animatedMaps: readonly number[];
  }[];
};

export const byName = new Map(REFERENCE.cases.map((entry) => [entry.name, entry]));
export const JOINT_NAMES = REFERENCE.names.joint ?? [];
export const CHANNELS = REFERENCE.names.blendshape ?? [];

/** glTF mesh 0, the LOD0 head: one target per channel, named as the export names them. */
const HEAD_CHANNELS = CHANNELS;
/** glTF mesh 1, the LOD1 head: only the jaw channel survives at that level. */
const LOD1_CHANNELS = CHANNELS.slice(0, 1);
const TARGET_PREFIX = "head_lod0_mesh";

/**
 * The synthetic scene's own bind pose, in glTF metres.
 *
 * The exported rest transform is the neutral a delta composes onto, and it is this scene's
 * business what that pose is. `jaw` and `brow_center` carry a rest rotation on purpose: a rig
 * whose every rest rotation is identity cannot tell `rest ∘ delta` from `delta ∘ rest`, and that
 * product order is the whole composition rule. That a real specimen's rest pose is the DNA's
 * converted neutral is what `neutral-match.spec.ts` proves, on the specimen.
 */
type XYZ = readonly [number, number, number];

export const REST: Readonly<Record<string, { position: XYZ; eulerZ: number }>> = {
  face_root: { position: [0, 0, 0], eulerZ: 0 },
  jaw: { position: [0, 0.0002, 0.0009], eulerZ: Math.PI / 2 },
  brow_center: { position: [0, 0.0006, -0.0011], eulerZ: -0.4 },
};

const CENTIMETRES = 0.01;
/** `(x, y, z) -> (x, z, -y)`, the declared z-up left-handed map, in centimetres. */
export function convertedVector(values: readonly number[]): Vector3 {
  return new Vector3(
    (values[0] as number) * CENTIMETRES,
    (values[2] as number) * CENTIMETRES,
    -(values[1] as number) * CENTIMETRES,
  );
}

/** `(x, y, z, w) -> (-x, -z, y, -w)`, the same map on a quaternion's four components. */
export function convertedRotation(values: readonly number[]): Quaternion {
  return new Quaternion(
    -(values[0] as number),
    -(values[2] as number),
    values[1] as number,
    -(values[3] as number),
  );
}

/** Where the reference says a case leaves each bound joint, rest pose composed onto deltas. */
export function expectedJoints(caseName: string) {
  const reference = byName.get(caseName);
  if (reference === undefined) throw new Error(`the reference has no case ${caseName}`);
  return JOINT_NAMES.map((name, index) => {
    const rest = REST[name];
    if (rest === undefined) throw new Error(`the scene has no rest pose for ${name}`);
    const at = index * 10;
    const restQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rest.eulerZ);
    return {
      position: convertedVector(reference.joints.slice(at, at + 3)).add(
        new Vector3(rest.position[0], rest.position[1], rest.position[2]),
      ),
      // Upstream composes bind * delta (OpenRigLogic examples/Advanced.cpp), in that order.
      quaternion: restQuaternion
        .clone()
        .multiply(convertedRotation(reference.joints.slice(at + 3, at + 7))),
      // A scale is a diagonal matrix, so the axis map permutes it and nothing else: the source's
      // z scale is the target's y scale, and no sign comes with it.
      scale: new Vector3(
        reference.joints[at + 7] as number,
        reference.joints[at + 9] as number,
        reference.joints[at + 8] as number,
      ).add(new Vector3(1, 1, 1)),
    };
  });
}

export function find(root: Object3D, name: string): Object3D | undefined {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = find(child, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function jointNode(root: Object3D, name: string): Object3D {
  const found = find(root, name);
  if (found === undefined) throw new Error(`the loaded scene has no node named ${name}`);
  return found;
}

export function head(human: { root: Object3D }, name: string): SkinnedMesh {
  const found = find(human.root, name);
  if (found === undefined || !(found as SkinnedMesh).isMesh)
    throw new Error(`the loaded scene has no mesh named ${name}`);
  return found as SkinnedMesh;
}

function bone(name: string, position: XYZ, eulerZ: number): Bone {
  const node = new Bone();
  node.name = name;
  node.position.set(position[0], position[1], position[2]);
  node.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), eulerZ);
  return node;
}

/** A skinned mesh with one primitive and `targets.length` named morph targets. */
function skinned(name: string, targets: readonly string[], bones: Bone[]): SkinnedMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]), 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new BufferAttribute(new Uint16Array([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new BufferAttribute(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), 4),
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.name = name;
  mesh.morphTargetInfluences = targets.map(() => 0);
  mesh.morphTargetDictionary = Object.fromEntries(targets.map((target, index) => [target, index]));
  mesh.bind(new Skeleton(bones));
  return mesh;
}

/** The glTF the loader would have produced, and the associations that go with it. */
export function buildModel(): IMetaHumanModel {
  const faceRoot = bone("face_root", REST.face_root?.position ?? [0, 0, 0], 0);
  const jaw = bone("jaw", REST.jaw?.position ?? [0, 0, 0], REST.jaw?.eulerZ ?? 0);
  const brow = bone(
    "brow_center",
    REST.brow_center?.position ?? [0, 0, 0],
    REST.brow_center?.eulerZ ?? 0,
  );
  faceRoot.add(jaw);
  jaw.add(brow);
  const bones: Bone[] = [faceRoot, jaw, brow];

  const head = skinned(
    "head",
    HEAD_CHANNELS.map((channel) => `${TARGET_PREFIX}__${channel}`),
    bones,
  );
  const headLod1 = skinned(
    "head_lod1",
    LOD1_CHANNELS.map((channel) => `head_lod1_mesh__${channel}`),
    bones,
  );
  // The mesh node is unnamed, exactly as MetaHuman's own export ships it: a binding that matched
  // scene meshes by name would find nothing here.
  const meshNode = new Object3D();
  meshNode.add(head, headLod1);
  const scene = new Object3D();
  scene.name = "Ada_Synthetic";
  scene.add(faceRoot, meshNode);

  return {
    scene,
    parser: {
      json: {
        nodes: [{ name: "face_root" }, { name: "jaw" }, { name: "brow_center" }, {}],
        // Target names on the mesh, not the primitive, exactly as the specimen's export writes
        // them: nothing in the load path may depend on a per-primitive extras block existing.
        meshes: [
          {
            name: "head",
            primitives: [{ targets: HEAD_CHANNELS.map(() => ({})) }],
            extras: { targetNames: HEAD_CHANNELS.map((channel) => `${TARGET_PREFIX}__${channel}`) },
          },
          {
            name: "head_lod1",
            primitives: [{ targets: LOD1_CHANNELS.map(() => ({})) }],
            extras: { targetNames: LOD1_CHANNELS.map((channel) => `head_lod1_mesh__${channel}`) },
          },
        ],
      },
      associations: new Map<unknown, { meshes?: number; primitives?: number }>([
        [head, { meshes: 0, primitives: 0 }],
        [headLod1, { meshes: 1, primitives: 0 }],
      ]),
    },
  };
}

export function bindingsJson(): string {
  const dnaSha256 = createHash("sha256").update(DNA).digest("hex");
  return JSON.stringify({
    schemaVersion: 1,
    specimen: { id: "synthetic", source: "packages/metahuman/fixtures", license: "MIT" },
    // The GLB hash is a preparation-time contract; only the DNA's bytes are checked here.
    hashes: { dna: dnaSha256, glb: "0".repeat(64) },
    coordinates: { sourceUnits: "cm", sourceUp: "z", handedness: "left" },
    joints: JOINT_NAMES.map((name) => ({ dna: name, node: name })),
    morphs: [
      ...HEAD_CHANNELS.map((channel, target) => ({ channel, mesh: 0, primitive: 0, target })),
      ...LOD1_CHANNELS.map((channel, target) => ({ channel, mesh: 1, primitive: 0, target })),
    ],
    lods: [
      { lod: 0, meshes: [0] },
      { lod: 1, meshes: [1] },
    ],
    controls: (REFERENCE.names.gui ?? []).map((gui) => ({
      alias: gui,
      gui,
      min: 0,
      max: 1,
      default: 0,
    })),
    animatedMaps: (REFERENCE.names.animatedMap ?? []).map((map) => ({ map })),
  });
}

/**
 * A loader with the same shape as `ctx.assets`, serving its files as data urls.
 *
 * The same bytes every time, because the loader's real contract is a cache: two handles built
 * from one loader share the model, and the DNA and sidecar are read from the resolved path.
 */
export function fakeAssets(model: IMetaHumanModel): IMetaHumanAssets {
  const dataUrl = (bytes: Uint8Array, type: string): string =>
    `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  const files: Readonly<Record<string, string>> = {
    "metahuman/head.dna": dataUrl(DNA, "application/octet-stream"),
    "metahuman/bindings.json": dataUrl(
      new TextEncoder().encode(bindingsJson()),
      "application/json",
    ),
  };
  return {
    model: async <T>() => model as T,
    resolve: async (path: string) => {
      const found = files[path];
      if (found === undefined) throw new Error(`the fake loader does not serve ${path}`);
      return [found];
    },
  };
}

export async function load(lod?: number) {
  return await loadMetaHuman({
    assets: fakeAssets(buildModel()),
    model: "metahuman/head.glb",
    dna: "metahuman/head.dna",
    bindings: "metahuman/bindings.json",
    ...(lod === undefined ? {} : { lod }),
  });
}

export function closeTo(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/** Element-wise comparison: the rig's outputs are float32, the reference file is float64 text. */
export function closeArray(
  actual: ArrayLike<number> | undefined,
  expected: readonly number[] | undefined,
  where: string,
  tolerance = 1e-6,
): void {
  if (actual === undefined || expected === undefined)
    throw new Error(`${where}: the comparison has no observation on one side`);
  if (actual.length !== expected.length)
    throw new Error(
      `${where}: got ${String(actual.length)} values, expected ${String(expected.length)}`,
    );
  for (const [index, value] of expected.entries())
    if (!closeTo(actual[index] ?? Number.NaN, value, tolerance))
      throw new Error(
        `${where}[${String(index)}]: got ${String(actual[index])}, reference ${String(value)}`,
      );
}

/**
 * Two orientations agree, compared component-wise after aligning the sign.
 *
 * A quaternion and its negation are the same rotation, and comparing them through an angle is
 * numerically useless here: `acos` of a dot product a float32 rounding away from 1 amplifies
 * float64 noise into thousandths of a degree. Component-wise is stable, and 1e-6 of a component
 * is about a ten-thousandth of a degree.
 */
export function sameRotation(actual: Quaternion, expected: Quaternion, tolerance = 1e-6): boolean {
  const sign = actual.dot(expected) < 0 ? -1 : 1;
  return [actual.x, actual.y, actual.z, actual.w].every(
    (value, index) =>
      Math.abs(
        value - sign * ([expected.x, expected.y, expected.z, expected.w][index] as number),
      ) <= tolerance,
  );
}

export { RigEvaluator };
