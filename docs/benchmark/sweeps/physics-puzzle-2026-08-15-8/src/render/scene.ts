import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  WebGLRenderer,
} from "three";
import { CRATE_SIZE, GOAL, ROOM, type ILayout } from "../level.js";
import { buildCharacter, type ICharacterRig } from "./character.js";
import { crateTexture, floorTexture, goalTexture } from "./textures.js";

export interface IView {
  readonly camera: PerspectiveCamera;
  readonly character: ICharacterRig;
  readonly crates: readonly Mesh[];
  readonly ghosts: readonly Group[];
  readonly goal: Group;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  setWon(won: boolean): void;
}

const GOAL_IDLE = new Color(0x36d7f2);
const GOAL_WON = new Color(0x7bff9a);

export function buildView(canvasHost: HTMLElement, layout: ILayout): IView {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.setSize(globalThis.innerWidth, globalThis.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  canvasHost.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x070b16);
  scene.fog = new Fog(0x070b16, 26, 46);

  const camera = new PerspectiveCamera(
    41,
    globalThis.innerWidth / globalThis.innerHeight,
    0.1,
    120,
  );
  camera.position.set(-5.2, 15.4, 15.8);
  camera.lookAt(-0.1, 0.4, -0.8);

  addRoom(scene);
  addLights(scene);

  const crates = addCrates(scene, layout);
  const ghosts = addGhosts(scene, layout);
  const goal = addGoal(scene);

  const character = buildCharacter();
  scene.add(character.root);

  const goalRing = goal.getObjectByName("goal.ring") as Mesh | undefined;
  const goalLight = goal.getObjectByName("goal.light") as PointLight | undefined;

  globalThis.addEventListener("resize", () => {
    camera.aspect = globalThis.innerWidth / globalThis.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(globalThis.innerWidth, globalThis.innerHeight);
  });

  return {
    camera,
    character,
    crates,
    ghosts,
    goal,
    renderer,
    scene,
    setWon: (won) => {
      const tint = won ? GOAL_WON : GOAL_IDLE;
      if (goalRing !== undefined) (goalRing.material as MeshBasicMaterial).color.copy(tint);
      if (goalLight !== undefined) {
        goalLight.color.copy(tint);
        goalLight.intensity = won ? 90 : 42;
      }
    },
  };
}

function addRoom(scene: Scene): void {
  const floor = new Mesh(
    new PlaneGeometry(ROOM.halfX * 2, ROOM.halfZ * 2),
    new MeshStandardMaterial({
      color: 0x39415a,
      map: floorTexture(6),
      metalness: 0.05,
      roughness: 0.92,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const stone = new MeshStandardMaterial({ color: 0x8a7f63, roughness: 0.95 });
  const skirt = new MeshStandardMaterial({ color: 0x1b2130, roughness: 0.9 });
  const timber = new MeshStandardMaterial({ color: 0x6a4630, roughness: 0.75 });

  const walls: readonly [number, number, number, number][] = [
    [0, -ROOM.halfZ - 0.25, ROOM.halfX + 0.5, 0.5],
    [0, ROOM.halfZ + 0.25, ROOM.halfX + 0.5, 0.5],
    [-ROOM.halfX - 0.25, 0, 0.5, ROOM.halfZ + 0.5],
    [ROOM.halfX + 0.25, 0, 0.5, ROOM.halfZ + 0.5],
  ];
  for (const [x, z, halfX, halfZ] of walls) {
    const wall = new Mesh(new BoxGeometry(halfX * 2, ROOM.wallHeight, halfZ * 2), stone);
    wall.position.set(x, ROOM.wallHeight / 2, z);
    wall.receiveShadow = true;
    scene.add(wall);

    const base = new Mesh(new BoxGeometry(halfX * 2 + 0.14, 0.62, halfZ * 2 + 0.14), skirt);
    base.position.set(x, 0.31, z);
    scene.add(base);

    const rail = new Mesh(new BoxGeometry(halfX * 2 + 0.22, 0.34, halfZ * 2 + 0.22), timber);
    rail.position.set(x, ROOM.wallHeight - 0.17, z);
    scene.add(rail);
  }

  for (const [x, z] of [
    [-ROOM.halfX - 0.25, -ROOM.halfZ - 0.25],
    [-ROOM.halfX - 0.25, ROOM.halfZ + 0.25],
    [ROOM.halfX + 0.25, -ROOM.halfZ - 0.25],
    [ROOM.halfX + 0.25, ROOM.halfZ + 0.25],
  ] as const) {
    const pillar = new Mesh(new BoxGeometry(1.05, ROOM.wallHeight + 0.5, 1.05), timber);
    pillar.position.set(x, (ROOM.wallHeight + 0.5) / 2, z);
    scene.add(pillar);
  }
}

function addLights(scene: Scene): void {
  scene.add(new AmbientLight(0x39476e, 1.7));

  const key = new DirectionalLight(0xffe0b6, 2.1);
  key.position.set(-8, 16, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.camera.far = 46;
  key.shadow.bias = -0.0012;
  scene.add(key);

  for (const [x, z] of [
    [-6.2, -ROOM.halfZ],
    [1.6, -ROOM.halfZ],
    [-ROOM.halfX, 1.4],
  ] as const) {
    const lantern = new Mesh(
      new BoxGeometry(0.3, 0.42, 0.3),
      new MeshBasicMaterial({ color: 0xffcb7d }),
    );
    lantern.position.set(x, 2.1, z);
    scene.add(lantern);

    const flame = new PointLight(0xffa94d, 34, 13);
    flame.position.set(x, 2.1, z);
    scene.add(flame);
  }
}

function addCrates(scene: Scene, layout: ILayout): Mesh[] {
  const geometry = new BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
  const map = crateTexture();
  const materials = new Map<number, MeshStandardMaterial>();
  return layout.crates.map((spec) => {
    let material = materials.get(spec.tint);
    if (material === undefined) {
      material = new MeshStandardMaterial({ color: spec.tint, map, roughness: 0.78 });
      materials.set(spec.tint, material);
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = `crate.${spec.index}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
}

function addGhosts(scene: Scene, layout: ILayout): Group[] {
  const geometry = new BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
  const material = new MeshStandardMaterial({
    color: 0x2ec7ff,
    emissive: 0x1b83b8,
    emissiveIntensity: 1.4,
    opacity: 0.34,
    roughness: 0.2,
    transparent: true,
  });
  const edgeMaterial = new LineBasicMaterial({ color: 0x9df3ff });
  return layout.ghosts.map((spec) => {
    const group = new Group();
    group.name = `ghost.${spec.index}`;
    group.position.set(spec.x, spec.y, spec.z);
    group.rotation.y = spec.yaw;

    const mesh = new Mesh(geometry, material);
    group.add(mesh);
    group.add(new LineSegments(new EdgesGeometry(geometry), edgeMaterial));

    const glow = new PointLight(0x4fd8ff, 6, 4.5);
    group.add(glow);
    scene.add(group);
    return group;
  });
}

function addGoal(scene: Scene): Group {
  const group = new Group();
  group.name = "goal";
  group.position.set(GOAL.center.x, 0, GOAL.center.z);

  const frame = new Mesh(
    new BoxGeometry(GOAL.halfX * 2 + 0.5, 0.24, GOAL.halfZ * 2 + 0.5),
    new MeshStandardMaterial({ color: 0x6f6549, roughness: 0.9 }),
  );
  frame.position.y = 0.12;
  frame.receiveShadow = true;
  group.add(frame);

  const ring = new Mesh(
    new PlaneGeometry(GOAL.halfX * 2, GOAL.halfZ * 2),
    new MeshBasicMaterial({ color: GOAL_IDLE, map: goalTexture(), toneMapped: false }),
  );
  ring.name = "goal.ring";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);

  const light = new PointLight(GOAL_IDLE, 42, 12);
  light.name = "goal.light";
  light.position.y = 2.2;
  group.add(light);

  scene.add(group);
  return group;
}
