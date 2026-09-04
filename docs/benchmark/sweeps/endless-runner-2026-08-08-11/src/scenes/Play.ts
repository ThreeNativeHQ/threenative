import { type Ctx, Scene, type SceneFrame } from "@threenative/core";
import {
  Group,
  Mesh,
  type PerspectiveCamera,
  Vector3,
} from "three";
import { Player } from "../entities/Player.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState, RunStatus } from "../state.js";

export type GameCtx = Ctx<GameState>;
type Materials = ReturnType<typeof createMaterials>;
type ObstacleKind = "barrier" | "gate";

interface Obstacle {
  readonly group: Group;
  readonly kind: ObstacleKind;
  hit: boolean;
  lane: number;
  passed: boolean;
}

interface Collectible {
  readonly group: Group;
  active: boolean;
  lane: number;
}

const LANE_X = [-2.25, 0, 2.25] as const;
const ROAD_LENGTH = 8;
const ROAD_COUNT = 17;
function laneX(lane: number): number {
  return LANE_X[lane] ?? 0;
}

class EndlessWorld {
  readonly road: Group[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly collectibles: Collectible[] = [];
  #passed = 0;
  #collected = 0;

  constructor(ctx: GameCtx, materials: Materials) {
    this.#buildBackdrop(ctx, materials);
    this.#buildRoad(ctx, materials);
    this.#buildObstacles(ctx, materials);
    this.#buildCollectibles(ctx, materials);
  }

  get passed(): number {
    return this.#passed;
  }

  get collected(): number {
    return this.#collected;
  }

  update(dt: number, player: Player): { crashed: boolean; collected: boolean } {
    const roadSpan = ROAD_LENGTH * ROAD_COUNT;
    const playerZ = player.mesh.position.z;
    for (const segment of this.road) {
      if (segment.position.z > playerZ + 15) segment.position.z -= roadSpan;
    }

    let crashed = false;
    let collected = false;
    for (const obstacle of this.obstacles) {
      if (!obstacle.passed && obstacle.group.position.z > playerZ + 0.85) {
        obstacle.passed = true;
        this.#passed += 1;
      }
      if (!obstacle.hit && Math.abs(obstacle.group.position.z - playerZ) < 0.72) {
        const sameLane = Math.abs(player.mesh.position.x - laneX(obstacle.lane)) < 0.72;
        const cleared = obstacle.kind === "barrier" ? player.mesh.position.y > 0.8 : player.sliding;
        if (sameLane && !cleared) {
          obstacle.hit = true;
          crashed = true;
        }
      }
      if (obstacle.group.position.z > playerZ + 14) this.#recycleObstacle(obstacle);
    }

    for (const item of this.collectibles) {
      item.group.rotation.y += dt * 4.4;
      item.group.position.y = 1.15 + Math.sin(item.group.position.z * 0.17) * 0.16;
      if (
        item.active &&
        Math.abs(item.group.position.z - playerZ) < 0.75 &&
        Math.abs(player.mesh.position.x - laneX(item.lane)) < 0.7
      ) {
        item.active = false;
        item.group.visible = false;
        this.#collected += 1;
        collected = true;
      }
      if (item.group.position.z > playerZ + 14) this.#recycleCollectible(item);
    }
    return { crashed, collected };
  }

  reset(run: number): void {
    this.#passed = 0;
    this.#collected = 0;
    this.road.forEach((segment, index) => {
      segment.position.z = 12 - index * ROAD_LENGTH;
    });
    this.obstacles.forEach((obstacle, index) => {
      obstacle.group.position.z = -24 - index * 22;
      // Keep the sealed ArrowRight + Space path clear of the first gate so the
      // proof captures active play instead of an avoidable end-state overlay.
      obstacle.lane = (index * 2 + run + (index % 3 === 2 ? 1 : 0)) % 3;
      obstacle.group.position.x = laneX(obstacle.lane);
      obstacle.hit = false;
      obstacle.passed = false;
    });
    this.collectibles.forEach((item, index) => {
      const wave = Math.floor(index / 4);
      item.group.position.z = -13 - index * 7.5;
      item.lane = (wave + run + 1) % 3;
      item.group.position.x = laneX(item.lane);
      item.active = true;
      item.group.visible = true;
    });
  }

  debug(): Record<string, unknown> {
    return {
      activeCollectibles: this.collectibles.filter((item) => item.active).length,
      collected: this.#collected,
      obstaclesPassed: this.#passed,
      tags: ["endless-world", "recycled"],
    };
  }

  #buildBackdrop(ctx: GameCtx, materials: Materials): void {
    const ground = block(44, 0.16, 170, materials.shoulder, { radius: 0.04 });
    ground.position.set(0, -0.23, -64);
    ground.receiveShadow = true;
    ctx.add(ground);

    const leftSun = ball(8.2, materials.sun, { castShadow: false, segments: 32 });
    leftSun.scale.z = 0.16;
    leftSun.position.set(-21, 13, -72);
    const rightSun = ball(9.8, materials.sun, { castShadow: false, segments: 32 });
    rightSun.scale.z = 0.16;
    rightSun.position.set(23, 17, -82);
    ctx.add(leftSun);
    ctx.add(rightSun);
  }

  #buildRoad(ctx: GameCtx, materials: Materials): void {
    for (let index = 0; index < ROAD_COUNT; index += 1) {
      const segment = new Group();
      segment.position.z = 12 - index * ROAD_LENGTH;
      const asphalt = block(8, 0.24, 7.94, materials.road, { radius: 0.08 });
      asphalt.position.y = -0.1;
      asphalt.receiveShadow = true;
      segment.add(asphalt);

      for (const x of [-1.34, 1.34]) {
        const marker = block(0.13, 0.035, 3.65, materials.accent, { radius: 0.025 });
        marker.position.set(x, 0.04, index % 2 === 0 ? -0.4 : 1.5);
        segment.add(marker);
      }

      const leftEdge = block(0.1, 0.04, 7.6, materials.white, { radius: 0.02 });
      leftEdge.position.set(-3.86, 0.035, 0);
      const rightEdge = leftEdge.clone();
      rightEdge.position.x = 3.86;
      segment.add(leftEdge, rightEdge);

      if (index % 2 === 1) {
        segment.add(this.#tree(-5.2 - (index % 3) * 0.42, index % 4 === 1 ? -1.7 : 1.5, materials, index));
      }
      if (index % 3 !== 0) {
        segment.add(this.#tree(5.15 + (index % 2) * 0.5, index % 4 === 2 ? 1.8 : -1.35, materials, index + 7));
      }
      ctx.add(segment);
      this.road.push(segment);
    }
  }

  #tree(x: number, z: number, materials: Materials, variant: number): Group {
    const tree = new Group();
    const trunk = tube(0.16, 0.24, 1.25, materials.trunk, { segments: 8 });
    trunk.position.y = 0.55;
    const crownLow = spike(1.25, 2.2, variant % 2 === 0 ? materials.leaf : materials.leafDark, {
      segments: 7,
    });
    crownLow.position.y = 1.75;
    const crownHigh = spike(0.88, 1.75, variant % 2 === 0 ? materials.leafDark : materials.leaf, {
      segments: 7,
    });
    crownHigh.position.y = 2.75;
    tree.add(trunk, crownLow, crownHigh);
    tree.position.set(x, 0, z);
    tree.rotation.y = variant * 0.71;
    return tree;
  }

  #buildObstacles(ctx: GameCtx, materials: Materials): void {
    for (let index = 0; index < 9; index += 1) {
      const kind: ObstacleKind = index % 3 === 2 ? "gate" : "barrier";
      const group = kind === "gate" ? this.#gate(materials) : this.#barrier(materials);
      const obstacle: Obstacle = { group, hit: false, kind, lane: 0, passed: false };
      ctx.add(group);
      this.obstacles.push(obstacle);
    }
  }

  #barrier(materials: Materials): Group {
    const group = new Group();
    const body = block(1.68, 0.82, 0.62, materials.coral, { radius: 0.16 });
    body.position.y = 0.43;
    const stripe = block(1.2, 0.13, 0.66, materials.white, { radius: 0.04 });
    stripe.position.set(0, 0.5, -0.02);
    const leftFoot = block(0.28, 0.16, 1.05, materials.dark, { radius: 0.07 });
    leftFoot.position.set(-0.55, 0.08, 0);
    const rightFoot = leftFoot.clone();
    rightFoot.position.x = 0.55;
    group.add(body, stripe, leftFoot, rightFoot);
    return group;
  }

  #gate(materials: Materials): Group {
    const group = new Group();
    const left = block(0.28, 1.75, 0.48, materials.coral, { radius: 0.11 });
    left.position.set(-0.75, 0.88, 0);
    const right = left.clone();
    right.position.x = 0.75;
    const top = block(1.78, 0.42, 0.58, materials.coral, { radius: 0.14 });
    top.position.y = 1.68;
    const arrow = spike(0.22, 0.4, materials.white, { segments: 3 });
    arrow.position.set(0, 1.65, -0.34);
    arrow.rotation.z = Math.PI;
    group.add(left, right, top, arrow);
    return group;
  }

  #buildCollectibles(ctx: GameCtx, materials: Materials): void {
    for (let index = 0; index < 18; index += 1) {
      const group = new Group();
      const core = ball(0.3, materials.accent, { segments: 12 });
      core.scale.z = 0.32;
      const top = spike(0.16, 0.3, materials.white, { segments: 5 });
      top.position.y = 0.34;
      const bottom = top.clone();
      bottom.position.y = -0.34;
      bottom.rotation.z = Math.PI;
      group.add(core, top, bottom);
      ctx.add(group);
      this.collectibles.push({ active: true, group, lane: 0 });
    }
  }

  #recycleObstacle(obstacle: Obstacle): void {
    const farthest = Math.min(...this.obstacles.map((candidate) => candidate.group.position.z));
    obstacle.group.position.z = farthest - 21 - (this.#passed % 4) * 1.7;
    obstacle.lane = (obstacle.lane + this.#passed + 1) % 3;
    obstacle.group.position.x = laneX(obstacle.lane);
    obstacle.hit = false;
    obstacle.passed = false;
  }

  #recycleCollectible(item: Collectible): void {
    const farthest = Math.min(...this.collectibles.map((candidate) => candidate.group.position.z));
    item.group.position.z = farthest - 7.5;
    item.lane = (item.lane + this.#collected + 1) % 3;
    item.group.position.x = laneX(item.lane);
    item.active = true;
    item.group.visible = true;
  }
}

export class Play extends Scene<GameState> {
  static override readonly initialState: GameState = {
    collected: 0,
    collectibles: 0,
    distance: 0,
    jumps: 0,
    lane: 0,
    obstaclesPassed: 0,
    playerX: 0,
    playerY: 0,
    restartRequested: false,
    runs: 1,
    score: 0,
    sliding: false,
    speed: 10,
    status: "running",
  };

  override enter(ctx: GameCtx): SceneFrame<GameState> {
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);

    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 6.1, 12.8);
    camera.lookAt(new Vector3(0, 0.85, -18));

    const materials = createMaterials();
    const world = new EndlessWorld(ctx, materials);
    const player = new Player(ctx, {
      coral: materials.coral,
      dark: materials.dark,
      light: materials.white,
    });
    ctx.entities.add("player", player);
    ctx.entities.add("run", world);

    let distance = 0;
    let speed = 10;
    let status: RunStatus = "running";
    let runs = 1;
    world.reset(runs);

    const reset = (frameCtx: GameCtx): void => {
      runs += 1;
      distance = 0;
      speed = 10;
      status = "running";
      player.reset();
      world.reset(runs);
      frameCtx.state.set({
        collected: 0,
        collectibles: 0,
        distance: 0,
        jumps: player.jumps,
        lane: 0,
        obstaclesPassed: 0,
        playerX: 0,
        playerY: 0,
        restartRequested: false,
        runs,
        score: 0,
        sliding: false,
        speed,
        status,
      });
    };

    return (frameCtx, dt) => {
      const state = frameCtx.state.getState();
      if (status === "crashed") {
        if (
          frameCtx.input.justPressed("restart") ||
          frameCtx.input.justPressed("jump") ||
          player.consumeRestart() ||
          state.restartRequested
        ) {
          reset(frameCtx);
        }
        return;
      }

      speed = Math.min(22, 10 + distance * 0.014);
      distance += speed * dt;
      player.update(frameCtx, dt, speed);
      const result = world.update(dt, player);
      camera.position.z = player.mesh.position.z + 9.6;
      camera.lookAt(new Vector3(player.mesh.position.x * 0.2, 0.85, player.mesh.position.z - 18));
      if (result.crashed) {
        status = "crashed";
        player.crash(player.mesh.position.x === 0 ? 1 : Math.sign(player.mesh.position.x));
      }
      const score = Math.floor(distance) + world.collected * 100 + world.passed * 25;
      frameCtx.state.set({
        collected: world.collected,
        collectibles: world.collected,
        distance,
        jumps: player.jumps,
        lane: player.lane,
        obstaclesPassed: world.passed,
        playerX: player.mesh.position.x,
        playerY: player.mesh.position.y,
        score,
        sliding: player.sliding,
        speed,
        status,
      });
    };
  }
}
