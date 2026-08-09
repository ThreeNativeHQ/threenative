import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "shape-geometry", ({ scene }) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.8);
    shape.bezierCurveTo(-1.25, -0.05, -0.9, 0.95, 0, 0.42);
    shape.bezierCurveTo(0.9, 0.95, 1.25, -0.05, 0, -0.8);
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 24),
      new THREE.MeshBasicMaterial({ color: 0xf56565, side: THREE.DoubleSide }),
    );
    scene.add(mesh);
    return mesh;
  });
}
