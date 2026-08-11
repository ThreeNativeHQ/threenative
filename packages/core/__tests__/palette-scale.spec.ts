import { BoxGeometry, DataTexture, Mesh, MeshToonMaterial, Scene } from "three";
import { expect, it } from "vitest";
import { SceneCollapse, type SceneCollapseReport } from "../src/collapse.js";

it("collapses a fox-sized palette scene to a handful of draws", () => {
  const scene = new Scene();
  const ramp = new DataTexture(new Uint8Array([100, 100, 100, 255, 255, 255, 255, 255]), 2, 1);
  // fox-native's palette: ~40 cached MeshToonMaterials sharing one gradient map, differing in colour.
  const materials = Array.from(
    { length: 40 },
    (_, i) => new MeshToonMaterial({ color: i * 1234567, gradientMap: ramp }),
  );
  for (let i = 0; i < 2282; i += 1) {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      materials[i % materials.length] as MeshToonMaterial,
    );
    mesh.position.set(i % 50, Math.floor(i / 50), 0);
    scene.add(mesh);
  }
  let report: SceneCollapseReport | undefined;
  const collapse = new SceneCollapse(scene as never, {
    observeFrames: 3,
    onReport: (v) => {
      report = v;
    },
  });
  for (let f = 0; f < 5; f += 1) {
    scene.updateMatrixWorld(true);
    collapse.frame();
  }
  console.log("REPORT", JSON.stringify(report));
  expect(report?.collapsed).toBe(true);
  expect(report?.mergedMeshes).toBeLessThanOrEqual(4);
});
