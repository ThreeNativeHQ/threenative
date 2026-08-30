import { type ICtx, Scene } from "@threenative/core";
import { Heightfield } from "@threenative/core/world";
import {
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import * as THREE from "three";

const CHUNK_SIZE = 64;
const CHUNK_RESOLUTION = 65;
const STREAM_RADIUS = 1;
const PLAYER_SPEED = 150;
const WORLD_SEED = 251;
const WORLD_HALF_EXTENT = 1_000;

function terrainHeight(x: number, z: number): number {
  if (Math.abs(x) > WORLD_HALF_EXTENT || Math.abs(z) > WORLD_HALF_EXTENT)
    throw new Error(`Terrain sample (${x}, ${z}) is outside the 2 km by 2 km proof region.`);
  const phase = WORLD_SEED * 0.013;
  const warpX = Math.sin(z * 0.006 + phase) * 40;
  const warpZ = Math.cos(x * 0.005 - phase) * 36;
  return (
    Math.sin((x + warpX) * 0.0025 + phase) * 14 +
    Math.cos((z + warpZ) * 0.003 - phase) * 8 +
    Math.sin((x + z) * 0.012 + phase * 3) * 3 +
    Math.cos((x - z) * 0.019 - phase * 2) * 1.5
  );
}

const initialState = {
  chunks: 0,
  playerX: 0,
};

export type TerrainState = typeof initialState;
type TerrainCtx = ICtx<TerrainState, IPhysicsContext>;

class TerrainChunk {
  readonly mesh: THREE.Mesh;
  readonly #body: RigidBody3D;
  readonly #assetPath: string;
  readonly #releaseAsset: () => boolean;
  readonly #geometry: THREE.BufferGeometry;
  readonly #material: THREE.MeshBasicMaterial;

  constructor(ctx: TerrainCtx, chunkX: number) {
    this.#assetPath = `terrain/chunk-${chunkX}.glb`;
    void ctx.assets.model<THREE.Group>(this.#assetPath);
    this.#releaseAsset = () => ctx.assets.release("model", this.#assetPath);

    const field = Heightfield.fromSampler({
      columns: CHUNK_RESOLUTION,
      depth: CHUNK_SIZE,
      origin: { x: chunkX * CHUNK_SIZE, z: 0 },
      rows: CHUNK_RESOLUTION,
      sampleHeight: terrainHeight,
      width: CHUNK_SIZE,
    });
    const geometry = field.toGeometry();
    this.#geometry = geometry;
    this.#material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.31, 0.35, 0.22 + (((chunkX % 3) + 3) % 3) * 0.03),
      wireframe: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.#material);
    this.mesh.position.set(chunkX * CHUNK_SIZE, 0, 0);
    ctx.add(this.mesh);
    this.#body = new RigidBody3D({
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.heightfield(
        CHUNK_RESOLUTION,
        CHUNK_RESOLUTION,
        field.toColliderHeights(),
        { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE },
      ),
      type: "fixed",
    });
  }

  debug(): Record<string, unknown> {
    return { chunk: this.mesh.position.x / CHUNK_SIZE };
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
    this.#geometry.dispose();
    this.#material.dispose();
    this.#releaseAsset();
  }
}

class TerrainPlayer {
  readonly mesh: THREE.Mesh;
  readonly #body: CharacterBody3D;
  readonly #geometry: THREE.BoxGeometry;
  readonly #material: THREE.MeshBasicMaterial;

  constructor(ctx: TerrainCtx) {
    this.#geometry = new THREE.BoxGeometry(8, 8, 8);
    this.#material = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    this.mesh = new THREE.Mesh(this.#geometry, this.#material);
    this.mesh.position.set(0, 30, 0);
    ctx.add(this.mesh);
    this.#body = new CharacterBody3D({
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(2, 2),
      snapToGround: 0.5,
    });
  }

  move(velocity: { x: number; z: number }, dt: number): void {
    this.#body.velocity.x = velocity.x;
    this.#body.velocity.z = velocity.z;
    this.#body.moveAndSlide(dt);
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

export class TerrainProbe extends Scene<TerrainState, IPhysicsContext> {
  static override readonly initialState = initialState;

  #chunks = new Map<number, TerrainChunk>();
  #player: TerrainPlayer | undefined;

  override enter(ctx: TerrainCtx): void {
    this.#player = new TerrainPlayer(ctx);
    ctx.entities.add("player", {
      debug: () => ({ position: this.#player?.mesh.position.toArray() ?? [] }),
      dispose: () => this.#player?.dispose(),
      mesh: this.#player.mesh,
    });
    this.#stream(ctx, 0);
    this.#publish(ctx);
    this.#camera(ctx);
  }

  override update(ctx: TerrainCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    const move = ctx.input.vector("move");
    const velocityX = move.x * PLAYER_SPEED;
    player.move({ x: velocityX, z: move.y * PLAYER_SPEED }, dt);
    this.#stream(ctx, player.mesh.position.x + velocityX * dt);
    this.#publish(ctx);
    this.#camera(ctx);
  }

  override exit(): void {
    this.#chunks.clear();
    this.#player = undefined;
  }

  #stream(ctx: TerrainCtx, playerX: number): void {
    const center = Math.floor((playerX + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const wanted = new Set<number>();
    for (let offset = -STREAM_RADIUS; offset <= STREAM_RADIUS; offset += 1)
      wanted.add(center + offset);

    for (const [chunkX] of this.#chunks) {
      if (wanted.has(chunkX)) continue;
      ctx.entities.remove(`chunk.${chunkX}`);
      this.#chunks.delete(chunkX);
    }
    for (const chunkX of wanted) {
      if (this.#chunks.has(chunkX)) continue;
      const chunk = new TerrainChunk(ctx, chunkX);
      this.#chunks.set(chunkX, chunk);
      ctx.entities.add(`chunk.${chunkX}`, chunk);
    }
  }

  #publish(ctx: TerrainCtx): void {
    ctx.state.set({ chunks: this.#chunks.size, playerX: this.#player?.mesh.position.x ?? 0 });
  }

  #camera(ctx: TerrainCtx): void {
    const x = this.#player?.mesh.position.x ?? 0;
    ctx.camera.position.set(x, 180, 180);
    ctx.camera.lookAt(x, 0, 0);
  }
}
