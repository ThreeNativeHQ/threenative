// The L4 rung (PRD-117 §3, PRD-449 R3) as native-AOT game code (PRD-533, arm `native-aot`): the same
// placements, per-cube colour, bob, rotation and camera orbit as l4-workload.ts (the V8 arm) and the
// host's C++ twin (native-cpp), from the same pose functions (src/l4-pose.ts), compiled ahead of
// time by Perry against the facade over the engine's C ABI. Run by tools/native-typescript/bench-aot.mjs,
// which stages it, links the engine and reads the report the session writes; sizes come from the
// environment (TN_BENCH_OBJECTS, _FRAMES, _WARMUP, _WIDTH, _HEIGHT).
import {
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from "three";
import { benchBegin, benchFinish, benchOpen, benchRender, benchSetting } from "three-aot";
import {
  cameraPose,
  createPlacements,
  cubeBobY,
  cubeRotationX,
  cubeRotationY,
  uniqueMaterialColor,
} from "../src/l4-pose.js";

const objects = benchSetting("objects");
const frames = benchSetting("frames");
const warmup = benchSetting("warmup");
const width = benchSetting("width");
const height = benchSetting("height");

// game.ts's authored scene: one lit material, a 200x200 ground, one sun, a cube per placement.
const scene = new Scene();
const camera = new PerspectiveCamera(60, width / height, 0.1, 4000);
const material = new MeshStandardMaterial();
material.color.setHex(0xb8c4cc);
material.metalness = 0;
material.roughness = 0.75;
const ground = new Mesh(new PlaneGeometry(200, 200), material);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const light = new DirectionalLight(0xffffff, 2.4);
light.position.set(40, 80, 25);
scene.add(light);
const box = new BoxGeometry(1, 1, 1);
const placements = createPlacements(objects);
const cubes: Mesh[] = [];
for (let index = 0; index < objects; index += 1) {
  const own = new MeshStandardMaterial(); // L4: a clone of the shared material per cube
  own.metalness = 0;
  own.roughness = 0.75;
  own.color.setHex(uniqueMaterialColor(index));
  const cube = new Mesh(box, own);
  const placement = placements[index];
  cube.position.set(placement.x, placement.y, placement.z);
  scene.add(cube);
  cubes.push(cube);
}

benchOpen(scene, camera, width, height);
for (let frame = 0; frame < warmup + frames; frame += 1) {
  benchBegin(frame, warmup);
  // writeAuthoredTransforms (mutation rate 1: every cube is dirty) and the camera's orbit.
  const pose = cameraPose(frame, objects);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
  for (let index = 0; index < objects; index += 1) {
    const cube = cubes[index];
    cube.position.y = cubeBobY(index, frame, placements[index].y);
    cube.rotation.x = cubeRotationX(index, frame);
    cube.rotation.y = cubeRotationY(index, frame);
  }
  benchRender();
}
benchFinish();
