// PRD-506: the §2.2 snippet, unchanged game source against "three". The reference build runs it on
// upstream three@0.185.1; the native build compiles it with tslang against the engine.
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";

const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
scene.add(mesh);
mesh.position.x += 1;
mesh.position.x += 1;
mesh.position.z -= 3;

console.log(`${scene.type} ${mesh.type} ${mesh.material.type}`);
console.log(
  `position ${mesh.position.x.toString()} ${mesh.position.y.toString()} ${mesh.position.z.toString()}`,
);
console.log(`found ${scene.getObjectById(mesh.id) === mesh ? "same" : "different"}`);
