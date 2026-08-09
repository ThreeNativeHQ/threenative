import { type Ctx, Scene, type SceneFrame } from "@threenative/core";
import type { PerspectiveCamera } from "three";
import { Player } from "../entities/Player.js";
import { createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { StreamedWorld } from "../render/world.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState>;

export class Play extends Scene<GameState> {
  static override readonly initialState: GameState = {
    activeChunks: "-1, 0, 1",
    currentChunk: 0,
    destination: "Sunwatch Mesa",
    discovered: 0,
    distance: 0,
    playerX: 0,
    playerZ: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState> {
    const sky = setupSky(ctx.scene);
    const lighting = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const materials = createMaterials();
    const world = new StreamedWorld(ctx, materials);
    const player = ctx.entities.add("player", new Player(ctx, materials));
    const camera = createSpringArm(ctx.camera as PerspectiveCamera);
    camera.snap(player.mesh.position);
    world.update(player.mesh.position.x);

    return (frameCtx, dt) => {
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      player.update(frameCtx, dt);
      const chunk = world.update(player.mesh.position.x);
      camera.follow(player.mesh.position, dt);
      lighting.follow(player.mesh.position);
      sky.follow(player.mesh.position);
      const debug = player.debug();
      const discovered = Number(player.mesh.position.x > 105) + Number(player.mesh.position.x > 265);
      frameCtx.state.set({
        activeChunks: world.active.join(", "),
        currentChunk: chunk,
        destination: discovered < 1 ? "Sunwatch Mesa" : discovered < 2 ? "Windcarved Arch" : "Eastward Wilds",
        discovered,
        distance: debug.distance,
        playerX: player.mesh.position.x,
        playerZ: player.mesh.position.z,
      });
    };
  }
}
