// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Everything in the clearing that the rules move or change: the three sigils, the altar, the chest,
// the pots, the briarlings, the keeper and her speech bubble, and the gems. Each is a handle the
// scene poses each frame from the rules' state — nothing here decides what happens.
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  Sprite,
  TorusGeometry,
  Vector2,
} from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import type { IGem } from "../logic/adventure.js";
import { ALTAR, CHEST, ENEMIES, KEEPER, POTS, SIGIL_SITES } from "../logic/layout.js";
import type { SigilId } from "../logic/quest.js";
import { groundHeight } from "../logic/terrain.js";
import { type ICharacter, createCharacter } from "./character.js";
import { ADDITIVE, type IForestMaterials } from "./materials.js";
import type { IRenderTools } from "./tools.js";

export interface ISigilView {
  readonly aura: Sprite;
  readonly core: Mesh;
  readonly group: Group;
  readonly id: SigilId;
  readonly ring: Mesh;
}

export interface IBriarlingView {
  readonly crown: Mesh;
  readonly group: Group;
  readonly trunk: Mesh;
}

export interface IProps {
  readonly altar: { readonly beam: Sprite; readonly group: Group; readonly material: MeshStandardMaterial };
  readonly briarlings: readonly IBriarlingView[];
  readonly chest: { readonly group: Group; readonly lid: Group };
  readonly gems: { readonly mesh: InstancedMesh; readonly sync: (gems: readonly IGem[], time: number) => void };
  readonly keeper: ICharacter;
  readonly pots: readonly Group[];
  readonly root: Group;
  readonly sigils: readonly ISigilView[];
  readonly speech: Sprite;
  readonly dispose: () => void;
}

const GEM_CAPACITY = 96;

export function createProps(tools: IRenderTools, mats: IForestMaterials): IProps {
  const root = new Group();
  const owned: (BufferGeometry | Material)[] = [];
  const own = <T extends BufferGeometry | Material>(item: T): T => {
    owned.push(item);
    return item;
  };
  const mesh = (geometry: BufferGeometry, material: Material, parent: Object3D, x = 0, y = 0, z = 0): Mesh => {
    const item = new Mesh(own(geometry), material);
    item.position.set(x, y, z);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  };
  const ball = (parent: Object3D, material: Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx): Mesh => {
    const item = mesh(new SphereGeometry(1, 12, 8), material, parent, x, y, z);
    item.scale.set(sx, sy, sz);
    return item;
  };
  const at = (group: Group, x: number, z: number): Group => {
    group.position.set(x, groundHeight(x, z), z);
    root.add(group);
    return group;
  };
  const glowSprite = (color: number, opacity: number): Sprite =>
    new Sprite(own(new SpriteNodeMaterial({ color, map: mats.glowMap, opacity, ...ADDITIVE })));

  // --- sigils: a pedestal, a hovering crystal, a ring, an aura -----------------------------------------------------
  const sigils: ISigilView[] = (Object.keys(SIGIL_SITES) as SigilId[]).map((id) => {
    const site = SIGIL_SITES[id];
    const group = at(new Group(), site.x, site.z);
    mesh(new CylinderGeometry(0.45, 0.55, 0.22, 9), mats.stone, group, 0, 0.1, 0);
    const core = mesh(
      new OctahedronGeometry(0.26),
      own(new MeshStandardMaterial({ color: site.color, emissive: site.color, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.2 })),
      group,
      0,
      1.05,
      0,
    );
    core.scale.set(0.82, 1.75, 0.82);
    const ring = mesh(new TorusGeometry(0.42, 0.025, 7, 40), mats.brass, group, 0, 1.05, 0);
    ring.rotation.set(0.5, 0, 0.25);
    const aura = glowSprite(site.color, 0.6);
    aura.position.y = 1.1;
    aura.scale.set(2.2, 2.2, 1);
    group.add(aura);
    return { aura, core, group, id, ring };
  });

  // --- altar: three steps of stone, an idle ring, standing stones ------------------------------------------------------
  const altarGroup = at(new Group(), ALTAR.x, ALTAR.z);
  mesh(new CylinderGeometry(1.3, 1.55, 0.24, 24), mats.darkStone, altarGroup, 0, 0.1, 0);
  mesh(new CylinderGeometry(0.82, 1, 0.38, 16), mats.stone, altarGroup, 0, 0.34, 0);
  mesh(new IcosahedronGeometry(0.5, 1), mats.moss, altarGroup, 0, 0.75, 0).scale.set(1, 0.45, 1);
  const altarMaterial = own(new MeshStandardMaterial({ color: 0x88cbaa, emissive: 0x87d6b7, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.35 }));
  mesh(new TorusGeometry(0.62, 0.034, 8, 64), altarMaterial, altarGroup, 0, 0.6, 0).rotation.x = Math.PI / 2;
  const beam = glowSprite(0xc9ffe0, 0);
  beam.position.y = 1.7;
  beam.scale.set(5, 6, 1);
  altarGroup.add(beam);
  for (let j = 0; j < 5; j += 1) {
    const a = (j / 5) * Math.PI * 2;
    const x = Math.cos(a) * 2.65;
    const z = Math.sin(a) * 2.65;
    if (z > 1.8) continue;
    const stone = mesh(new BoxGeometry(0.55, 2.4, 0.44), mats.darkStone, altarGroup, x, 1.05, z);
    stone.rotation.set(0, -a, Math.sin(a) * 0.11);
    mesh(new OctahedronGeometry(0.09), altarMaterial, altarGroup, x, 1.75, z + 0.24);
  }

  // --- chest -----------------------------------------------------------------------------------------------------------------------
  const chestGroup = at(new Group(), CHEST.x, CHEST.z);
  chestGroup.rotation.y = 0.4;
  mesh(new BoxGeometry(0.83, 0.47, 0.57), mats.wood, chestGroup, 0, 0.255, 0);
  for (const x of [-0.3, 0.3]) mesh(new BoxGeometry(0.062, 0.48, 0.59), mats.brass, chestGroup, x, 0.26, 0);
  const lid = new Group();
  lid.position.set(0, 0.48, -0.285);
  chestGroup.add(lid);
  mesh(new BoxGeometry(0.85, 0.16, 0.59), mats.wood, lid, 0, 0.05, 0.285);
  mesh(new BoxGeometry(0.13, 0.16, 0.055), mats.brass, chestGroup, 0, 0.45, 0.32);

  // --- pots --------------------------------------------------------------------------------------------------------------------------
  const terra = own(new MeshStandardMaterial({ color: 0x88734f, roughness: 0.94 }));
  const potProfile = [[0.17, 0], [0.28, 0.12], [0.29, 0.3], [0.17, 0.48], [0.2, 0.5], [0.19, 0.54]].map(([x, y]) => new Vector2(x, y));
  const pots = POTS.map(([x, z]) => {
    const group = at(new Group(), x, z);
    mesh(new LatheGeometry(potProfile, 14), terra, group);
    mesh(new TorusGeometry(0.18, 0.025, 6, 16), mats.pale, group, 0, 0.51, 0).rotation.x = Math.PI / 2;
    return group;
  });

  // --- briarlings: a walking stump with a moss crown, glaring amber eyes and thorns -------------------------------------------------
  const briarlings: IBriarlingView[] = ENEMIES.map(([x, z]) => {
    const group = at(new Group(), x, z);
    // The two surfaces that flash on a hit are this creature's own; the rest is baked once.
    const trunk = mesh(new CylinderGeometry(0.32, 0.44, 0.67, 10), own(mats.bark.clone()), group, 0, 0.48, 0);
    const crown = mesh(new SphereGeometry(1, 14, 8), own(mats.moss.clone()), group, 0, 0.89, 0);
    crown.scale.set(0.6, 0.28, 0.55);
    const parts = new Group();
    const eye = own(new MeshStandardMaterial({ color: 0xffd992, emissive: 0xff9922, emissiveIntensity: 2 }));
    for (const side of [-1, 1]) {
      ball(parts, mats.black, side * 0.15, 0.61, 0.315, 0.1, 0.13, 0.025);
      ball(parts, eye, side * 0.15, 0.64, 0.34, 0.045, 0.065, 0.024);
      const arm = mesh(new CylinderGeometry(0.04, 0.067, 0.42, 7), mats.bark, parts, side * 0.47, 0.44, 0.08);
      arm.rotation.z = side * 0.9;
      ball(parts, mats.darkWood, side * 0.24, 0.16, 0.1, 0.15, 0.12, 0.2);
    }
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      const thorn = mesh(new ConeGeometry(0.08, 0.33, 6), mats.darkWood, parts, Math.cos(a) * 0.38 * 0.7, 1.0, Math.sin(a) * 0.38 * 0.7);
      thorn.rotation.set(Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45);
    }
    for (const baked of tools.merge(parts, "briarling")) {
      baked.castShadow = true;
      group.add(baked);
    }
    return { crown, group, trunk };
  });

  // --- the keeper and her speech bubble --------------------------------------------------------------------------------------------------
  const keeper = createCharacter(tools, "keeper");
  keeper.group.position.set(KEEPER.x, groundHeight(KEEPER.x, KEEPER.z), KEEPER.z);
  keeper.group.rotation.y = -0.7;
  root.add(keeper.group);
  const speech = new Sprite(own(new SpriteNodeMaterial({ depthWrite: false, map: mats.bubble, transparent: true })));
  speech.position.set(KEEPER.x, groundHeight(KEEPER.x, KEEPER.z) + 2.05, KEEPER.z);
  speech.scale.set(0.5, 0.5, 1);
  root.add(speech);

  // --- gems: one instanced mesh, refilled from the rules' list each frame ---------------------------------------------------------------------
  const gemMesh = new InstancedMesh(
    own(new OctahedronGeometry(0.125)),
    own(new MeshStandardMaterial({ color: 0x88d6a6, emissive: 0x31775a, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.24 })),
    GEM_CAPACITY,
  );
  gemMesh.castShadow = true;
  gemMesh.frustumCulled = false;
  gemMesh.count = 0;
  root.add(gemMesh);
  const dummy = new Object3D();
  const matrix = new Matrix4();
  const sync = (gems: readonly IGem[], time: number): void => {
    const n = Math.min(gems.length, GEM_CAPACITY);
    for (let i = 0; i < n; i += 1) {
      const g = gems[i] as IGem;
      dummy.position.set(g.x, g.baseY + Math.sin(time * 2 + g.phase) * 0.07, g.z);
      dummy.rotation.set(0, time * 1.3 + g.phase, 0);
      dummy.scale.set(g.value > 1 ? 1.35 : 1, g.value > 1 ? 2.4 : 1.75, g.value > 1 ? 1.35 : 1);
      dummy.updateMatrix();
      gemMesh.setMatrixAt(i, matrix.copy(dummy.matrix));
    }
    gemMesh.count = n;
    gemMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    altar: { beam, group: altarGroup, material: altarMaterial },
    briarlings,
    chest: { group: chestGroup, lid },
    dispose: () => {
      keeper.dispose();
      for (const item of owned) item.dispose();
    },
    gems: { mesh: gemMesh, sync },
    keeper,
    pots,
    root,
    sigils,
    speech,
  };
}
