import { AudioBus, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { DoubleSide, Group, Mesh, MeshBasicMaterial, type PerspectiveCamera, Vector3 } from "three";
import { Crate } from "../entities/Crate.js";
import { Player } from "../entities/Player.js";
import { createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, makeRandom, roundedBox, sculpture, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const KILL_PLANE = -4;

export class Play extends Scene<GameState, IPhysicsContext> {
  #assetProof: Group | undefined;

  static override readonly initialState: GameState = {
    coyoteJumps: 0,
    entityCount: 0,
    jumps: 0,
    levelX: -99,
    peakRise: 0,
    playerX: -2,
    respawns: 0,
    score: 0,
  };

  override async load(ctx: GameCtx): Promise<void> {
    const [texture, model] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
    ]);
    model.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = new MeshBasicMaterial({ map: texture, side: DoubleSide });
      }
    });
    model.scene.name = "native-proof-assets";
    this.#assetProof = model.scene;
    console.info("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    if (this.#assetProof === undefined) throw new Error("Starter proof assets did not load.");
    this.#assetProof.position.set(0, 1.7, -1.5);
    ctx.add(this.#assetProof);
    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    void pickupAudio.catch(() => undefined);
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    ctx.add(ctx.camera);
    const springArm = createSpringArm(ctx.camera as PerspectiveCamera, {
      lookAhead: new Vector3(0, 0.9, -0.4),
    });

    const materials = createMaterials();
    const sculptureMesh = sculpture(materials.crate);
    sculptureMesh.name = "sculpture";
    sculptureMesh.position.set(-2, 2.6, -1.5);
    ctx.add(sculptureMesh);
    const levelX = ctx.random.range(-1, 1);
    const pickupX = 1.2 + makeRandom(Math.round((levelX + 1) * 1000))() * 0.8;
    const floorMesh = new Mesh(roundedBox(10, 0.2, 4, 0.08), materials.floor);
    floorMesh.position.y = -0.1;
    floorMesh.receiveShadow = true;
    ctx.add(floorMesh);
    new RigidBody3D({
      object: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });
    new Crate(ctx, levelX, 4, -1.5, materials.crate);
    const state = ctx.state.getState();
    const player = new Player(ctx, materials.player, {
      x: Number.isFinite(state.playerX) ? state.playerX : Play.initialState.playerX,
      y: 0.5,
      z: 0,
    });
    const pickupBase = block(0.42, 0.14, 0.42, materials.player);
    const pickupStem = tube(0.08, 0.08, 0.3, materials.player);
    const pickupOrb = ball(0.16, materials.player);
    const pickupTip = spike(0.14, 0.26, materials.player);
    pickupBase.position.y = -0.16;
    pickupStem.position.y = 0.06;
    pickupOrb.position.y = 0.32;
    pickupTip.position.y = 0.53;
    const pickupVisual = new Group();
    pickupVisual.add(pickupBase, pickupStem, pickupOrb, pickupTip);
    pickupVisual.position.set(pickupX, 0.5, 0);
    pickupVisual.castShadow = true;
    ctx.add(pickupVisual);
    ctx.entities.add("pickup", pickupVisual);
    void ctx.tween(pickupVisual.position, { y: 0.65 }, 0.4);
    springArm.snap(player.mesh.position);
    ctx.state.set({ levelX });
    ctx.entities.add("player", player);
    ctx.state.set({ entityCount: Object.keys(ctx.entities.snapshot()).length });
    const pickup = new Area3D({
      physics: ctx.physics,
      position: { x: pickupX, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    pickup.on("bodyEntered", (body) => {
      if (body !== player.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
      ctx.entities.remove("pickup");
      ctx.state.set({
        entityCount: Object.keys(ctx.entities.snapshot()).length,
      });
      pickup.monitoring = false;
      pickupVisual.visible = false;
      ctx.after(3, () => {
        ctx.entities.add("pickup", pickupVisual);
        pickupVisual.visible = true;
        pickup.monitoring = true;
      });
      void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
    });
    if (state.score > 0) {
      ctx.entities.remove("pickup");
      pickup.monitoring = false;
      pickupVisual.visible = false;
    }

    return (frameCtx, dt) => {
      // Restart resets the store before clearing entities and scheduled callbacks.
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      player.update(frameCtx, dt);
      let respawned = false;
      if (player.mesh.position.y < KILL_PLANE) {
        player.respawn();
        springArm.snap(player.mesh.position);
        respawned = true;
      }
      springArm.follow(player.mesh.position, dt);
      const debug = player.debug();
      const previous = frameCtx.state.getState();
      frameCtx.state.set({
        coyoteJumps: debug.coyoteJumps,
        jumps: debug.jumps,
        peakRise: Math.max(previous.peakRise, player.mesh.position.y - 0.5),
        playerX: player.mesh.position.x,
        respawns: previous.respawns + (respawned ? 1 : 0),
        entityCount: Object.keys(frameCtx.entities.snapshot()).length,
      });
      if (respawned) frameCtx.state.flush();
    };
  }
}
