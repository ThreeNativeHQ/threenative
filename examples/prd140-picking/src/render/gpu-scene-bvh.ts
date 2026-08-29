import { GPUSceneBVH, bvhIntersectFirstHit, rayStruct } from "@threenative/core";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Fn, positionWorld, select, vec3, wgslFn } from "three/tsl";
import { MeshBasicNodeMaterial, type Node, StructNode } from "three/webgpu";

interface IBoxData {
  readonly indices: Uint16Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

const BOX_FACES: readonly {
  readonly corners: readonly (readonly [number, number, number])[];
  readonly normal: readonly [number, number, number];
}[] = [
  {
    corners: [
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
      [0.5, -0.5, 0.5],
    ],
    normal: [1, 0, 0],
  },
  {
    corners: [
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, -0.5],
    ],
    normal: [-1, 0, 0],
  },
  {
    corners: [
      [-0.5, 0.5, -0.5],
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, -0.5],
    ],
    normal: [0, 1, 0],
  },
  {
    corners: [
      [-0.5, -0.5, 0.5],
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5],
    ],
    normal: [0, -1, 0],
  },
  {
    corners: [
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, -0.5, 0.5],
    ],
    normal: [0, 0, 1],
  },
  {
    corners: [
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5],
    ],
    normal: [0, 0, -1],
  },
];

function makeBoxData(): IBoxData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const face of BOX_FACES) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(...corner);
      normals.push(...face.normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    indices: new Uint16Array(indices),
    normals: new Float32Array(normals),
    positions: new Float32Array(positions),
  };
}

function bounds(values: Float32Array): {
  max: [number, number, number];
  min: [number, number, number];
} {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[index + axis] ?? 0;
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  return { max, min };
}

function makeGpuSceneBvhGlb(): ArrayBuffer {
  const boxes = [makeBoxData(), makeBoxData()];
  const views: { buffer: number; byteLength: number; byteOffset: number; target: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const add = (
    array: Float32Array | Uint16Array,
    componentType: number,
    type: "SCALAR" | "VEC3",
    target: number,
    withBounds = false,
  ): number => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const view = { buffer: 0, byteLength: bytes.byteLength, byteOffset, target };
    const accessor: Record<string, unknown> = {
      bufferView: views.length,
      componentType,
      count: array.length / (type === "VEC3" ? 3 : 1),
      type,
    };
    if (withBounds) Object.assign(accessor, bounds(array as Float32Array));
    views.push(view);
    accessors.push(accessor);
    chunks.push(bytes);
    byteOffset += bytes.byteLength;
    return accessors.length - 1;
  };
  const primitives = boxes.map((box, index) => {
    const position = add(box.positions, 5126, "VEC3", 34962, true);
    const normal = add(box.normals, 5126, "VEC3", 34962);
    const indices = add(box.indices, 5123, "SCALAR", 34963);
    return { attributes: { NORMAL: normal, POSITION: position }, indices, material: index };
  });
  const binaryLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const binaryBytes = new Uint8Array(binaryLength);
  let chunkOffset = 0;
  for (const chunk of chunks) {
    binaryBytes.set(chunk, chunkOffset);
    chunkOffset += chunk.byteLength;
  }
  const document = {
    asset: { generator: "ThreeNative GPUSceneBVH proof", version: "2.0" },
    buffers: [{ byteLength: binaryBytes.byteLength }],
    bufferViews: views,
    accessors,
    materials: [
      { name: "loaded-orange", pbrMetallicRoughness: { baseColorFactor: [0.96, 0.39, 0.12, 1] } },
      { name: "loaded-pink", pbrMetallicRoughness: { baseColorFactor: [0.92, 0.18, 0.52, 1] } },
    ],
    meshes: [{ name: "LoadedSplitMesh", primitives }],
    nodes: [
      { name: "LoadedLeft", mesh: 0, scale: [2, 2, 2], translation: [-2, 0, -0.3] },
      { name: "LoadedRight", mesh: 0, scale: [2, 2, 2], translation: [2, 0, -0.3] },
    ],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.byteLength + 3) & ~3;
  const paddedBinaryLength = (binaryBytes.byteLength + 3) & ~3;
  const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + paddedBinaryLength);
  const bytes = new Uint8Array(output);
  const header = new DataView(output);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  header.setUint32(binaryHeader, paddedBinaryLength, true);
  header.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binaryBytes, binaryHeader + 8);
  return output;
}

/** Load the indexed, split-material proof scene through the same GLTFLoader used by game assets. */
export async function loadGpuSceneBvhModel(): Promise<Group> {
  const gltf = await new GLTFLoader().parseAsync(makeGpuSceneBvhGlb(), "");
  if (!(gltf.scene instanceof Group))
    throw new Error("GPUSceneBVH proof GLTF did not load a Group.");
  return gltf.scene;
}

const traceHit = wgslFn(
  `
    fn bvhSceneHit(
      bvh_index: ptr<storage, array<vec3u>, read>,
      bvh_position: ptr<storage, array<vec3f>, read>,
      bvh: ptr<storage, array<BVHNode>, read>,
      ray: Ray,
    ) -> bool {
      let result = bvhIntersectFirstHit(bvh_index, bvh_position, bvh, ray);
      return result.didHit;
    }
  `,
  [bvhIntersectFirstHit as unknown as Node],
) as unknown as (index: Node, position: Node, nodes: Node, ray: Node) => Node<"bool">;

export interface IGPUSceneBVHDemo {
  readonly blockers: readonly Object3D[];
  readonly bvh: GPUSceneBVH;
}

/** A game-owned contact surface whose color changes when the GPU trace finds a prop above it. */
export function createContactOcclusionMaterial(bvh: GPUSceneBVH): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  const occluded = Fn(() => {
    const ray = new StructNode(rayStruct, {
      origin: positionWorld.add(vec3(0, 0.01, 0)),
      direction: vec3(0.001, 1, 0.001),
    } as never);
    return traceHit(bvh.indices, bvh.positions, bvh.nodes, ray);
  })();
  material.colorNode = select(occluded, vec3(0.06, 0.08, 0.11), vec3(0.38, 0.46, 0.56));
  return material;
}

/** Build the shared loaded-scene-shaped proof subject used by web and native conformance. */
export function createGpuSceneBvhDemo(
  scene: Object3D,
  add: (object: Object3D) => Object3D,
  loadedScene: Object3D,
): IGPUSceneBVHDemo {
  const addObject = <T extends Object3D>(object: T): T => add(object) as T;
  const blockers = loadedScene.children.slice();
  if (blockers.length < 2)
    throw new Error("GPUSceneBVH proof GLTF must contain two node instances.");
  loadedScene.traverse((candidate) => {
    if (!(candidate instanceof Mesh)) return;
    candidate.layers.set(1);
    candidate.userData.traceable = true;
  });
  addObject(loadedScene);

  const traceGeometry = new BoxGeometry(0.9, 0.9, 0.9);
  traceGeometry.clearGroups();
  traceGeometry.addGroup(0, 18, 0);
  traceGeometry.addGroup(18, 18, 1);
  const traceMaterials = [
    new MeshBasicMaterial({ color: 0xf6ad55 }),
    new MeshBasicMaterial({ color: 0xed64a6 }),
  ];
  const traceInstances = new InstancedMesh(traceGeometry, traceMaterials, 2);
  traceInstances.layers.set(1);
  traceInstances.userData.traceable = true;
  traceInstances.setMatrixAt(0, new Matrix4().makeTranslation(-3.5, 0, -0.3));
  traceInstances.setMatrixAt(1, new Matrix4().makeTranslation(3.5, 0, -0.3));
  traceInstances.instanceMatrix.needsUpdate = true;
  addObject(traceInstances);
  const bvh = addObject(
    new GPUSceneBVH(scene, { include: (object) => object.userData.traceable === true }),
  );
  const contactFloor = new Mesh(new PlaneGeometry(100, 100), createContactOcclusionMaterial(bvh));
  contactFloor.rotation.x = -Math.PI / 2;
  contactFloor.position.y = -0.5;
  contactFloor.position.z = -0.3;
  contactFloor.name = "gpu-contact-occlusion";
  addObject(contactFloor);
  return { blockers, bvh };
}
