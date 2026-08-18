import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  formatAssetInspection,
  inspectAsset,
  inspectCommand,
  parseInspectArgs,
} from "../src/inspect.js";

const temporaryDirectories: string[] = [];

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function makeGlb(document: Record<string, unknown>, binary: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = (json.byteLength + 3) & ~3;
  const binaryLength = (binary.byteLength + 3) & ~3;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

function viewOf(value: ArrayBufferView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function inspectionFixture(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 4]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const joints = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const inverseBindMatrices = new Float32Array(32);
  inverseBindMatrices[0] = 1;
  inverseBindMatrices[5] = 1;
  inverseBindMatrices[10] = 1;
  inverseBindMatrices[15] = 1;
  inverseBindMatrices[16] = 1;
  inverseBindMatrices[21] = 1;
  inverseBindMatrices[26] = 1;
  inverseBindMatrices[31] = 1;
  const animationInput = new Float32Array([0, 1]);
  const animationOutput = new Float32Array([0, 0, 0, 0, 0, 0]);
  const binary = concatenate(
    viewOf(positions),
    viewOf(normals),
    viewOf(indices),
    new Uint8Array(2),
    viewOf(joints),
    viewOf(weights),
    viewOf(inverseBindMatrices),
    viewOf(animationInput),
    viewOf(animationOutput),
  );
  const document = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        max: [2, 3, 4],
        min: [0, 0, 0],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 3, componentType: 5121, count: 3, type: "VEC4" },
      { bufferView: 4, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 5, componentType: 5126, count: 2, type: "MAT4" },
      { bufferView: 6, componentType: 5126, count: 2, max: [1], min: [0], type: "SCALAR" },
      { bufferView: 7, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: [
      {
        channels: [{ sampler: 0, target: { node: 1, path: "translation" } }],
        name: "Walk",
        samplers: [{ input: 6, interpolation: "LINEAR", output: 7 }],
      },
    ],
    asset: { generator: "ThreeNative inspect test", version: "2.0" },
    bufferViews: [
      { buffer: 0, byteLength: 36, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: 36, byteOffset: 36, target: 34962 },
      { buffer: 0, byteLength: 6, byteOffset: 72, target: 34963 },
      { buffer: 0, byteLength: 12, byteOffset: 80, target: 34962 },
      { buffer: 0, byteLength: 48, byteOffset: 92, target: 34962 },
      { buffer: 0, byteLength: 128, byteOffset: 140 },
      { buffer: 0, byteLength: 8, byteOffset: 268 },
      { buffer: 0, byteLength: 24, byteOffset: 276 },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    materials: [{ name: "FixtureMaterial", pbrMetallicRoughness: { roughnessFactor: 0.5 } }],
    meshes: [
      {
        name: "FixtureMesh",
        primitives: [
          {
            attributes: { JOINTS_0: 3, NORMAL: 1, POSITION: 0, WEIGHTS_0: 4 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    nodes: [
      { children: [1, 2], mesh: 0, name: "FixtureRoot", skin: 0 },
      { name: "Hip" },
      { name: "Hand", translation: [0, 1, 0] },
    ],
    scene: 0,
    scenes: [{ nodes: [0] }],
    skins: [{ inverseBindMatrices: 5, joints: [1, 2], skeleton: 1 }],
  };
  return makeGlb(document, binary);
}

async function temporaryAsset(name: string, contents: Uint8Array | string): Promise<string> {
  const directory = await makeTempDir("threenative-inspect-");
  temporaryDirectories.push(directory);
  const file = path.join(directory, name);
  await writeFile(file, contents);
  return file;
}

async function temporaryExternalGltf(resourceUri = "external-fixture.bin"): Promise<string> {
  const directory = await makeTempDir("threenative-inspect-external-");
  temporaryDirectories.push(directory);
  const file = path.join(directory, "external-fixture.gltf");
  const binary = new Float32Array([0, 0, 0, 2, 0, 0, 0, 0, 3]);
  await writeFile(
    file,
    JSON.stringify({
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          max: [2, 3, 0],
          min: [0, 0, 0],
          type: "VEC3",
        },
      ],
      asset: { generator: "ThreeNative inspect external test", version: "2.0" },
      bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
      buffers: [{ byteLength: binary.byteLength, uri: resourceUri }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }],
    }),
  );
  await writeFile(path.join(directory, decodeURIComponent(resourceUri)), viewOf(binary));
  return file;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("asset inspection", () => {
  it("loads a glTF fixture with an adjacent external binary buffer", async () => {
    const file = await temporaryExternalGltf();

    const result = await inspectAsset(file);

    expect(result.bounds).toEqual({
      center: { x: 1, y: 1.5, z: 0 },
      size: { x: 2, y: 3, z: 0 },
    });
    expect(result.meshes).toBe(1);
  });

  it("loads an adjacent external binary buffer with a percent-encoded filename", async () => {
    const file = await temporaryExternalGltf("mesh%20data.bin");

    const result = await inspectAsset(file);

    expect(result.bounds).toEqual({
      center: { x: 1, y: 1.5, z: 0 },
      size: { x: 2, y: 3, z: 0 },
    });
    expect(result.meshes).toBe(1);
  });

  it("reports bounds, clips, bones and resource counts from a GLB fixture", async () => {
    const file = await temporaryAsset("animated-fixture.glb", inspectionFixture());

    const result = await inspectAsset(file);

    expect(result.bounds).toEqual({
      center: { x: 1, y: 1.5, z: 2 },
      size: { x: 2, y: 3, z: 4 },
    });
    expect(result.clips).toEqual(["Walk"]);
    expect(result.bones).toEqual(["Hip", "Hand"]);
    expect(result.meshes).toBe(1);
    expect(result.materials).toBe(1);
    expect(result.textures).toBe(0);
    expect(formatAssetInspection(result)).toContain("2.000 x 3.000 x 4.000");
  });

  it("prints JSON with every human-readable field", async () => {
    const file = await temporaryAsset("json-fixture.glb", inspectionFixture());
    let output = "";

    await inspectCommand([file, "--json"], (text) => {
      output += text;
    });

    const result = JSON.parse(output) as Record<string, unknown>;
    expect(result).toMatchObject({
      bones: ["Hip", "Hand"],
      clips: ["Walk"],
      file: "json-fixture.glb",
      forwardAxis: { axis: "Z", basis: "longest geometry axis", direction: "unknown" },
      materials: 1,
      meshes: 1,
      textures: 0,
      units: { label: "likely metres", longestAxis: 4 },
    });
    expect(result.bounds).toEqual({
      center: { x: 1, y: 1.5, z: 2 },
      size: { x: 2, y: 3, z: 4 },
    });
  });

  it.each([
    ["missing.glb", undefined, "missing.glb"],
    ["notes.txt", "not a glTF asset", "notes.txt"],
    ["corrupt.glb", new Uint8Array([0, 1, 2, 3]), "corrupt.glb"],
  ])("throws and names the file for %s", async (name, contents, expectedName) => {
    let file: string;
    if (contents === undefined) {
      const directory = await makeTempDir("threenative-inspect-missing-");
      temporaryDirectories.push(directory);
      file = path.join(directory, name);
    } else {
      file = await temporaryAsset(name, contents);
    }

    await expect(inspectAsset(file)).rejects.toThrow(expectedName);
  });

  it("throws and names the glTF when an adjacent external resource is missing", async () => {
    const file = await temporaryExternalGltf();
    await rm(file.replace(/\.gltf$/, ".bin"));

    await expect(inspectAsset(file)).rejects.toThrow("external-fixture.gltf");
  });

  it("accepts the JSON flag in either argument position", () => {
    expect(parseInspectArgs(["--json", "asset.glb"])).toEqual({ file: "asset.glb", json: true });
    expect(parseInspectArgs(["asset.glb", "--json"])).toEqual({ file: "asset.glb", json: true });
  });
});
