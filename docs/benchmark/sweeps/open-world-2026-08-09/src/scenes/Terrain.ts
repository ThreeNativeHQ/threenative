import { type Ctx, Scene } from "@threenative/core";
import {
  CharacterBody3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import * as THREE from "three";

const SIZE = 64;
const RESOLUTION = 9;
const SPEED = 120;

const initialState = { chunks: 0, playerX: 0 };
export type TerrainState = typeof initialState;
type TerrainCtx = Ctx<TerrainState, PhysicsContext>;

class Chunk {
  readonly mesh: THREE.Mesh;
  readonly #body: RigidBody3D;
  readonly #release: () => boolean;
  readonly #geometry: THREE.PlaneGeometry;
  readonly #material: THREE.MeshBasicMaterial;

  constructor(ctx: TerrainCtx, x: number) {
    const path = `terrain/chunk-${x}.glb`;
    void ctx.assets.model(path);
    this.#release = () => ctx.assets.release("model", path);
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, RESOLUTION - 1, RESOLUTION - 1);
    geometry.rotateX(-Math.PI / 2);
    const heights = new Float32Array(RESOLUTION * RESOLUTION);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      const height = Math.sin((positions.getX(index) + x * SIZE) * 0.045) * 1.5;
      positions.setY(index, height);
      heights[index] = height;
    }
    this.#geometry = geometry;
    this.#material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.31, 0.35, 0.23),
      wireframe: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.#material);
    this.mesh.position.x = x * SIZE;
    ctx.add(this.mesh);
    this.#body = new RigidBody3D({
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.heightfield(RESOLUTION, RESOLUTION, heights, {
        x: SIZE,
        y: 1,
        z: SIZE,
      }),
      type: "fixed",
    });
  }

  debug(): Record<string, unknown> {
    return { chunk: this.mesh.position.x / SIZE };
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
    this.#geometry.dispose();
    this.#material.dispose();
    this.#release();
  }
}

class Player {
  readonly mesh: THREE.Mesh;
  readonly #body: CharacterBody3D;
  readonly #geometry: THREE.BoxGeometry;
  readonly #material: THREE.MeshBasicMaterial;

  constructor(ctx: TerrainCtx) {
    this.#geometry = new THREE.BoxGeometry(8, 8, 8);
    this.#material = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    this.mesh = new THREE.Mesh(this.#geometry, this.#material);
    this.mesh.position.y = 7;
    ctx.add(this.mesh);
    this.#body = new CharacterBody3D({
      object: this.mesh,
      gravity: 0,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(2, 2),
    });
  }

  move(x: number): void {
    this.#body.move({ x, y: 0, z: 0 });
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

export class Terrain extends Scene<TerrainState, PhysicsContext> {
  static override readonly initialState = initialState;
  #chunks = new Map<number, Chunk>();
  #player: Player | undefined;

  override enter(ctx: TerrainCtx): void {
    this.#player = new Player(ctx);
    ctx.entities.add("player", {
      debug: () => ({ position: this.#player?.mesh.position.toArray() ?? [] }),
      dispose: () => this.#player?.dispose(),
      mesh: this.#player.mesh,
    });
    this.#stream(ctx, 0);
    this.#camera(ctx);
  }

  override update(ctx: TerrainCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    const distance = ctx.input.vector("move").x * SPEED * dt;
    player.move(distance);
    this.#stream(ctx, player.mesh.position.x + distance);
    ctx.state.set({ chunks: this.#chunks.size, playerX: player.mesh.position.x });
    this.#camera(ctx);
  }

  override exit(): void {
    this.#chunks.clear();
    this.#player = undefined;
  }

  #stream(ctx: TerrainCtx, playerX: number): void {
    const center = Math.floor((playerX + SIZE / 2) / SIZE);
    const wanted = new Set([center - 1, center, center + 1]);
    for (const [x] of this.#chunks) {
      if (wanted.has(x)) continue;
      ctx.entities.remove(`chunk.${x}`);
      this.#chunks.delete(x);
    }
    for (const x of wanted) {
      if (this.#chunks.has(x)) continue;
      const chunk = new Chunk(ctx, x);
      this.#chunks.set(x, chunk);
      ctx.entities.add(`chunk.${x}`, chunk);
    }
  }

  #camera(ctx: TerrainCtx): void {
    const x = this.#player?.mesh.position.x ?? 0;
    ctx.camera.position.set(x, 180, 180);
    ctx.camera.lookAt(x, 0, 0);
  }
}
