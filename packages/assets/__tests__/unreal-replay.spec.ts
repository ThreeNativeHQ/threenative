import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { decompress as oodle } from "ooz-wasm";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  UAssetError,
  createThreeGeometry,
  parseUAssetStaticMesh,
} from "../../raw-unreal/src/index.js";
import { compileAssets } from "../src/index.js";

/**
 * PRD-320 Phase 2: the offline replay. A real, MIT-licensed, SHA-256-pinned `.uasset` (see
 * packages/raw-unreal/fixtures/PROVENANCE.md) is decoded, converted, compiled, and compared
 * structurally — no network, no Fab account, no external executable. This is the half of the
 * Fab→GLB path that breaks silently when the decoder, gltf-transform, or the compile passes
 * change; the account-gated download half is a separate lane that skips loudly.
 */

const FIXTURE_URL = new URL("../../raw-unreal/fixtures/SM_cube.uasset", import.meta.url);
const FIXTURE_SHA256 = "6302cfb9f81d1e71f1f5386c8d2a7d4851bea06cc73b14289554d155751f2283";

/**
 * The structural fingerprint of the GLB the replay writes. Deliberately free of byte-level and
 * version-level detail: a gltf-transform patch bump must not fail this gate, a dropped primitive
 * or a wrong accessor component type must.
 */
const GOLDEN_STRUCTURE = {
  meshes: 1,
  primitives: 1,
  positionComponentType: "FLOAT",
  positionMin: [-50, -50, -50],
  positionMax: [50, 50, 50],
  triangleCount: 12,
  vertexCount: 24,
};

async function fixtureBytes(): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(FIXTURE_URL));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
  return bytes;
}

interface IStructure {
  readonly meshes: number;
  readonly primitives: number;
  readonly positionComponentType: string;
  readonly positionMin: readonly number[];
  readonly positionMax: readonly number[];
  readonly triangleCount: number;
  readonly vertexCount: number;
}

/** Reads the GLB back and reduces it to the structural fingerprint the golden pins. */
async function structureOf(glbBytes: Uint8Array): Promise<IStructure> {
  const document = await new NodeIO().readBinary(glbBytes);
  const positions = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .map((primitive) => primitive.getAttribute("POSITION"));
  const position = positions[0];
  if (position === undefined) throw new Error("the GLB has no POSITION accessor");
  const indices = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .map((primitive) => primitive.getIndices());
  const index = indices[0];
  // 5126 is glTF's FLOAT component type, named here so the golden reads as data, not as a magic number.
  const componentTypeNames: Record<number, string> = {
    5120: "BYTE",
    5121: "UBYTE",
    5123: "SHORT",
    5125: "UINT",
    5126: "FLOAT",
  };
  return {
    meshes: document.getRoot().listMeshes().length,
    primitives: positions.length,
    positionComponentType: componentTypeNames[position.getComponentType()],
    positionMin: position.getMin([]).map((value) => Math.round(value)),
    positionMax: position.getMax([]).map((value) => Math.round(value)),
    triangleCount: index === undefined ? 0 : index.getArray().length / 3,
    vertexCount: position.getArray().length / 3,
  };
}

/** Builds the GLB the importer would: one non-interleaved primitive from the decoded mesh. */
async function writeReplayGlb(sourceDirectory: string): Promise<string> {
  const decoded = parseUAssetStaticMesh(await fixtureBytes(), { oodle });
  const geometry = createThreeGeometry(decoded);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (position === null || uv === null || normal === null || index === null) {
    throw new Error("the decoded fixture is missing an attribute the replay needs");
  }
  const document = new Document();
  const buffer = document.createBuffer();
  const positionAccessor = document
    .createAccessor("POSITION")
    .setType("VEC3")
    .setArray(new Float32Array(position.array))
    .setBuffer(buffer);
  const uvAccessor = document
    .createAccessor("TEXCOORD_0")
    .setType("VEC2")
    .setArray(new Float32Array(uv.array))
    .setBuffer(buffer);
  const normalAccessor = document
    .createAccessor("NORMAL")
    .setType("VEC3")
    .setArray(new Float32Array(normal.array))
    .setBuffer(buffer);
  const indexAccessor = document
    .createAccessor("indices")
    .setType("SCALAR")
    .setArray(new Uint16Array(index.array))
    .setBuffer(buffer);
  const material = document.createMaterial("SM_cube_section_0");
  const primitive = document
    .createPrimitive()
    .setAttribute("POSITION", positionAccessor)
    .setAttribute("TEXCOORD_0", uvAccessor)
    .setAttribute("NORMAL", normalAccessor)
    .setIndices(indexAccessor)
    .setMaterial(material);
  document.createMesh("SM_cube").addPrimitive(primitive);
  document.createScene().addChild(document.createNode("SM_cube"));
  // The importer pins SEPARATE layout because the native preflight rejects interleaved views.
  const glbBytes = await new NodeIO().writeBinary(document);
  const glbPath = path.join(sourceDirectory, "SM_cube.glb");
  await writeFile(glbPath, glbBytes);
  return glbPath;
}

describe("the offline Unreal replay (PRD-320)", () => {
  it("decodes the pinned UE5.7 package, converts it, compiles it, and matches the golden structure", async () => {
    const root = await makeTempDir("threenative-unreal-replay-");
    try {
      await mkdir(path.join(root, "assets"));
      await writeReplayGlb(path.join(root, "assets"));

      const result = await compileAssets({
        cwd: root,
        config: { textures: "none", models: "none" },
      });

      expect(result.written).toBe(1);
      const manifest = JSON.parse(
        await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
      ) as { entries: Record<string, { kind: string; output: string; bytes: number }> };
      const entry = manifest.entries["SM_cube.glb"];
      expect(entry.kind).toBe("model");
      expect(entry.output).toMatch(/^SM_cube\.[0-9a-f]{8}\.glb$/u);

      const structure = await structureOf(await readFile(path.join(root, "assets", "SM_cube.glb")));
      expect(structure).toEqual(GOLDEN_STRUCTURE);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails for the right reason when the UE5 header path is broken", async () => {
    // AC3's negative control lives beside the gate: flipping the package tag byte must fail the
    // decode, not silently produce different geometry — a replay that survives the decoder's
    // removal proves nothing.
    const bytes = await fixtureBytes();
    const corrupted = Uint8Array.from(bytes);
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    expect(() => parseUAssetStaticMesh(corrupted, { oodle })).toThrowError(UAssetError);
  });
});
