import { SceneRenderProjection } from "../../../../core/src/renderProjection.ts";
import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "line-segments", ({ renderer, scene, camera }) => {
    const points = [];
    for (let index = -4; index <= 4; index += 1) {
      const value = index * 0.24;
      points.push(-1.1, value, 0, 1.1, value, 0, value, -1.1, 0, value, 1.1, 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x81e6d9 }),
    );
    lines.rotation.z = 0.12;
    scene.add(lines);
    // Offscreen repeated meshes activate the real optimizer without obscuring the line corpus.
    const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshBasicMaterial();
    for (let index = 0; index < 8; index += 1) {
      const mesh = new THREE.Mesh(box, material);
      mesh.position.x = 100 + index;
      scene.add(mesh);
    }
    const projection = new SceneRenderProjection(scene, { minMeshes: 8 });
    projection.reconcile();
    assertCondition(!projection.deoptimized, "line corpus must exercise automatic projection");
    const proxyFor = (source) => projection.root.children.find((o) => o.geometry === source.geometry);
    assertCondition(proxyFor(lines)?.isLineSegments === true, "projection joined independent line segments");
    return {
      detail: { projecting: true, segments: true },
      render() {
        projection.reconcile();
        renderer.render(projection.root, camera);
        projection.commit();
      },
    };
  });
}
