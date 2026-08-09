import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "instanced-mesh", ({ scene }) => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.38, 0.38, 0.38),
      new THREE.MeshBasicMaterial({ color: 0x90cdf4 }),
      15,
    );
    const transform = new THREE.Object3D();
    for (let index = 0; index < 15; index += 1) {
      transform.position.set(((index % 5) - 2) * 0.48, (Math.floor(index / 5) - 1) * 0.48, 0);
      transform.rotation.set(index * 0.08, index * 0.12, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  });
}
