import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { assertCondition } from "./scene-support.js";

const PBR_HELMET_GLTF = {
  asset: { version: "2.0", generator: "ThreeNative deterministic PBR helmet" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "PBRHelmet", mesh: 0 }],
  meshes: [
    {
      name: "PBRHelmetMesh",
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    },
  ],
  materials: [
    {
      name: "HelmetMetal",
      pbrMetallicRoughness: {
        baseColorFactor: [0.12, 0.45, 0.78, 1],
        metallicFactor: 0.72,
        roughnessFactor: 0.28,
      },
      doubleSided: true,
    },
  ],
  buffers: [
    {
      byteLength: 264,
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 108, target: 34962 },
    { buffer: 0, byteOffset: 108, byteLength: 108, target: 34962 },
    { buffer: 0, byteOffset: 216, byteLength: 48, target: 34963 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 9,
      type: "VEC3",
      min: [-0.9, 0, -0.9],
      max: [0.9, 1, 0.9],
    },
    { bufferView: 1, componentType: 5126, count: 9, type: "VEC3" },
    {
      bufferView: 2,
      componentType: 5123,
      count: 24,
      type: "SCALAR",
      min: [0],
      max: [8],
    },
  ],
};

const ANIMATED_GLTF = {
  asset: { version: "2.0", generator: "ThreeNative deterministic animation clip" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "AnimatedRoot" }],
  animations: [
    {
      name: "helmet-glide",
      samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    },
  ],
  buffers: [
    {
      byteLength: 32,
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 8 },
    { buffer: 0, byteOffset: 8, byteLength: 24 },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 2,
      type: "SCALAR",
      min: [0],
      max: [1],
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 2,
      type: "VEC3",
      min: [-0.65, -0.2, 0],
      max: [0.65, 0.35, 0],
    },
  ],
};

function concatenateViews(...views) {
  const output = new Uint8Array(views.reduce((total, view) => total + view.byteLength, 0));
  let offset = 0;
  for (const view of views) {
    output.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset);
    offset += view.byteLength;
  }
  return output;
}

function makePbrHelmetBinary() {
  const positions = [0, 1, 0];
  const normals = [0, 1, 0];
  const indices = [];
  for (let segment = 0; segment < 8; segment += 1) {
    const angle = (Math.PI * 2 * segment) / 8;
    const x = Math.cos(angle) * 0.9;
    const z = Math.sin(angle) * 0.9;
    const length = Math.hypot(x, 0.65, z);
    positions.push(x, 0, z);
    normals.push(x / length, 0.65 / length, z / length);
    indices.push(0, segment + 1, ((segment + 1) % 8) + 1);
  }
  return concatenateViews(
    new Float32Array(positions),
    new Float32Array(normals),
    new Uint16Array(indices),
  );
}

function makeAnimatedBinary() {
  return concatenateViews(
    new Float32Array([0, 1]),
    new Float32Array([-0.65, -0.2, 0, 0.65, 0.35, 0]),
  );
}

function makeGlb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.byteLength + 3) & ~3;
  const binaryLength = (binary.byteLength + 3) & ~3;
  const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + binaryLength);
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
  header.setUint32(binaryHeader, binaryLength, true);
  header.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return output;
}

export async function loadPbrHelmet() {
  const gltf = await new GLTFLoader().parseAsync(makeGlb(PBR_HELMET_GLTF, makePbrHelmetBinary()), "");
  return assertPbrHelmet(gltf);
}

export function assertPbrHelmet(gltf) {
  const helmet = gltf?.scene?.getObjectByName("PBRHelmet");
  assertCondition(helmet?.isMesh === true, "GLTFLoader must produce the PBRHelmet mesh");
  assertCondition(
    helmet.material?.isMeshStandardMaterial === true,
    "glTF pbrMetallicRoughness must produce MeshStandardMaterial",
  );
  assertCondition(
    Math.abs(helmet.material.metalness - 0.72) < 1e-6 &&
      Math.abs(helmet.material.roughness - 0.28) < 1e-6,
    "GLTFLoader must preserve glTF metalness and roughness factors",
  );
  assertCondition(
    helmet.geometry?.getAttribute("position")?.count === 9,
    "PBR helmet geometry must be loaded from glTF",
  );
  return { gltf, helmet };
}

export async function loadAnimatedGltf() {
  const gltf = await new GLTFLoader().parseAsync(makeGlb(ANIMATED_GLTF, makeAnimatedBinary()), "");
  return assertAnimatedGltf(gltf);
}

export function assertAnimatedGltf(gltf) {
  const clip = gltf?.animations?.[0];
  const animatedRoot = gltf?.scene?.getObjectByName("AnimatedRoot");
  assertCondition(
    clip instanceof THREE.AnimationClip,
    "GLTFLoader must produce an AnimationClip",
  );
  assertCondition(clip.name === "helmet-glide", "GLTFLoader must preserve the clip name");
  assertCondition(clip.tracks.length === 1, "glTF animation must contain one translation track");
  assertCondition(animatedRoot?.isObject3D === true, "glTF animation target node must exist");
  return { gltf, clip, animatedRoot };
}

export function playClipAt(root, clip, seconds) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.update(seconds);
  assertCondition(action.isRunning(), "AnimationAction must be running after play and update");
  assertCondition(mixer.time === seconds, "AnimationMixer must advance by the requested time");
  return { mixer, action };
}

export { THREE };
