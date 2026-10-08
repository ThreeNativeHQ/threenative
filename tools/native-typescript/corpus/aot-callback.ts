// PRD-506: the engine invokes a compiled TypeScript closure with three's onBeforeRender arguments,
// and a closure that throws comes back as a status, not a crash. Native-only: it fires the callback
// through "three-aot", as a renderer does before a draw.
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";
import { fireBeforeRender } from "three-aot";

const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
scene.add(mesh);
let calls = 0;
let seen = "";
mesh.onBeforeRender = (renderer, s, camera, geometry, material, group) => {
  calls += 1;
  seen = `${renderer === null} ${s === scene} ${camera === null} ${geometry === mesh.geometry} ${material === mesh.material} ${group === null}`;
  if (calls === 2) throw "boom";
};
console.log(`first ${fireBeforeRender(mesh)} ${seen}`);
console.log(`second ${fireBeforeRender(mesh)}`);
console.log(`calls ${calls}`);
