import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "line-segments", ({ scene }) => {
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
    return lines;
  });
}
