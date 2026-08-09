import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "vertex-colors", ({ scene }) => {
    const geometry = new THREE.BoxGeometry(1.35, 1.35, 1.35);
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let index = 0; index < colors.length; index += 3) {
      colors[index] = (index % 9) / 9;
      colors[index + 1] = 0.45 + (index % 6) / 12;
      colors[index + 2] = 1 - (index % 12) / 15;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.rotation.set(0.45, 0.6, 0);
    scene.add(mesh);
    return mesh;
  });
}
