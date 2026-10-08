// PRD-506: 10,000 create/attach/detach cycles of a mesh whose callback captures it hold the engine
// object count and the resident set flat. Native-only: it uses the "three-aot" hooks a host runs
// between frames.
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";
import { collectGarbage, liveEngineObjects, residentKilobytes, safePoint } from "three-aot";

const scene = new Scene();
const baseline = liveEngineObjects();

function cycle(i: number): void {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  mesh.onBeforeRender = (renderer, s, camera, geometry, material, group) => {
    mesh.position.x = i;
  };
  scene.add(mesh);
  scene.remove(mesh);
}

let peak = 0;
let firstResident = 0;
let lastResident = 0;
for (let i = 0; i < 10000; i += 1) {
  cycle(i);
  if ((i + 1) % 1000 === 0) {
    safePoint();
    collectGarbage();
    const live = liveEngineObjects();
    if (live > peak) peak = live;
    lastResident = residentKilobytes();
    if (firstResident === 0) firstResident = lastResident;
  }
}
safePoint();
collectGarbage();
console.log(`objects back to baseline ${liveEngineObjects() === baseline}`);
console.log(`objects bounded between safe points ${peak <= baseline + 8}`);
console.log(
  `resident growth under 8 MiB ${lastResident > 0 && lastResident - firstResident < 8192}`,
);
