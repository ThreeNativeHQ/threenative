import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { installThreePlaytestBridge } from "@threenative/playtest/three";

const CHUNK_SIZE = 64;
const CHUNK_RESOLUTION = 9;
const SPEED_PER_TICK = 2;

const scene = new Scene();
scene.background = new Color(0x9fc6d6);
const camera = new OrthographicCamera(-640, 640, 360, -360, 1, 1_000);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
renderer.setSize(1280, 720, false);
document.body.append(renderer.domElement);

const chunks = new Map<number, { mesh: Mesh; geometry: PlaneGeometry; material: MeshBasicMaterial }>();
const pressed = new Set<string>();
const state = { chunks: 0, playerX: 0 };
const playerGeometry = new BoxGeometry(8, 8, 8);
const playerMaterial = new MeshBasicMaterial({ color: 0xffd27a });
const player = new Mesh(playerGeometry, playerMaterial);
player.position.y = 4;
scene.add(player);

function createChunk(chunkX: number): void {
  const geometry = new PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RESOLUTION - 1, CHUNK_RESOLUTION - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, Math.sin((positions.getX(index) + chunkX * CHUNK_SIZE) * 0.045) * 1.5);
  }
  positions.needsUpdate = true;
  const material = new MeshBasicMaterial({ color: 0x4c7a43, wireframe: true });
  const mesh = new Mesh(geometry, material);
  mesh.position.x = chunkX * CHUNK_SIZE;
  scene.add(mesh);
  chunks.set(chunkX, { geometry, material, mesh });
}

function stream(playerX: number): void {
  const center = Math.floor((playerX + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const wanted = new Set([center - 1, center, center + 1]);
  for (const [chunkX, chunk] of chunks) {
    if (wanted.has(chunkX)) continue;
    chunk.mesh.removeFromParent();
    chunk.geometry.dispose();
    chunk.material.dispose();
    chunks.delete(chunkX);
  }
  for (const chunkX of wanted) {
    if (!chunks.has(chunkX)) createChunk(chunkX);
  }
  state.chunks = chunks.size;
}

function updateCamera(): void {
  camera.position.set(player.position.x, 180, 180);
  camera.lookAt(player.position.x, 0, 0);
}

function tick(): void {
  if (pressed.has("ArrowRight")) player.position.x += SPEED_PER_TICK;
  if (pressed.has("ArrowLeft")) player.position.x -= SPEED_PER_TICK;
  state.playerX = player.position.x;
  stream(player.position.x);
  updateCamera();
  renderer.render(scene, camera);
}

window.addEventListener("keydown", (event) => pressed.add(event.code));
window.addEventListener("keyup", (event) => pressed.delete(event.code));

stream(0);
updateCamera();
renderer.render(scene, camera);

installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities: () => [
    { id: "player", object: player },
    ...[...chunks.entries()].map(([chunkX, chunk]) => ({ id: `chunk.${chunkX}`, object: chunk.mesh })),
  ],
  fixedStep: (ticks) => {
    for (let index = 0; index < ticks; index += 1) tick();
  },
  renderer,
  resources: { read: () => ({ state }) },
  scene,
});
