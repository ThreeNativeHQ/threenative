import { Scene, type Ctx } from "@threenative/core";
import { type PhysicsContext, CollisionShape3D, RigidBody3D } from "@threenative/physics";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  PointLight,
  type Material,
  type PerspectiveCamera,
  Vector3,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Player, type PlayerMaterials } from "../entities/Player.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, makeRandom, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { AreaId, GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const KILL_PLANE = -4;
const HUB_X = -2;
const NORTH_Z = -9;
const SOUTH_Z = 9;
const INSPECT_RANGE = 1.75;

type Materials = ReturnType<typeof createMaterials>;
type PointId = "hub.waystone" | "north.archive" | "south.tide";

type PointOfInterest = {
  readonly id: PointId;
  readonly area: AreaId;
  readonly group: Group;
  readonly orb: Mesh;
  readonly message: string;
  inspected: boolean;
};

const AREA_LABELS: Record<AreaId, string> = {
  hub: "The Quiet Hub",
  north: "Moss Archive",
  south: "Glass Tide",
};

export class Play extends Scene<GameState, PhysicsContext> {
  #world: Group | undefined;
  #northArrangement: Group | undefined;
  #southArrangement: Group | undefined;
  #beacon: Group | undefined;
  #floor: RigidBody3D | undefined;
  #player: Player | undefined;
  #springArm: SpringArm | undefined;
  #materials: Materials | undefined;
  #points: PointOfInterest[] = [];
  #area: AreaId = "hub";
  #previousArea: AreaId = "hub";
  #signalFound = false;
  #time = 0;

  enter(ctx: GameCtx): void {
    this.#materials = createMaterials();
    const materials = this.#materials;
    setupSky(ctx.scene, { top: 0x0c1628, bottom: 0x294258 });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);

    const world = new Group();
    world.name = "exploration-world";
    this.#world = world;
    ctx.add(world);

    const key = new DirectionalLight(0xffd9a3, 0.7);
    key.position.set(-7, 8, 5);
    world.add(key);
    const beaconLight = new PointLight(0xffc862, 10, 14, 2);
    beaconLight.position.set(0, 3.2, 0);
    world.add(beaconLight);
    const ambient = new AmbientLight(0x8fb9c8, 0.16);
    world.add(ambient);

    const floorMesh = block(12, 0.24, 30, materials.floor, { radius: 0.18 });
    floorMesh.position.set(HUB_X, -0.12, 0);
    world.add(floorMesh);
    this.#floor = new RigidBody3D({
      object: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });

    world.add(this.#makePlatform(8.4, 7.5, HUB_X, 0, materials.hub));
    world.add(this.#makePlatform(8.4, 7.5, HUB_X, NORTH_Z, materials.moss));
    world.add(this.#makePlatform(8.4, 7.5, HUB_X, SOUTH_Z, materials.tide));
    this.#addPathStones(world, materials.stone);
    this.#addGate(world, -5, materials.moss, materials.glow, "N");
    this.#addGate(world, 5, materials.tide, materials.warmGlow, "S");

    const hub = new Group();
    hub.name = "hub-arrangement";
    world.add(hub);
    this.#addHubLandmark(hub, materials);
    const waystone = this.#makePoint("hub.waystone", "hub", HUB_X - 1.35, 0, materials.glow, "The waystone remembers every path.");
    hub.add(waystone.group);
    this.#points.push(waystone);

    const north = new Group();
    north.name = "north-arrangement";
    north.visible = false;
    this.#northArrangement = north;
    world.add(north);
    this.#addNorthArrangement(north, materials);
    const archive = this.#makePoint("north.archive", "north", HUB_X, NORTH_Z, materials.glow, "A shelf of stones records a vanished shoreline.");
    north.add(archive.group);
    this.#points.push(archive);

    const south = new Group();
    south.name = "south-arrangement";
    south.visible = false;
    this.#southArrangement = south;
    world.add(south);
    this.#addSouthArrangement(south, materials);
    const tide = this.#makePoint("south.tide", "south", HUB_X, SOUTH_Z, materials.warmGlow, "The glass tide is warm, though the sea is gone.");
    south.add(tide.group);
    this.#points.push(tide);

    const playerMaterials: PlayerMaterials = { accent: materials.playerAccent, body: materials.player };
    this.#player = new Player(ctx, playerMaterials);
    this.#springArm = createSpringArm(ctx.camera as PerspectiveCamera, {
      damping: 0.2,
      lookAhead: new Vector3(0, 0.9, -0.4),
      offset: new Vector3(0, 4.2, 8.5),
    });
    this.#springArm.snap(this.#player.mesh.position);

    this.#beacon = hub.getObjectByName("hub-beacon") as Group | undefined;
    ctx.entities.add("player", this.#player);
    ctx.entities.add("landmark.beacon", this.#beacon ?? hub);
    for (const point of this.#points) ctx.entities.add(`poi.${point.id}`, point.group);

    const levelX = ctx.random.range(-1, 1);
    ctx.state.set({
      area: "hub",
      areaLabel: AREA_LABELS.hub,
      inspectedPoints: [],
      inspections: 0,
      levelX,
      objectiveComplete: false,
      playerX: HUB_X,
      playerZ: 0,
      returns: 0,
      score: 0,
      signalFound: false,
      transitionCount: 0,
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    player.update(ctx, dt);
    this.#time += dt;
    this.#animateWorld();
    let respawned = false;
    if (player.mesh.position.y < KILL_PLANE) {
      player.respawn();
      this.#springArm?.snap(player.mesh.position);
      respawned = true;
    }
    this.#springArm?.follow(player.mesh.position, dt);
    this.#updateArea(ctx, player.mesh.position.z);
    this.#tryInspect(ctx);

    const previous = ctx.state.getState();
    const signalFound = this.#signalFound || player.mesh.position.x > HUB_X + 1;
    if (signalFound && !this.#signalFound) this.#signalFound = true;
    ctx.state.set({
      coyoteJumps: player.debug().coyoteJumps,
      jumps: player.debug().jumps,
      peakRise: Math.max(previous.peakRise, player.mesh.position.y - 0.5),
      playerX: player.mesh.position.x,
      playerZ: player.mesh.position.z,
      respawns: previous.respawns + (respawned ? 1 : 0),
      score: Math.max(previous.score, signalFound ? 1 : 0),
      signalFound,
    });
  }

  exit(ctx: GameCtx): void {
    for (const point of this.#points) ctx.entities.remove(`poi.${point.id}`);
    ctx.entities.remove("landmark.beacon");
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#floor?.dispose();
    this.#world?.removeFromParent();
    if (this.#materials !== undefined) {
      for (const material of Object.values(this.#materials)) material.dispose();
    }
    this.#world = undefined;
    this.#floor = undefined;
    this.#player = undefined;
    this.#springArm = undefined;
    this.#materials = undefined;
    this.#northArrangement = undefined;
    this.#southArrangement = undefined;
    this.#beacon = undefined;
    this.#points = [];
    this.#area = "hub";
    this.#previousArea = "hub";
    this.#signalFound = false;
  }

  #makePlatform(width: number, depth: number, x: number, z: number, material: Material): Mesh {
    const platform = block(width, 0.22, depth, material, { radius: 0.2 });
    platform.position.set(x, 0.02, z);
    return platform;
  }

  #addPathStones(world: Group, material: Material): void {
    for (const z of [-3.8, -2.7, -1.6, 1.6, 2.7, 3.8]) {
      const stone = block(1.4, 0.12, 0.72, material, { radius: 0.22 });
      stone.position.set(HUB_X + (z % 2 === 0 ? 0.75 : -0.75), 0.17, z);
      stone.rotation.y = z * 0.12;
      world.add(stone);
    }
  }

  #addGate(world: Group, z: number, gateMaterial: Material, orbMaterial: Material, label: string): void {
    const gate = new Group();
    gate.position.set(HUB_X, 0, z);
    const left = block(0.42, 2.4, 0.46, gateMaterial);
    left.position.set(-2.2, 1.2, 0);
    const right = left.clone();
    right.position.x = 2.2;
    const lintel = block(4.8, 0.34, 0.46, gateMaterial);
    lintel.position.y = 2.28;
    const marker = ball(0.22, orbMaterial);
    marker.position.set(0, 2.8, 0);
    gate.add(left, right, lintel, marker);
    const sign = block(0.84, 0.18, 0.08, orbMaterial);
    sign.position.set(0, 1.72, 0.24);
    sign.scale.x = label === "N" ? 0.9 : 1.15;
    gate.add(sign);
    world.add(gate);
  }

  #addHubLandmark(hub: Group, materials: Materials): void {
    const beacon = new Group();
    beacon.name = "hub-beacon";
    beacon.position.set(0, 0, 0);
    const plinth = block(2.2, 0.45, 2.2, materials.stone, { radius: 0.18 });
    plinth.position.y = 0.3;
    const shaft = block(1.25, 3.1, 1.15, materials.bark, { radius: 0.12 });
    shaft.position.y = 2.05;
    const roof = spike(1.2, 1.5, materials.gold, { segments: 4 });
    roof.position.y = 4.35;
    roof.rotation.y = Math.PI / 4;
    const orb = ball(0.58, materials.warmGlow);
    orb.position.set(0, 2.45, -0.62);
    beacon.add(plinth, shaft, roof, orb);
    hub.add(beacon);

    for (const x of [-5.5, 1.5]) this.#addTree(hub, x, -1.7, materials);
    for (const x of [-4.9, 0.8]) this.#addTree(hub, x, 2.1, materials);
  }

  #addTree(parent: Group, x: number, z: number, materials: Materials): void {
    const tree = new Group();
    tree.position.set(x, 0, z);
    const trunk = tube(0.22, 0.3, 1.8, materials.bark);
    trunk.position.y = 0.9;
    const crown = ball(1.1, materials.foliage);
    crown.position.y = 2.05;
    tree.add(trunk, crown);
    parent.add(tree);
  }

  #addNorthArrangement(parent: Group, materials: Materials): void {
    for (const [x, z, scale] of [[-4.2, NORTH_Z - 1.5, 1], [0.2, NORTH_Z + 1.1, 0.75], [1.6, NORTH_Z - 1.3, 0.9]] as const) {
      const stack = new Group();
      stack.position.set(x, 0, z);
      for (let index = 0; index < 3; index += 1) {
        const stone = block(0.9 - index * 0.1, 0.55, 0.8, index === 1 ? materials.gold : materials.stone);
        stone.position.set(index % 2 === 0 ? -0.15 : 0.18, 0.3 + index * 0.48, index * 0.05);
        stone.rotation.y = index * 0.25;
        stack.add(stone);
      }
      stack.scale.setScalar(scale);
      parent.add(stack);
    }
    for (const x of [-4.9, 2.1]) this.#addTree(parent, x, NORTH_Z + 1.7, materials);
    const arch = new Group();
    arch.position.set(HUB_X, 0, NORTH_Z - 2.3);
    const postA = block(0.35, 2.8, 0.35, materials.gold);
    postA.position.set(-1.7, 1.4, 0);
    const postB = postA.clone();
    postB.position.x = 1.7;
    const top = block(3.8, 0.32, 0.35, materials.gold);
    top.position.y = 2.65;
    arch.add(postA, postB, top);
    parent.add(arch);
  }

  #addSouthArrangement(parent: Group, materials: Materials): void {
    const dais = block(2.8, 0.32, 2.8, materials.coral, { radius: 0.25 });
    dais.position.set(HUB_X, 0.22, SOUTH_Z);
    parent.add(dais);
    for (const [x, z, height] of [[-4.4, SOUTH_Z - 1.2, 2.7], [0.5, SOUTH_Z - 1.5, 2.1], [1.3, SOUTH_Z + 1.2, 3.3]] as const) {
      const pillar = tube(0.36, 0.5, height, materials.stone);
      pillar.position.set(x, height / 2, z);
      parent.add(pillar);
      const cap = ball(0.48, materials.warmGlow);
      cap.position.set(x, height + 0.44, z);
      parent.add(cap);
    }
    for (const x of [-5.2, 1.9]) {
      const fin = spike(0.65, 2.1, materials.tide, { segments: 5 });
      fin.position.set(x, 1.05, SOUTH_Z + 1.8);
      fin.rotation.z = x < 0 ? -0.12 : 0.12;
      parent.add(fin);
    }
  }

  #makePoint(id: PointId, area: AreaId, x: number, z: number, material: Material, message: string): PointOfInterest {
    const group = new Group();
    group.name = id;
    group.position.set(x, 0, z);
    const base = block(1.1, 0.2, 1.1, material, { radius: 0.18 });
    base.position.y = 0.14;
    const stem = tube(0.1, 0.13, 0.85, material);
    stem.position.y = 0.62;
    const orb = ball(0.33, material);
    orb.position.y = 1.15;
    group.add(base, stem, orb);
    return { area, group, id, inspected: false, message, orb };
  }

  #updateArea(ctx: GameCtx, z: number): void {
    const next: AreaId = z < -5 ? "north" : z > 5 ? "south" : "hub";
    if (next === this.#area) return;
    const leftArea = this.#area;
    this.#previousArea = leftArea;
    this.#area = next;
    if (this.#northArrangement !== undefined) this.#northArrangement.visible = next === "north";
    if (this.#southArrangement !== undefined) this.#southArrangement.visible = next === "south";
    const state = ctx.state.getState();
    const returned = next === "hub" && (leftArea === "north" || leftArea === "south");
    const message = next === "hub" ? "The waystone is in sight again." : next === "north" ? "Moss Archive revealed · press E near the record stone." : "Glass Tide revealed · press E near the warm shard.";
    ctx.state.set({
      area: next,
      areaLabel: AREA_LABELS[next],
      returns: state.returns + (returned ? 1 : 0),
      transitionCount: state.transitionCount + 1,
      lastMessage: message,
    } as Partial<GameState>);
  }

  #tryInspect(ctx: GameCtx): void {
    if (!ctx.input.justPressed("inspect") || this.#player === undefined) return;
    const playerPosition = this.#player.mesh.position;
    const point = this.#points.find((candidate) => {
      if (candidate.inspected || candidate.area !== this.#area) return false;
      return candidate.group.position.distanceTo(playerPosition) <= INSPECT_RANGE;
    });
    if (point === undefined) return;
    point.inspected = true;
    point.orb.scale.setScalar(1.35);
    const state = ctx.state.getState();
    const inspectedPoints = [...state.inspectedPoints, point.id];
    ctx.state.set({
      inspectedPoints,
      inspections: inspectedPoints.length,
      lastMessage: point.message,
      objectiveComplete: inspectedPoints.length === 3,
      score: Math.max(state.score, inspectedPoints.length),
    });
  }

  #animateWorld(): void {
    if (this.#beacon !== undefined) this.#beacon.rotation.y = Math.sin(this.#time * 0.35) * 0.035;
    for (const point of this.#points) {
      point.orb.position.y = 1.15 + Math.sin(this.#time * 2 + point.group.position.z) * 0.08;
      point.orb.rotation.y += 0.012;
    }
  }
}
