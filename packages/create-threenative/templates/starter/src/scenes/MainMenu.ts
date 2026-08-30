import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { ball, block, roundedBox } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * The start screen is a scene, so its art is ordinary Three.js behind the React chrome. The UI
 * sends the start intent to game.ts; this scene owns only the world and its camera motion.
 */
export class MainMenu extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    characterName: "",
    coyoteJumps: 0,
    entityCount: 0,
    flagDisplacement: 0,
    flagGusts: 0,
    flagReadbacks: 0,
    flagSteps: 0,
    jumps: 0,
    levelX: -99,
    lives: 3,
    odometer: 0,
    paused: false,
    peakRise: 0,
    playerX: -2,
    respawns: 0,
    screen: "menu",
    score: 0,
    status: "playing",
    uiReady: false,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    ctx.state.set({ screen: "menu" });
    ctx.state.flush();
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    ctx.add(ctx.camera);

    const materials = createMaterials();
    const plinth = new Mesh(roundedBox(1.4, 0.5, 1.4, 0.08), materials.floor);
    plinth.position.y = -0.25;
    plinth.receiveShadow = true;
    const pedestal = block(0.9, 0.9, 0.9, materials.rock);
    pedestal.position.y = 0.45;
    const bust = ball(0.45, materials.player);
    bust.position.y = 1.35;
    const display = new Group();
    display.add(plinth, pedestal, bust);
    ctx.add(display);

    const target = new Vector3(0, 0.9, 0);
    let angle = Math.PI * 0.25;
    return (_frameCtx, dt) => {
      angle += dt * 0.18;
      const radius = 4.2;
      const camera = ctx.camera as PerspectiveCamera;
      camera.position.set(
        target.x + Math.sin(angle) * radius,
        target.y + 1.1,
        target.z + Math.cos(angle) * radius,
      );
      camera.lookAt(target);
    };
  }
}
