import { type Ctx, Scene } from "@threenative/core";
import {
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import {
  Color,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import { createCrate } from "../entities/Crate.js";
import { Player } from "../entities/Player.js";
import { updateFollowCamera } from "../render/camera.js";
import { createLighting } from "../render/lighting.js";
import { palette } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, capsule, cone, cylinder, ring, roundedBox, star } from "../render/shapes.js";
import { createSky } from "../render/sky.js";
import type { GameState } from "../state.js";

type GameContext = Ctx<GameState, PhysicsContext>;

interface Coin {
  readonly mesh: Group;
  readonly baseY: number;
  collected: boolean;
}

const SPAWN = new Vector3(0, 1.15, 9.2);
const platformSpecs = [
  { x: 0, z: 8, width: 9, depth: 7, top: 0 },
  { x: 0, z: -0.2, width: 10, depth: 4.2, top: 0.8 },
  { x: 2.2, z: -5, width: 4.2, depth: 2.8, top: 1.25 },
  { x: -1.7, z: -8.7, width: 4.1, depth: 2.6, top: 1.7 },
  { x: 0, z: -13, width: 9, depth: 5.5, top: 2 },
] as const;

export class Play extends Scene<GameState, PhysicsContext> {
  private readonly world = new Group();
  private readonly solids: RigidBody3D[] = [];
  private readonly coins: Coin[] = [];
  private readonly spawn = SPAWN.clone();
  private player?: Player;
  private enemy?: Group;
  private goal?: Group;
  private time = 0;
  private restartNonce = 0;
  private respawnCooldown = 0;
  private goalPulse = 0;

  enter(ctx: GameContext): void {
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 52;
    camera.near = 0.1;
    camera.far = 180;
    camera.updateProjectionMatrix();
    camera.position.set(0, 7, 18);
    ctx.scene.background = new Color(palette.sky);
    ctx.scene.fog = new FogExp2(0x9cddff, 0.012);
    setupPost(ctx.renderer.raw);

    this.world.add(createSky(), createLighting());
    this.createWater();
    for (const spec of platformSpecs) this.createIsland(ctx, spec.x, spec.top, spec.z, spec.width, spec.depth);
    this.createBridge(ctx);
    this.createRouteDetails();
    this.createCoins();
    this.enemy = this.createEnemy();
    this.world.add(this.enemy);
    this.goal = this.createGoal();
    this.world.add(this.goal);
    ctx.add(this.world);

    this.player = new Player(ctx.physics, this.spawn);
    ctx.add(this.player.mesh);
    ctx.entities.add("player", this.player);
    ctx.entities.add("route", this);
    this.restartNonce = ctx.state.getState().restartNonce;
    this.reset(ctx, false);
  }

  update(ctx: GameContext, dt: number): void {
    const player = this.player;
    if (!player) return;
    if (ctx.input.justPressed("pause")) ctx.state.set((state) => ({ paused: !state.paused }));
    const state = ctx.state.getState();
    if (ctx.input.justPressed("restart") || state.restartNonce !== this.restartNonce) {
      this.restartNonce = state.restartNonce;
      this.reset(ctx, false);
      return;
    }
    if (state.paused) return;

    const step = Math.min(dt, 1 / 30);
    this.time += step;
    this.respawnCooldown = Math.max(0, this.respawnCooldown - step);
    const move = ctx.input.vector("move");
    player.update(step, move.x, -move.y, ctx.input.justPressed("jump"));
    updateFollowCamera(ctx.camera as PerspectiveCamera, player.mesh.position, step);

    this.animateWorld(step);
    this.collectNearby(ctx);
    this.checkHazards(ctx);
    this.checkGoal(ctx);
    ctx.state.set({ elapsed: this.time });
  }

  exit(ctx: GameContext): void {
    if (this.player) {
      ctx.entities.remove("player");
      this.player.dispose();
      this.player.mesh.removeFromParent();
    }
    ctx.entities.remove("route");
    for (const solid of this.solids) solid.dispose();
    this.solids.length = 0;
    this.coins.length = 0;
    this.world.removeFromParent();
    this.world.clear();
  }

  debug(): Record<string, unknown> {
    return {
      coinsRemaining: this.coins.filter((coin) => !coin.collected).length,
      goalUnlocked: this.coins.every((coin) => coin.collected),
      tags: ["route", "platformer"],
    };
  }

  private createIsland(ctx: GameContext, x: number, top: number, z: number, width: number, depth: number): void {
    const root = new Group();
    root.position.set(x, top - 0.95, z);
    const earth = roundedBox(width, 1.7, depth, palette.earth, 0.38);
    earth.position.y = 0.05;
    root.add(earth);
    const grass = roundedBox(width + 0.14, 0.42, depth + 0.14, palette.grass, 0.2);
    grass.position.y = 0.93;
    root.add(grass);
    for (let edge = -width / 2 + 0.45; edge < width / 2; edge += 0.8) {
      const tuft = ball(0.3, edge % 1.6 < 0.6 ? palette.grass : palette.grassDark);
      tuft.scale.set(1.15, 0.48, 0.72);
      tuft.position.set(edge, 1.12, depth / 2 - 0.02);
      root.add(tuft);
    }
    this.world.add(root);
    const solid = new RigidBody3D({
      object: root,
      physics: ctx.physics,
      shape: CollisionShape3D.box(width, 1.9, depth),
      type: "fixed",
    });
    this.solids.push(solid);
  }

  private createBridge(ctx: GameContext): void {
    const bridge = new Group();
    bridge.position.set(0, 0.16, 3.15);
    for (let z = -1.45; z <= 1.45; z += 0.48) {
      const plank = roundedBox(4.5, 0.34, 0.43, z % 0.96 < 0 ? palette.wood : palette.woodLight, 0.08);
      plank.position.set(Math.sin(z * 9) * 0.06, Math.sin(z * 7) * 0.03, z);
      plank.rotation.y = Math.sin(z * 5) * 0.025;
      bridge.add(plank);
    }
    for (const x of [-2.05, 2.05]) {
      for (const z of [-1.35, 0, 1.35]) {
        const post = cylinder(0.14, 1.25, palette.wood, 10);
        post.position.set(x, 0.22, z);
        bridge.add(post);
      }
      const rail = cylinder(0.07, 3, palette.woodLight, 10);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x, 0.67, 0);
      bridge.add(rail);
    }
    this.world.add(bridge);
    this.solids.push(new RigidBody3D({
      object: bridge,
      physics: ctx.physics,
      shape: CollisionShape3D.box(4.5, 0.38, 3.35),
      type: "fixed",
    }));
  }

  private createWater(): void {
    const water = new Mesh(
      new PlaneGeometry(100, 100),
      new MeshStandardMaterial({ color: palette.water, roughness: 0.22, metalness: 0.08, transparent: true, opacity: 0.9 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -3.2;
    water.receiveShadow = true;
    this.world.add(water);
    for (let i = 0; i < 18; i++) {
      const ripple = ring(0.45 + (i % 3) * 0.14, 0.025, 0xb5f3ff);
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(((i * 7) % 23) - 11, -3.12, -((i * 11) % 28) + 8);
      ripple.scale.y = 0.55;
      this.world.add(ripple);
    }
  }

  private createRouteDetails(): void {
    const treePositions: Array<[number, number, number, number]> = [
      [-3.4, 0.2, 9, 1.05], [3.6, 0.2, 7.6, 0.85], [-4.1, 1, 0, 0.8], [4, 1, -0.5, 0.9],
      [3.3, 2.4, -12.8, 1.05], [-3.5, 2.4, -14, 0.8],
    ];
    for (const [x, y, z, scale] of treePositions) {
      const tree = this.createTree();
      tree.position.set(x, y, z);
      tree.scale.setScalar(scale);
      this.world.add(tree);
    }
    for (const [x, y, z] of [[-3.2, 0.35, 5.6], [3.2, 1.15, -1], [-3.2, 2.35, -12]] as const) {
      const crate = createCrate();
      crate.scale.setScalar(0.65);
      crate.position.set(x, y, z);
      crate.rotation.y = x;
      this.world.add(crate);
    }
    for (const [x, y, z, color] of [
      [-2.5, 0.28, 6.1, 0xff6da8], [2.9, 1.06, 0.4, 0xffe264], [0.7, 2.33, -13.5, 0x9b69ff],
      [-2.7, 2.33, -11.8, 0xff715c], [1.1, 0.28, 9.8, 0xffffff],
    ] as const) {
      const flower = this.createFlower(color);
      flower.position.set(x, y, z);
      this.world.add(flower);
    }
    this.createDirectionSign();
  }

  private createTree(): Group {
    const tree = new Group();
    const trunk = cylinder(0.23, 2.3, palette.wood, 11);
    trunk.position.y = 1.1;
    tree.add(trunk);
    for (const [x, y, z, s] of [[0, 2.45, 0, 1.1], [-0.6, 2.25, 0, 0.78], [0.58, 2.3, 0.1, 0.84], [0, 2.75, -0.25, 0.75]] as const) {
      const crown = ball(s, y > 2.6 ? palette.leaf : palette.leafDark);
      crown.scale.y = 0.8;
      crown.position.set(x, y, z);
      tree.add(crown);
    }
    return tree;
  }

  private createFlower(color: number): Group {
    const flower = new Group();
    const stem = cylinder(0.025, 0.45, palette.leafDark, 8);
    stem.position.y = 0.2;
    flower.add(stem);
    for (let i = 0; i < 5; i++) {
      const petal = ball(0.11, color);
      petal.scale.set(0.7, 1.2, 0.5);
      petal.position.set(Math.cos(i * 1.256) * 0.13, 0.5 + Math.sin(i * 1.256) * 0.13, 0);
      flower.add(petal);
    }
    return flower;
  }

  private createDirectionSign(): void {
    const sign = new Group();
    const post = cylinder(0.1, 1.45, palette.wood, 9);
    post.position.y = 0.65;
    sign.add(post);
    const board = roundedBox(1.7, 0.62, 0.18, palette.woodLight, 0.1);
    board.position.set(0.25, 1.15, 0);
    sign.add(board);
    const arrow = cone(0.2, 0.6, palette.cream);
    arrow.rotation.z = Math.PI / 2;
    arrow.position.set(0.7, 1.15, -0.13);
    sign.add(arrow);
    sign.position.set(-3.2, 0.2, 3.9);
    sign.rotation.y = 0.25;
    this.world.add(sign);
  }

  private createCoins(): void {
    const positions = [
      [0, 1.35, 6.6], [0, 1.55, 3.3], [-1.6, 2.15, 0.6], [0.15, 2.35, -0.8],
      [2.2, 2.8, -4.35], [2.2, 3.05, -5.65], [-1.7, 3.25, -8.3], [-0.8, 3.55, -11.2], [1.35, 3.55, -12.7],
    ] as const;
    for (const [x, y, z] of positions) {
      const coin = new Group();
      const outer = cylinder(0.38, 0.12, palette.gold, 24);
      outer.rotation.z = Math.PI / 2;
      coin.add(outer);
      const face = cylinder(0.28, 0.135, palette.goldLight, 24);
      face.rotation.z = Math.PI / 2;
      coin.add(face);
      const emblem = star(0xffa51d);
      emblem.scale.setScalar(0.42);
      emblem.rotation.y = -Math.PI / 2;
      emblem.position.x = -0.08;
      coin.add(emblem);
      coin.position.set(x, y, z);
      this.world.add(coin);
      this.coins.push({ mesh: coin, baseY: y, collected: false });
    }
  }

  private createEnemy(): Group {
    const enemy = new Group();
    const shell = ball(0.58, palette.red);
    shell.position.set(0.2, 0.62, 0);
    enemy.add(shell);
    const spiral = ring(0.31, 0.065, 0x9f2937);
    spiral.rotation.y = Math.PI / 2;
    spiral.position.set(0.76, 0.62, 0);
    enemy.add(spiral);
    const body = capsule(0.29, 0.7, 0x8fc45a);
    body.rotation.z = Math.PI / 2;
    body.position.set(-0.33, 0.34, 0);
    enemy.add(body);
    for (const z of [-0.17, 0.17]) {
      const eye = ball(0.13, palette.cream);
      eye.position.set(-0.78, 0.68, z);
      enemy.add(eye);
      const pupil = ball(0.052, 0x263038);
      pupil.position.set(-0.88, 0.68, z);
      enemy.add(pupil);
    }
    enemy.position.set(2.4, 1, -0.3);
    return enemy;
  }

  private createGoal(): Group {
    const goal = new Group();
    for (const x of [-1.2, 1.2]) {
      const post = cylinder(0.16, 3.2, palette.woodLight, 12);
      post.position.set(x, 1.4, 0);
      goal.add(post);
      const cap = ball(0.23, palette.gold);
      cap.position.set(x, 3.05, 0);
      goal.add(cap);
    }
    const banner = roundedBox(2.45, 0.68, 0.16, palette.red, 0.14);
    banner.position.y = 2.5;
    goal.add(banner);
    const badge = star(palette.gold);
    badge.position.set(0, 2.48, -0.13);
    badge.scale.setScalar(0.7);
    goal.add(badge);
    const ringMesh = ring(0.78, 0.09, palette.goldLight);
    ringMesh.position.y = 1.25;
    goal.add(ringMesh);
    goal.position.set(0, 2.25, -14.3);
    return goal;
  }

  private animateWorld(dt: number): void {
    for (let i = 0; i < this.coins.length; i++) {
      const coin = this.coins[i];
      if (!coin || coin.collected) continue;
      coin.mesh.rotation.y += dt * 2.8;
      coin.mesh.position.y = coin.baseY + Math.sin(this.time * 3.5 + i) * 0.12;
    }
    if (this.enemy) {
      this.enemy.position.x = Math.sin(this.time * 1.25) * 2.8;
      this.enemy.rotation.y = Math.cos(this.time * 1.25) > 0 ? Math.PI : 0;
      this.enemy.position.y = 1 + Math.sin(this.time * 5) * 0.04;
    }
    if (this.goal) {
      this.goalPulse += dt;
      const unlocked = this.coins.every((coin) => coin.collected);
      const scale = unlocked ? 1 + Math.sin(this.goalPulse * 5) * 0.045 : 1;
      this.goal.scale.set(scale, scale, scale);
    }
  }

  private collectNearby(ctx: GameContext): void {
    const player = this.player;
    if (!player) return;
    let changed = false;
    for (const coin of this.coins) {
      if (!coin.collected && player.mesh.position.distanceTo(coin.mesh.position) < 1.15) {
        coin.collected = true;
        coin.mesh.visible = false;
        changed = true;
      }
    }
    if (changed) {
      const count = this.coins.filter((coin) => coin.collected).length;
      ctx.state.set({
        collected: count,
        message: count === this.coins.length ? "The finish arch is glowing—reach it!" : `${this.coins.length - count} sun coins left on the trail`,
      });
    }
  }

  private checkHazards(ctx: GameContext): void {
    const player = this.player;
    if (!player || this.respawnCooldown > 0) return;
    const fell = player.mesh.position.y < -3.9;
    const enemyHit = this.enemy
      ? Math.hypot(player.mesh.position.x - this.enemy.position.x, player.mesh.position.z - this.enemy.position.z) < 1.05
        && Math.abs(player.mesh.position.y - this.enemy.position.y) < 1.5
      : false;
    if (fell || enemyHit) this.respawn(ctx, fell ? "Splash! Back to the trail." : "That grumpy snail sent you back!");
  }

  private checkGoal(ctx: GameContext): void {
    const player = this.player;
    if (!player || ctx.state.getState().status === "won") return;
    const atGoal = Math.hypot(player.mesh.position.x, player.mesh.position.z + 14.3) < 1.35;
    if (!atGoal) return;
    if (this.coins.every((coin) => coin.collected)) {
      ctx.state.set({ status: "won", message: "Every sun coin is home!" });
    } else {
      const left = this.coins.filter((coin) => !coin.collected).length;
      ctx.state.set({ message: `The arch needs ${left} more sun coin${left === 1 ? "" : "s"}` });
    }
  }

  private respawn(ctx: GameContext, message: string): void {
    this.player?.teleport(this.spawn);
    this.respawnCooldown = 1;
    const respawns = ctx.state.getState().respawns + 1;
    ctx.state.set({ respawns, message });
  }

  private reset(ctx: GameContext, countRespawn: boolean): void {
    this.time = 0;
    this.respawnCooldown = 0.7;
    this.player?.teleport(this.spawn);
    for (const coin of this.coins) {
      coin.collected = false;
      coin.mesh.visible = true;
      coin.mesh.position.y = coin.baseY;
    }
    const current = ctx.state.getState();
    ctx.state.set({
      collected: 0,
      total: this.coins.length,
      status: "playing",
      paused: false,
      elapsed: 0,
      respawns: countRespawn ? current.respawns + 1 : 0,
      message: "Collect every sun coin, then reach the flag!",
    });
    updateFollowCamera(ctx.camera as PerspectiveCamera, this.spawn, 1);
  }
}
