import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, NodeIO, type Primitive } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTMeshGPUInstancing,
  KHRNodeVisibility,
} from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { Matrix3, Matrix4, Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { compileAssets } from "../src/index.js";
import {
  applyProxiesToWorld,
  cookWorldProxies,
  formatWorldHlod,
  readWorldPackage,
} from "../src/world/proxy.js";

/**
 * PRD-473 AC-4 (asset-cook half): the cook merges each authored cell's chunks into one proxy GLB
 * with world-space geometry and one draw per material group, writes it beside the world package,
 * and names it on the cell as an optional `proxy` record. No authoring tree is mutated and the
 * authored chunks are retained.
 */

const NONE = { audio: "none", models: "none", textures: "none" } as const;

/** A triangle at the origin, translated by the node, under a named material. */
function part(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  translation: readonly [number, number, number],
  material: ReturnType<Document["createMaterial"]>,
): ReturnType<Document["createNode"]> {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      "POSITION",
      document.createAccessor().setArray(positions).setType("VEC3").setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document.createAccessor().setArray(normals).setType("VEC3").setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document.createAccessor().setArray(uvs).setType("VEC2").setBuffer(buffer),
    )
    .setIndices(document.createAccessor().setArray(indices).setType("SCALAR").setBuffer(buffer));
  const mesh = document.createMesh("part").addPrimitive(primitive);
  return document
    .createNode("part")
    .setMesh(mesh)
    .setTranslation([...translation]);
}

/** An `n`×`n` grid in the XZ plane: enough opaque triangles for the simplifier to reduce. */
function gridPart(
  document: Document,
  scene: ReturnType<Document["createScene"]>,
  buffer: ReturnType<Document["createBuffer"]>,
  translation: readonly [number, number, number],
  material: ReturnType<Document["createMaterial"]>,
  n: number,
): number {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= n; row += 1) {
    for (let column = 0; column <= n; column += 1) {
      // Curved, so a collapse has measurable geometric error rather than a free flat-grid one.
      positions.push(
        column / n,
        0.4 * Math.sin((column / n) * Math.PI) * Math.cos((row / n) * Math.PI),
        row / n,
      );
      normals.push(0, 1, 0);
      uvs.push(column / n, row / n);
    }
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const a = row * (n + 1) + column;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      "POSITION",
      document
        .createAccessor()
        .setArray(new Float32Array(positions))
        .setType("VEC3")
        .setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document
        .createAccessor()
        .setArray(new Float32Array(normals))
        .setType("VEC3")
        .setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document.createAccessor().setArray(new Float32Array(uvs)).setType("VEC2").setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setArray(new Uint16Array(indices))
        .setType("SCALAR")
        .setBuffer(buffer),
    );
  const mesh = document.createMesh("grid").addPrimitive(primitive);
  scene.addChild(
    document
      .createNode("grid")
      .setMesh(mesh)
      .setTranslation([...translation]),
  );
  return indices.length / 3;
}

/** A chunk of one dense opaque grid and one dense MASK card, both at the same place. */
async function denseChunk(n: number): Promise<{ buffer: Buffer; opaqueTriangles: number }> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const opaque = gridPart(document, scene, buffer, [0, 0, 0], document.createMaterial("rock"), n);
  gridPart(
    document,
    scene,
    buffer,
    [0, 0, 0],
    document.createMaterial("needles").setAlphaMode("MASK"),
    n,
  );
  return { buffer: Buffer.from(await new NodeIO().writeBinary(document)), opaqueTriangles: opaque };
}

interface IChunkPart {
  readonly alphaMode?: "BLEND" | "MASK" | "OPAQUE";
  readonly material: string;
  readonly translation: readonly [number, number, number];
}

async function chunkGlb(parts: readonly IChunkPart[]): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  for (const entry of parts) {
    const material = document.createMaterial(entry.material);
    if (entry.alphaMode !== undefined) material.setAlphaMode(entry.alphaMode);
    scene.addChild(part(document, buffer, entry.translation, material));
  }
  return Buffer.from(await new NodeIO().writeBinary(document));
}

/**
 * One triangle in the XZ plane with its authored front face toward +Y, referenced by two nodes:
 * the second translated, mirrored in X and nonuniformly scaled in Z.
 */
async function sharedMeshChunk(): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const positions = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const primitive = document
    .createPrimitive()
    .setMaterial(document.createMaterial("rock"))
    .setAttribute(
      "POSITION",
      document.createAccessor().setArray(positions).setType("VEC3").setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document.createAccessor().setArray(normals).setType("VEC3").setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setArray(new Uint16Array([0, 1, 2]))
        .setType("SCALAR")
        .setBuffer(buffer),
    );
  const mesh = document.createMesh("shared").addPrimitive(primitive);
  scene.addChild(document.createNode("a").setMesh(mesh).setTranslation([0, 0, 0]));
  scene.addChild(
    document.createNode("b").setMesh(mesh).setTranslation([10, 0, 0]).setScale([-2, 1, 3]),
  );
  return Buffer.from(await new NodeIO().writeBinary(document));
}

/**
 * Two normally visible triangles sharing one material; the second is named with Godot's collider
 * suffix and carries an authored `collider` extra.
 *
 * The engine has no runtime convention that hides a name-matched collider: `WorldCells` loads a
 * hand-placed chunk GLB through `assets.model` and renders every mesh it contains
 * (`world-cells.ts` `#startChunkLoad` -> `#model` -> `loadModelWith`, then `mergeChunk`, which
 * filters only on lod chains and morph targets), and the only reader of the `-col`/`-convcol`
 * vocabulary is the advisory asset health report (`health.ts` `marksCollider`), which hides
 * nothing. Physics is a game-owned predicate in `buildStaticColliders`, not the name. Both
 * triangles are visible, so both belong in the proxy.
 */
async function colliderChunk(): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const material = document.createMaterial("rock");
  const visible = part(document, buffer, [0, 0, 0], material);
  visible.setExtras({ entity: "rock-1" });
  scene.addChild(visible);
  const collider = part(document, buffer, [5, 0, 0], material);
  collider.setName("arena-convcol").setExtras({ collider: "convexParts" });
  scene.addChild(collider);
  return Buffer.from(await new NodeIO().writeBinary(document));
}

/** One triangle Mesh drawn by `EXT_mesh_gpu_instancing` at two translations. */
async function instancedChunk(): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const mesh = document.createMesh("instanced").addPrimitive(
    document
      .createPrimitive()
      .setMaterial(document.createMaterial("rock"))
      .setAttribute(
        "POSITION",
        document
          .createAccessor()
          .setArray(new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0]))
          .setType("VEC3")
          .setBuffer(buffer),
      )
      .setAttribute(
        "NORMAL",
        document
          .createAccessor()
          .setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]))
          .setType("VEC3")
          .setBuffer(buffer),
      )
      .setIndices(
        document
          .createAccessor()
          .setArray(new Uint16Array([0, 1, 2]))
          .setType("SCALAR")
          .setBuffer(buffer),
      ),
  );
  const batch = document
    .createExtension(EXTMeshGPUInstancing)
    .createInstancedMesh()
    .setAttribute(
      "TRANSLATION",
      document
        .createAccessor()
        .setArray(new Float32Array([0, 0, 0, 4, 0, 0]))
        .setType("VEC3")
        .setBuffer(buffer),
    );
  scene.addChild(
    document.createNode("batch").setMesh(mesh).setExtension("EXT_mesh_gpu_instancing", batch),
  );
  return Buffer.from(
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS]).writeBinary(document),
  );
}

/** A chunk whose one node is explicitly hidden by `KHR_node_visibility`. */
async function invisibleChunk(): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const node = part(document, buffer, [0, 0, 0], document.createMaterial("rock"));
  const visibility = document.createExtension(KHRNodeVisibility).createVisibility();
  visibility.setVisible(false);
  node.setExtension("KHR_node_visibility", visibility);
  scene.addChild(node);
  return Buffer.from(
    await new NodeIO().registerExtensions([...ALL_EXTENSIONS]).writeBinary(document),
  );
}

/** Every vertex normal of a proxy, lifted into world space, as its Y component. */
function worldNormalY(document: Document): number[] {
  const result: number[] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const normalMatrix = new Matrix3().getNormalMatrix(
      new Matrix4().fromArray(node.getWorldMatrix() as number[]),
    );
    for (const primitive of mesh.listPrimitives()) {
      const normal = primitive.getAttribute("NORMAL");
      if (normal === null) continue;
      const element: number[] = [0, 0, 0];
      for (let vertex = 0; vertex < normal.getCount(); vertex += 1) {
        normal.getElement(vertex, element);
        result.push(
          new Vector3(element[0], element[1], element[2]).applyMatrix3(normalMatrix).normalize().y,
        );
      }
    }
  }
  return result;
}

/**
 * Every triangle's winding normal, in the primitive's own vertex space, should agree with its
 * vertex normals. A mirrored transform that baked vertices without reversing the index order
 * flips the winding normal while leaving the stored normals correct, so the two disagree — the
 * regression the shared/mirrored chunk exists to catch.
 */
function windingAgreesWithNormals(document: Document): boolean {
  const element: number[] = [0, 0, 0];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const normal = primitive.getAttribute("NORMAL");
      const indices = primitive.getIndices();
      if (position === null || normal === null || indices === null) continue;
      for (let triangle = 0; triangle + 2 < indices.getCount(); triangle += 3) {
        const corners = [0, 1, 2].map((offset) => {
          position.getElement(indices.getScalar(triangle + offset), element);
          return [element[0], element[1], element[2]] as const;
        });
        const [p0, p1, p2] = corners as [
          readonly [number, number, number],
          readonly [number, number, number],
          readonly [number, number, number],
        ];
        const geometric = new Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).cross(
          new Vector3(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]),
        );
        const vertexNormal = new Vector3();
        for (let offset = 0; offset < 3; offset += 1) {
          normal.getElement(indices.getScalar(triangle + offset), element);
          vertexNormal.add(new Vector3(element[0], element[1], element[2]));
        }
        if (geometric.lengthSq() === 0 || vertexNormal.lengthSq() === 0) continue;
        if (geometric.normalize().dot(vertexNormal.normalize()) < 0.9) return false;
      }
    }
  }
  return true;
}

/** A points-mode chunk: visible geometry this cook refuses to reproduce. */
async function pointsChunk(): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
  const primitive = document
    .createPrimitive()
    .setMode(0)
    .setAttribute(
      "POSITION",
      document.createAccessor().setArray(positions).setType("VEC3").setBuffer(buffer),
    );
  scene.addChild(
    document.createNode("points").setMesh(document.createMesh("points").addPrimitive(primitive)),
  );
  return Buffer.from(await new NodeIO().writeBinary(document));
}

/**
 * A chunk carrying a non-finite vertex or a non-finite node transform. Either would flow through
 * `getBounds` into the published world error, which `JSON.stringify` silently turns into `null`.
 */
async function malformedChunk(kind: "transform" | "vertex"): Promise<Buffer> {
  const document = new Document();
  const scene = document.createScene("Scene");
  const buffer = document.createBuffer();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, kind === "vertex" ? Number.NaN : 0, 0, 1]);
  const primitive = document
    .createPrimitive()
    .setMaterial(document.createMaterial("rock"))
    .setAttribute(
      "POSITION",
      document.createAccessor().setArray(positions).setType("VEC3").setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setArray(new Uint16Array([0, 1, 2]))
        .setType("SCALAR")
        .setBuffer(buffer),
    );
  const node = document
    .createNode("rock")
    .setMesh(document.createMesh("rock").addPrimitive(primitive));
  if (kind === "transform") node.setTranslation([Number.POSITIVE_INFINITY, 0, 0]);
  scene.addChild(node);
  return Buffer.from(await new NodeIO().writeBinary(document));
}

function worldJson(cells: readonly { chunks: readonly string[]; x: number; z: number }[]): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        assets: {},
        cellSize: 64,
        cells: cells.map((cell) => ({ chunks: [...cell.chunks], runs: [], x: cell.x, z: cell.z })),
        extent: { minX: -128, minZ: -128, sizeX: 256, sizeZ: 256 },
        placements: "placements.bin",
        terrain: {
          columns: 129,
          heightMax: 4.86,
          heightMin: -4.86,
          heightmap: "terrain/heightmap.u16",
          rows: 129,
          spacing: 2,
        },
        version: 1,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

interface IManifest {
  entries: Record<string, { output: string }>;
}

async function readManifest(root: string): Promise<IManifest> {
  return JSON.parse(
    await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
  ) as IManifest;
}

async function outputBytes(root: string, manifest: IManifest, logical: string): Promise<Buffer> {
  const entry = manifest.entries[logical];
  if (entry === undefined) throw new Error(`no manifest entry for ${logical}`);
  return readFile(path.join(root, "public", entry.output));
}

function logLines(log: ReturnType<typeof vi.spyOn>): string {
  return log.mock.calls.flat().join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("world cell HLOD proxies", () => {
  it("should merge translated chunks into one material-grouped proxy in world space", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    const chunkA = await chunkGlb([{ material: "bark", translation: [100, 0, 0] }]);
    const chunkB = await chunkGlb([
      { material: "rock", translation: [-50, 0, 20] },
      { alphaMode: "MASK", material: "needles", translation: [-50, 0, 20] },
    ]);
    const sourceWorld = worldJson([{ chunks: ["a.glb", "b.glb"], x: 0, z: 0 }]);
    await writeFile(path.join(root, "assets", "world", "a.glb"), chunkA);
    await writeFile(path.join(root, "assets", "world", "b.glb"), chunkB);
    await writeFile(path.join(root, "assets", "world", "world.json"), sourceWorld);

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);

    const shippedWorld = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as {
      cells: {
        proxy?: { glb: string; error: number; materialGroups: number; triangles: number };
      }[];
    };
    const proxy = shippedWorld.cells[0]?.proxy;
    expect(proxy).toBeDefined();
    expect(proxy?.glb).toBe("world.cell_0_0.proxy.glb");
    expect(proxy?.triangles).toBeGreaterThan(0);
    expect(proxy?.materialGroups).toBeGreaterThanOrEqual(2);
    expect(proxy?.error).toBeGreaterThanOrEqual(0);
    // The published world error is a finite bound; `JSON.stringify` would null a NaN.
    expect(Number.isFinite(proxy?.error)).toBe(true);

    const proxyBuffer = await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb");
    const proxyDocument = await new NodeIO().readBinary(new Uint8Array(proxyBuffer));
    const scene = proxyDocument.getRoot().listScenes()[0];
    expect(scene).toBeDefined();
    const bounds = getBounds(scene as NonNullable<typeof scene>);
    // Both authored node translations survive as world-space geometry; the proxy is not
    // double-offset by the cell.
    expect(bounds.min[0]).toBeLessThanOrEqual(-50);
    expect(bounds.max[0]).toBeGreaterThanOrEqual(101);
    // The alpha-cutout card survives as a MASK material rather than being dropped or blended.
    expect(
      proxyDocument
        .getRoot()
        .listMaterials()
        .some((material) => material.getAlphaMode() === "MASK"),
    ).toBe(true);
    expect(
      proxyDocument
        .getRoot()
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives()),
    ).toHaveLength(proxy?.materialGroups ?? 0);

    expect(logLines(log)).toContain("TN_WORLD_HLOD world=world/world.json");
    // The authored chunks and the authored world JSON are byte-identical after the cook.
    expect(await readFile(path.join(root, "assets", "world", "a.glb"))).toEqual(chunkA);
    expect(await readFile(path.join(root, "assets", "world", "b.glb"))).toEqual(chunkB);
    expect(await readFile(path.join(root, "assets", "world", "world.json"))).toEqual(sourceWorld);
  });

  it("should reduce opaque geometry, keep the cutout card intact and report its error", async () => {
    const root = await makeTempDir("threenative-hlod-simplify-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    const { buffer, opaqueTriangles } = await denseChunk(16);
    await writeFile(path.join(root, "assets", "world", "a.glb"), buffer);
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: { error: number } }[] };
    expect(shipped.cells[0]?.proxy?.error).toBeGreaterThan(0);

    const document = await new NodeIO().readBinary(
      new Uint8Array(await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb")),
    );
    const trianglesOf = (primitive: Primitive): number =>
      Math.floor(
        (primitive.getIndices()?.getCount() ??
          primitive.getAttribute("POSITION")?.getCount() ??
          0) / 3,
      );
    const primitives = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives());
    const opaque = primitives.find((prim) => prim.getMaterial()?.getAlphaMode() !== "MASK");
    const card = primitives.find((prim) => prim.getMaterial()?.getAlphaMode() === "MASK");
    expect(opaque).toBeDefined();
    expect(card).toBeDefined();
    expect(trianglesOf(opaque as NonNullable<typeof opaque>)).toBeLessThan(opaqueTriangles);
    expect(trianglesOf(card as NonNullable<typeof card>)).toBe(opaqueTriangles);
  });

  it("should cook the generated proxy through the default model pass", async () => {
    const root = await makeTempDir("threenative-hlod-modelpass-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(
      path.join(root, "assets", "world", "a.glb"),
      await chunkGlb([{ material: "bark", translation: [10, 0, 0] }]),
    );
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );
    // Models default on: the proxy is an ordinary model input, so the model pass must accept it.
    await compileAssets({ config: { audio: "none", textures: "none" }, cwd: root });
    const manifest = await readManifest(root);
    expect(manifest.entries["world/world.cell_0_0.proxy.glb"]).toBeDefined();
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: { glb: string } }[] };
    expect(shipped.cells[0]?.proxy?.glb).toBe("world.cell_0_0.proxy.glb");
  });

  it("should leave an unrelated JSON source untouched", async () => {
    const root = await makeTempDir("threenative-hlod-json-");
    await mkdir(path.join(root, "assets"), { recursive: true });
    const notes = Buffer.from('{"version":1,"note":"not a world"}\n', "utf8");
    await writeFile(path.join(root, "assets", "notes.json"), notes);
    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    expect(await outputBytes(root, manifest, "notes.json")).toEqual(notes);
  });

  it("should decline a cell whose visible geometry it cannot reproduce, with no partial proxy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-decline-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(path.join(root, "assets", "world", "points.glb"), await pointsChunk());
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["points.glb"], x: 2, z: 3 }]),
    );
    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: unknown }[] };
    expect(shipped.cells[0]?.proxy).toBeUndefined();
    expect(manifest.entries["world/world.cell_2_3.proxy.glb"]).toBeUndefined();
    expect(logLines(log)).toContain("declined=1:2_3@topology");
  });
});

describe("world HLOD determinism and cache", () => {
  it("should emit the same proxy and world hashes for the same input", async () => {
    const build = async (name: string): Promise<{ proxy: Buffer; world: Buffer }> => {
      const root = await makeTempDir(`threenative-hlod-${name}-`);
      await mkdir(path.join(root, "assets", "world"), { recursive: true });
      await writeFile(
        path.join(root, "assets", "world", "a.glb"),
        await chunkGlb([{ material: "bark", translation: [10, 0, 0] }]),
      );
      await writeFile(
        path.join(root, "assets", "world", "world.json"),
        worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
      );
      await compileAssets({ config: { ...NONE }, cwd: root });
      const manifest = await readManifest(root);
      return {
        proxy: await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb"),
        world: await outputBytes(root, manifest, "world/world.json"),
      };
    };
    const first = await build("a");
    const second = await build("b");
    expect(second.proxy).toEqual(first.proxy);
    expect(second.world).toEqual(first.world);
  });

  it("should reuse the previous cook on a second compile", async () => {
    const root = await makeTempDir("threenative-hlod-cache-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(
      path.join(root, "assets", "world", "a.glb"),
      await chunkGlb([{ material: "bark", translation: [10, 0, 0] }]),
    );
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );
    await compileAssets({ config: { ...NONE }, cwd: root });
    const second = await compileAssets({ config: { ...NONE }, cwd: root });
    expect(second.written).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });
});

describe("world package detection", () => {
  it("should accept a v1 world and reject unrelated JSON", () => {
    const world = readWorldPackage(worldJson([{ chunks: ["a.glb"], x: 1, z: 2 }]));
    expect(world?.cells[0]).toMatchObject({ chunks: ["a.glb"], x: 1, z: 2 });
    expect(readWorldPackage(Buffer.from('{"version":2,"cellSize":1,"cells":[]}'))).toBeUndefined();
    expect(readWorldPackage(Buffer.from("not json"))).toBeUndefined();
  });

  it("should attach proxies only to matching cells", () => {
    const world = readWorldPackage(
      worldJson([
        { chunks: [], x: 0, z: 0 },
        { chunks: [], x: 1, z: 1 },
      ]),
    );
    const rewritten = JSON.parse(
      applyProxiesToWorld(world as NonNullable<typeof world>, [
        {
          buffer: Buffer.alloc(0),
          error: 0.5,
          logical: "world/world.cell_1_1.proxy.glb",
          materialGroups: 2,
          reference: "world.cell_1_1.proxy.glb",
          triangles: 12,
          x: 1,
          z: 1,
        },
      ]).toString("utf8"),
    ) as { cells: { proxy?: { glb: string } }[] };
    expect(rewritten.cells[0]?.proxy).toBeUndefined();
    expect(rewritten.cells[1]?.proxy?.glb).toBe("world.cell_1_1.proxy.glb");
  });
});

describe("world HLOD transform and exclusion fidelity", () => {
  it("should keep both nodes of one shared mesh and preserve winding through a mirrored transform", async () => {
    const root = await makeTempDir("threenative-hlod-shared-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(path.join(root, "assets", "world", "a.glb"), await sharedMeshChunk());
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const document = await new NodeIO().readBinary(
      new Uint8Array(await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb")),
    );
    const scene = document.getRoot().listScenes()[0];
    expect(scene).toBeDefined();
    const bounds = getBounds(scene as NonNullable<typeof scene>);
    // Both differently transformed nodes of the one Mesh are present.
    expect(bounds.min[0]).toBeLessThanOrEqual(0);
    expect(bounds.max[0]).toBeGreaterThanOrEqual(10);
    const triangles = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, prim) => sum + Math.floor((prim.getIndices()?.getCount() ?? 0) / 3), 0);
    expect(triangles).toBe(2);
    // Mirrored geometry keeps its authored front face without forcing DoubleSide.
    for (const material of document.getRoot().listMaterials())
      expect(material.getDoubleSided()).toBe(false);
    expect(worldNormalY(document).every((y) => y > 0.99)).toBe(true);
    // The nonuniform + mirrored bake reverses winding, so the triangles' own face normals still
    // agree with the authored vertex normals instead of pointing into the mesh.
    expect(windingAgreesWithNormals(document)).toBe(true);
  });

  it("should expand GPU-instanced nodes into every authored instance", async () => {
    const root = await makeTempDir("threenative-hlod-instanced-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(path.join(root, "assets", "world", "a.glb"), await instancedChunk());
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const document = await new NodeIO().readBinary(
      new Uint8Array(await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb")),
    );
    const scene = document.getRoot().listScenes()[0];
    const bounds = getBounds(scene as NonNullable<typeof scene>);
    expect(bounds.min[0]).toBeLessThanOrEqual(0);
    expect(bounds.max[0]).toBeGreaterThanOrEqual(4);
    const triangles = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, prim) => sum + Math.floor((prim.getIndices()?.getCount() ?? 0) / 3), 0);
    expect(triangles).toBe(2);
  });

  it("should keep a name-matched collider mesh because the runtime renders it", async () => {
    const root = await makeTempDir("threenative-hlod-collider-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(path.join(root, "assets", "world", "a.glb"), await colliderChunk());
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const document = await new NodeIO().readBinary(
      new Uint8Array(await outputBytes(root, manifest, "world/world.cell_0_0.proxy.glb")),
    );
    const scene = document.getRoot().listScenes()[0];
    const bounds = getBounds(scene as NonNullable<typeof scene>);
    // Both triangles survive: the `-convcol`-named node at x=5 is rendered by the runtime, so
    // dropping it would make the distant proxy differ from the near chunk it replaces.
    expect(bounds.max[0]).toBeGreaterThanOrEqual(6);
    const triangles = document
      .getRoot()
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, prim) => sum + Math.floor((prim.getIndices()?.getCount() ?? 0) / 3), 0);
    expect(triangles).toBe(2);
    const proxyRoot = document.getRoot();
    for (const property of [
      ...proxyRoot.listScenes(),
      ...proxyRoot.listNodes(),
      ...proxyRoot.listMeshes(),
      ...proxyRoot.listMeshes().flatMap((mesh) => mesh.listPrimitives()),
    ])
      expect(property.getExtras()).toEqual({});
  });

  it("should decline a cell with a non-finite vertex or transform, publishing no proxy", async () => {
    for (const kind of ["vertex", "transform"] as const) {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const root = await makeTempDir(`threenative-hlod-malformed-${kind}-`);
      await mkdir(path.join(root, "assets", "world"), { recursive: true });
      await writeFile(path.join(root, "assets", "world", "a.glb"), await malformedChunk(kind));
      await writeFile(
        path.join(root, "assets", "world", "world.json"),
        worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
      );

      await compileAssets({ config: { ...NONE }, cwd: root });
      const manifest = await readManifest(root);
      const shipped = JSON.parse(
        (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
      ) as { cells: { proxy?: unknown }[] };
      expect(shipped.cells[0]?.proxy).toBeUndefined();
      expect(manifest.entries["world/world.cell_0_0.proxy.glb"]).toBeUndefined();
      expect(logLines(log)).toContain("declined=1:0_0@malformed-geometry");
      log.mockRestore();
    }
  });

  it("should decline a cell whose chunk is excluded by assets.exclude", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-exclude-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(
      path.join(root, "assets", "world", "a.glb"),
      await chunkGlb([{ material: "bark", translation: [0, 0, 0] }]),
    );
    await writeFile(
      path.join(root, "assets", "world", "secret.glb"),
      await chunkGlb([{ material: "bark", translation: [5, 0, 0] }]),
    );
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb", "secret.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE, exclude: ["world/secret.glb"] }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: unknown }[] };
    expect(shipped.cells[0]?.proxy).toBeUndefined();
    expect(manifest.entries["world/world.cell_0_0.proxy.glb"]).toBeUndefined();
    expect(logLines(log)).toContain("declined=1:0_0@excluded-chunk");
  });

  it("should obey an exclude glob that matches the generated proxy logical", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-proxy-exclude-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(
      path.join(root, "assets", "world", "a.glb"),
      await chunkGlb([{ material: "bark", translation: [0, 0, 0] }]),
    );
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE, exclude: ["world/*.proxy.glb"] }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: unknown }[] };
    expect(shipped.cells[0]?.proxy).toBeUndefined();
    expect(manifest.entries["world/world.cell_0_0.proxy.glb"]).toBeUndefined();
    expect(logLines(log)).toContain("declined=1:0_0@excluded-proxy");
  });

  it("should decline a cell whose chunk escapes the source root", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-traversal-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["../../outside.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: unknown }[] };
    expect(shipped.cells[0]?.proxy).toBeUndefined();
    expect(logLines(log)).toContain("declined=1:0_0@outside-chunk");
  });

  it("should decline a cell whose node has an unknown visibility extension", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = await makeTempDir("threenative-hlod-visibility-");
    await mkdir(path.join(root, "assets", "world"), { recursive: true });
    await writeFile(path.join(root, "assets", "world", "a.glb"), await invisibleChunk());
    await writeFile(
      path.join(root, "assets", "world", "world.json"),
      worldJson([{ chunks: ["a.glb"], x: 0, z: 0 }]),
    );

    await compileAssets({ config: { ...NONE }, cwd: root });
    const manifest = await readManifest(root);
    const shipped = JSON.parse(
      (await outputBytes(root, manifest, "world/world.json")).toString("utf8"),
    ) as { cells: { proxy?: unknown }[] };
    expect(shipped.cells[0]?.proxy).toBeUndefined();
    expect(logLines(log)).toContain("declined=1:0_0@extension");
  });
});

describe("cookWorldProxies", () => {
  it("should decline a cell whose chunk cannot be read without throwing", async () => {
    const world = readWorldPackage(worldJson([{ chunks: ["missing.glb"], x: 0, z: 0 }]));
    const result = await cookWorldProxies({
      read: async () => {
        throw new Error("ENOENT");
      },
      world: world as NonNullable<typeof world>,
      worldLogical: "world/world.json",
    });
    expect(result.proxies).toHaveLength(0);
    expect(result.declined).toEqual([{ reason: "missing-chunk", x: 0, z: 0 }]);
    expect(formatWorldHlod("world/world.json", result)).toContain("declined=1:0_0@missing-chunk");
  });
});
