import { readFile } from "node:fs/promises";
import { decompress as oodle } from "ooz-wasm";
import { BufferGeometry, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import {
  UAssetLoader,
  createThreeGeometry,
  createThreeObject,
  parseUAssetStaticMesh,
} from "../src/index.js";
import { legacyPackage, rawMeshBlob } from "./fixture-builder.js";

const fixtureUrl = new URL("../fixtures/SM_cube.uasset", import.meta.url);

async function fixtureBytes(): Promise<Uint8Array> {
  const buffer = await readFile(fixtureUrl);
  return new Uint8Array(buffer);
}

describe("createThreeObject", () => {
  it("creates official Three.js objects directly from raw uasset bytes", async () => {
    const decoded = parseUAssetStaticMesh(await fixtureBytes(), { oodle });
    const mesh = createThreeObject(decoded);

    expect(mesh).toBeInstanceOf(Mesh);
    const asMesh = mesh as Mesh;
    expect(asMesh.geometry).toBeInstanceOf(BufferGeometry);
    expect(asMesh.material).toBeInstanceOf(MeshStandardMaterial);
    expect(asMesh.name).toBe("SM_cube");
    expect(asMesh.geometry.getAttribute("position").count).toBe(24);
    expect(asMesh.geometry.getAttribute("uv").count).toBe(24);
    expect(asMesh.geometry.index?.count).toBe(36);
    expect(asMesh.geometry.groups).toEqual([{ start: 0, count: 36, materialIndex: 0 }]);
    expect(asMesh.userData.unreal.objectPath).toBe("/Game/texture_cube/StaticMeshes/SM_cube");
    expect(asMesh.userData.unreal.packageByteLength).toBe(19_288);
    expect(asMesh.userData.unreal.directUasset).toBe(true);
  });

  it("gives every section a game-provided material through materialFactory", () => {
    const blob = rawMeshBlob({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as const,
      wedgeIndices: [0, 2, 1, 0, 1, 3],
      wedgeNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
      ] as const,
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
        [1, 0],
        [0, 1],
      ] as const,
      faceMaterials: [0, 1],
    });
    const decoded = parseUAssetStaticMesh(legacyPackage(blob));
    const bark = new MeshStandardMaterial({ color: 0x5a4132 });
    const leafs = new MeshStandardMaterial({ color: 0x3f7d3f });

    const mesh = createThreeObject(decoded, { materialFactory: () => [bark, leafs] });
    const asMesh = mesh as Mesh;
    expect(asMesh.material).toEqual([bark, leafs]);
    expect(asMesh.geometry.groups.length).toBe(2);
    expect(asMesh.geometry.groups[1]).toEqual({ start: 3, count: 3, materialIndex: 1 });
  });

  it("builds a standalone BufferGeometry with bounding volumes", () => {
    const blob = rawMeshBlob({
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ] as const,
      wedgeIndices: [0, 2, 1, 0, 1, 3],
      wedgeNormals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
      ] as const,
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
        [1, 0],
        [0, 1],
      ] as const,
      faceMaterials: [0, 0],
    });
    const geometry = createThreeGeometry(parseUAssetStaticMesh(legacyPackage(blob)));
    expect(geometry.getAttribute("position").count).toBe(6);
    // Converted Y spans Unreal Z: the (0,0,1) vertex becomes three.js (0,1,0).
    expect(geometry.boundingBox?.max.y).toBeCloseTo(1, 5);
    expect(geometry.boundingBox?.min.z).toBeCloseTo(-1, 5);
    expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
  });
});

describe("UAssetLoader", () => {
  it("parses bytes under the three.js loader protocol", async () => {
    const loader = new UAssetLoader(undefined, { parse: { oodle } });
    const mesh = loader.parse(await fixtureBytes());
    expect(mesh).toBeInstanceOf(Mesh);
    expect((mesh as Mesh).userData.unreal.layout).toBe("mesh-description");
  });

  it("chains setPath/setRequestHeader/setWithCredentials like a three.js loader", () => {
    const loader = new UAssetLoader();
    expect(loader.setPath("/assets/")).toBe(loader);
    expect(loader.setRequestHeader({ Authorization: "test" })).toBe(loader);
    expect(loader.setWithCredentials(true)).toBe(loader);
    expect(loader.path).toBe("/assets/");
  });
});
