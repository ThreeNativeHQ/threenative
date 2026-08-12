import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { describe, expect, it } from "vitest";
import { type ISceneCollapseReport, SceneCollapse } from "../src/collapse.js";

const GEOMETRY = new BoxGeometry(1, 1, 1);

function fill(parent: Object3D, material: MeshToonMaterial, count: number): Mesh[] {
  const meshes: Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new Mesh(GEOMETRY.clone(), material);
    mesh.position.set(index, 0, 0);
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function run(
  scene: Scene,
  frames: number,
  options: { observeFrames?: number; minMeshes?: number } = {},
) {
  let report: ISceneCollapseReport | undefined;
  const collapse = new SceneCollapse(scene as never, {
    observeFrames: options.observeFrames ?? 3,
    minMeshes: options.minMeshes ?? 8,
    onReport: (value) => {
      report = value;
    },
  });
  for (let index = 0; index < frames; index += 1) {
    scene.updateMatrixWorld(true);
    collapse.frame();
  }
  return { collapse, report };
}

/**
 * Finds the transform buffer a merged shader indexes, by walking each material's node graph for
 * a Float32Array of mat4s. Bounded and visited-tracked: the graph is cyclic.
 */
function nodeTransforms(root: unknown): Float32Array | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [root];
  while (queue.length > 0 && seen.size < 5_000) {
    const node = queue.shift();
    if (node === null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (node instanceof Float32Array) {
      if (node.length % 16 === 0 && node.length > 0) return node;
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) queue.push(value);
  }
  return undefined;
}

function mergedTransforms(parent: Object3D): Float32Array | undefined {
  for (const child of parent.children) {
    const root = ((child as Mesh).material as { positionNode?: unknown } | undefined)?.positionNode;
    if (root === undefined) continue;
    const transforms = nodeTransforms(root);
    if (transforms !== undefined) return transforms;
  }
  return undefined;
}

describe("SceneCollapse", () => {
  it("rejects an observation window that cannot be observed", () => {
    expect(() => new SceneCollapse(new Scene() as never, { observeFrames: 0 })).toThrow(
      /observeFrames/,
    );
    expect(() => new SceneCollapse(new Scene() as never, { minMeshes: -1 })).toThrow(/minMeshes/);
  });

  it("keeps watching a scene too small to be worth collapsing, and leaves it untouched", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x00ff00 }), 4);
    const { report } = run(scene, 4, { minMeshes: 8 });
    expect(report?.collapsed).toBe(false);
    expect(report?.reason).toMatch(/fewer than 8 meshes so far; still watching/);
    expect(scene.children).toHaveLength(4);
  });

  it("merges materials that differ only in colour into one draw, colour moved to the vertices", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 6);
    fill(scene, new MeshToonMaterial({ color: 0xa8927a }), 6);
    const { report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    expect(report?.sourceMeshes).toBe(12);
    expect(report?.mergedMeshes).toBe(1);
    expect(report?.movingParts).toBe(0);
    const merged = scene.children.filter((child) => (child as Mesh).isMesh === true) as Mesh[];
    expect(merged).toHaveLength(1);
    const material = (merged[0] as Mesh).material as MeshToonMaterial;
    // The class and its toon ramp are still the game's — only the colour source moved.
    expect(material.type).toBe("MeshToonMaterial");
    expect(material.vertexColors).toBe(true);
    const colors = (merged[0] as Mesh).geometry.getAttribute("color");
    expect(colors).toBeDefined();
    expect((colors as { itemSize: number }).itemSize).toBe(3);
  });

  it("keeps materials apart when more than their colour differs", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 6);
    // Transparency is part of the look, not a colour: it must not be merged away.
    fill(scene, new MeshToonMaterial({ color: 0xa8927a, transparent: true, opacity: 0.5 }), 6);
    const { report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    expect(report?.mergedMeshes).toBe(2);
  });

  it("leaves a camera-parented subtree alone, because that is where the HUD lives", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const camera = new PerspectiveCamera();
    const hud = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xff0000 }));
    camera.add(hud);
    scene.add(camera);
    const { report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    expect(report?.sourceMeshes).toBe(10);
    expect(hud.parent).toBe(camera);
  });

  it("gives a part that moved during observation its own transform", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const arm = new Group();
    const armMesh = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xf2952f }));
    arm.add(armMesh);
    scene.add(arm);

    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      observeFrames: 3,
      minMeshes: 8,
      onReport: (value) => {
        report = value;
      },
    });
    for (let index = 0; index < 4; index += 1) {
      arm.rotation.z += 0.1;
      scene.updateMatrixWorld(true);
      collapse.frame();
    }
    expect(report?.collapsed).toBe(true);
    expect(report?.sourceMeshes).toBe(11);
    expect(report?.movingParts).toBe(1);
  });

  it("keeps a moving part's own visibility live after its source graph is detached", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const arm = new Group();
    arm.add(new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xf2952f })));
    scene.add(arm);

    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      observeFrames: 3,
      minMeshes: 8,
      onReport: (value) => {
        report = value;
      },
    });
    for (let index = 0; index < 4; index += 1) {
      arm.rotation.z += 0.1;
      scene.updateMatrixWorld(true);
      collapse.frame();
    }

    expect(report?.movingParts).toBe(1);
    const transforms = mergedTransforms(scene);
    expect(transforms).toBeDefined();
    arm.visible = false;
    collapse.frame();
    expect(transforms?.slice(12, 15)).toEqual(new Float32Array([1e9, 1e9, 1e9]));
    arm.visible = true;
    arm.position.x = 7;
    collapse.frame();
    expect(transforms?.[12]).toBe(7);
  });

  // A loading screen waits on this. If it never resolved, a game would hold the screen forever;
  // if it resolved early, the player would watch the map assemble itself, which is the bug.
  it("settles with real progress, and settles even when the scene is too small to collapse", async () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      observeFrames: 4,
      minMeshes: 8,
      onReport: (value) => {
        report = value;
      },
    });
    expect(collapse.progress).toBe(0);
    scene.updateMatrixWorld(true);
    collapse.frame();
    collapse.frame();
    // Observation is the first half of the bar, baking the second, so a bar driven by this keeps
    // moving through the collapse instead of filling and then hanging on a blocked frame.
    expect(collapse.progress).toBe(0.25);
    collapse.frame();
    collapse.frame();
    expect(collapse.progress).toBeGreaterThanOrEqual(0.5);
    // The bake is spread across frames, so it takes more than the one that started it.
    for (let frame = 0; frame < 40 && report === undefined; frame += 1) collapse.frame();
    expect(report?.collapsed).toBe(true);
    expect(collapse.progress).toBe(1);
    await expect(collapse.whenSettled()).resolves.toBeUndefined();

    // A scene under the floor never collapses, and must still release the loading screen.
    const small = new Scene();
    fill(small, new MeshToonMaterial({ color: 0x5cbb37 }), 2);
    const smallCollapse = new SceneCollapse(small as never, { observeFrames: 3, minMeshes: 8 });
    small.updateMatrixWorld(true);
    smallCollapse.frame();
    await expect(smallCollapse.whenSettled()).resolves.toBeUndefined();
  });

  it("restores the original scene graph on demand", () => {
    const scene = new Scene();
    const meshes = fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const { collapse, report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    for (const mesh of meshes) expect(mesh.parent).toBe(null);
    collapse.restore();
    for (const mesh of meshes) expect(mesh.parent).toBe(scene);
  });

  // The bake reads the position and normal arrays directly instead of calling
  // BufferGeometry.applyMatrix4, which was 1,418 ms of a 2,518 ms collapse on a Pixel 8. Same
  // arithmetic or the level renders in the wrong place, so it is checked against three.js itself.
  it("bakes the same world transform three.js would", () => {
    const scene = new Scene();
    const meshes = fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    for (const [index, mesh] of meshes.entries()) {
      mesh.position.set(index * 3 - 4, index, -index);
      mesh.rotation.set(index * 0.3, index * 0.2, index * 0.1);
      mesh.scale.set(1 + index * 0.1, 2 - index * 0.05, 0.5 + index * 0.2);
    }
    scene.updateMatrixWorld(true);

    // What three.js produces for the same inputs, computed before the collapse consumes them.
    const expected = meshes.map((mesh) => {
      const geometry = mesh.geometry.toNonIndexed();
      geometry.applyMatrix4(mesh.matrixWorld.clone());
      return geometry;
    });
    const bounds = new Box3();
    for (const geometry of expected) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox as Box3);
    }

    const { report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    const merged = scene.children.find((child) => (child as Mesh).isMesh === true) as Mesh;
    merged.geometry.computeBoundingBox();
    const actual = merged.geometry.boundingBox as Box3;
    for (const axis of ["x", "y", "z"] as const) {
      expect(actual.min[axis]).toBeCloseTo(bounds.min[axis], 4);
      expect(actual.max[axis]).toBeCloseTo(bounds.max[axis], 4);
    }
    // A rotated, non-uniformly scaled mesh must come out with unit normals, or lighting reads
    // wrong on exactly the surfaces the level is made of.
    const normals = merged.geometry.getAttribute("normal");
    for (let index = 0; index < normals.count; index += 1) {
      const length = Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index));
      expect(length).toBeCloseTo(1, 4);
    }
  });

  // A HUD is camera-parented, so the scene pass skips it by construction. On a real game that
  // left it as ~93 of ~110 draws — the whole gap between 57 fps and the frame budget.
  it("folds a camera-parented overlay into one draw per material instance", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const camera = new PerspectiveCamera();
    const hud = new Group();
    camera.add(hud);
    scene.add(camera);
    const hearts = new MeshToonMaterial({ color: 0xff0000 });
    const digits = new MeshToonMaterial({ color: 0xffffff });
    const overlay = [...fill(hud, hearts, 8), ...fill(hud, digits, 8)];
    const { report } = run(scene, 4);

    expect(report?.collapsed).toBe(true);
    expect(report?.overlayMeshes).toBe(16);
    // Two material instances in, two draws out — never merged by look.
    expect(report?.overlayDraws).toBe(2);
    // The overlay stays in the graph so Three.js keeps refreshing it; it simply stops drawing.
    for (const mesh of overlay) {
      expect(mesh.parent).toBe(hud);
      expect(mesh.layers.mask).toBe(0);
    }
    expect(camera.children.filter((child) => (child as Mesh).isMesh === true)).toHaveLength(2);
  });

  it("leaves the overlay's own material instances live so the game can still recolour them", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const camera = new PerspectiveCamera();
    scene.add(camera);
    const hearts = new MeshToonMaterial({ color: 0xff0000 });
    fill(camera, hearts, 14);
    const { collapse, report } = run(scene, 4);

    expect(report?.overlayDraws).toBe(1);
    // The merged draw uses the game's object, not a copy of it, so a later write still shows.
    const merged = camera.children.find((child) => (child as Mesh).isMesh === true) as Mesh;
    expect(merged.material).toBe(hearts);
    expect((hearts as unknown as { positionNode?: unknown }).positionNode).toBeDefined();

    collapse.restore();
    expect((hearts as unknown as { positionNode?: unknown }).positionNode).toBeUndefined();
    expect(camera.children.filter((child) => (child as Mesh).isMesh === true)).toHaveLength(14);
  });

  // The overlay's transform buffer starts zeroed. Filled only on the next frame's update, the
  // first frame after the collapse draws every overlay vertex through an all-zero matrix and
  // collapses it to a point — a one-frame flash of the scene where the HUD should be.
  it("fills the overlay transforms during the collapse, not a frame later", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const camera = new PerspectiveCamera();
    camera.position.set(3, 4, 5);
    scene.add(camera);
    fill(camera, new MeshToonMaterial({ color: 0xff0000 }), 14);
    // Stop the instant it settles. Pumping further frames would run the per-frame update and fill
    // the buffer anyway, which is what made the first version of this test pass without the fix.
    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      observeFrames: 3,
      minMeshes: 8,
      onReport: (value) => {
        report = value;
      },
    });
    for (let frame = 0; frame < 5_000 && report === undefined; frame += 1) {
      scene.updateMatrixWorld(true);
      collapse.frame();
    }

    expect(report?.overlayDraws).toBe(1);
    // An all-zero matrix collapses every vertex to a point, so a buffer that is still zero here
    // is the flash. The camera sits away from the origin, so a correct transform cannot be zero.
    const transforms = mergedTransforms(camera);
    expect(transforms).toBeDefined();
    expect(transforms?.some((value) => value !== 0)).toBe(true);
  });

  it("leaves a small overlay alone, where merging costs more than the draws it saves", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const camera = new PerspectiveCamera();
    scene.add(camera);
    const overlay = fill(camera, new MeshToonMaterial({ color: 0xff0000 }), 4);
    const { report } = run(scene, 4);

    expect(report?.collapsed).toBe(true);
    expect(report?.overlayMeshes).toBe(0);
    for (const mesh of overlay) expect(mesh.layers.mask).toBe(1);
  });
});
