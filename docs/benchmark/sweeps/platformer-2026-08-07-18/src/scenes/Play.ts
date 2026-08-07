import { type Ctx, Scene } from "@threenative/core";
import {
  Area3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { Player } from "../entities/Player.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

type Platform = { x: number; y: number; width: number; depth: number };
type Coin = { area: Area3D; mesh: Group; position: { x: number; y: number; z: number }; phase: number; collected: boolean };

const PLATFORMS: readonly Platform[] = [
  { x: -8, y: 0, width: 8, depth: 5 },
  { x: -1.5, y: 0.35, width: 4.5, depth: 4.4 },
  { x: 3.35, y: 0.2, width: 4.8, depth: 4.4 },
  { x: 8.4, y: 0.55, width: 4.8, depth: 4.4 },
  { x: 13.5, y: 0.25, width: 5, depth: 5 },
];

const COIN_POSITIONS = [
  [-10.4, 1.25, 0], [-8.8, 1.45, 0], [-7.2, 1.25, 0],
  [-4.8, 1.8, 0], [-2.7, 2.2, 0], [-1, 2.45, 0],
  [1.6, 1.35, 0], [3.1, 1.25, 0], [5.2, 1.1, 0],
  [7.4, 2.2, 0], [9.2, 2.55, 0], [12.2, 1.35, 0],
] as const;

const palette = {
  grass: 0x56c95b,
  grassLight: 0x8be36b,
  earth: 0x815744,
  earthDark: 0x4f3c43,
  wood: 0xb8733f,
  woodLight: 0xe4a156,
  gold: 0xffc52f,
  goldLight: 0xffef92,
  pink: 0xf18a72,
  leaf: 0x3c9c61,
};

export class Play extends Scene<GameState, PhysicsContext> {
  #floorBodies: RigidBody3D[] = [];
  #areas: Area3D[] = [];
  #coins: Coin[] = [];
  #player: Player | undefined;
  #world = new Group();
  #goalArea: Area3D | undefined;
  #goalObject: Group | undefined;
  #hazardArea: Area3D | undefined;
  #hazardObject: Group | undefined;
  #unsubscribe: (() => void)[] = [];
  #finished = false;
  #hurt = false;
  #hazardTriggered = false;
  #elapsed = 0;

  enter(ctx: GameCtx): void {
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as { toneMapping?: number; toneMappingExposure?: number });
    ctx.scene.background = new Color(0x238fd4);
    ctx.scene.fog = new Fog(0x65bfe3, 27, 58);
    ctx.scene.add(this.#world);

    this.#buildBackdrop();
    this.#buildPlatforms(ctx);
    this.#buildHazard(ctx);
    this.#buildGoal(ctx);
    this.#buildCoins(ctx);

    this.#player = new Player(ctx);
    ctx.entities.add("player", this.#player);
    ctx.camera.position.set(-3, 5.5, 8.5);
    ctx.camera.lookAt(0, 0.9, 0);
    ctx.state.set({ coins: 0, goalReached: false, respawns: 0, score: 0, total: COIN_POSITIONS.length, status: "Collect the stars and reach the flag", deaths: 0 });
  }

  update(ctx: GameCtx, dt: number): void {
    this.#elapsed += dt;
    if (ctx.input.justPressed("restart")) {
      this.#restart(ctx);
      return;
    }

    if (this.#finished) {
      this.#updateCamera(ctx, dt);
      return;
    }

    this.#player?.update(ctx, dt);
    this.#updateCoins(dt);
    this.#updateCamera(ctx, dt);
    if (this.#player !== undefined && (this.#player.mesh.position.y < -4 || this.#hurt)) {
      this.#restartAfterFall(ctx);
    }
    ctx.state.set({ playerX: this.#player?.mesh.position.x ?? -9 });
  }

  exit(ctx: GameCtx): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    for (const area of this.#areas) area.dispose();
    for (const body of this.#floorBodies) body.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#world.removeFromParent();
    ctx.scene.clear();
    this.#areas = [];
    this.#floorBodies = [];
    this.#coins = [];
    this.#unsubscribe = [];
    this.#goalArea = undefined;
    this.#goalObject = undefined;
    this.#hazardArea = undefined;
    this.#hazardObject = undefined;
    this.#player = undefined;
  }

  #buildBackdrop(): void {
    const mountainMaterial = new MeshStandardMaterial({ color: 0x2b8f80, roughness: 1 });
    const farMountainMaterial = new MeshStandardMaterial({ color: 0x43aab1, roughness: 1 });
    for (const [x, z, scale, material] of [
      [-12, -5, 5, farMountainMaterial], [-3, -6, 7, farMountainMaterial], [8, -5, 6, farMountainMaterial],
      [17, -4, 8, mountainMaterial],
    ] as const) {
      const mountain = new Mesh(new ConeGeometry(scale, scale * 1.5, 7), material);
      mountain.position.set(x, 1.7, z);
      mountain.rotation.y = 0.25;
      this.#world.add(mountain);
    }

    const cloudMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.78 });
    for (const [x, y, z, scale] of [[-10, 8, -7, 1.5], [-1, 7.2, -8, 1.15], [11, 8.3, -7, 1.7]] as const) {
      const cloud = new Group();
      for (const [ox, oy, oz, size] of [[0, 0, 0, 1], [1.1, 0.1, 0, 0.75], [-1.1, -0.05, 0, 0.72], [0.25, 0.45, 0, 0.8]] as const) {
        const puff = new Mesh(new SphereGeometry(size * scale, 12, 8), cloudMaterial);
        puff.position.set(ox * scale, oy * scale, oz);
        cloud.add(puff);
      }
      cloud.position.set(x, y, z);
      this.#world.add(cloud);
    }

    const islandMaterial = new MeshStandardMaterial({ color: 0x4fae9b, roughness: 0.95 });
    for (const [x, y, z] of [[-14, 4.5, -3.5], [4.5, 5, -4.5], [17, 4.5, -3]] as const) {
      const island = new Group();
      const top = new Mesh(new CylinderGeometry(1.25, 0.9, 0.35, 8), new MeshStandardMaterial({ color: palette.grass, roughness: 0.95 }));
      const rock = new Mesh(new ConeGeometry(0.7, 1.6, 7), islandMaterial);
      top.position.y = 0.75;
      rock.position.y = -0.15;
      island.add(top, rock);
      island.position.set(x, y, z);
      this.#world.add(island);
    }

    for (const [x, y, scale] of [[-12.8, 5.1, 1], [-3.8, 6.1, 0.8], [5.3, 5.6, 1.05], [16, 5.2, 1.2]] as const) {
      this.#addTree(x, y, -3.2, scale);
    }
  }

  #buildPlatforms(ctx: GameCtx): void {
    const earthMaterial = new MeshStandardMaterial({ color: palette.earth, roughness: 0.92 });
    const grassMaterial = new MeshStandardMaterial({ color: palette.grass, roughness: 0.9 });
    const grassEdgeMaterial = new MeshStandardMaterial({ color: palette.grassLight, roughness: 0.8 });
    const woodMaterial = new MeshStandardMaterial({ color: palette.wood, roughness: 0.78 });

    PLATFORMS.forEach((platform, index) => {
      const base = new Mesh(new BoxGeometry(platform.width, 0.8, platform.depth), earthMaterial);
      base.position.set(platform.x, platform.y - 0.4, 0);
      base.receiveShadow = true;
      base.castShadow = true;
      this.#world.add(base);
      this.#floorBodies.push(new RigidBody3D({ object: base, physics: ctx.physics, shape: CollisionShape3D.box(platform.width, 0.8, platform.depth), type: "fixed" }));

      const turf = new Mesh(new BoxGeometry(platform.width + 0.08, 0.18, platform.depth + 0.08), grassMaterial);
      turf.position.set(platform.x, platform.y + 0.09, 0);
      turf.receiveShadow = true;
      turf.castShadow = true;
      this.#world.add(turf);
      const edge = new Mesh(new BoxGeometry(platform.width + 0.14, 0.07, platform.depth + 0.14), grassEdgeMaterial);
      edge.position.set(platform.x, platform.y + 0.2, 0);
      this.#world.add(edge);

      for (const side of [-1, 1]) {
        const post = new Mesh(new CylinderGeometry(0.12, 0.16, 1.25, 8), woodMaterial);
        post.position.set(platform.x + side * (platform.width / 2 - 0.25), platform.y + 0.62, platform.depth / 2 - 0.38);
        post.castShadow = true;
        this.#world.add(post);
      }
      if (index > 0) this.#addBush(platform.x - platform.width * 0.25, platform.y + 0.42, 0.4);
    });

    this.#addTree(-9.8, 0.35, -1.75, 0.75);
    this.#addTree(9.7, 1.35, -1.65, 0.7);

    const bridge = new Group();
    const plankMaterial = new MeshStandardMaterial({ color: palette.woodLight, roughness: 0.8 });
    for (let i = 0; i < 7; i += 1) {
      const plank = new Mesh(new BoxGeometry(0.62, 0.16, 3.1), plankMaterial);
      plank.position.set(i * 0.22, 0.15 + i * 0.06, 0);
      plank.rotation.z = (i % 2 === 0 ? -1 : 1) * 0.025;
      plank.castShadow = true;
      plank.receiveShadow = true;
      bridge.add(plank);
    }
    bridge.position.x = -3.85;
    this.#world.add(bridge);
    const bridgeBase = new Mesh(new BoxGeometry(1.9, 0.18, 3.1), woodMaterial);
    bridgeBase.position.set(-3.6, 0.08, 0);
    bridgeBase.receiveShadow = true;
    this.#world.add(bridgeBase);
    this.#floorBodies.push(new RigidBody3D({ object: bridgeBase, physics: ctx.physics, shape: CollisionShape3D.box(1.9, 0.18, 3.1), type: "fixed" }));
  }

  #buildHazard(ctx: GameCtx): void {
    const hazard = new Group();
    const spikeMaterial = new MeshStandardMaterial({ color: palette.pink, roughness: 0.58 });
    for (const x of [3.9, 4.45, 5]) {
      const spike = new Mesh(new ConeGeometry(0.22, 0.62, 6), spikeMaterial);
      spike.position.set(x, 0.63, 0.2);
      spike.castShadow = true;
      hazard.add(spike);
    }
    const sign = new Mesh(new BoxGeometry(0.12, 0.9, 0.12), new MeshStandardMaterial({ color: palette.wood }));
    sign.position.set(3.35, 0.72, 0.2);
    hazard.add(sign);
    const warning = new Mesh(new ConeGeometry(0.35, 0.1, 4), new MeshStandardMaterial({ color: palette.gold }));
    warning.position.set(3.35, 1.25, 0.2);
    warning.rotation.y = Math.PI / 4;
    hazard.add(warning);
    this.#world.add(hazard);
    const area = new Area3D({ physics: ctx.physics, position: { x: 4.45, y: 0.65, z: 0.2 }, shape: CollisionShape3D.box(1.7, 1, 1.2) });
    this.#hazardArea = area;
    this.#hazardObject = hazard;
    this.#areas.push(area);
    this.#unsubscribe.push(area.on("bodyEntered", (body) => {
      if (body !== this.#player?.body || this.#hazardTriggered) return;
      this.#hazardTriggered = true;
      this.#hurt = true;
      hazard.visible = false;
      area.setPosition({ x: 0, y: -100, z: 0 });
    }));
  }

  #buildCoins(ctx: GameCtx): void {
    const coinMaterial = new MeshStandardMaterial({ color: palette.gold, emissive: 0x6f3b00, emissiveIntensity: 0.22, metalness: 0.25, roughness: 0.35 });
    const rimMaterial = new MeshStandardMaterial({ color: palette.goldLight, emissive: 0xb56a00, emissiveIntensity: 0.2, metalness: 0.18, roughness: 0.3 });
    COIN_POSITIONS.forEach(([x, y, z], index) => {
      const coin = new Group();
      const disk = new Mesh(new CylinderGeometry(0.24, 0.24, 0.1, 16), coinMaterial);
      disk.rotation.x = Math.PI / 2;
      const rim = new Mesh(new TorusGeometry(0.18, 0.035, 6, 16), rimMaterial);
      rim.position.z = 0.065;
      coin.add(disk, rim);
      coin.position.set(x, y, z);
      coin.castShadow = true;
      this.#world.add(coin);
      const position = { x, y, z };
      const area = new Area3D({ physics: ctx.physics, position, shape: CollisionShape3D.sphere(0.45) });
      const item: Coin = { area, mesh: coin, position, phase: index * 0.7, collected: false };
      this.#coins.push(item);
      this.#areas.push(area);
      this.#unsubscribe.push(area.on("bodyEntered", (body) => {
        if (body !== this.#player?.body || item.collected) return;
        item.collected = true;
        item.mesh.visible = false;
        item.area.setPosition({ x: 0, y: -100, z: 0 });
        ctx.state.set((state) => ({ coins: state.coins + 1, score: state.score + 1, status: `Great run! ${state.coins + 1}/${state.total} stars collected` }));
      }));
    });
  }

  #buildGoal(ctx: GameCtx): void {
    const goal = new Group();
    const poleMaterial = new MeshStandardMaterial({ color: palette.woodLight, roughness: 0.62 });
    const pole = new Mesh(new CylinderGeometry(0.09, 0.12, 3.2, 10), poleMaterial);
    pole.position.y = 1.6;
    pole.castShadow = true;
    goal.add(pole);
    const pennant = new Mesh(new PlaneGeometry(1.15, 0.56), new MeshStandardMaterial({ color: palette.pink, side: 2, roughness: 0.55 }));
    pennant.position.set(0.52, 2.55, 0);
    pennant.rotation.y = -0.08;
    goal.add(pennant);
    const ring = new Mesh(new TorusGeometry(0.38, 0.09, 8, 18), new MeshStandardMaterial({ color: palette.gold, emissive: 0x8c5000, emissiveIntensity: 0.2, metalness: 0.35, roughness: 0.3 }));
    ring.position.y = 3.02;
    ring.rotation.x = Math.PI / 2;
    goal.add(ring);
    goal.position.set(15.05, 0.3, 0);
    this.#world.add(goal);
    this.#goalObject = goal;
    this.#goalArea = new Area3D({ physics: ctx.physics, position: { x: 15.05, y: 1.25, z: 0 }, shape: CollisionShape3D.box(1.4, 2.3, 2) });
    this.#areas.push(this.#goalArea);
    this.#unsubscribe.push(this.#goalArea.on("bodyEntered", (body) => {
      if (body !== this.#player?.body || this.#finished) return;
      this.#finished = true;
      ctx.state.set((state) => ({ goalReached: true, status: `Trail complete! ${state.coins}/${state.total} stars • press R to replay` }));
    }));
  }

  #updateCoins(dt: number): void {
    for (const coin of this.#coins) {
      if (coin.collected) continue;
      coin.mesh.rotation.y += dt * 3;
      coin.mesh.position.y = coin.position.y + Math.sin(this.#elapsed * 3 + coin.phase) * 0.12;
    }
    if (this.#goalObject !== undefined) {
      this.#goalObject.rotation.y = Math.sin(this.#elapsed * 1.7) * 0.08;
      this.#goalObject.position.y = 0.3 + Math.sin(this.#elapsed * 2.1) * 0.035;
    }
  }

  #updateCamera(ctx: GameCtx, dt: number): void {
    if (this.#player === undefined) return;
    const x = this.#player.mesh.position.x;
    const targetX = x + 2.7;
    ctx.camera.position.x += (targetX + 1.8 - ctx.camera.position.x) * Math.min(1, dt * 3.2);
    ctx.camera.position.y += (5.5 - ctx.camera.position.y) * Math.min(1, dt * 2.2);
    ctx.camera.position.z += (8.5 - ctx.camera.position.z) * Math.min(1, dt * 2.2);
    ctx.camera.lookAt(targetX, 0.9, 0);
  }

  #restartAfterFall(ctx: GameCtx): void {
    this.#hurt = false;
    this.#player?.reset();
    ctx.state.set((state) => ({ deaths: state.deaths + 1, respawns: state.respawns + 1, status: "Careful! Back to the trail…" }));
  }

  #restart(ctx: GameCtx): void {
    this.#finished = false;
    this.#hurt = false;
    this.#hazardTriggered = false;
    this.#hazardArea?.setPosition({ x: 4.45, y: 0.65, z: 0.2 });
    if (this.#hazardObject !== undefined) this.#hazardObject.visible = true;
    this.#player?.reset();
    for (const coin of this.#coins) {
      coin.collected = false;
      coin.mesh.visible = true;
      coin.mesh.position.set(coin.position.x, coin.position.y, coin.position.z);
      coin.area.setPosition(coin.position);
    }
    ctx.state.set({ coins: 0, goalReached: false, respawns: 0, score: 0, status: "Collect the stars and reach the flag", playerX: -9 });
  }

  #addBush(x: number, y: number, scale: number): void {
    const bush = new Group();
    const leafMaterial = new MeshStandardMaterial({ color: palette.leaf, roughness: 0.96 });
    for (const [ox, oy, size] of [[0, 0, 0.5], [0.35, 0.08, 0.38], [-0.35, 0.04, 0.34]] as const) {
      const leaf = new Mesh(new SphereGeometry(size * scale, 10, 8), leafMaterial);
      leaf.position.set(ox * scale, oy * scale, 0);
      leaf.castShadow = true;
      bush.add(leaf);
    }
    bush.position.set(x, y, -1.55);
    this.#world.add(bush);
  }

  #addTree(x: number, y: number, z: number, scale: number): void {
    const tree = new Group();
    const trunk = new Mesh(new CylinderGeometry(0.14 * scale, 0.2 * scale, 1.35 * scale, 8), new MeshStandardMaterial({ color: palette.wood, roughness: 0.9 }));
    trunk.position.y = 0.65 * scale;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new Mesh(new SphereGeometry(0.75 * scale, 10, 8), new MeshStandardMaterial({ color: palette.leaf, roughness: 0.96 }));
    leaves.position.y = 1.35 * scale;
    leaves.scale.set(1.15, 0.85, 1);
    leaves.castShadow = true;
    tree.add(leaves);
    const crown = new Mesh(new SphereGeometry(0.48 * scale, 10, 8), new MeshStandardMaterial({ color: palette.grassLight, roughness: 0.96 }));
    crown.position.set(-0.3 * scale, 1.58 * scale, 0.05);
    crown.castShadow = true;
    tree.add(crown);
    tree.position.set(x, y, z);
    this.#world.add(tree);
  }
}
