import { installThreePlaytestBridge } from "@threenative/playtest/three";
import * as THREE from "three/webgpu";

const CHUNK_SIZE = 100;
const CHUNK_RADIUS_X = 2;
const CHUNK_RADIUS_Z = 2;
const WORLD_EXTENT = 620;
const WALK_SPEED = 43;

const app = document.querySelector<HTMLDivElement>("#app");
const distanceLabel = document.querySelector<HTMLDivElement>("#distance");
const objectiveLabel = document.querySelector<HTMLDivElement>("#objective");
const guide = document.querySelector<HTMLDivElement>("#guide");
if (!app || !distanceLabel || !objectiveLabel || !guide) throw new Error("HUD failed to mount");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x75bce8);
scene.fog = new THREE.FogExp2(0xa7c9cf, 0.00235);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
camera.position.set(-18, 18, 16);

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
app.append(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xbfe5ff, 0x486126, 2.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe5af, 4.8);
sun.position.set(75, 110, 65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0006;
scene.add(sun);

function fract(value: number): number {
  return value - Math.floor(value);
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(h(ix, iz), h(ix + 1, iz), sx),
    THREE.MathUtils.lerp(h(ix, iz + 1), h(ix + 1, iz + 1), sx),
    sz,
  );
}

function pathZ(x: number): number {
  return Math.sin(x * 0.018) * 8 + Math.sin(x * 0.005) * 5;
}

function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.018) * 5.2 + Math.cos(z * 0.022) * 6.2;
  const rolling = Math.sin((x + z) * 0.041) * 2.7 + Math.cos((x - z) * 0.034) * 2.2;
  const detail = (noise2(x * 0.045, z * 0.045) - 0.5) * 3.6;
  const trailDistance = Math.abs(z - pathZ(x));
  const valley = Math.max(0, 1 - trailDistance / 35) * -2.5;
  return broad + rolling + detail + valley;
}

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.97,
  metalness: 0,
});
const trailMaterial = new THREE.MeshStandardMaterial({ color: 0xb8864e, roughness: 1 });
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4225, roughness: 1 });
const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x3d741e, roughness: 0.95 });
const leafLightMaterial = new THREE.MeshStandardMaterial({ color: 0x659826, roughness: 0.95 });
const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x8e9383, roughness: 0.92 });
const trunkGeometry = new THREE.CylinderGeometry(0.32, 0.48, 3.5, 7);
const crownGeometry = new THREE.IcosahedronGeometry(2.4, 1);
const rockGeometry = new THREE.DodecahedronGeometry(1.5, 0);
const matrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();

interface TerrainChunk {
  cx: number;
  cz: number;
  group: THREE.Group;
}

const chunks = new Map<string, TerrainChunk>();

function seeded(cx: number, cz: number, index: number, salt: number): number {
  return fract(Math.sin(cx * 91.73 + cz * 211.31 + index * 47.11 + salt * 13.97) * 16453.2147);
}

function createTerrain(cx: number, cz: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 32, 32);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  if (!(positions instanceof THREE.BufferAttribute)) throw new Error("Terrain position buffer missing");
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i += 1) {
    const worldX = positions.getX(i) + cx * CHUNK_SIZE;
    const worldZ = positions.getZ(i) + cz * CHUNK_SIZE;
    const y = terrainHeight(worldX, worldZ);
    positions.setY(i, y);
    const dry = noise2(worldX * 0.06 + 20, worldZ * 0.06 - 8);
    const high = THREE.MathUtils.clamp((y + 5) / 24, 0, 1);
    color.setRGB(0.19 + dry * 0.09 + high * 0.06, 0.39 + dry * 0.16 + high * 0.08, 0.075 + dry * 0.045);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.name = `terrain:${cx}:${cz}`;
  return mesh;
}

function createTrail(cx: number, cz: number): THREE.Mesh | undefined {
  const minZ = cz * CHUNK_SIZE - CHUNK_SIZE / 2;
  const maxZ = minZ + CHUNK_SIZE;
  const centerX = cx * CHUNK_SIZE;
  const steps = 32;
  const vertices: number[] = [];
  const indices: number[] = [];
  let touches = false;
  for (let i = 0; i <= steps; i += 1) {
    const x = centerX - CHUNK_SIZE / 2 + (i / steps) * CHUNK_SIZE;
    const z = pathZ(x);
    touches ||= z > minZ - 8 && z < maxZ + 8;
    const halfWidth = 3.8 + Math.sin(x * 0.11) * 0.55;
    for (const edge of [-1, 1]) {
      const edgeZ = z + edge * halfWidth;
      vertices.push(x - centerX, terrainHeight(x, edgeZ) + 0.32, edgeZ - cz * CHUNK_SIZE);
    }
    if (i < steps) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  if (!touches) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const trail = new THREE.Mesh(geometry, trailMaterial);
  trail.receiveShadow = true;
  trail.name = `trail:${cx}:${cz}`;
  return trail;
}

function createChunk(cx: number, cz: number): TerrainChunk {
  const group = new THREE.Group();
  group.name = `chunk:${cx}:${cz}`;
  group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
  group.add(createTerrain(cx, cz));
  const trail = createTrail(cx, cz);
  if (trail) group.add(trail);

  const treeCount = 13;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, leafMaterial, treeCount);
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.receiveShadow = true;
  for (let i = 0; i < treeCount; i += 1) {
    let localX = (seeded(cx, cz, i, 1) - 0.5) * 92;
    let localZ = (seeded(cx, cz, i, 2) - 0.5) * 92;
    const worldX = localX + cx * CHUNK_SIZE;
    const route = pathZ(worldX) - cz * CHUNK_SIZE;
    if (Math.abs(localZ - route) < 12) localZ += localZ > route ? 15 : -15;
    const worldZ = localZ + cz * CHUNK_SIZE;
    const y = terrainHeight(worldX, worldZ);
    const size = 0.78 + seeded(cx, cz, i, 3) * 0.75;
    position.set(localX, y + 1.75 * size, localZ);
    scale.set(size, size, size);
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seeded(cx, cz, i, 4) * Math.PI);
    matrix.compose(position, rotation, scale);
    trunks.setMatrixAt(i, matrix);
    position.y = y + 4.75 * size;
    scale.set(size * (0.85 + seeded(cx, cz, i, 5) * 0.3), size, size);
    matrix.compose(position, rotation, scale);
    crowns.setMatrixAt(i, matrix);
  }
  group.add(trunks, crowns);

  const rockCount = 11;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  for (let i = 0; i < rockCount; i += 1) {
    const localX = (seeded(cx, cz, i, 7) - 0.5) * 96;
    const localZ = (seeded(cx, cz, i, 8) - 0.5) * 96;
    const x = localX + cx * CHUNK_SIZE;
    const z = localZ + cz * CHUNK_SIZE;
    const y = terrainHeight(x, z);
    const size = 0.45 + seeded(cx, cz, i, 9) * 1.45;
    position.set(localX, y + size * 0.7, localZ);
    rotation.setFromEuler(new THREE.Euler(seeded(cx, cz, i, 10), seeded(cx, cz, i, 11) * 6, seeded(cx, cz, i, 12) * 0.5));
    scale.set(size * 1.3, size * 0.7, size);
    matrix.compose(position, rotation, scale);
    rocks.setMatrixAt(i, matrix);
  }
  group.add(rocks);
  scene.add(group);
  return { cx, cz, group };
}

function refreshChunks(force = false): void {
  const centerX = Math.floor((player.position.x + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const centerZ = Math.floor((player.position.z + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const wanted = new Set<string>();
  for (let x = centerX - CHUNK_RADIUS_X; x <= centerX + CHUNK_RADIUS_X; x += 1) {
    for (let z = centerZ - CHUNK_RADIUS_Z; z <= centerZ + CHUNK_RADIUS_Z; z += 1) {
      if (Math.abs(x * CHUNK_SIZE) > WORLD_EXTENT || Math.abs(z * CHUNK_SIZE) > WORLD_EXTENT) continue;
      const key = `${x}:${z}`;
      wanted.add(key);
      if (!chunks.has(key)) chunks.set(key, createChunk(x, z));
    }
  }
  for (const [key, chunk] of chunks) {
    if (!wanted.has(key)) {
      scene.remove(chunk.group);
      chunk.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry !== trunkGeometry && object.geometry !== crownGeometry && object.geometry !== rockGeometry) {
          object.geometry.dispose();
        }
      });
      chunks.delete(key);
    }
  }
  if (force) renderer.render(scene, camera);
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, cast = true): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = cast;
  result.receiveShadow = true;
  return result;
}

function addLandmarks(): THREE.Group[] {
  const stone = new THREE.MeshStandardMaterial({ color: 0x858d7e, roughness: 0.96 });
  const warmStone = new THREE.MeshStandardMaterial({ color: 0x9a9178, roughness: 0.95 });
  const arch = new THREE.Group();
  arch.name = "landmark:old-shepherds-arch";
  const ax = 145;
  const az = pathZ(ax) - 15;
  const ay = terrainHeight(ax, az);
  for (const side of [-1, 1]) {
    const pillar = mesh(new THREE.BoxGeometry(2.7, 9.5, 3.2), stone);
    pillar.position.set(side * 5.2, 4.6, 0);
    pillar.rotation.z = side * 0.07;
    arch.add(pillar);
  }
  const lintel = mesh(new THREE.BoxGeometry(13, 2.5, 3.6), warmStone);
  lintel.position.y = 9.2;
  lintel.rotation.z = -0.025;
  arch.add(lintel);
  const marker = mesh(new THREE.ConeGeometry(0.6, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0xffcf57, emissive: 0xa95a10, emissiveIntensity: 0.8 }));
  marker.position.y = 12.1;
  arch.add(marker);
  arch.position.set(ax, ay, az);
  scene.add(arch);

  const tower = new THREE.Group();
  tower.name = "landmark:sunwatch-tower";
  const tx = 365;
  const tz = pathZ(tx) + 22;
  const ty = terrainHeight(tx, tz);
  const base = mesh(new THREE.CylinderGeometry(6.5, 8.5, 20, 9), stone);
  base.position.y = 10;
  tower.add(base);
  const rim = mesh(new THREE.CylinderGeometry(8.2, 7.8, 2.4, 9), warmStone);
  rim.position.y = 21;
  tower.add(rim);
  for (let i = 0; i < 5; i += 1) {
    const tooth = mesh(new THREE.BoxGeometry(2.1, 3, 2), stone);
    const angle = (i / 5) * Math.PI * 2;
    tooth.position.set(Math.cos(angle) * 6.4, 23.4, Math.sin(angle) * 6.4);
    tower.add(tooth);
  }
  const beacon = mesh(new THREE.SphereGeometry(1.15, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
  beacon.position.y = 26;
  tower.add(beacon);
  tower.position.set(tx, ty, tz);
  scene.add(tower);
  return [arch, tower];
}

function addDistantMountains(): void {
  const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x79909a, roughness: 1, flatShading: true });
  const sunFace = new THREE.MeshStandardMaterial({ color: 0x91a393, roughness: 1, flatShading: true });
  const peaks = [
    [430, -160, 62, 100], [470, -72, 88, 130], [520, 25, 54, 95], [480, 130, 72, 120],
  ] as const;
  let peakIndex = 0;
  for (const [x, z, height, radius] of peaks) {
    const mountain = mesh(new THREE.ConeGeometry(radius, height, 7, 3), peakIndex % 2 === 0 ? mountainMaterial : sunFace, false);
    mountain.position.set(x, terrainHeight(x, z) + height * 0.37, z);
    mountain.rotation.y = peakIndex * 0.74;
    scene.add(mountain);
    peakIndex += 1;
  }
}

function addClouds(): THREE.Group {
  const cloudLayer = new THREE.Group();
  cloudLayer.name = "cloud-layer";
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xfff5df, transparent: true, opacity: 0.83, depthWrite: false });
  const cloudGeometry = new THREE.IcosahedronGeometry(1, 2);
  for (let i = 0; i < 14; i += 1) {
    const cloud = new THREE.Group();
    const x = -100 + i * 52;
    const z = -170 + (i % 5) * 88;
    const y = 55 + (i % 4) * 8;
    for (let p = 0; p < 5; p += 1) {
      const puff = mesh(cloudGeometry, cloudMaterial, false);
      puff.position.set(p * 4.4 - 8.8, Math.sin(p * 1.8) * 1.8, Math.cos(p * 2.2) * 2.5);
      puff.scale.set(6.3 + (p % 2) * 2.5, 3.3 + (p % 3), 4.2);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    cloud.scale.setScalar(1 + (i % 3) * 0.18);
    cloudLayer.add(cloud);
  }
  scene.add(cloudLayer);
  return cloudLayer;
}

const player = new THREE.Group();
player.name = "player";
const coatMaterial = new THREE.MeshStandardMaterial({ color: 0xc85127, roughness: 0.88 });
const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x24331f, roughness: 0.9 });
const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a370, roughness: 0.9 });
const body = mesh(new THREE.CapsuleGeometry(0.55, 1.5, 4, 8), coatMaterial);
body.position.y = 2.05;
player.add(body);
const head = mesh(new THREE.SphereGeometry(0.45, 12, 8), skinMaterial);
head.position.y = 3.5;
player.add(head);
const hat = mesh(new THREE.ConeGeometry(0.72, 0.8, 9), darkMaterial);
hat.position.y = 4.05;
player.add(hat);
for (const side of [-1, 1]) {
  const leg = mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.4, 7), darkMaterial);
  leg.name = side < 0 ? "left-leg" : "right-leg";
  leg.position.set(0, 0.72, side * 0.28);
  player.add(leg);
}
scene.add(player);
player.position.set(0, terrainHeight(0, pathZ(0)) + 0.05, pathZ(0));

const landmarks = addLandmarks();
addDistantMountains();
const cloudLayer = addClouds();
refreshChunks();

const keys = new Set<string>();
let travelled = 0;
let elapsed = 0;
let lastChunk = "";
let guidanceVisible = true;

addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  guidanceVisible = false;
});
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("blur", () => keys.clear());

const cameraGoal = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
const oldPlayer = new THREE.Vector3();

function update(delta: number): void {
  elapsed += delta;
  oldPlayer.copy(player.position);
  let forward = 0;
  let lateral = 0;
  if (keys.has("ArrowRight") || keys.has("KeyD")) forward += 1;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) forward -= 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) lateral -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) lateral += 1;
  const moving = forward !== 0 || lateral !== 0;
  if (moving) {
    const length = Math.hypot(forward, lateral);
    player.position.x = THREE.MathUtils.clamp(player.position.x + (forward / length) * WALK_SPEED * delta, -WORLD_EXTENT, WORLD_EXTENT);
    player.position.z = THREE.MathUtils.clamp(player.position.z + (lateral / length) * WALK_SPEED * delta, -WORLD_EXTENT, WORLD_EXTENT);
    travelled += oldPlayer.distanceTo(player.position);
    player.rotation.y = Math.atan2(lateral, forward) - Math.PI / 2;
  }
  player.position.y = terrainHeight(player.position.x, player.position.z) + 0.05;
  body.position.y = 2.05 + (moving ? Math.abs(Math.sin(elapsed * 10)) * 0.12 : Math.sin(elapsed * 2) * 0.025);
  const leftLeg = player.getObjectByName("left-leg");
  const rightLeg = player.getObjectByName("right-leg");
  if (leftLeg && rightLeg) {
    const stride = moving ? Math.sin(elapsed * 10) * 0.55 : 0;
    leftLeg.rotation.z = stride;
    rightLeg.rotation.z = -stride;
  }

  const chunkKey = `${Math.floor((player.position.x + 50) / CHUNK_SIZE)}:${Math.floor((player.position.z + 50) / CHUNK_SIZE)}`;
  if (chunkKey !== lastChunk) {
    lastChunk = chunkKey;
    refreshChunks();
  }

  cameraGoal.set(player.position.x - 18, player.position.y + 13.5, player.position.z + 15.5);
  const cameraBlend = 1 - Math.exp(-delta * 4.2);
  camera.position.lerp(cameraGoal, cameraBlend);
  cameraLook.set(player.position.x + 18, player.position.y + 3.2, player.position.z);
  camera.lookAt(cameraLook);
  sun.position.set(player.position.x + 70, player.position.y + 105, player.position.z + 65);
  sun.target.position.copy(player.position);
  scene.add(sun.target);
  cloudLayer.position.x = player.position.x * 0.62;
  guide!.style.opacity = guidanceVisible ? "1" : "0";

  const next = player.position.x < 145 ? { name: "Old Shepherd's Arch", x: 145 } : { name: "Sunwatch Tower", x: 365 };
  objectiveLabel!.textContent = `${next.name} · ${Math.max(0, Math.round(next.x - player.position.x))} m`;
  distanceLabel!.innerHTML = `${Math.round(travelled)} m TRAVELLED<br>CHUNK ${lastChunk.replace(":", " · ")}`;
}

let bridgeTick = 0;
let previousFrame = performance.now();

installThreePlaytestBridge({
  camera,
  renderer,
  scene,
  entities: () => [
    { id: "player", object: player },
    { id: "landmark-old-shepherds-arch", object: landmarks[0] as THREE.Object3D },
    { id: "landmark-sunwatch-tower", object: landmarks[1] as THREE.Object3D },
    ...[...chunks.values()].map((chunk) => ({ id: `chunk-${chunk.cx}-${chunk.cz}`, object: chunk.group })),
  ],
  fixedStep: (ticks) => {
    for (let i = 0; i < ticks; i += 1) update(1 / 60);
    bridgeTick += ticks;
  },
  gameplay: () => ({
    animation: {},
    states: { player: keys.size > 0 ? "walking" : "idle", streaming: "active" },
    world: { seed: 3, runtime: { agent: "vanilla-three", core: "three", randomState: 3, rapier: null, step: bridgeTick } },
  }),
  resources: {
    read: () => ({
      loadedChunks: [...chunks.keys()].sort(),
      playerDistance: travelled,
      playerChunk: lastChunk,
      worldSize: [WORLD_EXTENT * 2, WORLD_EXTENT * 2],
      landmarks: ["old-shepherds-arch", "sunwatch-tower"],
      renderer: "WebGPU",
    }),
  },
});

await renderer.init();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  update(Math.min((now - previousFrame) / 1000, 0.05));
  previousFrame = now;
  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
