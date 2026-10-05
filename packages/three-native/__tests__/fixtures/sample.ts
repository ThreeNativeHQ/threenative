/**
 * The §2.2 developer experience, typechecked against the generated declarations.
 *
 * `three` resolves to `generated/three.d.ts` through this package's tsconfig, so a game that keeps
 * the familiar imports is what the catalog has to make compile.
 */

import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";

const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xff8844 }));
scene.add(mesh);
mesh.position.x += 1;

const local: Vector3 = mesh.getWorldPosition(new Vector3());
scene.rotation.set(0, Math.PI / 2, 0);
mesh.lookAt(0, 0, 0);
mesh.updateMatrixWorld(true);
scene.traverse((node) => {
  node.visible = node === mesh;
});

export const sceneSample = { children: scene.children.length, local, mesh };
