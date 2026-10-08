// PRD-506: a mesh <-> closure cycle is reclaimed once the mesh leaves the scene and its last
// TypeScript reference drops, at the safe point. Native-only: it uses the "three-aot" hooks a host
// runs between frames.
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";
import { collectGarbage, fireBeforeRender, liveEngineObjects, safePoint } from "three-aot";

const scene = new Scene();
const baseline = liveEngineObjects();

// The closure captures its own mesh; nothing else in the program keeps either.
function attach(): number {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  // All six parameters: the pinned tslang refuses a closure with fewer than the callback type has.
  mesh.onBeforeRender = (renderer, s, camera, geometry, material, group) => {
    mesh.position.x += 1;
  };
  scene.add(mesh);
  return mesh.id;
}

function fireById(id: number): string {
  const found = scene.getObjectById(id);
  return found === null ? "gone" : fireBeforeRender(found);
}

function settle(): void {
  safePoint();
  collectGarbage();
}

const id = attach();
settle();
console.log(`attached held ${liveEngineObjects() > baseline}`);
console.log(`attached fires ${fireById(id)}`);
scene.clear();
settle();
settle();
console.log(`detached reclaimed ${liveEngineObjects() === baseline}`);
