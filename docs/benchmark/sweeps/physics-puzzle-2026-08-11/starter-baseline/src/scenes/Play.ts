import { type Ctx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, type PerspectiveCamera } from "three";
import { Player } from "../entities/Player.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { floorMaterial } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

export class Play extends Scene<GameState, PhysicsContext> {
  static override readonly initialState: GameState = { playerX: -2, score: 0 };

  override enter(ctx: GameCtx): SceneFrame<GameState, PhysicsContext> {
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    setupCamera(ctx.camera as PerspectiveCamera);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add(
      "hud",
      createHud(ctx.camera as PerspectiveCamera, "SCORE", "ITEMS"),
    );
    const floor = new Mesh(new BoxGeometry(10, 0.2, 4), floorMaterial);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    ctx.add(floor);
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floor),
      type: "fixed",
    });
    const player = new Player(ctx);
    ctx.entities.add("player", player);
    const pickup = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    pickup.on("bodyEntered", (body) => {
      if (body === player.body) ctx.state.set((state) => ({ score: state.score + 1 }));
    });

    let elapsed = 0;
    return (frameCtx, dt) => {
      player.update(frameCtx, dt);
      elapsed += dt;
      const state = frameCtx.state.getState();
      hud.update({
        counter: Math.abs(player.mesh.position.x) * 10,
        primary: state.score,
        seconds: elapsed,
      });
      frameCtx.state.set({ playerX: player.mesh.position.x });
    };
  }
}
