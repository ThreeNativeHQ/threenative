import { Scene, type Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, Mesh, type Material, type PerspectiveCamera, Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Player } from "../entities/Player.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, makeRandom, roundedBox, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const LANES: readonly number[] = [-2.8, 0, 2.8];
const ROAD_LENGTH = 420;
const ROAD_CENTER_Z = -190;
const BASE_SPEED = 11;

function laneX(lane: number): number {
  return LANES[lane] ?? 0;
}

type Obstacle = { readonly mesh: Group; lane: number; z: number; height: number; width: number };
type Pickup = { readonly mesh: Group; lane: number; z: number; collected: boolean };

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #player: Player | undefined;
  #springArm: SpringArm | undefined;
  #roadDetails: Group | undefined;
  #obstacles: Obstacle[] = [];
  #pickups: Pickup[] = [];
  #props: Group[] = [];
  #distance = 0;
  #score = 0;
  #collected = 0;
  #collisions = 0;
  #respawns = 0;
  #run = 1;
  #phase: GameState["phase"] = "running";
  #spawnTailZ = -168;
  #patternIndex = 0;
  #random = makeRandom(90210);

  enter(ctx: GameCtx): void {
    setupSky(ctx.scene, { top: 0x8bd8f4, bottom: 0x5ca8c9 });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);
    this.#springArm = createSpringArm(ctx.camera as PerspectiveCamera, {
      damping: 0.2,
      lookAhead: new Vector3(0, 0.9, -13),
      offset: new Vector3(0, 5.2, 10.5),
    });

    const materials = createMaterials();
    const floorMesh = new Mesh(roundedBox(10.4, 0.3, ROAD_LENGTH, 0.14), materials.road);
    floorMesh.position.set(0, -0.16, ROAD_CENTER_Z);
    floorMesh.receiveShadow = true;
    ctx.add(floorMesh);
    this.#floor = new RigidBody3D({
      object: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });

    this.#roadDetails = new Group();
    ctx.add(this.#roadDetails);
    this.#buildRoadDetails(materials.lane, materials.roadEdge);
    this.#buildRoadside(ctx, materials.trunk, materials.foliage, materials.foliageDark, materials.sign);

    this.#player = new Player(ctx, materials.player);
    this.#springArm.snap(this.#player.mesh.position);
    ctx.entities.add("player", this.#player);
    this.#buildObstacles(ctx, materials.hazard, materials.hazardDark, materials.playerTop);
    this.#buildPickups(ctx, materials.pickup, materials.pickupLight);
    ctx.state.set({
      collected: 0,
      collisions: 0,
      coyoteJumps: 0,
      distance: 0,
      jumps: 0,
      lane: 1,
      levelX: -99,
      peakRise: 0,
      phase: "running",
      playerX: 0,
      playerZ: 0,
      respawns: 0,
      run: 1,
      score: 0,
      speed: BASE_SPEED,
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    if (this.#phase === "crashed") {
      if (ctx.input.justPressed("restart") || ctx.input.justPressed("jump")) this.#restart(ctx);
      this.#springArm?.follow(player.mesh.position, dt);
      this.#publishState(ctx, player, BASE_SPEED);
      return;
    }

    const speed = BASE_SPEED + Math.min(12, this.#distance * 0.055);
    player.update(ctx, dt, speed);
    this.#distance += speed * dt;
    this.#score = Math.floor(this.#distance) + this.#collected * 25;
    this.#recycleRoadDetails(player.mesh.position.z);
    this.#recycleProps(player.mesh.position.z);
    this.#updateObstacles(player.mesh.position.z);
    this.#updatePickups(player);
    if (this.#obstacles.some((obstacle) => this.#hitsObstacle(player, obstacle))) this.#crash(ctx);
    this.#springArm?.follow(player.mesh.position, dt);
    this.#publishState(ctx, player, speed);
  }

  exit(ctx: GameCtx): void {
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#floor?.dispose();
    this.#roadDetails?.removeFromParent();
    this.#props.forEach((prop) => prop.removeFromParent());
    this.#obstacles.forEach(({ mesh }) => mesh.removeFromParent());
    this.#pickups.forEach(({ mesh }) => mesh.removeFromParent());
    this.#floor = undefined;
    this.#player = undefined;
    this.#springArm = undefined;
    this.#roadDetails = undefined;
    this.#props = [];
    this.#obstacles = [];
    this.#pickups = [];
  }

  #buildRoadDetails(laneMaterial: Material, edgeMaterial: Material): void {
    const details = this.#roadDetails;
    if (details === undefined) return;
    for (let index = 0; index < 32; index += 1) {
      const z = 4 - index * 12;
      for (const x of [-1.4, 1.4]) {
        const dash = block(0.1, 0.035, 5.4, laneMaterial, { radius: 0.03 });
        dash.position.set(x, 0.03, z);
        details.add(dash);
      }
      for (const x of [-5.25, 5.25]) {
        const curb = block(0.18, 0.16, 5.8, edgeMaterial, { radius: 0.06 });
        curb.position.set(x, 0.07, z);
        details.add(curb);
      }
    }
  }

  #buildRoadside(
    ctx: GameCtx,
    trunkMaterial: Material,
    foliageMaterial: Material,
    darkFoliageMaterial: Material,
    signMaterial: Material,
  ): void {
    for (let index = 0; index < 13; index += 1) {
      const z = -10 - index * 25;
      for (const side of [-1, 1]) {
        const tree = new Group();
        const trunk = tube(0.2, 0.24, 1.5, trunkMaterial, { segments: 10 });
        trunk.position.y = 0.75;
        const canopy = ball(0.95 + (index % 3) * 0.12, index % 2 === 0 ? foliageMaterial : darkFoliageMaterial);
        canopy.position.y = 1.9;
        tree.add(trunk, canopy);
        tree.position.set(side * (7 + (index % 3) * 0.8), 0, z);
        ctx.add(tree);
        this.#props.push(tree);
      }
      if (index % 3 === 1) {
        const sign = new Group();
        const post = tube(0.08, 0.08, 1.8, trunkMaterial, { segments: 10 });
        post.position.y = 0.9;
        const plate = block(1.1, 0.62, 0.12, signMaterial, { radius: 0.1 });
        plate.position.y = 1.75;
        sign.add(post, plate);
        sign.position.set(index % 2 === 0 ? -7.2 : 7.2, 0, z - 7);
        ctx.add(sign);
        this.#props.push(sign);
      }
    }
  }

  #buildObstacles(ctx: GameCtx, hazardMaterial: Material, darkMaterial: Material, topMaterial: Material): void {
    const obstacleData = [
      { lane: 1, z: -42, kind: "block" },
      { lane: 0, z: -60, kind: "block" },
      { lane: 2, z: -78, kind: "hurdle" },
      { lane: 1, z: -96, kind: "block" },
      { lane: 0, z: -114, kind: "hurdle" },
      { lane: 2, z: -132, kind: "block" },
      { lane: 1, z: -150, kind: "block" },
      { lane: 0, z: -168, kind: "hurdle" },
    ] as const;
    obstacleData.forEach(({ lane, z, kind }, index) => {
      const mesh = new Group();
      const height = kind === "hurdle" ? 0.82 : 1.25;
      const width = kind === "hurdle" ? 1.9 : 1.55;
      const base = block(width, height, 1.25, index % 2 === 0 ? hazardMaterial : darkMaterial, { radius: 0.16 });
      base.position.y = height / 2;
      mesh.add(base);
      if (kind === "block") {
        const cap = block(width * 0.72, 0.14, 1.32, topMaterial, { radius: 0.06 });
        cap.position.y = height - 0.1;
        mesh.add(cap);
      } else {
        const flag = spike(0.16, 0.36, topMaterial);
        flag.position.set(0, height + 0.2, 0);
        mesh.add(flag);
      }
      mesh.position.set(laneX(lane), 0, z);
      ctx.add(mesh);
      this.#obstacles.push({ mesh, lane, z, height, width });
    });
    this.#spawnTailZ = -168;
  }

  #buildPickups(ctx: GameCtx, pickupMaterial: Material, lightMaterial: Material): void {
    for (let index = 0; index < 10; index += 1) {
      const mesh = new Group();
      const ring = tube(0.26, 0.26, 0.08, pickupMaterial, { segments: 14 });
      ring.rotation.x = Math.PI / 2;
      const gem = spike(0.23, 0.56, lightMaterial, { segments: 8 });
      const base = spike(0.23, 0.56, lightMaterial, { segments: 8 });
      base.rotation.z = Math.PI;
      mesh.add(ring, gem, base);
      const z = -14 - index * 14;
      const lane = index === 0 ? 2 : index % 3;
      mesh.position.set(laneX(lane), 1.1, z);
      ctx.add(mesh);
      this.#pickups.push({ mesh, lane, z, collected: false });
    }
  }

  #updateObstacles(playerZ: number): void {
    for (const obstacle of this.#obstacles) {
      if (obstacle.z > playerZ + 8) {
        this.#patternIndex += 1;
        const lane = (this.#patternIndex + 1) % 3;
        this.#spawnTailZ -= 14 + Math.round(this.#random() * 5);
        obstacle.lane = lane;
        obstacle.z = this.#spawnTailZ;
        obstacle.mesh.position.x = laneX(lane);
        obstacle.mesh.position.z = obstacle.z;
        obstacle.mesh.rotation.y = this.#random() * 0.15 - 0.075;
      }
    }
  }

  #updatePickups(player: Player): void {
    for (const pickup of this.#pickups) {
      if (pickup.collected) {
        pickup.mesh.visible = false;
        if (pickup.z > player.mesh.position.z + 10) {
          pickup.collected = false;
          pickup.z = Math.min(...this.#pickups.map((item) => item.z)) - 14;
          pickup.lane = (pickup.lane + 1) % 3;
          pickup.mesh.position.set(laneX(pickup.lane), 1.1, pickup.z);
          pickup.mesh.visible = true;
        }
        continue;
      }
      pickup.mesh.rotation.y += 0.05;
      pickup.mesh.position.y = 1.1 + Math.sin(this.#distance * 0.12 + pickup.z) * 0.08;
      if (
        Math.abs(player.mesh.position.x - pickup.mesh.position.x) < 0.8 &&
        Math.abs(player.mesh.position.z - pickup.z) < 0.9 &&
        player.mesh.position.y < 2.2
      ) {
        pickup.collected = true;
        pickup.mesh.visible = false;
        this.#collected += 1;
      }
    }
  }

  #hitsObstacle(player: Player, obstacle: Obstacle): boolean {
    return (
      Math.abs(player.mesh.position.x - laneX(obstacle.lane)) < 0.62 + obstacle.width / 2 &&
      Math.abs(player.mesh.position.z - obstacle.z) < 0.72 &&
      player.mesh.position.y - player.height / 2 < obstacle.height
    );
  }

  #recycleRoadDetails(playerZ: number): void {
    this.#roadDetails?.children.forEach((child) => {
      if (child.position.z > playerZ + 14) child.position.z -= 384;
    });
  }

  #recycleProps(playerZ: number): void {
    this.#props.forEach((prop) => {
      if (prop.position.z > playerZ + 20) prop.position.z -= 325;
    });
  }

  #crash(ctx: GameCtx): void {
    this.#collisions += 1;
    this.#phase = "crashed";
    ctx.state.set({ collisions: this.#collisions, phase: "crashed" });
  }

  #restart(ctx: GameCtx): void {
    const player = this.#player;
    if (player === undefined) return;
    this.#phase = "running";
    this.#distance = 0;
    this.#score = 0;
    this.#collected = 0;
    this.#respawns += 1;
    this.#run += 1;
    this.#patternIndex = 0;
    this.#spawnTailZ = -168;
    player.respawn();
    this.#obstacles.forEach((obstacle, index) => {
      obstacle.lane = index % 3 === 0 ? 1 : (index + 1) % 3;
      obstacle.z = -42 - index * 18;
      obstacle.mesh.position.set(laneX(obstacle.lane), 0, obstacle.z);
      obstacle.mesh.visible = true;
    });
    this.#pickups.forEach((pickup, index) => {
      pickup.collected = false;
      pickup.lane = index % 3;
      pickup.z = -14 - index * 14;
      pickup.mesh.position.set(laneX(pickup.lane), 1.1, pickup.z);
      pickup.mesh.visible = true;
    });
    ctx.state.set({
      collected: 0,
      distance: 0,
      lane: 1,
      phase: "running",
      playerX: 0,
      playerZ: 0,
      respawns: this.#respawns,
      run: this.#run,
      score: 0,
      speed: BASE_SPEED,
    });
  }

  #publishState(ctx: GameCtx, player: Player, speed: number): void {
    const debug = player.debug();
    const previous = ctx.state.getState();
    ctx.state.set({
      collected: this.#collected,
      coyoteJumps: Number(debug.coyoteJumps),
      distance: this.#distance,
      jumps: Number(debug.jumps),
      lane: player.lane,
      peakRise: Math.max(previous.peakRise, player.mesh.position.y - 0.55),
      phase: this.#phase,
      playerX: player.mesh.position.x,
      playerZ: player.mesh.position.z,
      respawns: this.#respawns,
      run: this.#run,
      score: this.#score,
      speed,
    });
  }
}
