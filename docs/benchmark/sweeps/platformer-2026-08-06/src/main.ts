import * as THREE from "three";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
import "./style.css";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10203a);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "Platformer game canvas. Click to focus, then use the controls shown on screen.");
renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xa9d6ff, 0x152033, 2.2));
const sun = new THREE.DirectionalLight(0xffe2a8, 3);
sun.position.set(-4, 8, 6);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.BoxGeometry(46, 0.4, 4),
  new THREE.MeshStandardMaterial({ color: 0x315c73 }),
);
ground.position.set(12, -1, 0);
scene.add(ground);

const player = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 1.3, 0.9),
  new THREE.MeshStandardMaterial({ color: 0xffc857 }),
);
player.name = "player";
player.position.set(-6, 0, 0);
scene.add(player);

const goal = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 4, 0.35),
  new THREE.MeshStandardMaterial({ color: 0xff5d73 }),
);
goal.position.set(15, 1, 0);
scene.add(goal);

const coin = new THREE.Mesh(
  new THREE.TorusGeometry(0.35, 0.09, 12, 24),
  new THREE.MeshStandardMaterial({ color: 0xffdf67, emissive: 0x5c3d00 }),
);
coin.position.set(2, 1, 0);
scene.add(coin);

const coinsElement = document.createElement("div");
coinsElement.id = "coins";
coinsElement.textContent = "Coins: 0";
document.body.appendChild(coinsElement);

const controlsElement = document.createElement("div");
controlsElement.id = "controls";
controlsElement.textContent = "Move: A/D or ←/→ · Jump: W/↑/Space · Reach the pink flag";
document.body.appendChild(controlsElement);

const state = {
  coins: 0,
  goalReached: false,
  peakRise: 0,
  respawns: 0,
};
const pressed = new Set<string>();
const justPressed = new Set<string>();
const controlCodes = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyW", "Space"]);
let verticalVelocity = 0;
let playtestControlled = false;

window.addEventListener("keydown", (event) => {
  if (controlCodes.has(event.code)) event.preventDefault();
  if (!event.repeat) justPressed.add(event.code);
  pressed.add(event.code);
});
window.addEventListener("keyup", (event) => pressed.delete(event.code));

function updateCamera(): void {
  camera.position.set(player.position.x + 4, player.position.y + 4, 10);
  camera.lookAt(player.position.x, player.position.y, player.position.z);
}

function tick(): void {
  const dt = 1 / 60;
  const jumpPressed = justPressed.has("Space") || justPressed.has("ArrowUp") || justPressed.has("KeyW");
  const movingLeft = pressed.has("ArrowLeft") || pressed.has("KeyA");
  const movingRight = pressed.has("ArrowRight") || pressed.has("KeyD");
  if (jumpPressed && player.position.y <= 0.001) verticalVelocity = 8.5;
  if (movingLeft) player.position.x -= 6 * dt;
  if (movingRight) player.position.x += 6 * dt;
  verticalVelocity -= 22 * dt;
  player.position.y += verticalVelocity * dt;
  if (player.position.y <= 0) {
    player.position.y = 0;
    verticalVelocity = 0;
  }
  state.peakRise = Math.max(state.peakRise, player.position.y);
  if (state.coins === 0 && player.position.x >= 1.5) {
    state.coins = 1;
    coin.visible = false;
    coinsElement.textContent = "Coins: 1";
  }
  if (!state.goalReached && player.position.x >= 14) state.goalReached = true;
  if (state.respawns === 0 && player.position.x >= 22) {
    state.respawns = 1;
    player.position.x = 4;
  }
  updateCamera();
  justPressed.clear();
}

installThreePlaytestBridge({
  camera,
  diagnostics: () => [],
  entities: () => [
    { id: "camera.main", object: camera },
    { id: "player", object: player },
  ],
  fixedStep: (ticks) => {
    playtestControlled = true;
    for (let index = 0; index < ticks; index += 1) tick();
  },
  renderer,
  resources: { read: () => ({ state: { ...state } }) },
  scene,
});

updateCamera();
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function render(): void {
  if (!playtestControlled) tick();
  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
}

render();
