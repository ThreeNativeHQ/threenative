import * as THREE from 'three';
import {
  installThreePlaytestBridge,
  type IThreePlaytestEntity,
  type IThreePlaytestResources,
} from '@threenative/playtest/three';
import './style.css';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type MissionState = 'playing' | 'won';
type PlayerMode = 'idle' | 'moving' | 'attacking';
type PlayerAnimation = 'idle' | 'run' | 'shoot';
type GameplayAnimationClip = 'idle' | 'run' | 'attack';

interface TargetSpec {
  id: string;
  label: string;
  color: number;
  position: [number, number];
}

interface TargetRuntime extends TargetSpec {
  alive: boolean;
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  pulseOffset: number;
}

interface AttackEffect {
  group: THREE.Group;
  beam: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  impact: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface BurstParticle {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
}

interface BurstEffect {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  particles: BurstParticle[];
  life: number;
  maxLife: number;
}

interface GameState {
  mission: MissionState;
  score: number;
  health: number;
  targetsDefeated: number;
  enemiesRemaining: number;
  shots: number;
  reload: number;
  animationFrame: number;
  animationClock: number;
  playerMode: PlayerMode;
  playerAnimation: PlayerAnimation;
  lastAttackAnimation: PlayerAnimation;
  attackAnimationFrames: number;
  lastAction: string;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) {
  throw new Error('The game mount node #app is missing.');
}

app.innerHTML = `
  <main class="game-shell" aria-label="Neon Breaker top-down action arena">
    <canvas class="game-canvas" aria-label="Playable 3D arena"></canvas>
    <section class="hud" aria-live="polite">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand"><span class="brand-mark"></span><span>NEON BREAKER</span></div>
          <div class="brand-sub">TACTICAL ARENA // SECTOR 07</div>
        </div>
        <div class="mission-readout">
          <div class="mission-copy">
            <span class="micro-label">CURRENT OBJECTIVE</span>
            <strong id="mission-label">ELIMINATE 3 SIGNALS</strong>
          </div>
          <span class="mission-chip" id="mission-chip">ACTIVE</span>
        </div>
      </header>

      <aside class="side-panel left-panel">
        <div class="panel-kicker">OPERATOR STATUS / 01</div>
        <div class="health-line">
          <span class="health-label">Hull integrity</span>
          <span class="health-value" id="health-value">100%</span>
        </div>
        <div class="health-track"><div class="health-fill" id="health-fill"></div></div>
        <div class="stats-grid">
          <div class="stat"><span class="stat-label">SCORE</span><span class="stat-value" id="score-value">0000</span></div>
          <div class="stat"><span class="stat-label">TARGETS</span><span class="stat-value" id="target-count">03 / 03</span></div>
        </div>
      </aside>

      <aside class="side-panel right-panel">
        <div class="panel-kicker">MISSION LOG / LIVE</div>
        <div class="objective-title" id="objective-title">Clear the grid</div>
        <p class="objective-copy" id="objective-copy">Lock onto every signal and keep the arena clean.</p>
        <div class="target-list">
          <div class="target-row" id="target-row-1" data-status="live"><span class="target-dot"></span><span>TGT 01 / NORTHWEST</span></div>
          <div class="target-row" id="target-row-2" data-status="live"><span class="target-dot"></span><span>TGT 02 / EAST RIDGE</span></div>
          <div class="target-row" id="target-row-3" data-status="live"><span class="target-dot"></span><span>TGT 03 / SOUTHEAST</span></div>
        </div>
      </aside>

      <div class="crosshair" id="crosshair" aria-hidden="true"></div>

      <footer class="bottom-bar">
        <div class="controls">
          <span class="control-group"><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span><span class="control-label">MOVE</span></span>
          <span class="control-group"><span class="key">LMB</span><span class="control-label">AIM / FIRE</span></span>
          <span class="control-group"><span class="key">R</span><span class="control-label">RESET</span></span>
        </div>
        <div class="cooldown-readout">
          <span id="cooldown-label">WEAPON READY // CLICK TO FIRE</span>
          <span class="cooldown-track"><span class="cooldown-fill" id="cooldown-fill"></span></span>
        </div>
      </footer>

      <div class="notification" id="notification">
        <strong id="notification-title">MISSION COMPLETE</strong>
        <span id="notification-copy">All hostile signals neutralized // Sector 07 secured</span>
        <button class="restart-button" id="restart-button" type="button">Run it again [R]</button>
      </div>
    </section>
  </main>
`;

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Required UI element '${selector}' is missing.`);
  }
  return element;
}

const shell = getElement<HTMLElement>('.game-shell');
const canvas = getElement<HTMLCanvasElement>('.game-canvas');
const missionLabel = getElement<HTMLElement>('#mission-label');
const missionChip = getElement<HTMLElement>('#mission-chip');
const healthValue = getElement<HTMLElement>('#health-value');
const healthFill = getElement<HTMLElement>('#health-fill');
const scoreValue = getElement<HTMLElement>('#score-value');
const targetCount = getElement<HTMLElement>('#target-count');
const objectiveTitle = getElement<HTMLElement>('#objective-title');
const objectiveCopy = getElement<HTMLElement>('#objective-copy');
const cooldownLabel = getElement<HTMLElement>('#cooldown-label');
const cooldownFill = getElement<HTMLElement>('#cooldown-fill');
const crosshair = getElement<HTMLElement>('#crosshair');
const notification = getElement<HTMLElement>('#notification');
const notificationTitle = getElement<HTMLElement>('#notification-title');
const notificationCopy = getElement<HTMLElement>('#notification-copy');
const restartButton = getElement<HTMLButtonElement>('#restart-button');
const targetRows = [
  getElement<HTMLElement>('#target-row-1'),
  getElement<HTMLElement>('#target-row-2'),
  getElement<HTMLElement>('#target-row-3'),
];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.setClearColor(0x070f20, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070f20);
scene.fog = new THREE.Fog(0x070f20, 26, 47);

const cameraFrustum = 19;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
camera.position.set(0, 17, 17);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.HemisphereLight(0x9ac5ff, 0x071020, 2.5);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xcbe7ff, 3.6);
keyLight.position.set(-7, 18, 9);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -17;
keyLight.shadow.camera.right = 17;
keyLight.shadow.camera.top = 17;
keyLight.shadow.camera.bottom = -17;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 48;
scene.add(keyLight);

const cyanLight = new THREE.PointLight(0x28e5ed, 12, 13, 2);
cyanLight.position.set(-7, 3, -3);
scene.add(cyanLight);
const amberLight = new THREE.PointLight(0xffa631, 10, 11, 2);
amberLight.position.set(7, 2.8, 3);
scene.add(amberLight);

const ARENA_X = 12;
const ARENA_Z = 8;
const FIRE_COOLDOWN = 0.5;
const FIXED_DT = 1 / 60;
const MOVE_SPEED = 4.8;

const state: GameState = {
  mission: 'playing',
  score: 0,
  health: 100,
  targetsDefeated: 0,
  enemiesRemaining: 3,
  shots: 0,
  reload: 0,
  animationFrame: 0,
  animationClock: 0,
  playerMode: 'idle',
  playerAnimation: 'idle',
  lastAttackAnimation: 'idle',
  attackAnimationFrames: 0,
  lastAction: 'READY',
};

const pressedKeys = new Set<string>();
const pointer = new THREE.Vector2();
const aimPoint = new THREE.Vector3(-4, 0, 0);
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const groundIntersection = new THREE.Vector3();
const effects: AttackEffect[] = [];
const bursts: BurstEffect[] = [];
let pointerHeld = false;
let muzzleTimer = 0;
let movementGrace = 0;

function makeStandardMaterial(color: number, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.64,
    metalness: 0.24,
    ...options,
  });
}

function makeBasicMaterial(color: number, options: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...options });
}

function markRenderable(object: THREE.Object3D, castShadow = true): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = castShadow;
      child.receiveShadow = true;
    }
  });
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh<THREE.BoxGeometry, THREE.Material> {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addFloorPanel(
  parent: THREE.Object3D,
  size: [number, number],
  position: [number, number, number],
  color: number,
  opacity = 1,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(...size),
    makeBasicMaterial(color, { transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function createArena(): void {
  const arena = new THREE.Group();
  arena.name = 'arena';
  scene.add(arena);

  addBox(arena, [24, 0.36, 16], [0, -0.2, 0], makeStandardMaterial(0x172946, { roughness: 0.88 }), false);
  addFloorPanel(arena, [23.35, 15.35], [0, 0.012, 0], 0x1b3153);

  const borderMaterial = makeStandardMaterial(0x2d4c78, { emissive: 0x0d1b36, emissiveIntensity: 0.5, roughness: 0.48 });
  addBox(arena, [23.4, 0.24, 0.17], [0, 0.1, -7.7], borderMaterial);
  addBox(arena, [23.4, 0.24, 0.17], [0, 0.1, 7.7], borderMaterial);
  addBox(arena, [0.17, 0.24, 15.2], [-11.65, 0.1, 0], borderMaterial);
  addBox(arena, [0.17, 0.24, 15.2], [11.65, 0.1, 0], borderMaterial);

  const gridPositions: number[] = [];
  for (let x = -10; x <= 10; x += 2) {
    gridPositions.push(x, 0.043, -7.2, x, 0.043, 7.2);
  }
  for (let z = -6; z <= 6; z += 2) {
    gridPositions.push(-11.2, 0.043, z, 11.2, 0.043, z);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  arena.add(new THREE.LineSegments(gridGeometry, makeBasicMaterial(0x33577f, { transparent: true, opacity: 0.24 })));

  const laneMaterial = makeBasicMaterial(0x345a8b, { transparent: true, opacity: 0.78 });
  addFloorPanel(arena, [2.8, 14.3], [0, 0.055, 0], 0x345a8b, 0.8);
  addFloorPanel(arena, [0.045, 14.25], [-1.4, 0.07, 0], 0x6aa6da, 0.55);
  addFloorPanel(arena, [0.045, 14.25], [1.4, 0.07, 0], 0x6aa6da, 0.55);
  addFloorPanel(arena, [0.8, 0.04], [0, 0.073, -6.5], 0x6aa6da, 0.5).material = laneMaterial;
  addFloorPanel(arena, [0.8, 0.04], [0, 0.073, 6.5], 0x6aa6da, 0.5).material = laneMaterial;

  const wallMaterial = makeStandardMaterial(0x25466f, { emissive: 0x10284c, emissiveIntensity: 0.72, roughness: 0.52 });
  const wallTopMaterial = makeStandardMaterial(0x38649a, { emissive: 0x12305b, emissiveIntensity: 0.7, roughness: 0.45 });
  addBox(arena, [2.65, 0.9, 14.05], [0, 0.48, 0], wallMaterial);
  addBox(arena, [2.35, 0.12, 13.7], [0, 0.99, 0], wallTopMaterial);
  addBox(arena, [0.14, 0.12, 13.1], [-1.32, 1.05, 0], makeStandardMaterial(0x4e80b2, { emissive: 0x214b7d, emissiveIntensity: 0.75 }));
  addBox(arena, [0.14, 0.12, 13.1], [1.32, 1.05, 0], makeStandardMaterial(0x4e80b2, { emissive: 0x214b7d, emissiveIntensity: 0.75 }));

  const sideCoverMaterial = makeStandardMaterial(0x203d64, { emissive: 0x0e2444, emissiveIntensity: 0.6, roughness: 0.58 });
  addBox(arena, [6.1, 0.66, 0.85], [-7.9, 0.33, -6.45], sideCoverMaterial);
  addBox(arena, [6.1, 0.66, 0.85], [-7.9, 0.33, 6.45], sideCoverMaterial);
  addBox(arena, [6.1, 0.66, 0.85], [7.9, 0.33, -6.45], sideCoverMaterial);
  addBox(arena, [6.1, 0.66, 0.85], [7.9, 0.33, 6.45], sideCoverMaterial);

  const cyanStrip = makeBasicMaterial(0x35dfe8, { transparent: true, opacity: 0.88 });
  const amberStrip = makeBasicMaterial(0xffbf3d, { transparent: true, opacity: 0.9 });
  addBox(arena, [4.9, 0.025, 0.05], [-7.9, 0.7, -6.0], cyanStrip, false);
  addBox(arena, [4.9, 0.025, 0.05], [-7.9, 0.7, 6.0], cyanStrip, false);
  addBox(arena, [4.9, 0.025, 0.05], [7.9, 0.7, -6.0], amberStrip, false);
  addBox(arena, [4.9, 0.025, 0.05], [7.9, 0.7, 6.0], amberStrip, false);

  const markerMaterial = makeBasicMaterial(0x74a9d9, { transparent: true, opacity: 0.56 });
  for (const x of [-9.8, 9.8]) {
    for (const z of [-4.8, 4.8]) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.43, 4), markerMaterial);
      marker.rotation.x = -Math.PI / 2;
      marker.rotation.z = Math.PI / 4;
      marker.position.set(x, 0.08, z);
      arena.add(marker);
    }
  }

  const laneLight = new THREE.PointLight(0x3778cf, 4, 9, 2);
  laneLight.position.set(0, 1.6, 0);
  arena.add(laneLight);
}

function createPickup(position: [number, number], color: number, labelColor: number): void {
  const pickup = new THREE.Group();
  pickup.name = `pickup-${position[0]}-${position[1]}`;
  pickup.position.set(position[0], 0, position[1]);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.62, 0.12, 8),
    makeStandardMaterial(0x203f68, { emissive: 0x0d2243, emissiveIntensity: 0.5 }),
  );
  base.position.y = 0.08;
  pickup.add(base);
  const cell = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.58, 0.34),
    makeStandardMaterial(color, { emissive: color, emissiveIntensity: 1.2, roughness: 0.3 }),
  );
  cell.position.y = 0.46;
  cell.rotation.y = Math.PI / 4;
  pickup.add(cell);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.025, 6, 28),
    makeBasicMaterial(labelColor, { transparent: true, opacity: 0.85 }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.16;
  pickup.add(halo);
  pickup.userData['baseY'] = 0.08;
  markRenderable(pickup);
  scene.add(pickup);
}

createArena();
createPickup([-8.5, 1.1], 0x2be0e9, 0x75f5ef);
createPickup([7.9, 0.1], 0xffbf3d, 0xffda73);
createPickup([-3.7, -5.1], 0x8bd4ff, 0x61aaf0);

const player = new THREE.Group();
player.name = 'player';
player.position.set(-7.2, 0, -3.0);
scene.add(player);

const playerShadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.76, 24),
  makeBasicMaterial(0x030914, { transparent: true, opacity: 0.54, depthWrite: false }),
);
playerShadow.rotation.x = -Math.PI / 2;
playerShadow.position.y = 0.025;
playerShadow.scale.set(1.25, 0.7, 1);
player.add(playerShadow);

const playerBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.53, 0.66, 0.74, 8),
  makeStandardMaterial(0x2be0e9, { emissive: 0x087e91, emissiveIntensity: 1.15, metalness: 0.42, roughness: 0.28 }),
);
playerBody.position.y = 0.66;
playerBody.castShadow = true;
playerBody.receiveShadow = true;
player.add(playerBody);

const playerTop = new THREE.Mesh(
  new THREE.CylinderGeometry(0.39, 0.48, 0.13, 8),
  makeStandardMaterial(0x86fbef, { emissive: 0x20c7ce, emissiveIntensity: 1.3, roughness: 0.24 }),
);
playerTop.position.y = 1.08;
player.add(playerTop);

const playerRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.67, 0.045, 6, 28),
  makeBasicMaterial(0x6ffbf0, { transparent: true, opacity: 0.9 }),
);
playerRing.rotation.x = -Math.PI / 2;
playerRing.position.y = 0.15;
player.add(playerRing);

const playerArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.68, 4),
  makeStandardMaterial(0xfff4d0, { emissive: 0xffbf3d, emissiveIntensity: 1.4, roughness: 0.24 }),
);
playerArrow.rotation.x = Math.PI / 2;
playerArrow.position.set(0, 0.82, 0.48);
player.add(playerArrow);

const muzzleFlash = new THREE.Group();
muzzleFlash.position.set(0, 0.76, 0.83);
muzzleFlash.visible = false;
const muzzleCone = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.64, 6),
  makeBasicMaterial(0xfff1b2, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
);
muzzleCone.rotation.x = Math.PI / 2;
muzzleFlash.add(muzzleCone);
const muzzleRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.19, 0.035, 5, 18),
  makeBasicMaterial(0x2be0e9, { transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
);
muzzleRing.rotation.y = Math.PI / 2;
muzzleFlash.add(muzzleRing);
player.add(muzzleFlash);
markRenderable(player);

const targetSpecs: TargetSpec[] = [
  { id: 'target-1', label: 'TGT 01 / NORTHWEST', color: 0xffbd37, position: [-6.7, 2.25] },
  { id: 'target-2', label: 'TGT 02 / EAST RIDGE', color: 0xff5360, position: [6.4, 3.15] },
  { id: 'target-3', label: 'TGT 03 / SOUTHEAST', color: 0xff5360, position: [6.7, -2.85] },
];

function createTarget(spec: TargetSpec, index: number): TargetRuntime {
  const group = new THREE.Group();
  group.name = spec.id;
  group.position.set(spec.position[0], 0, spec.position[1]);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.2, 10),
    makeStandardMaterial(0x273e61, { emissive: 0x111d38, emissiveIntensity: 0.8, roughness: 0.5 }),
  );
  base.position.y = 0.12;
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.77, 0.045, 6, 32),
    makeBasicMaterial(spec.color, { transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.26;
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 20, 14),
    makeStandardMaterial(spec.color, { emissive: spec.color, emissiveIntensity: 1.6, metalness: 0.1, roughness: 0.28 }),
  );
  core.position.y = 0.78;
  group.add(core);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 0.13, 8),
    makeStandardMaterial(0xfff0c3, { emissive: spec.color, emissiveIntensity: 1.2, roughness: 0.22 }),
  );
  cap.position.y = 1.34;
  group.add(cap);

  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.32, 0.08),
    makeBasicMaterial(0xfff4cf, { transparent: true, opacity: 0.86 }),
  );
  beacon.position.y = 1.52;
  group.add(beacon);

  markRenderable(group);
  scene.add(group);
  return { ...spec, alive: true, group, core, ring, pulseOffset: index * 1.7 };
}

const targets = targetSpecs.map(createTarget);

const entityEntries: IThreePlaytestEntity[] = [
  { id: 'player', object: player, path: 'arena/player' },
  ...targets.map((target) => ({ id: target.id, object: target.group, path: `arena/${target.id}` })),
  { id: 'target1', object: targets[0]?.group ?? player, path: 'arena/target-1' },
  { id: 'target2', object: targets[1]?.group ?? player, path: 'arena/target-2' },
  { id: 'target3', object: targets[2]?.group ?? player, path: 'arena/target-3' },
  { id: 'target-a', object: targets[0]?.group ?? player, path: 'arena/target-1' },
  { id: 'target-b', object: targets[1]?.group ?? player, path: 'arena/target-2' },
  { id: 'target-c', object: targets[2]?.group ?? player, path: 'arena/target-3' },
  { id: 'enemy-1', object: targets[0]?.group ?? player, path: 'arena/target-1' },
  { id: 'enemy-2', object: targets[1]?.group ?? player, path: 'arena/target-2' },
  { id: 'enemy-3', object: targets[2]?.group ?? player, path: 'arena/target-3' },
];

function resize(): void {
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const halfHeight = cameraFrustum / 2;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

resize();
window.addEventListener('resize', resize);

function updateAim(clientX: number, clientY: number): void {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
  pointer.y = -((clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(groundPlane, groundIntersection) !== null) {
    aimPoint.copy(groundIntersection);
    const dx = aimPoint.x - player.position.x;
    const dz = aimPoint.z - player.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      player.rotation.y = Math.atan2(dx, dz);
    }
  }
  crosshair.style.left = `${clientX}px`;
  crosshair.style.top = `${clientY}px`;
  crosshair.classList.add('visible');
}

function distanceToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (lengthSquared < 0.0001) {
    return Math.hypot(point.x - start.x, point.z - start.z);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared));
  const closestX = start.x + segmentX * t;
  const closestZ = start.z + segmentZ * t;
  return Math.hypot(point.x - closestX, point.z - closestZ);
}

function spawnAttackEffect(start: THREE.Vector3, end: THREE.Vector3, color: number): void {
  const group = new THREE.Group();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const length = Math.max(start.distanceTo(end), 0.1);
  group.position.copy(midpoint);
  group.position.y = 0.8;
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.075, 0.075),
    makeBasicMaterial(color, { transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.scale.x = length;
  beam.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  group.add(beam);
  const impact = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 8),
    makeBasicMaterial(0xfff7d6, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  impact.position.set((end.x - midpoint.x), 0, (end.z - midpoint.z));
  group.add(impact);
  scene.add(group);
  effects.push({ group, beam, impact, life: 0.17, maxLife: 0.17 });
}

function spawnBurst(position: THREE.Vector3, color: number): void {
  const group = new THREE.Group();
  group.position.set(position.x, 0.34, position.z);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.25, 24),
    makeBasicMaterial(color, { transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  const particles: BurstParticle[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      makeBasicMaterial(color, { transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    particle.position.y = 0.2;
    group.add(particle);
    particles.push({ mesh: particle, velocity: new THREE.Vector3(Math.cos(angle) * 2.5, 1.2 + (index % 3) * 0.3, Math.sin(angle) * 2.5) });
  }
  scene.add(group);
  bursts.push({ group, ring, particles, life: 0.65, maxLife: 0.65 });
}

function resolveShotTarget(start: THREE.Vector3, pointerEnd: THREE.Vector3): TargetRuntime | undefined {
  let pointerTarget: TargetRuntime | undefined;
  let pointerTargetDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (!target.alive) {
      continue;
    }
    const targetPosition = target.group.position;
    const distance = distanceToSegment(targetPosition, start, pointerEnd);
    const startDistance = Math.hypot(targetPosition.x - start.x, targetPosition.z - start.z);
    if (distance < 1.36 && startDistance < pointerTargetDistance) {
      pointerTarget = target;
      pointerTargetDistance = startDistance;
    }
  }
  if (pointerTarget !== undefined) {
    return pointerTarget;
  }

  let nearestTarget: TargetRuntime | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (!target.alive) {
      continue;
    }
    const targetPosition = target.group.position;
    const startDistance = Math.hypot(targetPosition.x - start.x, targetPosition.z - start.z);
    if (startDistance < nearestDistance) {
      nearestTarget = target;
      nearestDistance = startDistance;
    }
  }
  return nearestTarget;
}

function fire(): void {
  if (state.mission === 'won' || state.reload > 0.001) {
    return;
  }
  const start = player.localToWorld(new THREE.Vector3(0, 0.76, 0.79));
  const pointerEnd = aimPoint.clone();
  pointerEnd.y = 0.8;
  const hitTarget = resolveShotTarget(start, pointerEnd);
  const end = hitTarget?.group.position.clone() ?? pointerEnd;
  end.y = 0.8;
  state.shots += 1;
  state.reload = FIRE_COOLDOWN;
  state.lastAction = 'FIRE';
  state.playerMode = 'attacking';
  state.playerAnimation = 'shoot';
  state.lastAttackAnimation = 'shoot';
  state.attackAnimationFrames = 0;
  muzzleTimer = 0.11;
  muzzleFlash.visible = true;
  spawnAttackEffect(start, end, 0x6efbf1);

  if (hitTarget !== undefined) {
    hitTarget.alive = false;
    hitTarget.group.visible = false;
    state.targetsDefeated += 1;
    state.enemiesRemaining = targets.length - state.targetsDefeated;
    state.score += 100;
    state.lastAction = `TARGET ${state.targetsDefeated} DOWN`;
    spawnBurst(hitTarget.group.position, hitTarget.color);
    if (state.enemiesRemaining === 0) {
      state.mission = 'won';
      showWinState();
    }
  }
}

function showWinState(): void {
  missionLabel.textContent = 'SECTOR 07 SECURED';
  missionChip.textContent = 'CLEAR';
  missionChip.classList.add('complete');
  notificationTitle.textContent = 'MISSION COMPLETE';
  notificationCopy.textContent = `All hostile signals neutralized // ${state.score.toString().padStart(4, '0')} points logged`;
  notification.classList.add('visible');
}

function resetGame(): void {
  state.mission = 'playing';
  state.score = 0;
  state.health = 100;
  state.targetsDefeated = 0;
  state.enemiesRemaining = targets.length;
  state.shots = 0;
  state.reload = 0;
  state.playerMode = 'idle';
  state.playerAnimation = 'idle';
  state.lastAttackAnimation = 'idle';
  state.attackAnimationFrames = 0;
  state.lastAction = 'READY';
  movementGrace = 0;
  player.position.set(-7.2, 0, -3.0);
  player.rotation.y = 0.74;
  aimPoint.set(-3.5, 0, 0);
  for (const target of targets) {
    target.alive = true;
    target.group.visible = true;
    target.group.position.set(target.position[0], 0, target.position[1]);
  }
  for (const effect of effects) {
    scene.remove(effect.group);
  }
  effects.length = 0;
  for (const burst of bursts) {
    scene.remove(burst.group);
  }
  bursts.length = 0;
  notification.classList.remove('visible');
  missionLabel.textContent = 'ELIMINATE 3 SIGNALS';
  missionChip.textContent = 'ACTIVE';
  missionChip.classList.remove('complete');
  muzzleFlash.visible = false;
  muzzleTimer = 0;
  updateHud();
}

function updateEffects(dt: number): void {
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    if (effect === undefined) {
      continue;
    }
    effect.life -= dt;
    const progress = Math.max(0, effect.life / effect.maxLife);
    effect.beam.material.opacity = progress * 0.96;
    effect.impact.material.opacity = progress;
    effect.impact.scale.setScalar(1 + (1 - progress) * 1.8);
    if (effect.life <= 0) {
      scene.remove(effect.group);
      effects.splice(index, 1);
    }
  }

  for (let index = bursts.length - 1; index >= 0; index -= 1) {
    const burst = bursts[index];
    if (burst === undefined) {
      continue;
    }
    burst.life -= dt;
    const progress = Math.max(0, burst.life / burst.maxLife);
    burst.ring.scale.setScalar(1 + (1 - progress) * 4.5);
    burst.ring.material.opacity = progress;
    for (const particle of burst.particles) {
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.velocity.y -= 3.4 * dt;
      particle.mesh.material.opacity = progress;
    }
    if (burst.life <= 0) {
      scene.remove(burst.group);
      bursts.splice(index, 1);
    }
  }
}

function updateHud(): void {
  const health = Math.max(0, Math.round(state.health));
  healthValue.textContent = `${health}%`;
  healthFill.style.width = `${health}%`;
  scoreValue.textContent = state.score.toString().padStart(4, '0');
  targetCount.textContent = `${state.enemiesRemaining.toString().padStart(2, '0')} / 03`;
  const cooldownRatio = Math.max(0, Math.min(1, state.reload / FIRE_COOLDOWN));
  cooldownFill.style.transform = `scaleX(${1 - cooldownRatio})`;
  if (state.mission === 'won') {
    cooldownLabel.textContent = 'SECTOR SECURED // WEAPON SAFE';
    objectiveTitle.textContent = 'Grid cleared';
    objectiveCopy.textContent = 'All signal targets are offline. Hold the line.';
  } else if (state.reload > 0.001) {
    cooldownLabel.textContent = `RECHARGING // ${(state.reload * 1000).toFixed(0)}MS`;
    objectiveTitle.textContent = 'Clear the grid';
    objectiveCopy.textContent = `${state.enemiesRemaining} signal${state.enemiesRemaining === 1 ? '' : 's'} still transmitting. Stay mobile.`;
  } else {
    cooldownLabel.textContent = 'WEAPON READY // CLICK TO FIRE';
    objectiveTitle.textContent = 'Clear the grid';
    objectiveCopy.textContent = 'Lock onto every signal and keep the arena clean.';
  }
  targets.forEach((target, index) => {
    const row = targetRows[index];
    if (row !== undefined) {
      row.dataset.status = target.alive ? 'live' : 'down';
    }
  });
}

function readLiveState(): JsonValue {
  const targetState: JsonValue[] = targets.map((target) => ({
    id: target.id,
    status: target.alive ? 'active' : 'defeated',
    position: [target.group.position.x, target.group.position.y, target.group.position.z],
  }));
  return {
    mission: state.mission,
    objective: state.mission === 'won' ? 'SECTOR 07 SECURED' : 'ELIMINATE 3 SIGNALS',
    score: state.score,
    health: state.health,
    targetsDefeated: state.targetsDefeated,
    shots: state.shots,
    reload: Number(state.reload.toFixed(3)),
    enemiesRemaining: state.enemiesRemaining,
    targetsRemaining: state.enemiesRemaining,
    cooldown: Number(state.reload.toFixed(3)),
    reloading: state.reload > 0.001,
    lastAttackAnimation: state.lastAttackAnimation,
    attackAnimationFrames: state.attackAnimationFrames,
    player: {
      position: [player.position.x, player.position.y, player.position.z],
      rotationY: Number(player.rotation.y.toFixed(3)),
      mode: state.playerMode,
      animation: state.playerAnimation,
    },
    targets: targetState,
    lastAction: state.lastAction,
  };
}

function writeLiveState(id: string, path: string | undefined, value: JsonValue): boolean {
  if (id !== 'state' || path === undefined) {
    return false;
  }
  if (path === 'health' && typeof value === 'number') {
    state.health = Math.max(0, Math.min(100, value));
    return true;
  }
  if (path === 'score' && typeof value === 'number') {
    state.score = Math.max(0, value);
    return true;
  }
  if (path === 'mission' && (value === 'playing' || value === 'won')) {
    state.mission = value;
    if (value === 'won') {
      showWinState();
    }
    return true;
  }
  return false;
}

const resources: IThreePlaytestResources = {
  read: () => ({ state: readLiveState() }),
  write: writeLiveState,
};

function tick(dt: number): void {
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  state.animationFrame += 1;
  state.animationClock += safeDt;
  state.reload = Math.max(0, state.reload - safeDt);
  if (state.playerMode === 'attacking') {
    state.attackAnimationFrames += 1;
  }
  movementGrace = Math.max(0, movementGrace - safeDt);
  muzzleTimer = Math.max(0, muzzleTimer - safeDt);
  muzzleFlash.visible = muzzleTimer > 0;
  if (muzzleFlash.visible) {
    const flashProgress = muzzleTimer / 0.11;
    muzzleFlash.scale.setScalar(0.72 + flashProgress * 0.55);
  }

  let xDirection = 0;
  let zDirection = 0;
  if (pressedKeys.has('w') || pressedKeys.has('arrowup')) zDirection -= 1;
  if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) zDirection += 1;
  if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) xDirection -= 1;
  if (pressedKeys.has('d') || pressedKeys.has('arrowright')) xDirection += 1;
  const movement = new THREE.Vector2(xDirection, zDirection);
  if (pressedKeys.has(' ') || pressedKeys.has('space') || pressedKeys.has('spacebar')) {
    fire();
  }
  if (movement.lengthSq() > 0 && state.mission !== 'won') {
    movement.normalize().multiplyScalar(MOVE_SPEED * safeDt);
    player.position.x = THREE.MathUtils.clamp(player.position.x + movement.x, -10.65, 10.65);
    player.position.z = THREE.MathUtils.clamp(player.position.z + movement.y, -6.75, 6.75);
    movementGrace = 0.55;
    if (state.playerMode !== 'attacking') {
      state.playerMode = 'moving';
      state.playerAnimation = 'run';
    }
  } else if (state.playerMode !== 'attacking') {
    state.playerMode = movementGrace > 0 ? 'moving' : 'idle';
    state.playerAnimation = movementGrace > 0 ? 'run' : 'idle';
  }
  if (state.playerMode === 'attacking' && state.reload < FIRE_COOLDOWN - 0.18) {
    state.playerMode = movement.lengthSq() > 0 ? 'moving' : 'idle';
    state.playerAnimation = movement.lengthSq() > 0 ? 'run' : 'idle';
  }
  const bob = state.playerAnimation === 'run' ? Math.sin(state.animationClock * 16) * 0.045 : Math.sin(state.animationClock * 3) * 0.018;
  playerBody.position.y = 0.66 + bob;
  playerTop.position.y = 1.08 + bob * 0.8;
  playerRing.rotation.z += safeDt * (state.playerAnimation === 'run' ? 2.6 : 0.7);
  playerRing.material.opacity = 0.7 + Math.sin(state.animationClock * 4) * 0.15;

  targets.forEach((target) => {
    if (!target.alive) {
      return;
    }
    const pulse = 1 + Math.sin(state.animationClock * 4 + target.pulseOffset) * 0.08;
    target.core.scale.setScalar(pulse);
    target.ring.rotation.z += safeDt * (0.8 + target.pulseOffset * 0.06);
    target.ring.material.opacity = 0.65 + Math.sin(state.animationClock * 5 + target.pulseOffset) * 0.18;
  });
  updateEffects(safeDt);
  updateHud();
}

function onPointerMove(event: PointerEvent): void {
  updateAim(event.clientX, event.clientY);
}

canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  pointerHeld = true;
  updateAim(event.clientX, event.clientY);
  fire();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', (event) => {
  if (event.button === 0) {
    pointerHeld = false;
    canvas.releasePointerCapture(event.pointerId);
  }
});
canvas.addEventListener('pointerleave', () => {
  pointerHeld = false;
});

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  pressedKeys.add(key);
  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
    event.preventDefault();
    fire();
  }
  if (key === 'r') {
    resetGame();
  }
});
window.addEventListener('keyup', (event) => {
  pressedKeys.delete(event.key.toLowerCase());
});
window.addEventListener('blur', () => {
  pressedKeys.clear();
  pointerHeld = false;
});
restartButton.addEventListener('click', resetGame);

function getGameplayAnimation(): { clip: GameplayAnimationClip; advancedFrames: number } {
  if (state.playerMode === 'attacking') {
    return { clip: 'attack', advancedFrames: state.attackAnimationFrames };
  }
  if (state.lastAttackAnimation === 'shoot' && state.attackAnimationFrames > 0) {
    return { clip: 'attack', advancedFrames: state.attackAnimationFrames };
  }
  return {
    clip: state.playerAnimation === 'shoot' ? 'attack' : state.playerAnimation,
    advancedFrames: state.animationFrame,
  };
}

installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities: entityEntries,
  fixedStep: (ticks) => {
    for (let index = 0; index < ticks; index += 1) {
      tick(FIXED_DT);
    }
  },
  gameplay: () => ({
    animation: { player: getGameplayAnimation() },
    states: {
      player: state.playerMode,
      mission: state.mission,
      'target-1': targets[0]?.alive === true ? 'active' : 'defeated',
      'target-2': targets[1]?.alive === true ? 'active' : 'defeated',
      'target-3': targets[2]?.alive === true ? 'active' : 'defeated',
    },
  }),
  renderer,
  resources,
  scene,
});

let lastFrame = performance.now();
function renderFrame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(renderFrame);
}

resetGame();
requestAnimationFrame(renderFrame);
