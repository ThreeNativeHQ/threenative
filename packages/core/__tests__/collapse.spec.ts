import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
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

  it("reports the applied diagnostics contract without retaining scene references", () => {
    const scene = new Scene();
    const green = new MeshToonMaterial({ color: 0x5cbb37 });
    const orange = new MeshToonMaterial({ color: 0xf2952f });
    fill(scene, green, 8);
    fill(scene, orange, 8);

    const { report, collapse } = run(scene, 4);

    expect(report?.schemaVersion).toBe(1);
    expect(report?.status).toBe("applied");
    expect(report?.reasonCode).toBe("applied");
    expect(report?.collapsed).toBe(true);
    expect(report?.diagnostics.sourceRenderables).toBe(16);
    expect(report?.diagnostics.resultDrawCandidates).toBe(1);
    expect(report?.diagnostics.sourceMaterialIdentities).toBe(2);
    expect(report?.diagnostics.resultMaterialIdentities).toBe(1);
    expect(report?.diagnostics.groups.staticWorld).toBe(1);
    expect(report?.diagnostics.groups.movingOwners).toBe(0);
    expect(report?.diagnostics.groups.cameraOverlays).toBe(0);
    expect(report?.diagnostics.skipped.cameraOverlay).toBe(0);
    expect(report?.diagnostics.timings.bakeMs).toBeGreaterThanOrEqual(0);
    expect(report?.diagnostics.timings.transformRefresh.lastMs).toBe(0);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(green.uuid);
    expect(serialized).not.toContain(orange.uuid);
    expect(serialized).not.toContain("matrixWorld");
    expect(JSON.parse(serialized)).toEqual(report);
    expect(collapse.report).toBe(report);
    expect(collapse.diagnostics).toMatchObject({
      sourceRenderables: report?.diagnostics.sourceRenderables,
      resultDrawCandidates: report?.diagnostics.resultDrawCandidates,
      sourceMaterialIdentities: report?.diagnostics.sourceMaterialIdentities,
      resultMaterialIdentities: report?.diagnostics.resultMaterialIdentities,
      groups: report?.diagnostics.groups,
      skipped: report?.diagnostics.skipped,
    });
    expect(collapse.diagnostics?.timings.bakeMs).toBeGreaterThanOrEqual(
      report?.diagnostics.timings.bakeMs ?? 0,
    );
  });

  it("reports current transform-refresh diagnostics without mutating the applied report snapshot", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const arm = new Group();
    const armMesh = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xf2952f }));
    arm.add(armMesh);
    scene.add(arm);

    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      measureTransformRefresh: true,
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
    expect(report?.status).toBe("applied");
    expect(report?.diagnostics.timings.transformRefresh.count).toBe(0);
    const beforeRefreshCount = collapse.diagnostics?.timings.transformRefresh.count ?? 0;

    for (let index = 0; index < 3; index += 1) {
      arm.rotation.z += 0.1;
      scene.updateMatrixWorld(true);
      collapse.frame();
    }

    expect(report?.diagnostics.timings.transformRefresh.count).toBe(0);
    expect(collapse.diagnostics?.timings.transformRefresh.count).toBe(beforeRefreshCount + 3);
    expect(collapse.diagnostics?.timings.transformRefresh.maxMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(JSON.stringify(collapse.diagnostics))).toEqual(collapse.diagnostics);
  });

  it("reports a stable deferred status for the below-floor early report without changing settlement compatibility", async () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x00ff00 }), 4);
    const { collapse, report } = run(scene, 1, { minMeshes: 8 });

    expect(report?.status).toBe("deferred");
    expect(report?.reasonCode).toBe("belowMeshFloorStillWatching");
    expect(report?.diagnostics.sourceRenderables).toBe(4);
    expect(report?.diagnostics.skipped.belowMeshFloor).toBe(4);
    await expect(collapse.whenSettled()).resolves.toBeUndefined();
    expect(collapse.report).toBeUndefined();
  });

  it("counts unsupported and unsafe semantics explicitly without rewriting them", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const hiddenLayer = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xff0000 }));
    hiddenLayer.layers.set(2);
    const ordered = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xff0000 }));
    ordered.renderOrder = 7;
    const hooked = new Mesh(GEOMETRY.clone(), new MeshToonMaterial({ color: 0xff0000 }));
    hooked.onBeforeRender = () => undefined;
    const transparent = new Mesh(
      GEOMETRY.clone(),
      new MeshToonMaterial({ color: 0xff0000, opacity: 0.5, transparent: true }),
    );
    const spriteLike = new Group() as Group & { isSprite: true };
    spriteLike.isSprite = true;
    const pointsLike = new Group() as Group & { isPoints: true };
    pointsLike.isPoints = true;
    scene.add(hiddenLayer, ordered, hooked, transparent, spriteLike, pointsLike);

    const { report } = run(scene, 4);

    expect(report?.status).toBe("applied");
    expect(report?.diagnostics.skipped.layers).toBe(1);
    expect(report?.diagnostics.skipped.renderOrder).toBe(1);
    expect(report?.diagnostics.skipped.renderHook).toBe(1);
    expect(report?.diagnostics.skipped.transparency).toBe(1);
    expect(report?.diagnostics.skipped.sprite).toBe(1);
    expect(report?.diagnostics.skipped.points).toBe(1);
    expect(hiddenLayer.parent).toBe(scene);
    expect(hiddenLayer.layers.mask).toBe(4);
    expect(ordered.parent).toBe(scene);
    expect(ordered.renderOrder).toBe(7);
    expect(hooked.parent).toBe(scene);
    expect(transparent.parent).toBe(scene);
    expect((transparent.material as MeshToonMaterial).transparent).toBe(true);
    expect(spriteLike.parent).toBe(scene);
    expect(pointsLike.parent).toBe(scene);
  });

  it("counts missing geometry, material and position explicitly without rewriting them", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const missingGeometry = new Group() as Group & { isMesh: true; material: MeshToonMaterial };
    missingGeometry.isMesh = true;
    missingGeometry.material = new MeshToonMaterial({ color: 0xff0000 });
    const missingMaterial = new Group() as Group & { geometry: BoxGeometry; isMesh: true };
    missingMaterial.isMesh = true;
    missingMaterial.geometry = GEOMETRY.clone();
    const noPosition = new Mesh(new BufferGeometry(), new MeshToonMaterial({ color: 0xff0000 }));
    noPosition.geometry.setAttribute("normal", new Float32BufferAttribute(new Float32Array(9), 3));
    scene.add(missingGeometry, missingMaterial, noPosition);

    const { report } = run(scene, 4);

    expect(report?.status).toBe("applied");
    expect(report?.diagnostics.skipped.missingGeometry).toBe(1);
    expect(report?.diagnostics.skipped.missingMaterial).toBe(1);
    expect(report?.diagnostics.skipped.missingPosition).toBe(1);
    expect(missingGeometry.parent).toBe(scene);
    expect(missingMaterial.parent).toBe(scene);
    expect(noPosition.parent).toBe(scene);
  });

  it("does not add an extra full scene traversal for diagnostics", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 12);
    let traversals = 0;
    const original = scene.traverse.bind(scene);
    scene.traverse = ((callback: (object: Object3D) => void) => {
      traversals += 1;
      return original(callback);
    }) as Scene["traverse"];

    run(scene, 4);

    expect(traversals).toBe(5);
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

  it("preserves transparent materials instead of merging their semantics away", () => {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 8);
    // Transparency is part of the look, not a colour: it must not be merged away.
    fill(scene, new MeshToonMaterial({ color: 0xa8927a, transparent: true, opacity: 0.5 }), 6);
    const { report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    expect(report?.mergedMeshes).toBe(1);
    expect(report?.diagnostics.skipped.transparency).toBe(6);
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

  // A level that streams its far half in after the loading screen adds to the very group this
  // pass detached. It used to land in a subtree no renderer walks, and simply never drew: on the
  // fox game the platform past the first bridge, its grass, its ? block and the ground under a
  // snail were all missing, with no error anywhere. Nothing about that is visible to a unit test
  // unless the test adds after the collapse and then asks whether the addition can be reached.
  it("draws geometry a game adds to a consumed group after the collapse has settled", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x5cbb37 });
    const level = new Group();
    scene.add(level);
    fill(level, material, 10);
    const { collapse, report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    expect(level.parent).toBe(null);

    const streamedIn = fill(level, material, 3);
    collapse.frame();

    expect(level.parent).toBe(scene);
    expect(collapse.adoptedRoots).toBe(1);
    const reachable = new Set<Object3D>();
    scene.traverse((object) => reachable.add(object));
    for (const mesh of streamedIn) expect(reachable.has(mesh)).toBe(true);
  });

  // The adoption must not undo the collapse for everyone else. A root nobody touches stays out of
  // the scene, because putting it back is exactly the per-frame traversal the pass exists to
  // remove — and the merged draws keep drawing what it used to.
  it("leaves a consumed group the game never touches out of the scene", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x5cbb37 });
    const untouched = new Group();
    scene.add(untouched);
    fill(untouched, material, 10);
    const { collapse, report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);

    for (let index = 0; index < 10; index += 1) collapse.frame();

    expect(untouched.parent).toBe(null);
    expect(collapse.adoptedRoots).toBe(0);
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
    expect(report?.diagnostics.groups.cameraOverlays).toBe(2);
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

describe("scene collapse normal buffer", () => {
  /**
   * Every distinct mat4 buffer the merged material graph reaches. Identity of a single walk is not
   * enough: the normal node and the position node share ancestors, so a first-match walk finds the
   * transform buffer either way and the test passes whatever the code does.
   */
  function mat4Buffers(root: unknown): Set<Float32Array> {
    const found = new Set<Float32Array>();
    const seen = new Set<unknown>();
    const queue: unknown[] = [root];
    while (queue.length > 0 && seen.size < 20_000) {
      const node = queue.shift();
      if (node === null || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (node instanceof Float32Array) {
        if (node.length > 0 && node.length % 16 === 0) found.add(node);
        continue;
      }
      for (const value of Object.values(node as Record<string, unknown>)) queue.push(value);
    }
    return found;
  }

  function mergedBuffers(parent: Object3D): Set<Float32Array> {
    const all = new Set<Float32Array>();
    for (const child of parent.children) {
      const material = (child as Mesh).material as
        | { normalNode?: unknown; positionNode?: unknown }
        | undefined;
      if (material?.positionNode === undefined) continue;
      for (const buffer of mat4Buffers(material.positionNode)) all.add(buffer);
      for (const buffer of mat4Buffers(material.normalNode)) all.add(buffer);
    }
    return all;
  }

  function collapseWithMovingArm(squash: boolean) {
    const scene = new Scene();
    fill(scene, new MeshToonMaterial(), 10);
    const arm = new Group();
    // The squash goes on the moving owner, not its child: a child's scale is baked into the merged
    // vertices, so scaling it there would never reach `hasUniformScale(owner.matrixWorld)`.
    if (squash) arm.scale.set(1, 1, 0.92);
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
    for (let index = 0; index < 6; index += 1) {
      arm.rotation.z += 0.1;
      scene.updateMatrixWorld(true);
      collapse.frame();
    }
    return { report, scene };
  }

  it("should reuse the transform buffer for normals when every moving part scales uniformly", () => {
    // A uniform-scale part's normal matrix is its transform's own upper 3x3: the shader multiplies
    // by vec4(normal, 0) so translation cannot reach the result, and normalize() cancels the scale.
    // A second buffer costs a per-part copy and a whole-buffer upload every frame, and on a phone
    // that copy is interpreted JavaScript in the hot loop.
    const { report, scene } = collapseWithMovingArm(false);
    expect(report?.status).toBe("applied");
    expect(mergedBuffers(scene).size).toBe(1);
  });

  it("should keep a separate normal buffer when a moving part is squashed", () => {
    // One non-uniform scale is enough: the shortcut is wrong for it, so the pass must not take it.
    const { report, scene } = collapseWithMovingArm(true);
    expect(report?.status).toBe("applied");
    expect(mergedBuffers(scene).size).toBe(2);
  });
});

describe("scene collapse motion detection", () => {
  it("should see motion authored before any render has recomputed matrices", () => {
    // `defineGame` calls `collapse.frame()` before `renderer.render()`, so `object.matrix` is stale
    // — or never written at all. Sampling it classified 4,095 of 4,096 animated cubes as static and
    // baked a moving scene into a frozen one, at full speed, with nothing reporting a fault.
    const scene = new Scene();
    const movers = fill(scene, new MeshToonMaterial(), 12);

    let report: ISceneCollapseReport | undefined;
    const collapse = new SceneCollapse(scene as never, {
      observeFrames: 3,
      minMeshes: 8,
      onReport: (value) => {
        report = value;
      },
    });
    // Deliberately never updates matrices: only `position` moves, exactly as a game's update does.
    for (let frame = 0; frame < 8; frame += 1) {
      for (const mesh of movers) mesh.position.y = frame * 0.25;
      collapse.frame();
    }

    expect(report?.status).toBe("applied");
    expect(report?.movingParts).toBe(movers.length);
  });
});

describe("shadow flags survive the collapse", () => {
  /**
   * Round 9's framework arm set `castShadow` on roughly 500 props and rendered with two casters.
   * The merged meshes were built with Three.js's defaults — both flags `false` — and the sources
   * were then removed from the scene, so the flags were gone from the graph entirely while
   * `renderer.shadowMap.enabled` still read `true`. No gate reported it: a scene with no shadows
   * typechecks, lints, and passes every playtest.
   */
  it("should carry castShadow and receiveShadow onto the merged mesh", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x88aa44 });
    const level = new Group();
    scene.add(level);
    for (const mesh of fill(level, material, 24)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    const { report } = run(scene, 6);
    expect(report?.collapsed).toBe(true);

    const merged = scene.children.filter((child): child is Mesh => (child as Mesh).isMesh === true);
    expect(merged.length).toBeGreaterThan(0);
    for (const mesh of merged) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  /**
   * The flags are part of the group key, not merely copied. Copying alone would take whichever
   * mesh happened to create the group and impose its shadow behaviour on every other mesh sharing
   * the material — a floor that suddenly casts, or props that stop.
   */
  it("should not merge a caster with a non-caster that shares its material", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x88aa44 });
    const level = new Group();
    scene.add(level);
    const meshes = fill(level, material, 24);
    for (const [index, mesh] of meshes.entries()) {
      mesh.castShadow = index % 2 === 0;
      mesh.receiveShadow = true;
    }

    const { report } = run(scene, 6);
    expect(report?.collapsed).toBe(true);

    const merged = scene.children.filter((child): child is Mesh => (child as Mesh).isMesh === true);
    // One draw for the casters and one for the rest, rather than a single draw that has to lie
    // about one of them.
    expect(merged.filter((mesh) => mesh.castShadow).length).toBeGreaterThan(0);
    expect(merged.filter((mesh) => !mesh.castShadow).length).toBeGreaterThan(0);
    for (const mesh of merged) expect(mesh.receiveShadow).toBe(true);
  });
});
