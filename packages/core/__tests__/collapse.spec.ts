import { BoxGeometry, Group, Mesh, MeshToonMaterial, PerspectiveCamera, Scene } from "three";
import { describe, expect, it } from "vitest";
import { SceneCollapse, type SceneCollapseReport } from "../src/collapse.js";

const GEOMETRY = new BoxGeometry(1, 1, 1);

function fill(parent: Group | Scene, material: MeshToonMaterial, count: number): Mesh[] {
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
  let report: SceneCollapseReport | undefined;
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

    let report: SceneCollapseReport | undefined;
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

  it("restores the original scene graph on demand", () => {
    const scene = new Scene();
    const meshes = fill(scene, new MeshToonMaterial({ color: 0x5cbb37 }), 10);
    const { collapse, report } = run(scene, 4);
    expect(report?.collapsed).toBe(true);
    for (const mesh of meshes) expect(mesh.parent).toBe(null);
    collapse.restore();
    for (const mesh of meshes) expect(mesh.parent).toBe(scene);
  });
});
