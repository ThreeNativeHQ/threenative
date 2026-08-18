import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { type ISceneCollapseReport, SceneCollapse } from "../src/collapse.js";

const MESH_COUNT = 250;
const PICKABLE_COUNT = 5;

function buildScene(withUserData: boolean): { scene: Scene; pickable: Mesh[] } {
  const scene = new Scene();
  const pickable: Mesh[] = [];
  for (let index = 0; index < MESH_COUNT; index += 1) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    if (index < PICKABLE_COUNT) {
      mesh.position.set((index - 2) * 3, 0, 0);
      if (withUserData) {
        mesh.userData.target = index;
        pickable.push(mesh);
      }
    } else {
      mesh.position.set(20 + ((index - PICKABLE_COUNT) % 20) * 2, 2 * Math.floor(index / 20), 0);
    }
    scene.add(mesh);
  }
  return { pickable, scene };
}

function collapse(scene: Scene, minMeshes = 200): ISceneCollapseReport {
  let report: ISceneCollapseReport | undefined;
  const pass = new SceneCollapse(scene as never, {
    minMeshes,
    observeFrames: 3,
    onReport: (value) => {
      report = value;
    },
  });
  for (let frame = 0; frame < 500 && report === undefined; frame += 1) {
    scene.updateMatrixWorld(true);
    pass.frame();
  }
  if (report === undefined) throw new Error("SceneCollapse did not settle.");
  return report;
}

function raycastMeshes(scene: Scene, meshes: readonly Mesh[]): Mesh[] {
  const raycaster = new Raycaster();
  const hits: Mesh[] = [];
  for (const mesh of meshes) {
    const origin = mesh.getWorldPosition(new Vector3()).add(new Vector3(0, 0, 5));
    raycaster.set(origin, new Vector3(0, 0, -1));
    const hit = raycaster.intersectObject(scene, true)[0]?.object;
    if (hit === mesh) hits.push(mesh);
  }
  return hits;
}

describe("SceneCollapse picking contract", () => {
  it("preserves an annotated camera-parented mesh and keeps it raycastable", () => {
    const scene = new Scene();
    for (let index = 0; index < 8; index += 1) {
      const filler = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
      filler.position.set(20 + index * 2, 0, 0);
      scene.add(filler);
    }

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    scene.add(camera);

    const sharedMaterial = new MeshBasicMaterial();
    const target = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
    target.position.z = -2;
    target.userData.target = "camera-picked";
    camera.add(target);

    for (let index = 0; index < 12; index += 1) {
      const overlay = new Mesh(new BoxGeometry(1, 1, 1), sharedMaterial);
      overlay.position.set(20 + index * 2, 0, -2);
      camera.add(overlay);
    }

    const report = collapse(scene, 8);

    expect(report.collapsed).toBe(true);
    expect(report.overlayMeshes).toBe(12);
    expect(report.overlayDraws).toBe(1);
    expect(report.diagnostics.skipped.userData).toBe(1);
    expect(target.parent).toBe(camera);
    expect(target.layers.mask).toBe(1);
    expect(target.userData.target).toBe("camera-picked");
    expect(target.material).not.toBe(sharedMaterial);
    expect((target.material as unknown as { positionNode?: unknown }).positionNode).toBeUndefined();
    expect(target.geometry.getAttribute("tnOwnerId")).toBeUndefined();
    const mergedOverlay = camera.children.find((object): object is Mesh => {
      const mesh = object as Mesh;
      return (
        mesh instanceof Mesh &&
        mesh !== target &&
        mesh.geometry.getAttribute("tnOwnerId") !== undefined
      );
    });
    expect(mergedOverlay?.material).toBe(sharedMaterial);
    expect(mergedOverlay?.geometry.getAttribute("tnOwnerId")).toBeDefined();

    scene.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.set(camera.getWorldPosition(new Vector3()), camera.getWorldDirection(new Vector3()));
    expect(raycaster.intersectObject(scene, true)[0]?.object).toBe(target);
  });

  it("preserves every mesh with userData and keeps it raycastable", () => {
    const { pickable, scene } = buildScene(true);
    const report = collapse(scene);

    expect(report.collapsed).toBe(true);
    expect(report.sourceMeshes).toBe(MESH_COUNT - PICKABLE_COUNT);
    expect(report.mergedMeshes).toBe(1);
    expect(report.diagnostics.skipped.userData).toBe(PICKABLE_COUNT);

    const reachable = new Set<Mesh>();
    scene.traverse((object) => {
      if (object instanceof Mesh) reachable.add(object);
    });
    expect(pickable.every((mesh) => mesh.parent === scene && reachable.has(mesh))).toBe(true);
    expect(reachable).toHaveLength(PICKABLE_COUNT + 1);
    const hits = raycastMeshes(scene, pickable);
    expect(hits).toEqual(pickable);
    expect(hits.map((mesh) => mesh.userData.target)).toEqual([0, 1, 2, 3, 4]);
  });

  it("still collapses 250 meshes when none carry userData", () => {
    const { scene } = buildScene(false);
    const report = collapse(scene);

    expect(report.collapsed).toBe(true);
    expect(report.sourceMeshes).toBe(MESH_COUNT);
    expect(report.mergedMeshes).toBe(1);
    expect(report.diagnostics.skipped.userData).toBe(0);
    expect(scene.children.filter((object) => object instanceof Mesh)).toHaveLength(1);
  });
});
