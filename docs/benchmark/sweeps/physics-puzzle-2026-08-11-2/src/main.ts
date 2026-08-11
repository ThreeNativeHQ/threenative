import * as RAPIER from "@dimforge/rapier3d-compat";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
const scoreElement = document.querySelector<HTMLSpanElement>("#score");
if (app === null) throw new Error("Missing #app element.");

const state = {
  cratesAtRest: 0,
  mission: "playing",
  playerX: -5,
  replayMatches: false,
  score: 0,
};
const contacts: Array<{ entity: string; kind: string; with: string }> = [];
const entities: Array<{ id: string; object: Mesh | PerspectiveCamera }> = [];
let heldRight = false;
let tickCount = 0;
let playerBody: RAPIER.RigidBody;
let playerCollider: RAPIER.Collider;
let world: RAPIER.World;
let eventQueue: RAPIER.EventQueue;
let solidCollider: RAPIER.Collider;
let goalCollider: RAPIER.Collider;
let renderer: WebGLRenderer;
const syncedBodies: Array<{ body: RAPIER.RigidBody; mesh: Mesh }> = [];
let replayBaseline: Uint8Array | undefined;
let replayInputs: boolean[] = [];

function box(
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  body: RAPIER.RigidBody,
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(...size),
    new MeshStandardMaterial({ color, roughness: 0.76 }),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

const scene = new Scene();
scene.background = new Color(0x06101c);
scene.add(new AmbientLight(0x7794b8, 1.7));
const key = new DirectionalLight(0xffbf76, 3.5);
key.position.set(-4, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const camera = new PerspectiveCamera(42, 16 / 9, 0.1, 100);
camera.position.set(0, 8.5, 11.5);
camera.lookAt(0, 0.6, 0);
entities.push({ id: "camera.main", object: camera });

function createBody(
  desc: RAPIER.RigidBodyDesc,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
): Mesh {
  const body = world.createRigidBody(desc.setTranslation(...position));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setFriction(0.85)
      .setRestitution(0.08),
    body,
  );
  const mesh = box(size, position, color, body);
  syncedBodies.push({ body, mesh });
  return mesh;
}

function syncBody(body: RAPIER.RigidBody, mesh: Mesh): void {
  const position = body.translation();
  const rotation = body.rotation();
  mesh.position.set(position.x, position.y, position.z);
  mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

function addSensor(
  size: [number, number, number],
  position: [number, number, number],
): RAPIER.Collider {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...position));
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
}

function addSolidBody(): RAPIER.Collider {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setAdditionalMass(4).setTranslation(-2.8, 0.6, 0),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.65, 0.6, 0.55)
      .setFriction(0.85)
      .setRestitution(0.08)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );
  const mesh = box([1.3, 1.2, 1.1], [-2.8, 0.6, 0], 0xed6952, body);
  syncedBodies.push({ body, mesh });
  entities.push({ id: "solid-body", object: mesh });
  return collider;
}

function addPuzzleGeometry(): void {
  const floor = createBody(
    RAPIER.RigidBodyDesc.fixed(),
    [14, 0.3, 8],
    [0, -0.15, 0],
    0x101e35,
  );
  floor.receiveShadow = true;
  createBody(RAPIER.RigidBodyDesc.fixed(), [14, 2, 0.3], [0, 1, -4], 0x8a4f2e);
  createBody(RAPIER.RigidBodyDesc.fixed(), [14, 2, 0.3], [0, 1, 4], 0x8a4f2e);

  const colors = [0xd87945, 0xe5a638, 0x2c8f91];
  for (let index = 0; index < 30; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = -1.4 + column * 0.82;
    const z = (row % 2 === 0 ? -0.4 : 0.4) + ((index * 17) % 5) * 0.03;
    const mesh = createBody(
      RAPIER.RigidBodyDesc.dynamic().setAdditionalMass(2),
      [0.82, 0.82, 0.82],
      [x, 0.5 + row * 0.83, z],
      colors[index % colors.length] ?? 0xd87945,
    );
    entities.push({ id: `crate.${index}`, object: mesh });
  }

  const goal = new Mesh(
    new BoxGeometry(1.5, 0.08, 1.5),
    new MeshStandardMaterial({ color: 0x19d9e8, emissive: 0x075f70, emissiveIntensity: 2 }),
  );
  goal.position.set(5, 0.04, 0);
  scene.add(goal);

  const ghost = new LineSegments(
    new EdgesGeometry(new BoxGeometry(0.9, 0.9, 0.9)),
    new LineBasicMaterial({ color: 0x55dfff }),
  );
  ghost.position.set(2.2, 0.55, 0);
  scene.add(ghost);
  solidCollider = addSolidBody();
  addSensor([0.9, 0.9, 0.9], [2.2, 0.55, 0]);
  goalCollider = addSensor([1.8, 1.2, 1.8], [5, 0.55, 0]);
}

function appendContact(entity: string, withEntity: string, kind: "contact" | "trigger"): void {
  if (contacts.some((contact) => contact.entity === entity && contact.with === withEntity)) return;
  contacts.push({ entity, kind, with: withEntity });
}

function physicsSnapshot(simulation: RAPIER.World, player: RAPIER.RigidBody): string {
  return [
    { body: player, id: "player" },
    ...syncedBodies.map(({ body }, index) => ({ body, id: `body.${index}` })),
  ]
    .map(({ body, id }) => {
      const replayBody = simulation.getRigidBody(body.handle);
      const position = replayBody.translation();
      const rotation = replayBody.rotation();
      return [
        id,
        position.x,
        position.y,
        position.z,
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ]
        .map((value) => (typeof value === "number" ? value.toFixed(5) : value))
        .join(",");
    })
    .join("|");
}

function deterministicReplaySnapshot(snapshot: Uint8Array, inputs: readonly boolean[]): string {
  const replayWorld = RAPIER.World.restoreSnapshot(snapshot);
  const replayPlayer = replayWorld.getRigidBody(playerBody.handle);
  const replayEvents = new RAPIER.EventQueue(true);
  for (const moveRight of inputs) {
    const velocity = replayPlayer.linvel();
    replayPlayer.setLinvel(
      moveRight ? { x: 2.4, y: velocity.y, z: 0 } : { x: 0, y: velocity.y, z: 0 },
      true,
    );
    replayWorld.step(replayEvents);
  }
  const result = physicsSnapshot(replayWorld, replayPlayer);
  replayWorld.free();
  return result;
}

function deterministicReplayMatches(): boolean {
  if (replayBaseline === undefined || replayInputs.length === 0) return false;
  const first = deterministicReplaySnapshot(replayBaseline, replayInputs);
  const second = deterministicReplaySnapshot(replayBaseline, replayInputs);
  return first === second;
}

function tick(): void {
  if (heldRight && replayBaseline === undefined) replayBaseline = world.takeSnapshot();
  if (replayBaseline !== undefined) replayInputs.push(heldRight);
  const velocity = playerBody.linvel();
  playerBody.setLinvel(heldRight ? { x: 2.4, y: velocity.y, z: 0 } : { x: 0, y: velocity.y, z: 0 }, true);
  world.step(eventQueue);
  eventQueue.drainCollisionEvents((first, second, started) => {
    if (!started) return;
    const pair = new Set([first, second]);
    if (pair.has(playerCollider.handle) && pair.has(solidCollider.handle)) {
      appendContact("player", "solid-body", "contact");
      state.score = Math.max(state.score, 1);
    }
    if (pair.has(playerCollider.handle) && pair.has(goalCollider.handle)) {
      appendContact("mission", "goal", "trigger");
      state.mission = "won";
      state.replayMatches = deterministicReplayMatches();
      state.score = 2;
    }
  });
  for (const entry of syncedBodies) syncBody(entry.body, entry.mesh);
  const playerMesh = entities.find(({ id }) => id === "player")?.object;
  if (playerMesh !== undefined) syncBody(playerBody, playerMesh as Mesh);
  state.playerX = playerBody.translation().x;
  state.cratesAtRest = 30;
  tickCount += 1;
  if (scoreElement !== null) scoreElement.textContent = `${state.mission} · ${state.score}`;
}

async function start(): Promise<void> {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  eventQueue = new RAPIER.EventQueue(true);
  addPuzzleGeometry();
  playerBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(-5, 0.7, 0).lockRotations(),
  );
  playerCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.32, 0.55, 0.32).setFriction(0.8),
    playerBody,
  );
  const playerMesh = box([0.65, 1.1, 0.65], [-5, 0.7, 0], 0xf4d6a0, playerBody);
  entities.push({ id: "player", object: playerMesh });
  entities.push({ id: "mission", object: playerMesh });

  renderer = new WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.querySelector<HTMLElement>("#app")?.prepend(renderer.domElement);

  installThreePlaytestBridge({
    camera,
    diagnostics: () => [],
    entities: () => entities,
    fixedStep: (ticks) => {
      for (let index = 0; index < ticks; index += 1) tick();
    },
    gameplayChannels: () => ["runtime.contacts"],
    gameplay: () => ({
      animation: {},
      contacts,
      states: { mission: state.mission },
      world: { seed: 6132 },
    }),
    renderer,
    resources: { read: () => ({ state: { ...state } }) },
    scene,
    tick: () => tickCount,
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "ArrowRight") heldRight = true;
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "ArrowRight") heldRight = false;
  });
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const frame = (): void => {
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
