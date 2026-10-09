import { BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene } from "three";
import { describe, expect, it } from "vitest";
import { createProjectionScanWorkspace, scanProjection } from "../src/projection-plan.js";
import { ProjectionStability } from "../src/projection-stability.js";

function sceneWith(material: MeshStandardMaterial | MeshBasicMaterial): {
  scene: Scene;
  mesh: Mesh;
} {
  const scene = new Scene();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  scene.add(mesh);
  return { mesh, scene };
}

describe("ProjectionStability lane predicates", () => {
  it("holds after record, and drops when a material or geometry lane value changes", () => {
    const material = new MeshStandardMaterial();
    const { scene, mesh } = sceneWith(material);
    const stability = new ProjectionStability();
    const workspace = createProjectionScanWorkspace();
    stability.record(scene, scanProjection(scene, 4, workspace));
    expect(stability.holds(scene)).toBe(true);

    // A lane change that is not a scene-structure change still costs a re-scan.
    material.transparent = true;
    expect(stability.holds(scene)).toBe(false);
    material.transparent = false;

    const ranged = new BoxGeometry(1, 1, 1);
    mesh.geometry = ranged;
    const workspace2 = createProjectionScanWorkspace();
    stability.record(scene, scanProjection(scene, 4, workspace2));
    expect(stability.holds(scene)).toBe(true);
    ranged.setDrawRange(1, 8);
    expect(stability.holds(scene)).toBe(false);
  });

  it("drops when a renderable moves in or out of the exact lane via visibility", () => {
    const material = new MeshBasicMaterial();
    const { scene, mesh } = sceneWith(material);
    const stability = new ProjectionStability();
    const workspace = createProjectionScanWorkspace();
    stability.record(scene, scanProjection(scene, 4, workspace));
    expect(stability.holds(scene)).toBe(true);
    mesh.visible = false;
    expect(stability.holds(scene)).toBe(false);
    mesh.visible = true;
    expect(stability.holds(scene)).toBe(true);
  });
});
