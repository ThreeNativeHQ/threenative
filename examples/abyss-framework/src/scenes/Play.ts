import { type Ctx, Scene } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";
import { Crate } from "../entities/Crate.js";
import { Player } from "../entities/Player.js";

export type GameState = { playerX: number; score: number };
export type GameCtx = Ctx<GameState, PhysicsContext>;

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #step: RigidBody3D | undefined;
  #crate: Crate | undefined;
  #player: Player | undefined;
  #pickup: Area3D | undefined;
  #pickupMesh: Mesh | undefined;
  #unsubscribe: (() => void) | undefined;

  override enter(ctx: GameCtx): void {
    ctx.camera.position.set(0, 3, 9);
    ctx.camera.lookAt(0, 1, 0);

    const floorMesh = new Mesh(new BoxGeometry(10, 0.2, 4), new MeshNormalMaterial());
    floorMesh.position.y = -0.1;
    ctx.add(floorMesh);
    this.#floor = new RigidBody3D({
      mesh: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });

    const stepMesh = new Mesh(new BoxGeometry(0.7, 0.3, 4), new MeshNormalMaterial());
    stepMesh.position.set(0.8, 0.15, 0);
    ctx.add(stepMesh);
    this.#step = new RigidBody3D({
      mesh: stepMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(stepMesh),
      type: "fixed",
    });

    this.#crate = new Crate(ctx, -1, 4, -1.5);
    this.#player = new Player(ctx);
    ctx.entities.add("player", this.#player);
    this.#pickup = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    this.#pickupMesh = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshNormalMaterial());
    this.#pickupMesh.position.set(1.5, 0.5, 0);
    ctx.add(this.#pickupMesh);
    this.#unsubscribe = this.#pickup.on("bodyEntered", (body) => {
      if (body !== this.#player?.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
    });
  }

  override update(ctx: GameCtx, dt: number): void {
    this.#player?.update(ctx, dt);
    ctx.state.set({ playerX: this.#player?.mesh.position.x ?? -2 });
  }

  override exit(ctx: GameCtx): void {
    this.#unsubscribe?.();
    this.#pickup?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#crate?.dispose();
    this.#step?.dispose();
    this.#floor?.dispose();
    this.#pickupMesh?.removeFromParent();
    this.#unsubscribe = undefined;
    this.#pickup = undefined;
    this.#player = undefined;
    this.#crate = undefined;
    this.#step = undefined;
    this.#floor = undefined;
    this.#pickupMesh = undefined;
  }
}
