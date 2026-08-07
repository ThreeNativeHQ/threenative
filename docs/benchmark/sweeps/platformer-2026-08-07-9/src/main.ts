import { installThreePlaytestBridge } from "@threenative/playtest/three";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app mount point");

app.innerHTML = `
  <div class="hud" id="hud">
    <div class="mission"><strong id="objective">Collect the coins & reach the flag!</strong><span id="status">Adventure ahead</span></div>
    <div class="coin-count"><span class="coin-icon">★</span><span id="coins">0 / 8</span></div>
    <div class="toast" id="toast">Back to safety!</div>
    <div class="controls"><span>WASD / ARROWS · MOVE</span><span>SPACE · JUMP</span><span>R · RESTART</span></div>
  </div>`;

const hud = document.querySelector<HTMLElement>("#hud")!;
const coinLabel = document.querySelector<HTMLElement>("#coins")!;
const objectiveLabel = document.querySelector<HTMLElement>("#objective")!;
const statusLabel = document.querySelector<HTMLElement>("#status")!;
const toast = document.querySelector<HTMLElement>("#toast")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x42b9f5);
scene.fog = new THREE.Fog(0x88d9f5, 42, 92);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 180);
camera.position.set(9, 8.5, 16);

const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
app.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdff7ff, 0x496a35, 2.5));
const sun = new THREE.DirectionalLight(0xfff0c9, 4.4);
sun.position.set(-15, 24, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0004;
scene.add(sun);

const mat = (color: number, roughness = 0.82, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const grassMat = mat(0x61c936);
const grassSideMat = mat(0x3e9e2c);
const earthMat = mat(0x895535);
const earthDarkMat = mat(0x5e3e31);
const woodMat = mat(0xb96b2c);
const woodLightMat = mat(0xe59a45);
const leafMat = mat(0x2f9d45);
const leafLightMat = mat(0x5dbe49);
const stoneMat = mat(0x6d7187);
const goldMat = mat(0xffb817, 0.35, 0.18);
const goldEdgeMat = mat(0xffdf47, 0.3, 0.2);

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  cast = true,
  receive = true,
) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
}

function roundedBox(width: number, height: number, depth: number, radius: number, material: THREE.Material) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: radius * 0.45,
    bevelThickness: radius * 0.45,
  });
  geometry.center();
  return mesh(geometry, material);
}

type Platform = { x: number; z: number; width: number; depth: number; top: number };
const platforms: Platform[] = [];

function island(x: number, top: number, z: number, width: number, depth: number, thickness = 3.8) {
  const group = new THREE.Group();
  const soil = roundedBox(width, thickness, depth, 0.65, earthMat);
  soil.position.y = top - thickness / 2;
  group.add(soil);

  const lower = mesh(new THREE.ConeGeometry(Math.min(width, depth) * 0.47, thickness * 1.8, 7), earthDarkMat);
  lower.position.y = top - thickness - thickness * 0.72;
  lower.rotation.y = Math.PI / 7;
  group.add(lower);

  const turf = roundedBox(width + 0.22, 0.65, depth + 0.22, 0.38, grassSideMat);
  turf.position.y = top - 0.19;
  group.add(turf);
  const topPatch = roundedBox(width - 0.05, 0.28, depth - 0.05, 0.32, grassMat);
  topPatch.position.y = top + 0.24;
  group.add(topPatch);

  group.position.set(x, 0, z);
  scene.add(group);
  platforms.push({ x, z, width, depth, top: top + 0.42 });
  return group;
}

island(0, 0, 5, 14, 18);
island(0, 0, -12, 11, 9);
island(2.6, 2.2, -23, 12, 8);
island(-1.5, 0.8, -35, 13, 10);
island(0, 1.25, -47, 17, 12);

function makeCloud(x: number, y: number, z: number, scale: number) {
  const cloud = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf8fdff, roughness: 1 });
  for (const [px, py, pz, size] of [
    [-1.2, 0, 0, 1.3],
    [0, 0.35, 0, 1.75],
    [1.25, 0, 0, 1.25],
    [0.4, -0.1, 0.2, 1.4],
  ] as const) {
    const puff = mesh(new THREE.SphereGeometry(size, 12, 8), cloudMat, false, false);
    puff.position.set(px, py, pz);
    cloud.add(puff);
  }
  cloud.position.set(x, y, z);
  cloud.scale.setScalar(scale);
  scene.add(cloud);
}

makeCloud(-22, 17, -28, 2.6);
makeCloud(23, 14, -42, 2.1);
makeCloud(-24, 11, -62, 1.8);
makeCloud(14, 20, -72, 2.8);

function makeTree(x: number, y: number, z: number, scale = 1) {
  const tree = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.36, 0.5, 3.2, 8), woodMat);
  trunk.position.y = 1.6;
  tree.add(trunk);
  const crown = new THREE.Group();
  for (const [px, py, pz, radius, color] of [
    [0, 0.8, 0, 1.65, leafMat],
    [-1, 0.1, 0, 1.2, leafMat],
    [1, 0.05, 0.1, 1.15, leafLightMat],
    [0.2, 0.1, 0.8, 1.3, leafLightMat],
  ] as const) {
    const ball = mesh(new THREE.DodecahedronGeometry(radius, 1), color);
    ball.position.set(px, py, pz);
    crown.add(ball);
  }
  crown.position.y = 3.25;
  tree.add(crown);
  tree.position.set(x, y, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
}

makeTree(-4.8, 0.4, 4, 1.15);
makeTree(4.1, 0.4, -11.8, 0.85);
makeTree(-1.6, 2.62, -23.5, 0.95);
makeTree(4.4, 1.22, -35.7, 0.8);
makeTree(-5.7, 1.67, -48.5, 1.15);

function flower(x: number, y: number, z: number, color: number) {
  const group = new THREE.Group();
  const stem = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), mat(0x3d902d), false);
  stem.position.y = 0.25;
  group.add(stem);
  for (let i = 0; i < 5; i += 1) {
    const petal = mesh(new THREE.SphereGeometry(0.12, 7, 5), mat(color), false);
    petal.position.set(Math.cos((i * Math.PI * 2) / 5) * 0.17, 0.58, Math.sin((i * Math.PI * 2) / 5) * 0.17);
    group.add(petal);
  }
  const center = mesh(new THREE.SphereGeometry(0.09, 7, 5), goldMat, false);
  center.position.y = 0.6;
  group.add(center);
  group.position.set(x, y, z);
  scene.add(group);
}

const flowerPositions: Array<[number, number, number, number]> = [
  [-4, 0.5, 0, 0xff6b82], [4, 0.5, 5, 0xffdf58], [-3, 0.5, -10, 0xffffff],
  [5, 2.7, -24, 0xff7993], [-4, 1.3, -34, 0xffdd59], [3, 1.75, -47, 0xffffff],
];
for (const flowerPosition of flowerPositions) flower(...flowerPosition);

function bridge(z: number, length: number, y: number) {
  const group = new THREE.Group();
  const plankCount = Math.ceil(length / 0.82);
  for (let index = 0; index < plankCount; index += 1) {
    const plank = roundedBox(5.4, 0.24, 0.72, 0.1, index % 2 ? woodMat : woodLightMat);
    plank.position.set(Math.sin(index * 1.7) * 0.08, y, z - index * 0.79);
    plank.rotation.y = Math.sin(index * 2.3) * 0.016;
    group.add(plank);
  }
  for (const x of [-2.55, 2.55]) {
    const rail = mesh(new THREE.CylinderGeometry(0.08, 0.08, length, 8), woodMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(x, y - 0.2, z - length / 2 + 0.4);
    group.add(rail);
  }
  scene.add(group);
}

bridge(-2.6, 5.2, 0.6);
bridge(-16.2, 4.8, 1.15);
bridge(-28.1, 4.2, 1.9);
bridge(-40.4, 3.5, 1.55);

function makeFox() {
  const fox = new THREE.Group();
  const orange = mat(0xe97822);
  const cream = mat(0xffe0ad);
  const dark = mat(0x5a321e);
  const blue = mat(0x276fbb);
  const body = mesh(new THREE.SphereGeometry(0.66, 16, 12), blue);
  body.scale.set(0.85, 1.05, 0.75);
  body.position.y = 1.05;
  fox.add(body);
  const head = mesh(new THREE.SphereGeometry(0.62, 16, 12), orange);
  head.scale.set(0.95, 0.9, 0.92);
  head.position.set(0, 1.83, -0.08);
  fox.add(head);
  const muzzle = mesh(new THREE.SphereGeometry(0.34, 14, 10), cream);
  muzzle.scale.set(1.15, 0.7, 0.8);
  muzzle.position.set(0, 1.7, -0.52);
  fox.add(muzzle);
  const nose = mesh(new THREE.SphereGeometry(0.105, 10, 8), dark);
  nose.position.set(0, 1.75, -0.82);
  fox.add(nose);
  for (const x of [-0.27, 0.27]) {
    const ear = mesh(new THREE.ConeGeometry(0.25, 0.55, 4), orange);
    ear.position.set(x, 2.37, -0.03);
    ear.rotation.y = Math.PI / 4;
    fox.add(ear);
    const eye = mesh(new THREE.SphereGeometry(0.07, 8, 6), dark);
    eye.position.set(x * 0.72, 1.95, -0.57);
    fox.add(eye);
  }
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.34, 0.34]) {
    const leg = mesh(new THREE.CapsuleGeometry(0.15, 0.38, 6, 8), orange);
    leg.position.set(x, 0.44, 0);
    fox.add(leg);
    legs.push(leg);
  }
  const tail = new THREE.Group();
  const tailMain = mesh(new THREE.CapsuleGeometry(0.26, 1.05, 8, 12), orange);
  tailMain.rotation.z = Math.PI / 2.8;
  tailMain.position.set(-0.72, 1.1, 0.35);
  tail.add(tailMain);
  const tip = mesh(new THREE.SphereGeometry(0.27, 12, 9), cream);
  tip.position.set(-1.13, 1.45, 0.35);
  tail.add(tip);
  fox.add(tail);
  fox.userData.legs = legs;
  fox.userData.tail = tail;
  return fox;
}

const player = makeFox();
player.position.set(0, 0.43, 9);
scene.add(player);

function makeCoin(x: number, y: number, z: number) {
  const coin = new THREE.Group();
  const disc = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 24), goldMat);
  disc.rotation.z = Math.PI / 2;
  coin.add(disc);
  const ring = mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 24), goldEdgeMat);
  ring.rotation.y = Math.PI / 2;
  coin.add(ring);
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? 0.2 : 0.085;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) star.moveTo(px, py);
    else star.lineTo(px, py);
  }
  star.closePath();
  const emblem = mesh(new THREE.ShapeGeometry(star), mat(0xffed72, 0.25, 0.15), false);
  emblem.rotation.y = Math.PI / 2;
  emblem.position.x = -0.075;
  coin.add(emblem);
  coin.position.set(x, y, z);
  scene.add(coin);
  return coin;
}

const coinPositions: Array<[number, number, number]> = [
  [0, 1.45, 3], [0, 1.45, -0.5], [-0.6, 1.5, -9.7], [0.6, 1.5, -13.1],
  [0.7, 3.7, -20.7], [-0.7, 3.7, -24.2], [-0.6, 2.3, -34], [0, 2.8, -44.5],
];
const coins = coinPositions.map((position, index) => ({
  id: `coin-${index + 1}`,
  object: makeCoin(...position),
  collected: false,
}));

function mushroom() {
  const group = new THREE.Group();
  const body = mesh(new THREE.CapsuleGeometry(0.46, 0.55, 8, 12), mat(0xf0c892));
  body.position.y = 0.65;
  group.add(body);
  const cap = mesh(new THREE.SphereGeometry(0.8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe54835));
  cap.position.y = 1.15;
  group.add(cap);
  for (const x of [-0.25, 0.25]) {
    const spot = mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xfff1cf), false);
    spot.position.set(x, 1.52, -0.42);
    group.add(spot);
    const eye = mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(0x3b2a22), false);
    eye.position.set(x * 0.65, 0.82, -0.44);
    group.add(eye);
  }
  return group;
}

const hazard = mushroom();
hazard.position.set(-2.4, 0.43, -12.5);
scene.add(hazard);

function goalGate() {
  const group = new THREE.Group();
  for (const x of [-2.2, 2.2]) {
    const post = mesh(new THREE.CylinderGeometry(0.22, 0.3, 4.8, 10), woodMat);
    post.position.set(x, 2.4, 0);
    group.add(post);
  }
  const beam = roundedBox(5.2, 0.5, 0.5, 0.16, woodLightMat);
  beam.position.y = 4.6;
  group.add(beam);
  const banner = roundedBox(3.9, 1.2, 0.12, 0.2, mat(0x39a8dc));
  banner.position.set(0, 3.82, 0.05);
  group.add(banner);
  const star = mesh(new THREE.OctahedronGeometry(0.48), goldEdgeMat);
  star.position.set(0, 3.85, -0.12);
  star.scale.set(1, 1.3, 0.35);
  group.add(star);
  group.position.set(0, 1.67, -49.5);
  scene.add(group);
  return group;
}

const goal = goalGate();

const keys = new Set<string>();
addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "KeyR") restartGame();
});
addEventListener("keyup", (event) => keys.delete(event.code));

const state = {
  coins: 0,
  coinCount: 0,
  collectedCoins: 0,
  totalCoins: coins.length,
  respawns: 0,
  goalReached: false,
  completed: false,
  mission: "playing",
  playerState: "idle",
  grounded: true,
  playerPosition: { x: 0, y: 0.43, z: 9 },
};
const velocity = new THREE.Vector3();
let elapsed = 0;
let toastTimer = 0;
let lastSafe = new THREE.Vector3(0, 0.43, 9);
let currentGround = 0.43;
let hazardEncountered = false;

function groundAt(x: number, z: number) {
  let highest = -Infinity;
  for (const platform of platforms) {
    if (Math.abs(x - platform.x) <= platform.width / 2 - 0.22 && Math.abs(z - platform.z) <= platform.depth / 2 - 0.22) {
      highest = Math.max(highest, platform.top);
    }
  }
  const onBridge =
    Math.abs(x) < 2.55 &&
    ((z < -2.1 && z > -7.9) || (z < -16 && z > -20.5) || (z < -27.7 && z > -31.8) || (z < -40 && z > -43.8));
  if (onBridge) highest = Math.max(highest, z < -16 ? (z < -27 ? 1.72 : 1.05) : 0.55);
  return highest;
}

function updateHud() {
  coinLabel.textContent = `${state.coinCount} / ${state.totalCoins}`;
  if (state.completed) {
    hud.classList.add("complete");
    objectiveLabel.textContent = "Adventure complete!";
    statusLabel.textContent = `${state.coinCount} coins found · Press R to replay`;
  } else {
    hud.classList.remove("complete");
    objectiveLabel.textContent = "Collect the coins & reach the flag!";
    statusLabel.textContent = state.coinCount === state.totalCoins ? "All coins found — head for the gate!" : "Adventure ahead";
  }
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = 1.4;
}

function respawn(message = "Back to safety!") {
  player.position.copy(lastSafe);
  velocity.set(0, 0, 0);
  state.respawns += 1;
  showToast(message);
}

function restartGame() {
  state.coins = 0;
  state.coinCount = 0;
  state.collectedCoins = 0;
  state.respawns = 0;
  state.goalReached = false;
  state.completed = false;
  state.mission = "playing";
  hazardEncountered = false;
  for (const coin of coins) {
    coin.collected = false;
    coin.object.visible = true;
  }
  lastSafe.set(0, 0.43, 9);
  player.position.copy(lastSafe);
  velocity.set(0, 0, 0);
  updateHud();
  showToast("Fresh adventure!");
}

function tick(dt = 1 / 60) {
  elapsed += dt;
  const inputX = Number(keys.has("KeyD")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
  const forward = !state.completed && (keys.has("KeyW") || keys.has("ArrowUp") || keys.has("ArrowRight"));
  const inputZ = Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(forward);
  const input = new THREE.Vector2(inputX, inputZ);
  if (input.lengthSq() > 1) input.normalize();

  const ground = groundAt(player.position.x, player.position.z);
  const grounded = ground > -Infinity && player.position.y <= ground + 0.08 && velocity.y <= 0;
  if (grounded) {
    player.position.y = ground;
    velocity.y = 0;
    currentGround = ground;
    if (keys.has("Space")) velocity.y = 7.7;
    if (Math.abs(player.position.y - ground) < 0.1) lastSafe.set(player.position.x, ground, player.position.z);
  } else {
    velocity.y -= 19 * dt;
  }

  const speed = grounded ? 6.3 : 5.1;
  velocity.x = THREE.MathUtils.damp(velocity.x, input.x * speed, grounded ? 14 : 4, dt);
  velocity.z = THREE.MathUtils.damp(velocity.z, input.y * speed, grounded ? 14 : 4, dt);
  player.position.x += velocity.x * dt;
  player.position.z += velocity.z * dt;
  player.position.y += velocity.y * dt;

  if (input.lengthSq() > 0.01) {
    const targetAngle = Math.atan2(-input.x, -input.y);
    player.rotation.y = THREE.MathUtils.lerp(player.rotation.y, targetAngle, 1 - Math.exp(-12 * dt));
  }

  const moving = input.lengthSq() > 0.01;
  state.grounded = grounded;
  state.playerState = grounded ? (moving ? "running" : "idle") : "jumping";
  const bob = moving && grounded ? Math.abs(Math.sin(elapsed * 11)) * 0.08 : 0;
  const legs = player.userData.legs as THREE.Mesh[];
  legs[0]!.rotation.x = moving ? Math.sin(elapsed * 11) * 0.7 : 0;
  legs[1]!.rotation.x = moving ? -Math.sin(elapsed * 11) * 0.7 : 0;
  (player.userData.tail as THREE.Group).rotation.z = Math.sin(elapsed * 4) * 0.12;
  player.children[0]!.position.y = 1.05 + bob;

  hazard.position.x = Math.sin(elapsed * 1.35) * 0.55;
  hazard.position.y = 0.43 + Math.abs(Math.sin(elapsed * 2.7)) * 0.13;
  hazard.rotation.y = Math.sin(elapsed * 1.35) > 0 ? -0.5 : 0.5;
  if (!hazardEncountered && player.position.distanceTo(hazard.position) < 1.18) {
    hazardEncountered = true;
    respawn("Ouch! Mushroom patrol.");
  }
  if (player.position.y < -9) respawn("Mind the gaps!");

  for (let index = 0; index < coins.length; index += 1) {
    const coin = coins[index]!;
    if (!coin.collected) {
      coin.object.rotation.y = elapsed * 2.4 + index * 0.4;
      coin.object.position.y = coinPositions[index]![1] + Math.sin(elapsed * 3 + index) * 0.12;
      if (player.position.distanceTo(coin.object.position) < 1.45) {
        coin.collected = true;
        coin.object.visible = false;
        state.coinCount += 1;
        state.coins = state.coinCount;
        state.collectedCoins = state.coinCount;
        showToast(state.coinCount === coins.length ? "All coins found!" : `Coin ${state.coinCount} of ${coins.length}`);
        updateHud();
      }
    }
  }

  if (!state.completed && player.position.distanceTo(new THREE.Vector3(0, 1.67, -49.5)) < 3.1) {
    state.goalReached = true;
    if (state.coinCount === state.totalCoins) {
      state.completed = true;
      state.mission = "complete";
      showToast("You did it!");
      updateHud();
    } else {
      showToast(`${state.totalCoins - state.coinCount} coins still out there!`);
    }
  }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toast.classList.remove("show");
  }

  state.playerPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
  currentGround = Number.isFinite(ground) ? ground : currentGround;
}

const diagnostics: Array<Record<string, string>> = [];
addEventListener("error", (event) => diagnostics.push({ level: "error", message: event.message }));
addEventListener("unhandledrejection", (event) => diagnostics.push({ level: "error", message: String(event.reason) }));

const entities = () => [
  { id: "camera.main", object: camera },
  { id: "player", object: player },
  { id: "hazard", object: hazard },
  { id: "goal", object: goal },
  ...coins.map((coin) => ({ id: coin.id, object: coin.object })),
];

installThreePlaytestBridge({
  camera,
  diagnostics: () => diagnostics,
  entities,
  fixedStep: (ticks) => {
    for (let index = 0; index < ticks; index += 1) tick();
  },
  gameplay: () => ({
    animation: { player: { clip: state.playerState, advancedFrames: Math.max(1, Math.floor(elapsed * 60)) } },
    states: { player: state.playerState, mission: state.mission },
  }),
  renderer,
  resources: { read: () => ({ state: { ...state } }) },
  scene,
});

const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  tick(dt);
  desiredCamera.set(player.position.x * 0.45 + 7.2, player.position.y + 6.4, player.position.z + 10.5);
  camera.position.lerp(desiredCamera, 1 - Math.exp(-4.5 * dt));
  cameraTarget.set(player.position.x * 0.35, player.position.y + 1.5, player.position.z - 4.8);
  camera.lookAt(cameraTarget);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
updateHud();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
