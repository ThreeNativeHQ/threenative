import * as THREE from "three";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
import "./styles.css";

type Area = "hub" | "north" | "south";
type PointId = "hub.beacon" | "north.archive" | "south.grove";

interface GameState {
  area: Area;
  inspections: number;
  inspectedPoints: PointId[];
  objectiveComplete: boolean;
  returns: number;
  message: string;
}

interface InterestPoint {
  id: PointId;
  area: Area;
  title: string;
  detail: string;
  position: THREE.Vector3;
  radius: number;
  marker: THREE.Group;
}

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("The #app mount was not found.");
}

const canvas = document.createElement("canvas");
canvas.id = "game-canvas";
canvas.setAttribute("aria-label", "Wayfarer exploration game canvas");
app.append(canvas);

const hud = document.createElement("section");
hud.className = "hud";
hud.setAttribute("aria-label", "Exploration HUD");
hud.innerHTML = `
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <div class="eyebrow">FIELD LOG / 07</div>
        <div class="brand-name">WAYFARER</div>
      </div>
    </div>
    <div class="area-chip"><span class="status-dot"></span><span id="area-label">HUB · BEACON YARD</span></div>
  </header>

  <aside class="objective-card">
    <div class="card-kicker"><span class="signal-icon">✦</span> ACTIVE THREAD</div>
    <h1>Follow the signal</h1>
    <p class="objective-copy">Three traces remain in the valley. Log each one, then return to the beacon.</p>
    <div class="objective-progress">
      <div class="progress-meta"><span>FIELD NOTES</span><span id="progress-count">0 / 3</span></div>
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
    </div>
    <ul class="journal-list" id="journal-list">
      <li data-point="hub.beacon"><span class="journal-check"></span><span>Beacon / hub</span><em>UNREAD</em></li>
      <li data-point="north.archive"><span class="journal-check"></span><span>Archive / north</span><em>UNREAD</em></li>
      <li data-point="south.grove"><span class="journal-check"></span><span>Grove / south</span><em>UNREAD</em></li>
    </ul>
  </aside>

  <div class="message-panel" aria-live="polite">
    <div class="message-rule"></div>
    <div class="message-label">WAYFARER NOTE</div>
    <div class="message-text" id="message-text">The beacon is quiet. Start close to home.</div>
  </div>

  <div class="interaction-panel">
    <div class="interaction-hint" id="interaction-hint">Move toward a marked trace</div>
    <button id="inspect-button" class="inspect-button" type="button" disabled>
      <span class="keycap">E</span><span id="inspect-label">INSPECT TRACE</span><span class="button-arrow">↗</span>
    </button>
  </div>

  <footer class="controls-bar">
    <div class="control-group"><span class="keycap small">W</span><span class="keycap small">A</span><span class="keycap small">S</span><span class="keycap small">D</span><span>move</span></div>
    <div class="control-divider"></div>
    <div class="control-group"><span class="keycap small">E</span><span>inspect</span></div>
    <div class="control-divider"></div>
    <div class="control-group"><span class="mouse-icon">◒</span><span>drag to orbit</span></div>
    <div class="build-tag">NORTHSTAR VALLEY <span>·</span> 01</div>
  </footer>

  <div class="complete-banner" id="complete-banner" hidden>
    <span class="complete-star">✦</span>
    <div><strong>FIELD THREAD COMPLETE</strong><span>All traces logged. The beacon remembers.</span></div>
  </div>
`;
app.append(hud);

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

const areaLabel = query<HTMLElement>("#area-label");
const messageText = query<HTMLElement>("#message-text");
const interactionHint = query<HTMLElement>("#interaction-hint");
const inspectButton = query<HTMLButtonElement>("#inspect-button");
const inspectLabel = query<HTMLElement>("#inspect-label");
const progressCount = query<HTMLElement>("#progress-count");
const progressFill = query<HTMLElement>("#progress-fill");
const journalList = query<HTMLElement>("#journal-list");
const completeBanner = query<HTMLElement>("#complete-banner");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c1629");
scene.fog = new THREE.Fog("#0c1629", 22, 52);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.name = "main";

const state: GameState = {
  area: "hub",
  inspections: 0,
  inspectedPoints: [],
  objectiveComplete: false,
  returns: 0,
  message: "The beacon is quiet. Start close to home.",
};

const world = new THREE.Group();
world.name = "northstar-world";
scene.add(world);

const hubGroup = new THREE.Group();
hubGroup.name = "hub";
const northGroup = new THREE.Group();
northGroup.name = "north";
const southGroup = new THREE.Group();
southGroup.name = "south";
world.add(hubGroup, northGroup, southGroup);

const ambientLight = new THREE.HemisphereLight(0xb9d0e8, 0x16262e, 1.7);
scene.add(ambientLight);

const moonLight = new THREE.DirectionalLight(0xffd5a0, 3.25);
moonLight.position.set(-13, 20, 12);
moonLight.shadow.camera.left = -24;
moonLight.shadow.camera.right = 24;
moonLight.shadow.camera.top = 32;
moonLight.shadow.camera.bottom = -32;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 70;
scene.add(moonLight);

const beaconLight = new THREE.PointLight(0xffca6a, 7, 18, 2);
beaconLight.position.set(0, 5.1, 0);
scene.add(beaconLight);

const northLight = new THREE.PointLight(0x70d9d2, 3.2, 14, 2);
northLight.position.set(0, 3.2, -14);
scene.add(northLight);

const southLight = new THREE.PointLight(0x5bb9a4, 2.5, 16, 2);
southLight.position.set(0, 3, 14);
scene.add(southLight);

function standardMaterial(color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.04, flatShading: true, ...options });
}

function mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material): THREE.Mesh<T, THREE.Material> {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Mesh {
  const object = mesh(new THREE.BoxGeometry(...size), standardMaterial(color, options));
  object.position.set(...position);
  parent.add(object);
  return object;
}

function addCylinder(parent: THREE.Object3D, radius: number, height: number, position: [number, number, number], color: THREE.ColorRepresentation, segments = 12, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Mesh {
  const object = mesh(new THREE.CylinderGeometry(radius, radius * 1.08, height, segments), standardMaterial(color, options));
  object.position.set(...position);
  parent.add(object);
  return object;
}

function addTree(parent: THREE.Object3D, x: number, z: number, scale: number, foliageColor: THREE.ColorRepresentation): void {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  const trunk = mesh(new THREE.CylinderGeometry(0.34, 0.48, 3.8, 7), standardMaterial("#6b4b3b"));
  trunk.position.y = 1.9;
  tree.add(trunk);
  const lower = mesh(new THREE.DodecahedronGeometry(2.25, 1), standardMaterial(foliageColor));
  lower.position.y = 4.25;
  lower.scale.set(1, 0.92, 1);
  tree.add(lower);
  const upper = mesh(new THREE.DodecahedronGeometry(1.62, 1), standardMaterial(foliageColor));
  upper.position.set(0.18, 5.5, 0.08);
  tree.add(upper);
  parent.add(tree);
}

function addLantern(parent: THREE.Object3D, position: [number, number, number], color: THREE.ColorRepresentation): void {
  const lantern = new THREE.Group();
  lantern.position.set(...position);
  addCylinder(lantern, 0.07, 1.6, [0, 0.8, 0], "#475066", 8);
  const glow = mesh(new THREE.SphereGeometry(0.28, 10, 6), standardMaterial(color, { emissive: color, emissiveIntensity: 1.4 }));
  glow.position.y = 1.72;
  lantern.add(glow);
  parent.add(lantern);
}

function addGround(): void {
  const bed = mesh(new THREE.BoxGeometry(38, 0.55, 68), standardMaterial("#101d32"));
  bed.position.set(0, -0.38, 0);
  bed.receiveShadow = true;
  world.add(bed);

  const hubTile = mesh(new THREE.CircleGeometry(10.2, 32), standardMaterial("#1b2c44"));
  hubTile.rotation.x = -Math.PI / 2;
  hubTile.position.y = -0.08;
  hubGroup.add(hubTile);

  const northTile = mesh(new THREE.CircleGeometry(8.8, 24), standardMaterial("#182b3c"));
  northTile.rotation.x = -Math.PI / 2;
  northTile.position.set(0, -0.07, -21.5);
  northGroup.add(northTile);

  const southTile = mesh(new THREE.CircleGeometry(8.8, 24), standardMaterial("#172c39"));
  southTile.rotation.x = -Math.PI / 2;
  southTile.position.set(0, -0.07, 21.5);
  southGroup.add(southTile);

  for (const z of [-12.2, 12.2]) {
    const route = mesh(new THREE.BoxGeometry(5.2, 0.08, 13), standardMaterial("#22364e"));
    route.position.set(0, -0.015, z);
    world.add(route);
    for (const x of [-2.25, 2.25]) {
      const edge = mesh(new THREE.BoxGeometry(0.14, 0.12, 13), standardMaterial("#3c5a68", { emissive: "#1d343f", emissiveIntensity: 0.35 }));
      edge.position.set(x, 0.05, z);
      world.add(edge);
    }
  }

  const hubInlay = mesh(new THREE.RingGeometry(7.2, 7.35, 32), standardMaterial("#3a5960", { emissive: "#182b31", emissiveIntensity: 0.4 }));
  hubInlay.rotation.x = -Math.PI / 2;
  hubInlay.position.y = 0.02;
  hubGroup.add(hubInlay);

  for (const z of [-7.9, 7.9]) {
    const gate = new THREE.Group();
    gate.position.z = z;
    const gateColor = z < 0 ? "#5c7182" : "#536d66";
    addBox(gate, [0.85, 3.2, 0.85], [-3.15, 1.6, 0], gateColor);
    addBox(gate, [0.85, 3.2, 0.85], [3.15, 1.6, 0], gateColor);
    addBox(gate, [7.1, 0.55, 0.9], [0, 3.15, 0], gateColor);
    world.add(gate);
  }
}

function addHubLandmark(): THREE.Object3D {
  const landmark = new THREE.Group();
  landmark.name = "beacon-tower";
  addCylinder(landmark, 3.15, 0.55, [0, 0.27, 0], "#344b5b", 8);
  addBox(landmark, [3.25, 4.7, 2.75], [0, 2.72, 0], "#8c5e3d");
  addBox(landmark, [3.5, 0.38, 3.0], [0, 0.62, 0], "#6e4b3a");
  addBox(landmark, [0.92, 1.85, 0.16], [0, 1.5, 1.42], "#1b2738", { roughness: 0.7 });

  const roof = mesh(new THREE.ConeGeometry(3.15, 2.5, 4), standardMaterial("#c48a4b"));
  roof.position.y = 6.3;
  roof.rotation.y = Math.PI / 4;
  landmark.add(roof);

  const beaconHousing = mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.24, 16), standardMaterial("#f3b85d", { emissive: "#ffbc59", emissiveIntensity: 0.65 }));
  beaconHousing.rotation.x = Math.PI / 2;
  beaconHousing.position.set(0, 4.2, 1.48);
  landmark.add(beaconHousing);
  const beaconCore = mesh(new THREE.SphereGeometry(0.88, 16, 10), standardMaterial("#ffd875", { emissive: "#ffb53d", emissiveIntensity: 1.35, roughness: 0.45 }));
  beaconCore.position.set(0, 4.2, 1.58);
  landmark.add(beaconCore);

  const beaconRing = mesh(new THREE.TorusGeometry(1.32, 0.08, 8, 24), standardMaterial("#f2bc65", { emissive: "#ffba51", emissiveIntensity: 0.8 }));
  beaconRing.position.set(0, 4.2, 1.7);
  beaconRing.rotation.x = Math.PI / 2;
  landmark.add(beaconRing);

  for (const x of [-2.5, 2.5]) {
    addCylinder(landmark, 0.22, 1.15, [x, 0.78, 0], "#62727c", 8);
  }
  hubGroup.add(landmark);
  addLantern(hubGroup, [-5.8, 0, 2.3], "#ffd276");
  addLantern(hubGroup, [5.8, 0, 2.3], "#ffd276");
  return landmark;
}

function addNorthArchive(): THREE.Object3D {
  const archive = new THREE.Group();
  archive.name = "archive";
  archive.position.z = -21.5;
  addBox(archive, [7, 0.38, 4.8], [0, 0.2, 0], "#354c5a");
  for (const x of [-2.75, 2.75]) {
    addBox(archive, [0.9, 4.8, 1.0], [x, 2.55, 0], "#647a85");
  }
  addBox(archive, [6.2, 0.9, 1.15], [0, 5, 0], "#536b78");
  const cap = mesh(new THREE.ConeGeometry(3.85, 1.7, 4), standardMaterial("#3d6471", { emissive: "#15343e", emissiveIntensity: 0.35 }));
  cap.position.y = 6.25;
  cap.rotation.y = Math.PI / 4;
  archive.add(cap);

  const scroll = new THREE.Group();
  scroll.position.set(0, 2.35, 0.72);
  const paper = mesh(new THREE.BoxGeometry(1.9, 1.3, 0.12), standardMaterial("#b9a47a"));
  scroll.add(paper);
  const line = addBox(scroll, [1.1, 0.08, 0.14], [0, 0.1, 0.1], "#5f7980");
  line.rotation.z = -0.2;
  addBox(scroll, [0.78, 0.08, 0.14], [-0.08, -0.17, 0.1], "#5f7980");
  archive.add(scroll);

  for (const x of [-5.2, 5.2]) addLantern(northGroup, [x, 0, -20], "#69d8d0");
  northGroup.add(archive);
  addTree(northGroup, -8.5, -23.5, 1.2, "#1d3f46");
  addTree(northGroup, 8.2, -19.8, 1.1, "#21454b");
  return archive;
}

function addSouthGrove(): THREE.Object3D {
  const grove = new THREE.Group();
  grove.name = "grove";
  grove.position.z = 21.5;
  addCylinder(grove, 3.15, 0.38, [0, 0.2, 0], "#335d59", 12);
  const stone = mesh(new THREE.DodecahedronGeometry(1.85, 0), standardMaterial("#557871"));
  stone.position.set(0, 1.55, 0);
  stone.scale.set(0.85, 1.32, 0.75);
  grove.add(stone);
  const groveCore = mesh(new THREE.SphereGeometry(0.62, 12, 8), standardMaterial("#6de0bd", { emissive: "#4ec99c", emissiveIntensity: 1.45, roughness: 0.42 }));
  groveCore.position.set(0, 2.9, 0.1);
  grove.add(groveCore);
  const groveRing = mesh(new THREE.TorusGeometry(2.25, 0.1, 8, 24), standardMaterial("#6ac5aa", { emissive: "#3e8f79", emissiveIntensity: 0.65 }));
  groveRing.rotation.x = Math.PI / 2;
  groveRing.position.y = 0.75;
  grove.add(groveRing);
  const branch = mesh(new THREE.CylinderGeometry(0.12, 0.16, 3.7, 8), standardMaterial("#5f7e67"));
  branch.position.set(-1.1, 2.3, 0);
  branch.rotation.z = -0.45;
  grove.add(branch);
  const branchTwo = branch.clone();
  branchTwo.position.x = 1.1;
  branchTwo.rotation.z = 0.45;
  grove.add(branchTwo);
  southGroup.add(grove);
  addTree(southGroup, -8.2, 20, 1.18, "#205146");
  addTree(southGroup, 8.5, 24, 1.26, "#1c493f");
  addTree(southGroup, -7.7, 27, 0.8, "#2a6252");
  addTree(southGroup, 7.2, 17.8, 0.78, "#2a6252");
  addLantern(southGroup, [-5.2, 0, 22], "#67d6b1");
  addLantern(southGroup, [5.2, 0, 22], "#67d6b1");
  return grove;
}

function makeLabelTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 640;
  labelCanvas.height = 160;
  const context = labelCanvas.getContext("2d");
  if (!context) throw new Error("Could not create label canvas context.");
  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = "rgba(10, 20, 35, .88)";
  context.beginPath();
  context.roundRect(8, 8, labelCanvas.width - 16, labelCanvas.height - 16, 16);
  context.fill();
  context.fillStyle = accent;
  context.fillRect(24, 32, 5, 94);
  context.font = "600 24px Arial, sans-serif";
  context.letterSpacing = "3px";
  context.fillText(title, 52, 66);
  context.fillStyle = "rgba(214, 225, 226, .66)";
  context.font = "500 18px Arial, sans-serif";
  context.fillText(subtitle, 52, 103);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function addInterestMarker(id: PointId, area: Area, title: string, detail: string, position: [number, number, number], accent: string, radius: number): InterestPoint {
  const marker = new THREE.Group();
  marker.name = id;
  marker.position.set(...position);
  marker.userData.inspectId = id;

  const ring = mesh(new THREE.TorusGeometry(1.05, 0.075, 8, 24), standardMaterial(accent, { emissive: accent, emissiveIntensity: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  ring.userData.inspectId = id;
  marker.add(ring);

  const beacon = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 8), standardMaterial(accent, { emissive: accent, emissiveIntensity: 1.4, transparent: true, opacity: 0.55 }));
  beacon.position.y = 1;
  beacon.userData.inspectId = id;
  marker.add(beacon);

  const halo = mesh(new THREE.SphereGeometry(0.16, 10, 6), standardMaterial(accent, { emissive: accent, emissiveIntensity: 2.1 }));
  halo.position.y = 1.88;
  halo.userData.inspectId = id;
  marker.add(halo);

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(title, detail, accent), transparent: true, depthWrite: false }));
  label.scale.set(3.7, 0.93, 1);
  label.position.set(0, 3.05, 0);
  marker.add(label);
  world.add(marker);

  return { id, area, title, detail, position: new THREE.Vector3(...position), radius, marker };
}

addGround();
addHubLandmark();
addNorthArchive();
addSouthGrove();
addTree(hubGroup, -8.9, -1.4, 1.65, "#1d3d42");
addTree(hubGroup, 8.6, -0.6, 1.56, "#1d3d42");
addTree(hubGroup, -10.2, 5.4, 0.92, "#2d5d58");
addTree(hubGroup, 10.1, 5.7, 0.88, "#2d5d58");

const points: InterestPoint[] = [
  addInterestMarker("hub.beacon", "hub", "BEACON / HUB", "The first signal", [0, 0, 0], "#f5c56c", 6.2),
  addInterestMarker("north.archive", "north", "ARCHIVE / NORTH", "A page in the frost", [0, 0, -21.5], "#6bddd5", 4.7),
  addInterestMarker("south.grove", "south", "GROVE / SOUTH", "A living echo", [0, 0, 21.5], "#72d7ae", 4.7),
];

const player = new THREE.Group();
player.name = "player";
player.position.set(0, 0, 5.4);
player.userData.role = "player";

const playerShadow = mesh(new THREE.CircleGeometry(0.75, 16), new THREE.MeshBasicMaterial({ color: "#07101c", transparent: true, opacity: 0.48, depthWrite: false }));
playerShadow.rotation.x = -Math.PI / 2;
playerShadow.position.y = 0.04;
playerShadow.scale.set(1, 0.58, 1);
player.add(playerShadow);

const playerBody = mesh(new THREE.CapsuleGeometry(0.48, 1.1, 5, 10), standardMaterial("#d3d4c4"));
playerBody.position.y = 1.15;
playerBody.scale.set(0.88, 1, 0.72);
player.add(playerBody);

const playerHead = mesh(new THREE.SphereGeometry(0.43, 12, 8), standardMaterial("#d6a276"));
playerHead.position.y = 2.13;
player.add(playerHead);

const hood = mesh(new THREE.ConeGeometry(0.51, 0.34, 8), standardMaterial("#dd9b54"));
hood.position.y = 2.47;
player.add(hood);

const backpack = addBox(player, [0.64, 0.86, 0.32], [0, 1.18, -0.42], "#345a61");
backpack.rotation.x = -0.08;
const scarf = addBox(player, [0.72, 0.13, 0.55], [0, 1.82, 0.02], "#eca85c");
scarf.rotation.z = -0.06;
const leftLeg = addBox(player, [0.18, 0.56, 0.2], [-0.2, 0.43, 0], "#47626b");
const rightLeg = addBox(player, [0.18, 0.56, 0.2], [0.2, 0.43, 0], "#47626b");
player.add(leftLeg, rightLeg);
world.add(player);

const input = new Set<string>();
let isMoving = false;
let animationFrames = 1;
let walkTime = 0;
let messageTimer = 0;
let lastNearby: InterestPoint | undefined;
const moveSpeed = 0.18;

const areaNames: Record<Area, string> = {
  hub: "HUB · BEACON YARD",
  north: "NORTH · FROST ARCHIVE",
  south: "SOUTH · LUMEN GROVE",
};

const areaColors: Record<Area, string> = {
  hub: "#0c1629",
  north: "#0b1a2b",
  south: "#0a1b23",
};

function setSceneTone(area: Area): void {
  const color = new THREE.Color(areaColors[area]);
  scene.background = color;
  if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(color);
  ambientLight.color.set(area === "south" ? "#a6d8cf" : area === "north" ? "#b8d4ea" : "#b9d0e8");
  renderer.toneMappingExposure = area === "north" ? 1.2 : area === "south" ? 1.16 : 1.12;
}

function pointDistance(point: InterestPoint): number {
  return Math.hypot(player.position.x - point.position.x, player.position.z - point.position.z);
}

function nearbyPoint(): InterestPoint | undefined {
  let closest: InterestPoint | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = pointDistance(point);
    if (distance <= point.radius && distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closest;
}

function setMessage(message: string, duration = 0): void {
  state.message = message;
  messageText.textContent = message;
  messageTimer = duration;
}

function updateJournal(): void {
  progressCount.textContent = `${state.inspections} / 3`;
  progressFill.style.width = `${(state.inspections / 3) * 100}%`;
  for (const item of journalList.querySelectorAll<HTMLElement>("[data-point]")) {
    const id = item.dataset.point as PointId | undefined;
    const inspected = id !== undefined && state.inspectedPoints.includes(id);
    item.classList.toggle("is-complete", inspected);
    const status = item.querySelector("em");
    if (status) status.textContent = inspected ? "LOGGED" : "UNREAD";
  }
  completeBanner.hidden = !state.objectiveComplete;
}

function updateInteractionUi(): void {
  areaLabel.textContent = areaNames[state.area];
  const point = nearbyPoint();
  lastNearby = point;
  if (state.objectiveComplete) {
    interactionHint.textContent = "The route is complete. Return to the beacon.";
  } else if (point) {
    const inspected = state.inspectedPoints.includes(point.id);
    interactionHint.textContent = inspected ? `${point.title} · already logged` : `${point.title} · within reach`;
  } else {
    interactionHint.textContent = state.area === "hub" ? "Move toward a marked trace" : "Follow the route markers";
  }
  inspectButton.disabled = point === undefined || state.objectiveComplete;
  inspectLabel.textContent = point && !state.objectiveComplete ? (state.inspectedPoints.includes(point.id) ? "REVIEW TRACE" : `INSPECT ${point.area.toUpperCase()}`) : "INSPECT TRACE";
}

function markPoint(point: InterestPoint): void {
  if (state.inspectedPoints.includes(point.id)) {
    setMessage(`${point.title} is already in your field log.`);
    return;
  }
  state.inspectedPoints.push(point.id);
  state.inspections = state.inspectedPoints.length;
  state.objectiveComplete = state.inspectedPoints.length === points.length;
  point.marker.userData.inspected = true;
  point.marker.scale.setScalar(0.86);
  point.marker.traverse((object) => {
    const material = object instanceof THREE.Mesh ? object.material : undefined;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissiveIntensity *= 0.5;
    }
  });
  if (state.objectiveComplete) {
    setMessage("Every trace is logged. Return to the beacon and close the loop.");
  } else {
    const remaining = points.length - state.inspections;
    setMessage(`${point.title} added to the field log. ${remaining} trace${remaining === 1 ? "" : "s"} remaining.`);
  }
  updateJournal();
}

function inspectNearby(): void {
  const point = nearbyPoint();
  if (point) markPoint(point);
  else setMessage("Nothing to inspect here. Follow the glowing route markers.");
}

function inspectPointById(id: PointId): void {
  const point = points.find((candidate) => candidate.id === id);
  if (!point) return;
  if (pointDistance(point) <= point.radius) markPoint(point);
  else setMessage(`Walk closer to ${point.title.toLowerCase()} to inspect it.`);
}

function updateArea(): void {
  const previous = state.area;
  let next: Area = previous;
  if (previous === "hub") {
    if (player.position.z < -8.2) next = "north";
    else if (player.position.z > 8.2) next = "south";
  } else if (previous === "north" && player.position.z > -6.7) {
    next = "hub";
  } else if (previous === "south" && player.position.z < 6.7) {
    next = "hub";
  }
  if (next === previous) return;
  if (next === "hub" && previous !== "hub") state.returns += 1;
  state.area = next;
  setSceneTone(next);
  if (next === "hub") setMessage(`Back at the beacon yard. Return ${state.returns} recorded.`);
  else if (next === "north") setMessage("The air turns blue. The frost archive is ahead.");
  else setMessage("The path softens into moss. The lumen grove is ahead.");
}

const cameraTarget = new THREE.Vector3();
let cameraYaw = 0;
let cameraPitch = 0.22;
let cameraDistance = 14.5;

function updateCamera(): void {
  cameraTarget.set(player.position.x, player.position.y + 1.35, player.position.z);
  const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
  camera.position.set(
    cameraTarget.x + Math.sin(cameraYaw) * horizontalDistance,
    cameraTarget.y + 2.1 + Math.sin(cameraPitch) * cameraDistance,
    cameraTarget.z + Math.cos(cameraYaw) * horizontalDistance,
  );
  camera.lookAt(cameraTarget.x, cameraTarget.y + 0.15, cameraTarget.z - 0.8);
}

function simulate(dt: number): void {
  const movement = new THREE.Vector3();
  if (input.has("w") || input.has("arrowup")) movement.z -= 1;
  if (input.has("s") || input.has("arrowdown")) movement.z += 1;
  if (input.has("a") || input.has("arrowleft")) movement.x -= 1;
  if (input.has("d") || input.has("arrowright")) movement.x += 1;
  isMoving = movement.lengthSq() > 0;
  if (isMoving) {
    movement.normalize();
    const sprint = input.has("shift") ? 1.75 : 1;
    const distance = moveSpeed * sprint * dt * 60;
    player.position.x = THREE.MathUtils.clamp(player.position.x + movement.x * distance, -15.5, 15.5);
    player.position.z = THREE.MathUtils.clamp(player.position.z + movement.z * distance, -29, 29);
    player.rotation.y = Math.atan2(movement.x, movement.z);
    walkTime += dt * 11 * sprint;
    leftLeg.rotation.x = Math.sin(walkTime) * 0.42;
    rightLeg.rotation.x = -Math.sin(walkTime) * 0.42;
    playerBody.position.y = 1.15 + Math.abs(Math.sin(walkTime * 2)) * 0.035;
  } else {
    leftLeg.rotation.x = THREE.MathUtils.damp(leftLeg.rotation.x, 0, 10, dt);
    rightLeg.rotation.x = THREE.MathUtils.damp(rightLeg.rotation.x, 0, 10, dt);
    playerBody.position.y = THREE.MathUtils.damp(playerBody.position.y, 1.15, 10, dt);
  }
  animationFrames += 1;
  for (const point of points) {
    const pulse = 1 + Math.sin(performance.now() * 0.003 + point.position.z) * 0.08;
    point.marker.children[0]?.scale.setScalar(pulse);
    point.marker.children[2]?.scale.setScalar(1 + Math.sin(performance.now() * 0.004 + point.position.x) * 0.12);
  }
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) setMessage("The trail is quiet. Keep moving.");
  }
  updateArea();
  updateInteractionUi();
  updateCamera();
}

function keyName(event: KeyboardEvent): string {
  return event.key.toLowerCase();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  const key = keyName(event);
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
    event.preventDefault();
    input.add(key);
  }
  if (key === "e" || key === "enter" || key === " ") {
    event.preventDefault();
    inspectNearby();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  input.delete(keyName(event));
  isMoving = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].some((key) => input.has(key));
}

document.addEventListener("keydown", handleKeyDown, true);
document.addEventListener("keyup", handleKeyUp, true);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

inspectButton.addEventListener("click", inspectNearby);

let pointerStart: { x: number; y: number } | undefined;
let pointerMoved = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
  pointerMoved = false;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerStart) return;
  const deltaX = event.clientX - pointerStart.x;
  const deltaY = event.clientY - pointerStart.y;
  if (Math.abs(deltaX) + Math.abs(deltaY) > 4) pointerMoved = true;
  if (!pointerMoved) return;
  cameraYaw -= (event.movementX || deltaX) * 0.008;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch - (event.movementY || deltaY) * 0.004, -0.05, 0.65);
  pointerStart = { x: event.clientX, y: event.clientY };
});

function interactiveId(object: THREE.Object3D | null): PointId | undefined {
  let current = object;
  while (current) {
    const id = current.userData.inspectId as PointId | undefined;
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

canvas.addEventListener("pointerup", (event) => {
  if (pointerStart && !pointerMoved) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(world.children, true).find((intersection) => interactiveId(intersection.object));
    const id = hit ? interactiveId(hit.object) : undefined;
    if (id) inspectPointById(id);
    else inspectNearby();
  }
  pointerStart = undefined;
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.006, 8, 18);
}, { passive: false });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

setSceneTone(state.area);
updateJournal();
updateInteractionUi();
updateCamera();

function tick(): void {
  simulate(1 / 60);
}

installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities: [{ id: "player", object: player, path: "player" }],
  fixedStep: (ticks: number) => {
    for (let index = 0; index < ticks; index += 1) tick();
  },
  gameplay: () => ({
    animation: { player: { clip: isMoving ? "walk" : "idle", advancedFrames: animationFrames } },
    states: { player: isMoving ? "walking" : "idle", mission: state.objectiveComplete ? "complete" : "playing", area: state.area },
  }),
  renderer,
  resources: { read: () => ({ state: { ...state, inspectedPoints: [...state.inspectedPoints] } }) },
  scene,
});

let lastFrameTime = performance.now();
function renderLoop(frameTime: number): void {
  const delta = Math.min((frameTime - lastFrameTime) / 1000, 0.05);
  lastFrameTime = frameTime;
  simulate(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

renderer.render(scene, camera);
requestAnimationFrame(renderLoop);
