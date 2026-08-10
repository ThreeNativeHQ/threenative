function concatenateViews(...views) {
  const output = new Uint8Array(views.reduce((total, view) => total + view.byteLength, 0));
  let offset = 0;
  for (const view of views) {
    output.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset);
    offset += view.byteLength;
  }
  return output;
}

function makeGlb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.byteLength + 3) & ~3;
  const binaryLength = (binary.byteLength + 3) & ~3;
  const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + binaryLength);
  const bytes = new Uint8Array(output);
  const view = new DataView(output);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return output;
}

function triangleBinary(includeUv) {
  const positions = new Float32Array([-0.9, -0.7, 0, 0.9, -0.7, 0, 0, 0.9, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  if (!includeUv) return concatenateViews(positions, normals, indices);
  const uv = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  return concatenateViews(positions, normals, uv, indices);
}

export function makeStaticGlbFixture() {
  const binary = triangleBinary(false);
  const document = {
    asset: { version: "2.0", generator: "ThreeNative deterministic GLB fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "StaticGlbMesh", mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: "StaticGlbMaterial",
        pbrMetallicRoughness: {
          baseColorFactor: [0.1, 0.65, 0.9, 1],
          metallicFactor: 0.15,
          roughnessFactor: 0.55,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 72, byteLength: 6, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-0.9, -0.7, 0],
        max: [0.9, 0.9, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
    ],
  };
  return makeGlb(document, binary);
}

export function makeExternalGltfFixture() {
  const binary = triangleBinary(true);
  const document = {
    asset: { version: "2.0", generator: "ThreeNative deterministic external glTF fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "ExternalGltfMesh", mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "ExternalTextureMaterial",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
        doubleSided: true,
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ uri: "fixture.png", mimeType: "image/png" }],
    buffers: [{ uri: "fixture.bin", byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 72, byteLength: 24, target: 34962 },
      { buffer: 0, byteOffset: 96, byteLength: 6, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-0.9, -0.7, 0],
        max: [0.9, 0.9, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      {
        bufferView: 2,
        componentType: 5126,
        count: 3,
        type: "VEC2",
        min: [0, 0],
        max: [1, 1],
      },
      { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
    ],
  };
  const png = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
    0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
    156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0,
    0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  return { binary, document, png };
}
