import { readFileSync } from "node:fs";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float16BufferAttribute,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCRETE_LOD_SCHEMA_VERSION,
  DiscreteLodPlugin,
  TN_DISCRETE_LOD,
  lodChainOf,
  updateModelLods,
} from "../src/model-lod.js";
import { ChunkInstanceShapes, chunkGeometry } from "../src/projection-plan.js";
import { VelocityTracker, readVelocityPreviousMatrices } from "../src/render/velocity.js";
import { VIRTUAL_SHADOW_CASTER_LAYER } from "../src/render/virtual-shadow.js";
import { SceneRenderProjection } from "../src/renderProjection.js";
import { type IWorldPackage, WorldCells } from "../src/world.js";

const fixture = new URL("./fixtures/world-v1/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("world.json", fixture), "utf8")) as IWorldPackage;
const camera = new PerspectiveCamera(60, 1, 0.1, 500);
camera.position.set(0, 0, 20);
camera.updateMatrixWorld();

function shape(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Uint8Array([255, 128, 0, 0, 255, 128, 128, 0, 255]), 3, true),
  );
  geometry.setAttribute(
    "tangent",
    new BufferAttribute(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), 4),
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

async function chained(): Promise<Mesh> {
  const geometry = shape();
  geometry.setIndex([0, 1, 2, 0, 2, 1]);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, alphaTest: 0.5 }));
  const plugin = new DiscreteLodPlugin();
  plugin.setParser({
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    getDependency: async () => ({ array: new Uint32Array([0, 1, 2]) }),
    json: {
      meshes: [
        {
          primitives: [
            {
              extensions: {
                [TN_DISCRETE_LOD]: {
                  absoluteErrors: [0.2],
                  counts: [1],
                  errors: [0.2],
                  indices: [0],
                  lod0Triangles: 2,
                  schemaVersion: DISCRETE_LOD_SCHEMA_VERSION,
                },
              },
            },
          ],
        },
      ],
    },
  });
  await plugin.afterRoot({});
  plugin.attach(mesh, { maxPixelError: 1, hysteresis: 0.15 });
  return mesh;
}

async function chunks(): Promise<Group[]> {
  return Promise.all(
    [0, 1, 2].map(async (chunk) => {
      const group = new Group();
      for (let copy = 0; copy < 4; copy += 1) {
        const mesh = new Mesh(
          shape(),
          new MeshBasicMaterial({
            color: copy % 2 ? 0xb04932 : 0x407952,
            alphaTest: 0.5,
            vertexColors: true,
          }),
        );
        mesh.position.set(chunk * 3 - 3, copy * 2 - 3, 0);
        group.add(mesh);
      }
      const instances = new InstancedMesh(
        shape(),
        new MeshBasicMaterial({ color: 0x0000ff, alphaTest: 0.5, vertexColors: true }),
        5,
      );
      for (let slot = 0; slot < 5; slot += 1)
        instances.setMatrixAt(slot, new Matrix4().makeTranslation(slot - 2 + chunk * 3 - 3, -5, 0));
      group.add(instances);
      const lod = await chained();
      lod.position.set(0, 5, -chunk * 100);
      group.add(lod);
      group.traverse((node) => {
        node.castShadow = true;
        node.receiveShadow = true;
      });
      return group;
    }),
  );
}

async function resident(models: Group[]): Promise<{
  world: WorldCells;
  scene: Scene;
  projection: SceneRenderProjection;
  follow: { position: { x: number; z: number } };
}> {
  const cell = manifest.cells.find((entry) => entry.x === 1 && entry.z === 1);
  if (!cell) throw new Error("missing fixture cell");
  const paths = models.map((_, index) => `chunks/test-${index}.glb`);
  const pkg = { ...manifest, cells: [{ ...cell, chunks: paths, runs: [] }] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const file = url.endsWith("world.json")
        ? Buffer.from(JSON.stringify(pkg))
        : readFileSync(new URL(url.replace(/^.*?world\//, ""), fixture));
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => JSON.parse(file.toString()),
        arrayBuffer: async () =>
          file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      };
    }),
  );
  const follow = {
    position: {
      x: manifest.extent.minX + 1.5 * manifest.cellSize,
      z: manifest.extent.minZ + 1.5 * manifest.cellSize,
    },
  };
  const world = await WorldCells.load({
    url: "/world/world.json",
    follow,
    ring: 0,
    prefetchSeconds: 0,
    surface: new MeshBasicMaterial({ visible: false }),
    budgets: { bytes: 1e9, instances: 1e6, residentCells: 64 },
    shadows: { cast: true, receive: true },
    chunkMergeMaxTriangles: 1,
    admissionBudgetMs: Number.POSITIVE_INFINITY,
    loadModel: async (path) => models[Number(/test-(\d)/.exec(path)?.[1])] as Group,
  });
  for (let step = 0; step < 80; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    world.update();
    if (models.every((model) => model.parent === world)) break;
  }
  expect(models.every((model) => model.parent === world)).toBe(true);
  const scene = new Scene();
  scene.add(world);
  const projection = new SceneRenderProjection(scene, {
    minMeshes: 1,
    onReport: () => undefined,
    projection: { materialChecks: "everyFrame" },
  });
  projection.reconcile();
  projection.reconcile();
  return { world, scene, projection, follow };
}

function drawMeshes(root: Object3D): Mesh[] {
  const result: Mesh[] = [];
  root.traverse((node) => {
    if (
      node instanceof Mesh &&
      node.visible &&
      !Array.isArray(node.material) &&
      node.material.visible &&
      node.layers.isEnabled(0)
    )
      result.push(node);
  });
  return result;
}

// The actual buffers supplied to each draw, including every shader-visible vertex channel and
// base colour after Three's instance-colour multiply. Integer placements make vertices bit-exact.
function rasterInput(root: Object3D, shadow = false): string[] {
  root.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const rows: string[] = [];
  for (const mesh of drawMeshes(root)) {
    if (shadow && !mesh.castShadow) continue;
    let visible = true;
    for (let node: Object3D | null = mesh; node; node = node.parent)
      if (!node.visible) visible = false;
    if (!visible || (mesh.frustumCulled && !frustum.intersectsObject(mesh))) continue;
    mesh.onBeforeRender(
      {} as never,
      root as Scene,
      camera,
      mesh.geometry,
      mesh.material as never,
      null as never,
    );
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    const end = Math.min(
      index?.count ?? position.count,
      geometry.drawRange.start + geometry.drawRange.count,
    );
    for (let slot = 0; slot < (mesh instanceof InstancedMesh ? mesh.count : 1); slot += 1) {
      const matrix = mesh.matrixWorld.clone();
      const color = (mesh.material as MeshBasicMaterial).color.clone();
      if (mesh instanceof InstancedMesh) {
        const instance = new Matrix4();
        mesh.getMatrixAt(slot, instance);
        matrix.multiply(instance);
        if (mesh.instanceColor) {
          const tint = new Color();
          mesh.getColorAt(slot, tint);
          color.multiply(tint);
        }
      }
      if (matrix.determinant() === 0) continue;
      for (let at = geometry.drawRange.start; at < end; at += 3) {
        const vertices = [];
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = index?.getX(at + corner) ?? at + corner;
          const attributes = Object.keys(geometry.attributes)
            .sort()
            .map((name) => {
              const attribute = geometry.getAttribute(name);
              return [
                name,
                attribute.itemSize,
                attribute.normalized,
                Array.from({ length: attribute.itemSize }, (_, component) =>
                  attribute.getComponent(vertex, component),
                ),
              ];
            });
          vertices.push([
            new Vector3().fromBufferAttribute(position, vertex).applyMatrix4(matrix).toArray(),
            attributes,
          ]);
        }
        const material = mesh.material as MeshBasicMaterial;
        rows.push(
          JSON.stringify([
            vertices,
            color.toArray().map(Math.fround),
            material.side,
            material.alphaTest,
            material.vertexColors,
            mesh.receiveShadow,
          ]),
        );
      }
    }
    mesh.onAfterRender(
      {} as never,
      root as Scene,
      camera,
      mesh.geometry,
      mesh.material as never,
      null as never,
    );
  }
  return rows.sort();
}

afterEach(() => vi.unstubAllGlobals());

describe("resident repeated chunk inputs", () => {
  it("uploads each pass and restores stable slots for velocity history after a selected draw", async () => {
    const models = await chunks();
    const { world, projection } = await resident(models);
    const batch = drawMeshes(projection.root).find(
      (mesh) => mesh instanceof InstancedMesh,
    ) as InstancedMesh & { casterMinDiameter: number };
    const tracker = new VelocityTracker();
    tracker.update(projection.root);
    tracker.commit(projection.root);
    const before = batch.instanceMatrix.array.slice();
    (models[0]?.children[0] as Mesh).position.x += 1;
    projection.reconcile();
    tracker.update(projection.root);
    const full = batch.instanceMatrix.array.slice();
    const colours = batch.instanceColor?.array.slice();
    const previous = readVelocityPreviousMatrices(batch);
    expect(previous).toEqual(before);
    batch.casterMinDiameter = 3;
    camera.layers.enable(VIRTUAL_SHADOW_CASTER_LAYER);
    batch.onBeforeRender(
      {} as never,
      projection.root,
      camera,
      batch.geometry,
      batch.material as never,
      null as never,
    );
    expect(batch.count).toBe(15);
    const previousSlot = before.findIndex((value, index) => index % 16 === 12 && value === -5);
    expect(previousSlot).toBeGreaterThanOrEqual(0);
    expect(readVelocityPreviousMatrices(batch)?.slice(0, 16)).toEqual(
      before.slice(previousSlot - 12, previousSlot + 4),
    );
    expect(Reflect.get(batch.instanceMatrix, "isStorageInstancedBufferAttribute")).toBe(true);
    expect(batch.instanceMatrix.usage).toBe(DynamicDrawUsage);
    expect(batch.instanceColor?.usage).toBe(DynamicDrawUsage);
    batch.onAfterRender(
      {} as never,
      projection.root,
      camera,
      batch.geometry,
      batch.material as never,
      null as never,
    );
    expect(batch.instanceMatrix.array).toEqual(full);
    expect(batch.instanceColor?.array).toEqual(colours);
    expect(readVelocityPreviousMatrices(batch)).toBe(previous);
    tracker.commit(projection.root);
    tracker.update(projection.root);
    expect(readVelocityPreviousMatrices(batch)).toEqual(full);
    tracker.clear();
    camera.layers.disable(VIRTUAL_SHADOW_CASTER_LAYER);
    projection.dispose();
    world.dispose();
  });
  it("separates identical Uint16 bytes read as float16 and integer vertex attributes", () => {
    const half = shape();
    const integer = shape();
    const bytes = new Uint16Array([0, 0, 0, 0x3c00, 0, 0, 0, 0x3c00, 0]);
    half.setAttribute("position", new Float16BufferAttribute(bytes.slice(), 3));
    integer.setAttribute("position", new BufferAttribute(bytes.slice(), 3));
    const pool = new ChunkInstanceShapes();
    const root = new Group();
    root.add(new Mesh(half, new MeshBasicMaterial()), new Mesh(integer, new MeshBasicMaterial()));
    pool.add(root);
    expect(chunkGeometry(half)).not.toBe(chunkGeometry(integer));
    pool.remove(root);
  });
  it("follows changing instance counts, instance colours and live vertex data without stale copies", async () => {
    const models = await chunks();
    const { world, projection, scene } = await resident(models);
    const source = models[1]?.children[4] as InstancedMesh;
    source.count = 4;
    source.setMatrixAt(0, new Matrix4().makeTranslation(5, -5, 0));
    source.instanceMatrix.needsUpdate = true;
    const part = models[2]?.children[0] as Mesh;
    const colors = part.geometry.getAttribute("color") as BufferAttribute;
    colors.setX(0, 0);
    colors.needsUpdate = true;
    projection.reconcile();
    expect(rasterInput(projection.root)).toEqual(rasterInput(scene));
    source.setColorAt(0, new Color(0.5, 1, 0.25));
    projection.reconcile();
    expect(rasterInput(projection.root)).toEqual(rasterInput(scene));
    projection.dispose();
    world.dispose();
  });
  it("does not identify different index bytes, sides or normal transforms as one draw", async () => {
    const models = await chunks();
    const parts = models[0]?.children as Mesh[];
    parts[0]?.geometry.setIndex([0, 2, 1]);
    (parts[1]?.material as MeshBasicMaterial).side = BackSide;
    parts[2]?.scale.set(2, 1, 1);
    parts[3]?.scale.set(1, 1.000001, 1);
    (models[1]?.children[0] as Mesh).position.x = 0.1;
    const before = new Scene();
    before.add(...models);
    const expected = rasterInput(before);
    const { world, projection } = await resident(models);
    expect(drawMeshes(projection.root)).toHaveLength(9);
    expect(rasterInput(projection.root)).toEqual(expected);
    projection.dispose();
    world.dispose();
  });

  it("keeps canonical buffers alive when their first supplying chunk leaves", () => {
    const pool = new ChunkInstanceShapes();
    const shared = shape();
    const first = new Group();
    first.add(new Mesh(shared, new MeshBasicMaterial()));
    const second = new Group();
    second.add(
      new Mesh(shared, new MeshBasicMaterial()),
      new Mesh(shape(), new MeshBasicMaterial()),
    );
    pool.add(first);
    pool.add(second);
    const geometry = chunkGeometry(shared);
    const disposed = vi.spyOn(geometry, "dispose");
    expect(geometry).not.toBe(shared);
    pool.remove(first);
    expect(chunkGeometry(shared)).toBe(geometry);
    expect(disposed).not.toHaveBeenCalled();
    pool.remove(second);
    expect(chunkGeometry(shared)).toBe(shared);
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("keeps per-source frustum, hierarchy and shadow texel decisions", async () => {
    const models = await chunks();
    (models[1]?.children[4] as InstancedMesh).position.x = 100;
    const { world, projection } = await resident(models);
    const reference = new Scene();
    reference.add(...models.map((model) => model.clone()));
    (models[0] as Group).visible = false;
    (reference.children[0] as Group).visible = false;
    projection.reconcile();
    expect(rasterInput(projection.root)).toEqual(rasterInput(reference));
    const batch = drawMeshes(projection.root).find(
      (mesh) => mesh instanceof InstancedMesh,
    ) as InstancedMesh & { casterMinDiameter: number };
    batch.casterMinDiameter = 3;
    camera.layers.enable(VIRTUAL_SHADOW_CASTER_LAYER);
    batch.onBeforeRender(
      {} as never,
      projection.root,
      camera,
      batch.geometry,
      batch.material as never,
      null as never,
    );
    // Individual triangles are below this diameter; the EXT group's whole authored bound exceeds it.
    expect(batch.count).toBe(5);
    camera.layers.disable(VIRTUAL_SHADOW_CASTER_LAYER);
    projection.dispose();
    world.dispose();
  });

  it("keeps Cut 5's opaque shadow proxies working through projection", async () => {
    const models = await chunks();
    for (const model of models)
      ((model.children[4] as Mesh).material as MeshBasicMaterial).alphaTest = 0;
    const { world, projection } = await resident(models);
    expect(projection.deoptimized).toBe(false);
    expect(drawMeshes(projection.root)).toHaveLength(5);
    const proxy = projection.root.children.find(
      (mesh) => Reflect.get(mesh, "chunkShadowProxy") === true && !mesh.layers.isEnabled(0),
    ) as Mesh;
    expect(proxy).toBeDefined();
    Reflect.set(proxy, "casterMinDiameter", 100);
    proxy.onBeforeRender(
      {} as never,
      projection.root,
      camera,
      proxy.geometry,
      proxy.material as never,
      null as never,
    );
    expect(proxy.geometry.drawRange.count).toBe(0);
    Reflect.set(proxy, "casterMinDiameter", 0);
    proxy.onBeforeRender(
      {} as never,
      projection.root,
      camera,
      proxy.geometry,
      proxy.material as never,
      null as never,
    );
    expect(proxy.geometry.drawRange.count).toBe(15);
    projection.dispose();
    world.dispose();
  });
  it("reduces main and layer-0 shadow candidates across three independently loaded chunk files", async () => {
    const models = await chunks();
    expect(models.flatMap(drawMeshes)).toHaveLength(18);
    const { world, projection } = await resident(models);
    expect(drawMeshes(projection.root)).toHaveLength(4);
    expect(projection.deoptimized).toBe(false);
    expect(drawMeshes(projection.root).filter((mesh) => mesh.castShadow)).toHaveLength(4);
    projection.dispose();
    world.dispose();
  });

  it("preserves world triangle vertices, every attribute and paint in both passes", async () => {
    const models = await chunks();
    const before = new Scene();
    before.add(...models);
    const expected = rasterInput(before);
    const expectedShadow = rasterInput(before, true);
    const { world, projection } = await resident(models);
    expect(rasterInput(projection.root)).toEqual(expected);
    expect(rasterInput(projection.root, true)).toEqual(expectedShadow);
    projection.dispose();
    world.dispose();
  });

  it("removes every instance when its resident cell is evicted", async () => {
    const { world, projection, follow } = await resident(await chunks());
    expect(rasterInput(projection.root)).toHaveLength(33);
    follow.position.x += manifest.cellSize * 20;
    world.update();
    projection.reconcile();
    expect(world.getObjectByName("world-chunk")).toBeUndefined();
    expect(drawMeshes(projection.root)).toHaveLength(0);
    projection.dispose();
    world.dispose();
  });

  it("leaves AutoLOD selection per copy unchanged at near and far cameras", async () => {
    const models = await chunks();
    const { world, projection } = await resident(models);
    const controls = await chunks();
    const before = new Scene();
    before.add(...controls);
    for (const z of [20, 200, 20]) {
      camera.position.z = z;
      camera.updateMatrixWorld();
      updateModelLods(before, camera, 1080);
      updateModelLods(projection.root, camera, 1080);
      const selected = (root: Object3D) =>
        drawMeshes(root)
          .filter((mesh) => lodChainOf(mesh.geometry))
          .map((mesh) => mesh.geometry.index?.count);
      expect(selected(projection.root)).toEqual(selected(before));
      expect(rasterInput(projection.root)).toEqual(rasterInput(before));
    }
    camera.position.z = 20;
    camera.updateMatrixWorld();
    projection.dispose();
    world.dispose();
  });
});
