import { BufferAttribute, BufferGeometry, Group, Mesh, PerspectiveCamera, Scene } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { describe, expect, it } from "vitest";
import {
  DiscreteLodPlugin,
  TN_DISCRETE_LOD,
  baseGeometryOf,
  updateModelLods,
} from "../src/model-lod.js";

// The LOD chain belongs to the geometry a cloned mesh shares, not to the mesh object the loader
// registered. A game reuses an imported model by cloning it (plain `clone()` for static parts,
// `SkeletonUtils.clone` for rigged ones), so a chain that does not follow a clone is a chain that
// never engages on a real game — Midway measured 0 of 3,645 meshes chained for exactly this reason.

const SCHEMA = 1;
const BASE_INDICES = [0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3, 0, 2, 1, 3, 1, 2];
const LEVEL_INDICES = [
  [0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3],
  [0, 1, 2, 1, 3, 2],
];

/** LOD0 is 6 triangles; the two derived levels are 4 and 2. */
const LOD0_TRIANGLES = 6;
const LEVEL_ONE_TRIANGLES = 4;

function baseGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0, 1]);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(BASE_INDICES), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function definition(): Record<string, unknown> {
  return {
    absoluteErrors: [0.05, 5],
    counts: [4, 2],
    errors: [0.05, 5],
    indices: [0, 1],
    lod0Triangles: LOD0_TRIANGLES,
    schemaVersion: SCHEMA,
    sharedVertexBuffers: true,
    strategy: "discrete",
  };
}

function parserFor(target: Mesh): {
  readonly associations: Map<object, { meshes?: number; primitives?: number }>;
  getDependency(type: string, index: number): Promise<{ array: ArrayLike<number> }>;
  readonly json: { meshes?: { primitives?: { extensions?: Record<string, unknown> }[] }[] };
} {
  return {
    associations: new Map([[target, { meshes: 0, primitives: 0 }]]),
    getDependency: async (_type, index) => ({
      array: Uint32Array.from(LEVEL_INDICES[index] ?? []),
    }),
    json: { meshes: [{ primitives: [{ extensions: { [TN_DISCRETE_LOD]: definition() } }] }] },
  };
}

/** A source mesh the loader attached a chain to, exactly as a game receives it. */
async function managedMesh(): Promise<Mesh> {
  const target = new Mesh(baseGeometry(), undefined);
  const plugin = new DiscreteLodPlugin();
  plugin.setParser(parserFor(target) as never);
  await plugin.afterRoot({ scene: target });
  expect(plugin.attach(target, { hysteresis: 0.15, maxPixelError: 1 })).toBe(1);
  return target;
}

function farCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.updateMatrixWorld(true);
  return camera;
}

function firstMesh(root: Group): Mesh {
  let found: Mesh | undefined;
  root.traverse((object) => {
    if (found === undefined && object instanceof Mesh) found = object;
  });
  if (found === undefined) throw new Error("the clone holds no mesh");
  return found;
}

describe("discrete LOD chains follow clones", () => {
  it("chains a plain clone() and selects the same level as its source", async () => {
    const source = await managedMesh();
    const clone = source.clone();
    const scene = new Scene();
    scene.add(source);
    scene.add(clone);

    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(clone.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
    expect(clone.geometry).toBe(source.geometry);
    expect(baseGeometryOf(clone)).toBe(baseGeometryOf(source));

    const near = new PerspectiveCamera(60, 1, 0.1, 1000);
    near.position.set(0, 0, 3);
    near.updateMatrixWorld(true);
    updateModelLods(scene, near, 1080);
    expect(clone.geometry.index?.count).toBe(LOD0_TRIANGLES * 3);
  });

  it("chains a SkeletonUtils.clone() rigged model, the idiom the templates teach", async () => {
    const source = await managedMesh();
    const base = baseGeometryOf(source);
    const rig = new Group();
    rig.add(source);
    const clone = cloneSkeleton(rig) as Group;
    const clonedMesh = firstMesh(clone);

    const scene = new Scene();
    scene.add(clone);
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES);
    expect(clonedMesh.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
    expect(clonedMesh.geometry.getAttribute("position")).toBe(base.getAttribute("position"));
    expect(baseGeometryOf(clonedMesh)).toBe(base);
  });

  it("adopts a clone made after the source has already coarsened", async () => {
    const source = await managedMesh();
    const scene = new Scene();
    scene.add(source);
    const far = farCamera();
    updateModelLods(scene, far, 1080);
    expect(source.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);

    // The clone carries the derived geometry, not LOD0: the chain is found on every level it wrote.
    const clone = source.clone();
    scene.add(clone);
    expect(updateModelLods(scene, far, 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(clone.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
  });

  it("shares one chain across many clones and unloads one without breaking the rest", async () => {
    const source = await managedMesh();
    const base = baseGeometryOf(source);
    const first = source.clone();
    const second = source.clone();
    const scene = new Scene();
    scene.add(source);
    scene.add(first);
    scene.add(second);
    const far = farCamera();

    expect(updateModelLods(scene, far, 1080)).toBe(LEVEL_ONE_TRIANGLES * 3);
    // Clones share the selected level object and the authored vertices; nothing was duplicated.
    expect(first.geometry).toBe(second.geometry);
    expect(first.geometry.getAttribute("position")).toBe(base.getAttribute("position"));

    // Unloading one clone leaves the source and the sibling selecting, and adopting is idempotent.
    scene.remove(second);
    expect(updateModelLods(scene, far, 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(updateModelLods(scene, far, 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(first.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
    expect(baseGeometryOf(first)).toBe(base);
    expect(base.index?.count).toBe(BASE_INDICES.length);

    // Re-adding it is a fresh adoption, not a stale entry counting twice.
    scene.add(second);
    expect(updateModelLods(scene, far, 1080)).toBe(LEVEL_ONE_TRIANGLES * 3);
  });

  it("does not retain a dropped clone, and disposing its level does not disturb the source", async () => {
    const source = await managedMesh();
    const base = baseGeometryOf(source);
    const clone = source.clone();
    const scene = new Scene();
    scene.add(source);
    scene.add(clone);

    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    const droppedLevel = clone.geometry;
    scene.remove(clone);
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES);
    // Releasing the dropped clone's level is the game's own handle; the source chain is intact.
    droppedLevel.dispose();
    expect(baseGeometryOf(source)).toBe(base);
    expect(base.index?.count).toBe(BASE_INDICES.length);
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES);
  });

  it("leaves the uncloned path exactly as it was", async () => {
    const source = await managedMesh();
    const base = baseGeometryOf(source);
    const scene = new Scene();
    scene.add(source);
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES);
    expect(source.geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
    expect(baseGeometryOf(source)).toBe(base);
  });
});
