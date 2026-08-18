import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import faceUrl from "../assets/textures/range-target-face.png?url";
import faceHitUrl from "../assets/textures/range-target-face-hit.png?url";
import surfaceUrl from "../assets/textures/ue-test-surface.jpg?url";
import skyUrl from "../assets/imported/polyhaven/sky.outdoor-cloudy/environment.jpg?url";
import viewmodelUrl from "../assets/models/player-viewmodel.glb?url";
import enemyUrl from "../assets/models/enemy-terrorist.glb?url";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
import { Hud } from "./hud";
import { Enemy, ENEMY_HEIGHT, makeRandom, type EnemyShot } from "./enemy";
import {
  buildWorld,
  groundHeight,
  resetTargets,
  resolveCollisions,
  stepTargets,
  type RangeTarget,
} from "./world";

// ---------------------------------------------------------------- tunables
const EYE_HEIGHT = 1.66;
const WALK_SPEED = 5.6;
const SPRINT_SPEED = 8.2;
const FOV_HIP = 70;
const FOV_AIM = 22;
const PITCH_MIN = THREE.MathUtils.degToRad(-66);
const PITCH_MAX = THREE.MathUtils.degToRad(72);
const MAG_SIZE = 30;
const RESERVE_SIZE = 90;
const RELOAD_TIME = 0.7;
const SHOT_RANGE = 60;
const BASE_DAMAGE = 10;
const RUN_SECONDS = 60;
const TARGET_GOAL = 12;
const PLAYER_RADIUS = 0.35;
const FIXED_DT = 1 / 60;

// viewmodel placement, tuned against reference.png
const VIEWMODEL_SCALE = 0.56;
const VIEWMODEL_POS = new THREE.Vector3(0.17, -0.21, -0.33);
const VIEWMODEL_EULER = new THREE.Euler(0, Math.PI, 0);
const VIEWMODEL_AIM_POS = new THREE.Vector3(-0.026, -0.104, -0.28);

const root = document.getElementById("app") ?? document.body;
document.body.style.cssText = "margin:0;overflow:hidden;background:#0b0e12;";

const renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
await renderer.init();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.cssText = "position:fixed;inset:0;display:block;";
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc0e0);

const camera = new THREE.PerspectiveCamera(FOV_HIP, window.innerWidth / window.innerHeight, 0.02, 300);
camera.rotation.order = "YXZ";
scene.add(camera);

const textureLoader = new THREE.TextureLoader();
const faceMap = textureLoader.load(faceUrl);
faceMap.colorSpace = THREE.SRGBColorSpace;
const hitFaceMap = textureLoader.load(faceHitUrl);
hitFaceMap.colorSpace = THREE.SRGBColorSpace;
const floorMap = textureLoader.load(surfaceUrl);
floorMap.colorSpace = THREE.SRGBColorSpace;
const propMap = textureLoader.load(surfaceUrl);
propMap.colorSpace = THREE.SRGBColorSpace;

const world = buildWorld(scene, floorMap, propMap);
const hitPlateMaterial = new THREE.MeshBasicMaterial({ map: hitFaceMap, side: THREE.DoubleSide });

// sky: the shipped outdoor-cloudy equirectangular panorama
textureLoader.load(skyUrl, (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  scene.environment = texture;
  scene.environmentIntensity = 0.32;
  scene.backgroundIntensity = 0.78;
});

const random = makeRandom(0x5eed1234);
const enemy = new Enemy(world, random);
scene.add(enemy.root);

// ---------------------------------------------------------------- game state
interface GameState {
  score: number;
  health: number;
  ammo: number;
  reserve: number;
  shots: number;
  reloads: number;
  targetsHit: number;
  distanceMoved: number;
  timeRemaining: number;
  phase: "playing" | "complete" | "failed";
}

const state: GameState = {
  score: 0,
  health: 100,
  ammo: MAG_SIZE,
  reserve: RESERVE_SIZE,
  shots: 0,
  reloads: 0,
  targetsHit: 0,
  distanceMoved: 0,
  timeRemaining: RUN_SECONDS,
  phase: "playing",
};

const player = {
  position: new THREE.Vector3(0.15, 0, 14.2),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  aiming: false,
  reloadTimer: 0,
  fireCooldown: 0,
  bob: 0,
  feet: 0,
};

const keys = new Set<string>();
let firePressed = false;
let fireLatch = false;
// edge-triggered intents: a synthetic press shorter than one tick must still register
let pendingFire = 0;
let pendingReload = 0;
let pendingRetry = 0;
let pointerLocked = false;
let muzzleTimer = 0;
let hitMarker = 0;
let shakeTimer = 0;

// ---------------------------------------------------------------- input
window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    event.preventDefault();
    return;
  }
  keys.add(event.code);
  if (event.code === "Space" || event.code === "KeyF") pendingFire += 1;
  if (event.code === "KeyR") pendingReload += 1;
  if (event.code === "Enter" || event.code === "NumpadEnter") pendingRetry += 1;
  if (event.code === "Space" || event.code === "Enter" || event.code.startsWith("Arrow")) event.preventDefault();
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});
window.addEventListener("blur", () => keys.clear());

renderer.domElement.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    if (!pointerLocked) void renderer.domElement.requestPointerLock();
    firePressed = true;
    pendingFire += 1;
  }
  if (event.button === 2) player.aiming = true;
});
window.addEventListener("mouseup", (event) => {
  if (event.button === 0) firePressed = false;
  if (event.button === 2) player.aiming = false;
});
window.addEventListener("contextmenu", (event) => event.preventDefault());
document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
window.addEventListener("mousemove", (event) => {
  if (!pointerLocked) return;
  const sensitivity = (player.aiming ? 0.00075 : 0.0015);
  player.yaw -= event.movementX * sensitivity;
  player.pitch = THREE.MathUtils.clamp(player.pitch - event.movementY * sensitivity, PITCH_MIN, PITCH_MAX);
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- viewmodel
const viewmodel = new THREE.Group();
viewmodel.position.copy(VIEWMODEL_POS);
viewmodel.rotation.copy(VIEWMODEL_EULER);
camera.add(viewmodel);

let viewmodelMixer: THREE.AnimationMixer | null = null;
const viewmodelActions = new Map<string, THREE.AnimationAction>();
let viewmodelIdle: THREE.AnimationAction | null = null;

const muzzleFlash = new THREE.PointLight(0xffd9a0, 0, 6, 2);
muzzleFlash.position.set(0.24, -0.06, -0.9);
camera.add(muzzleFlash);

const puffGeometry = new THREE.SphereGeometry(0.055, 6, 5);
const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xd8d4cc, transparent: true, opacity: 0 });
const puffs: Array<{ mesh: THREE.Mesh; life: number }> = [];
for (let index = 0; index < 6; index += 1) {
  const mesh = new THREE.Mesh(puffGeometry, puffMaterial.clone());
  mesh.visible = false;
  scene.add(mesh);
  puffs.push({ mesh, life: 0 });
}
let puffCursor = 0;

function spawnPuff(at: THREE.Vector3): void {
  const entry = puffs[puffCursor % puffs.length]!;
  puffCursor += 1;
  entry.mesh.position.copy(at);
  entry.mesh.scale.setScalar(1);
  entry.mesh.visible = true;
  entry.life = 0.22;
}

const tracerMaterial = new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0 });
const tracerGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const tracer = new THREE.Line(tracerGeometry, tracerMaterial);
tracer.frustumCulled = false;
scene.add(tracer);
let tracerTimer = 0;

// incoming fire needs to be legible: a short tracer from the enemy's muzzle to the player
const enemyTracerMaterial = new THREE.LineBasicMaterial({ color: 0xffc987, transparent: true, opacity: 0 });
const enemyTracerGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const enemyTracer = new THREE.Line(enemyTracerGeometry, enemyTracerMaterial);
enemyTracer.frustumCulled = false;
scene.add(enemyTracer);
let enemyTracerTimer = 0;

const loader = new GLTFLoader();

loader.load(viewmodelUrl, (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z);
  model.scale.multiplyScalar((VIEWMODEL_SCALE * 1.4) / (longest || 1));
  const scaled = new THREE.Box3().setFromObject(model);
  const centre = new THREE.Vector3();
  scaled.getCenter(centre);
  model.position.sub(centre);
  model.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;
      node.renderOrder = 10;
      const material = node.material as THREE.Material & { depthTest?: boolean };
      if (material) material.depthTest = true;
    }
  });
  viewmodel.add(model);
  viewmodelMixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) viewmodelActions.set(clip.name, viewmodelMixer.clipAction(clip));
  viewmodelIdle = viewmodelActions.get("Idle") ?? null;
  viewmodelIdle?.play();
});

loader.load(enemyUrl, (gltf) => {
  enemy.attachModel(gltf.scene, gltf.animations);
});

function playViewmodel(name: string, duration: number): void {
  const action = viewmodelActions.get(name);
  if (!action) return;
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = false;
  action.timeScale = action.getClip().duration / Math.max(0.05, duration);
  action.setEffectiveWeight(1);
  action.play();
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const enemyShots: EnemyShot[] = [];

function fire(): void {
  if (state.phase !== "playing") return;
  if (player.reloadTimer > 0) return;
  if (state.ammo <= 0) {
    beginReload();
    return;
  }
  state.ammo -= 1;
  state.shots += 1;
  muzzleTimer = 0.05;
  playViewmodel("Shoot", 0.18);

  camera.getWorldDirection(forward);
  const origin = new THREE.Vector3(player.position.x, player.feet + EYE_HEIGHT, player.position.z);
  raycaster.set(origin, forward);
  raycaster.far = SHOT_RANGE;

  const candidates: THREE.Object3D[] = [...world.plates, enemy.hitbox, ...world.occluders];
  const hits = raycaster.intersectObjects(candidates, false);
  let end = origin.clone().addScaledVector(forward, SHOT_RANGE);

  for (const hit of hits) {
    const target = hit.object.userData.target as RangeTarget | undefined;
    if (target) {
      if (target.down) continue;
      end = hit.point.clone();
      registerTargetHit(target);
      break;
    }
    if (hit.object === enemy.hitbox) {
      if (enemy.state === "dead") continue;
      end = hit.point.clone();
      const localY = hit.point.y - enemy.root.position.y;
      const fraction = THREE.MathUtils.clamp(localY / ENEMY_HEIGHT, 0, 1);
      const multiplier = fraction > 0.88 ? 4 : fraction < 1 / 3 ? 0.7 : 1;
      const award = enemy.damage(BASE_DAMAGE * multiplier, origin);
      if (award > 0) {
        state.score += award;
        state.targetsHit += 1;
        hitMarker = 0.18;
      }
      break;
    }
    end = hit.point.clone();
    break;
  }

  const positions = tracerGeometry.getAttribute("position") as THREE.BufferAttribute;
  const muzzle = origin.clone().addScaledVector(forward, 0.6);
  muzzle.y -= 0.06;
  positions.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
  positions.setXYZ(1, end.x, end.y, end.z);
  positions.needsUpdate = true;
  tracerTimer = 0.05;
  spawnPuff(end);

  enemy.hearShot(origin);
}

function registerTargetHit(target: RangeTarget): void {
  target.plate.material = hitPlateMaterial;
  target.down = true;
  target.restore = 1.4;
  state.score += target.value;
  state.targetsHit += 1;
  hitMarker = 0.18;
  if (state.targetsHit >= TARGET_GOAL) state.phase = "complete";
}

function beginReload(): void {
  if (state.phase !== "playing") return;
  if (player.reloadTimer > 0 || state.reserve <= 0 || state.ammo >= MAG_SIZE) return;
  player.reloadTimer = RELOAD_TIME;
  playViewmodel("Reload", RELOAD_TIME);
}

function finishReload(): void {
  const wanted = Math.min(MAG_SIZE - state.ammo, state.reserve);
  state.ammo += wanted;
  state.reserve -= wanted;
  state.reloads += 1;
}

function restart(): void {
  state.score = 0;
  state.health = 100;
  state.ammo = MAG_SIZE;
  state.reserve = RESERVE_SIZE;
  state.shots = 0;
  state.reloads = 0;
  state.targetsHit = 0;
  state.distanceMoved = 0;
  state.timeRemaining = RUN_SECONDS;
  state.phase = "playing";
  player.position.set(0.15, 0, 14.2);
  player.velocity.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.reloadTimer = 0;
  player.feet = 0;
  resetTargets(world);
  enemy.reset();
}

// ---------------------------------------------------------------- simulation
const hud = new Hud(document.body);
let frame = 0;
let elapsed = 0;

function tick(dt: number = FIXED_DT): void {
  frame += 1;
  elapsed += dt;

  if (pendingRetry > 0) {
    pendingRetry = 0;
    restart();
  }

  const aimKey = keys.has("KeyE") || keys.has("ControlLeft");
  const aiming = player.aiming || aimKey;
  const playing = state.phase === "playing";

  // ---- look and move
  const move = new THREE.Vector2(0, 0);
  if (playing) {
    if (keys.has("KeyW")) move.y += 1;
    if (keys.has("KeyS")) move.y -= 1;
    if (keys.has("KeyA")) move.x -= 1;
    if (keys.has("KeyD")) move.x += 1;
    if (keys.has("ArrowLeft")) player.yaw += dt * 1.8;
    if (keys.has("ArrowRight")) player.yaw -= dt * 1.8;
    if (keys.has("ArrowUp")) player.pitch = Math.min(PITCH_MAX, player.pitch + dt * 1.3);
    if (keys.has("ArrowDown")) player.pitch = Math.max(PITCH_MIN, player.pitch - dt * 1.3);
  }

  const sprinting = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && !aiming && move.y > 0;
  const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
  const desired = new THREE.Vector3();
  if (move.lengthSq() > 0) {
    move.normalize();
    const forwardVector = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const rightVector = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    desired.addScaledVector(forwardVector, move.y).addScaledVector(rightVector, move.x);
    desired.normalize().multiplyScalar(speed);
  }
  player.velocity.lerp(desired, Math.min(1, dt * 14));
  const before = player.position.clone();
  player.position.addScaledVector(player.velocity, dt);
  resolveCollisions(world, player.position, PLAYER_RADIUS, player.feet);
  player.feet = groundHeight(world, player.position.x, player.position.z, player.feet);
  const travelled = Math.hypot(player.position.x - before.x, player.position.z - before.z);
  if (playing) state.distanceMoved += travelled;
  player.bob += travelled * (sprinting ? 5.5 : 4.2);

  // ---- weapon
  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) {
      player.reloadTimer = 0;
      finishReload();
    }
  }

  if (pendingFire > 0) {
    pendingFire = 0;
    fire();
  } else if (firePressed && !fireLatch) {
    fire();
  }
  fireLatch = firePressed;

  if (pendingReload > 0) {
    pendingReload = 0;
    beginReload();
  }

  // ---- enemy
  const eye = new THREE.Vector3(player.position.x, player.feet + EYE_HEIGHT, player.position.z);
  enemyShots.length = 0;
  enemy.update(dt, eye, playing && state.health > 0, enemyShots);
  for (const shot of enemyShots) {
    if (!playing) break;
    state.health = Math.max(0, state.health - shot.damage);
    shakeTimer = 0.22;
    const line = enemyTracerGeometry.getAttribute("position") as THREE.BufferAttribute;
    line.setXYZ(0, shot.origin.x, shot.origin.y, shot.origin.z);
    line.setXYZ(1, eye.x, eye.y - 0.12, eye.z);
    line.needsUpdate = true;
    enemyTracerTimer = 0.07;
    if (state.health <= 0) state.phase = "failed";
  }

  stepTargets(world, dt);

  if (playing) {
    state.timeRemaining = Math.max(0, state.timeRemaining - dt);
    if (state.timeRemaining <= 0 && state.targetsHit < TARGET_GOAL) state.phase = "failed";
  }

  // ---- camera
  const aimBlend = THREE.MathUtils.clamp(
    (aiming && player.reloadTimer <= 0 ? 1 : 0),
    0,
    1,
  );
  camera.fov += (( aimBlend ? FOV_AIM : FOV_HIP) - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  const bobAmount = Math.min(0.035, player.velocity.length() * 0.006);
  const shake = shakeTimer > 0 ? shakeTimer * 0.06 : 0;
  if (shakeTimer > 0) shakeTimer -= dt;
  camera.position.set(
    player.position.x + Math.cos(player.bob) * bobAmount * 0.5 + (random() - 0.5) * shake,
    player.feet + EYE_HEIGHT + Math.sin(player.bob * 2) * bobAmount + (random() - 0.5) * shake,
    player.position.z,
  );
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");

  // ---- viewmodel sway / aim pose
  const targetPos = aimBlend ? VIEWMODEL_AIM_POS : VIEWMODEL_POS;
  viewmodel.position.lerp(targetPos, Math.min(1, dt * 12));
  if (player.reloadTimer > 0) viewmodel.position.y -= dt * 0.35;
  viewmodel.position.x += Math.cos(player.bob) * bobAmount * 0.25;
  viewmodel.position.y += Math.sin(player.bob * 2) * bobAmount * 0.35;

  if (muzzleTimer > 0) {
    muzzleTimer -= dt;
    muzzleFlash.intensity = muzzleTimer > 0 ? 18 : 0;
  } else {
    muzzleFlash.intensity = 0;
  }
  if (enemyTracerTimer > 0) {
    enemyTracerTimer -= dt;
    enemyTracerMaterial.opacity = Math.max(0, enemyTracerTimer / 0.07) * 0.9;
  } else {
    enemyTracerMaterial.opacity = 0;
  }
  if (tracerTimer > 0) {
    tracerTimer -= dt;
    tracerMaterial.opacity = Math.max(0, tracerTimer / 0.05) * 0.85;
  } else {
    tracerMaterial.opacity = 0;
  }
  for (const puff of puffs) {
    if (puff.life <= 0) continue;
    puff.life -= dt;
    const material = puff.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = Math.max(0, puff.life / 0.22) * 0.8;
    puff.mesh.scale.setScalar(1 + (0.22 - puff.life) * 5);
    if (puff.life <= 0) puff.mesh.visible = false;
  }
  if (hitMarker > 0) hitMarker -= dt;
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let accumulator = 0;
let fps = 60;
// While a scenario drives fixedStep the harness owns the clock; the render loop must not
// advance the simulation a second time. It resumes half a second after the last driven tick
// so a real-time keyboard scenario still works.
let externalClockUntil = 0;

function render(now: number): void {
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.9 + (1 / Math.max(delta, 1e-4)) * 0.1;
  if (now < externalClockUntil) {
    accumulator = 0;
  } else {
    accumulator += delta;
    let guard = 0;
    while (accumulator >= FIXED_DT && guard < 6) {
      tick(FIXED_DT);
      accumulator -= FIXED_DT;
      guard += 1;
    }
  }
  viewmodelMixer?.update(delta);
  hud.update({
    score: state.score,
    health: state.health,
    ammo: state.ammo,
    reserve: state.reserve,
    targetsHit: state.targetsHit,
    timeRemaining: state.timeRemaining,
    phase: state.phase,
    locked: pointerLocked,
    reloading: player.reloadTimer > 0,
    hitFlash: hitMarker,
  });
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// ---------------------------------------------------------------- bridge
installThreePlaytestBridge({
  camera,
  diagnostics: () => [
    { label: "FPS", value: Math.round(fps) },
    { label: "phase", value: state.phase },
    { label: "targetsHit", value: state.targetsHit },
  ],
  entities: () => [
    { id: "player", object: camera, path: "player" },
    { id: "enemy", object: enemy.root, path: "enemy" },
    ...world.targets.map((target, index) => ({
      id: `target-${index}`,
      object: target.plate,
      path: `targets/${index}`,
    })),
  ],
  fixedStep: (ticks) => {
    externalClockUntil = performance.now() + 500;
    for (let index = 0; index < ticks; index += 1) tick(FIXED_DT);
  },
  tick: () => frame,
  gameplay: () => ({
    animation: {
      player: {
        clip: player.reloadTimer > 0 ? "reload" : player.velocity.length() > 0.4 ? "walk" : "idle",
        advancedFrames: frame,
      },
      enemy: { clip: enemy.state, advancedFrames: frame },
    },
    states: {
      player: state.health <= 0 ? "dead" : player.reloadTimer > 0 ? "reloading" : "idle",
      enemy: enemy.state,
      mission: state.phase,
    },
  }),
  renderer,
  resources: { read: () => ({ state: { ...state } }) },
  scene,
});

// keep unused-but-meaningful references honest for the typechecker
void faceMap;
void elapsed;

// debug handle used by the local capture loop; harmless in production
(window as unknown as Record<string, unknown>).__g = { scene, camera, renderer, world, player, state, enemy };
