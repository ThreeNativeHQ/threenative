import * as THREE from "three";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
import "./style.css";

type RunnerState = {
  distance: number;
  collected: number;
  lane: number;
  speed: number;
  jumps: number;
  peakRise: number;
};

const STEP = 1 / 60;
const LANES = [-3.25, 0, 3.25];
const laneX = (lane: number) => LANES[lane] ?? 0;
const ROAD_LENGTH = 40;
const ROAD_COUNT = 9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x78d9f3);
scene.fog = new THREE.Fog(0x78d9f3, 42, 155);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 260);
camera.position.set(0, 6.7, 11.5);
camera.lookAt(0, 1.2, -15);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.querySelector("#game")!.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xeafaff, 0x24525c, 2.5));
const sunlight = new THREE.DirectionalLight(0xfff4cf, 3.8);
sunlight.position.set(-12, 24, 8);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -14;
sunlight.shadow.camera.right = 14;
sunlight.shadow.camera.top = 16;
sunlight.shadow.camera.bottom = -8;
scene.add(sunlight);

const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x182942, roughness: 0.88, metalness: 0.05 });
const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x304b58, roughness: 1 });
const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0x8a5400, emissiveIntensity: 0.16, roughness: 0.65 });
const roads: THREE.Group[] = [];

function makeRoad(index: number) {
  const segment = new THREE.Group();
  const road = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.34, ROAD_LENGTH), roadMaterial);
  road.receiveShadow = true;
  segment.add(road);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, ROAD_LENGTH), shoulderMaterial);
    shoulder.position.set(side * 6.38, 0.02, 0);
    segment.add(shoulder);
  }
  for (let z = -17; z <= 17; z += 8) {
    for (const x of [-1.62, 1.62]) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 3.4), yellowMaterial);
      dash.position.set(x, 0.205, z);
      segment.add(dash);
    }
  }
  segment.position.z = -index * ROAD_LENGTH;
  roads.push(segment);
  scene.add(segment);
}
for (let index = 0; index < ROAD_COUNT; index += 1) makeRoad(index);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(420, 420),
  new THREE.MeshStandardMaterial({ color: 0x66cddd, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.2;
ground.receiveShadow = true;
scene.add(ground);

function makeSun(x: number, y: number, z: number, scale: number) {
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(scale, 40, 24),
    new THREE.MeshBasicMaterial({ color: 0xf8fcf1, fog: false }),
  );
  sun.position.set(x, y, z);
  scene.add(sun);
}
makeSun(-28, 23, -76, 8.5);
makeSun(30, 28, -105, 11);

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x785037, roughness: 1 });
const leafMaterials = [0x24c96e, 0x34dd7b, 0x18b965].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
const scenery: THREE.Group[] = [];
function makeTree(side: number, z: number, variant: number) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 2.2, 7), trunkMaterial);
  trunk.position.y = 0.9;
  tree.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35 + (variant % 3) * 0.16, 1), leafMaterials[variant % leafMaterials.length]);
  crown.position.y = 2.7;
  crown.castShadow = true;
  tree.add(crown);
  tree.position.set(side * (8 + (variant % 3) * 1.7), 0, z);
  tree.rotation.y = variant * 0.74;
  scenery.push(tree);
  scene.add(tree);
}
for (let index = 0; index < 32; index += 1) makeTree(index % 2 ? 1 : -1, -10 - index * 9, index);

const player = new THREE.Group();
player.name = "player";
const redMaterial = new THREE.MeshStandardMaterial({ color: 0xf04f55, roughness: 0.45 });
const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x17263b, roughness: 0.8 });
const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.65, 1.25), redMaterial);
body.position.y = 1.48;
body.castShadow = true;
player.add(body);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffba7a, roughness: 0.65 }));
head.position.set(0, 2.65, -0.08);
head.castShadow = true;
player.add(head);
for (const side of [-1, 1]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.82, 0.48), darkMaterial);
  leg.position.set(side * 0.38, 0.43, 0);
  leg.castShadow = true;
  player.add(leg);
}
scene.add(player);

type TrackObject = THREE.Group & { userData: { kind: "obstacle" | "collectible"; baseY: number; bob: number; hit: boolean } };
const trackObjects: TrackObject[] = [];
function createObstacle(lane: number, z: number, index: number) {
  const item = new THREE.Group() as TrackObject;
  item.userData = { kind: "obstacle", baseY: 1, bob: 0, hit: false };
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 2.15, 1.35),
    new THREE.MeshStandardMaterial({ color: index % 2 ? 0xff844c : 0x9a65ea, roughness: 0.55 }),
  );
  mesh.castShadow = true;
  item.add(mesh);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.28, 1.4), yellowMaterial);
  stripe.position.y = 0.25;
  item.add(stripe);
  item.position.set(laneX(lane), 1.28, z);
  trackObjects.push(item);
  scene.add(item);
}
function createCollectible(lane: number, z: number, index: number) {
  const item = new THREE.Group() as TrackObject;
  item.userData = { kind: "collectible", baseY: 1.55, bob: index * 0.7, hit: false };
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.17, 10, 22), yellowMaterial);
  ring.rotation.y = Math.PI / 2;
  ring.castShadow = true;
  item.add(ring);
  item.position.set(laneX(lane), 1.55, z);
  trackObjects.push(item);
  scene.add(item);
}
const layout = [
  ["collectible", 1, -15], ["obstacle", 0, -28], ["collectible", 2, -37],
  ["obstacle", 1, -49], ["collectible", 0, -58], ["obstacle", 1, -70],
  ["collectible", 1, -81], ["obstacle", 0, -94], ["collectible", 2, -104],
] as const;
layout.forEach(([kind, lane, z], index) => kind === "obstacle" ? createObstacle(lane, z, index) : createCollectible(lane, z, index));

const state: RunnerState = { distance: 0, collected: 0, lane: 1, speed: 18, jumps: 0, peakRise: 0 };
let targetLane = 1;
let rise = 0;
let verticalVelocity = 0;
let elapsed = 0;
let animationFrame = 0;
let restartCooldown = 0;

const distanceNode = document.querySelector<HTMLElement>("#distance")!;
const scoreNode = document.querySelector<HTMLElement>("#score")!;
const speedNode = document.querySelector<HTMLElement>("#speed")!;
const flashNode = document.querySelector<HTMLElement>("#flash")!;
const pips = [...document.querySelectorAll(".lane-pips i")];

function updateHud() {
  distanceNode.textContent = Math.floor(state.distance).toString().padStart(4, "0");
  scoreNode.textContent = (state.collected * 100).toString().padStart(3, "0");
  speedNode.textContent = state.speed.toFixed(1);
  pips.forEach((pip, index) => pip.classList.toggle("active", index === state.lane));
}

function changeLane(direction: number) {
  targetLane = THREE.MathUtils.clamp(targetLane + direction, 0, 2);
  state.lane = targetLane;
  updateHud();
}

function jump() {
  if (rise > 0.02) return;
  verticalVelocity = 8.8;
  state.jumps += 1;
}

function resetRun() {
  state.distance = 0;
  state.collected = 0;
  state.speed = 18;
  state.lane = 1;
  targetLane = 1;
  state.peakRise = 0;
  rise = 0;
  verticalVelocity = 0;
  player.position.set(0, 0, 0);
  layout.forEach(([, lane, z], index) => {
    const item = trackObjects[index]!;
    item.position.x = laneX(lane);
    item.position.z = z;
    item.visible = true;
    item.userData.hit = false;
  });
  restartCooldown = 1;
  flashNode.classList.add("show");
  window.setTimeout(() => flashNode.classList.remove("show"), 260);
  updateHud();
}

function recycle(item: TrackObject) {
  const farthest = Math.min(...trackObjects.map((entry) => entry.position.z));
  const sequence = Math.floor(state.distance / 12) + trackObjects.indexOf(item);
  item.position.z = farthest - 14 - (sequence % 3) * 2;
  item.position.x = laneX((sequence * 7 + 1) % 3);
  item.visible = true;
  item.userData.hit = false;
}

function tick() {
  elapsed += STEP;
  animationFrame += 1;
  restartCooldown = Math.max(0, restartCooldown - STEP);
  state.speed = Math.min(31, 18 + state.distance * 0.012);
  const advance = state.speed * STEP;
  state.distance += advance;
  player.position.z -= advance;
  player.position.x = THREE.MathUtils.damp(player.position.x, laneX(targetLane), 13, STEP);

  if (verticalVelocity !== 0 || rise > 0) {
    verticalVelocity -= 21 * STEP;
    rise = Math.max(0, rise + verticalVelocity * STEP);
    if (rise === 0) verticalVelocity = 0;
    state.peakRise = Math.max(state.peakRise, rise);
  }
  player.position.y = rise;
  const running = rise === 0;
  player.children.slice(2).forEach((leg, index) => {
    leg.rotation.x = running ? Math.sin(elapsed * 14 + index * Math.PI) * 0.55 : -0.25;
  });

  camera.position.z = player.position.z + 11.5;
  camera.position.x = THREE.MathUtils.damp(camera.position.x, player.position.x * 0.15, 4, STEP);
  camera.lookAt(player.position.x * 0.24, 1.25 + rise * 0.12, player.position.z - 16);
  sunlight.position.z = player.position.z + 8;
  ground.position.z = player.position.z - 110;

  roads.forEach((road) => {
    if (road.position.z > player.position.z + ROAD_LENGTH) road.position.z -= ROAD_COUNT * ROAD_LENGTH;
  });
  scenery.forEach((tree, index) => {
    if (tree.position.z > player.position.z + 18) tree.position.z -= scenery.length * 9;
    tree.rotation.z = Math.sin(elapsed * 1.5 + index) * 0.018;
  });
  trackObjects.forEach((item) => {
    if (item.position.z > player.position.z + 12) recycle(item);
    if (item.userData.kind === "collectible") {
      item.rotation.y += STEP * 3.2;
      item.position.y = item.userData.baseY + Math.sin(elapsed * 4 + item.userData.bob) * 0.16;
    }
    if (item.userData.hit) return;
    const closeZ = Math.abs(item.position.z - player.position.z) < 1.05;
    const closeX = Math.abs(item.position.x - player.position.x) < 1.05;
    if (!closeZ || !closeX) return;
    if (item.userData.kind === "collectible") {
      item.userData.hit = true;
      item.visible = false;
      state.collected += 1;
    } else if (rise < 1.65 && restartCooldown === 0) {
      resetRun();
    }
  });
  updateHud();
}

addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "ArrowLeft") changeLane(-1);
  if (event.code === "ArrowRight") changeLane(1);
  if (event.code === "Space") jump();
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
});

const entities = [{ id: "player", object: player, path: "scene/player" }];
installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities,
  fixedStep: (ticks) => {
    for (let index = 0; index < ticks; index += 1) tick();
    renderer.render(scene, camera);
  },
  gameplay: () => ({
    animation: { player: { clip: rise > 0 ? "jump" : "run", advancedFrames: animationFrame } },
    states: { player: rise > 0 ? "jumping" : "running", mission: "playing" },
  }),
  renderer,
  resources: { read: () => ({ state: { ...state } }) },
  scene,
});

let previous = performance.now();
let accumulator = 0;
function frame(now: number) {
  accumulator += Math.min((now - previous) / 1000, 0.1);
  previous = now;
  while (accumulator >= STEP) {
    tick();
    accumulator -= STEP;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updateHud();
requestAnimationFrame(frame);
