import {
  AudioBus,
  type ICtx,
  Scene,
  type SceneFrame,
  WaveField,
  createRandom,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BufferAttribute, Group, Mesh, NearestFilter, type PerspectiveCamera } from "three";
import { Crate } from "../entities/Crate.js";
import { Goal, ISLAND } from "../entities/Goal.js";
import { Player } from "../entities/Player.js";
import { createSpringArm } from "../render/camera.js";
import { createCoastalScene } from "../render/coast.js";
import { pickupRiseEase } from "../render/easing.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials, createPennantMaterial } from "../render/materials.js";
import { COAST_DOMAIN_WARP, COAST_WAVES } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { createScenery } from "../render/scenery.js";
import { ball, block, roundedBox, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const KILL_PLANE = -4;
const STARTING_LIVES = 3;
const FLOOR_SURFACE_Y = 0;
const FLOOR_BOUNDS = { maxX: 5, minX: -5, maxZ: 2, minZ: -2 } as const;

export class Play extends Scene<GameState, IPhysicsContext> {
  #assetProof: Mesh | undefined;
  #materials: ReturnType<typeof createMaterials> | undefined;
  #player: Player | undefined;
  #scenery: ReturnType<typeof createScenery> | undefined;

  static override readonly initialState: GameState = {
    coyoteJumps: 0,
    entityCount: 0,
    flagDisplacement: 0,
    flagGusts: 0,
    flagReadbacks: 0,
    flagSteps: 0,
    jumps: 0,
    levelX: -99,
    lives: STARTING_LIVES,
    odometer: 0,
    paused: false,
    peakRise: 0,
    playerX: -2,
    respawns: 0,
    score: 0,
    status: "playing",
    uiReady: false,
  };

  override async load(ctx: GameCtx): Promise<void> {
    const materials = createMaterials();
    this.#materials = materials;
    const state = ctx.state.getState();
    this.#player = ctx.entities.add(
      "player",
      new Player(ctx, materials.player, {
        x: Number.isFinite(state.playerX) ? state.playerX : Play.initialState.playerX,
        y: 0.5,
        z: 0,
      }),
    );
    const [texture, model] = await Promise.all([
      ctx.assets.texture("native-proof.png"),
      ctx.assets.model<{ scene: Group }>("native-proof.glb"),
    ]);
    // A 16-pixel check filtered smoothly is a grey smear at flag size; nearest keeps the
    // squares square, which is the whole reason the finish flag is legible from the ledge.
    texture.magFilter = NearestFilter;
    let pennant: Mesh | undefined;
    model.scene.traverse((object) => {
      if (object instanceof Mesh) {
        if (pennant !== undefined) throw new Error("Starter proof glTF must contain one mesh.");
        object.material = createPennantMaterial(texture);
        // The packaged proof carries positions and indices only. Without UVs the sampler
        // reads one corner texel for every fragment and the flag renders as flat white —
        // a loaded texture that proves nothing you can see. Plane-project the triangle.
        // Compiled models may be quantized (KHR_mesh_quantization): the attribute then holds
        // normalized integers, so measure each axis range from the array itself instead of
        // assuming float32 metres — the affine projection is identical either way.
        const position = object.geometry.getAttribute("position");
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < position.count; index += 1) {
          minX = Math.min(minX, position.getX(index));
          maxX = Math.max(maxX, position.getX(index));
          minY = Math.min(minY, position.getY(index));
          maxY = Math.max(maxY, position.getY(index));
        }
        const spanX = Math.max(maxX - minX, Number.EPSILON);
        const spanY = Math.max(maxY - minY, Number.EPSILON);
        const uv = new Float32Array(position.count * 2);
        for (let index = 0; index < position.count; index += 1) {
          uv[index * 2] = (position.getX(index) - minX) / spanX;
          uv[index * 2 + 1] = (position.getY(index) - minY) / spanY;
        }
        object.geometry.setAttribute("uv", new BufferAttribute(uv, 2));
        pennant = object;
      }
    });
    if (pennant === undefined) throw new Error("Starter proof glTF did not contain a mesh.");
    model.scene.name = "native-proof-assets";
    this.#assetProof = pennant;
    console.info("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    if (
      this.#assetProof === undefined ||
      this.#materials === undefined ||
      this.#player === undefined
    )
      throw new Error("Starter scene did not finish loading.");
    const materials = this.#materials;
    const player = this.#player;
    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.wav");
    void pickupAudio.catch(() => undefined);
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package:
    // the platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, {
      godraysLight: sun,
      mobile: isMobile(),
    });
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const waves = new WaveField({ waves: COAST_WAVES, domainWarp: COAST_DOMAIN_WARP });
    ctx.add(createCoastalScene(materials, waves, createRandom(31_415_926)));
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(ctx.camera as PerspectiveCamera))
      : undefined;
    // Offset, lead and damping all live in render/camera.ts — framing is a look decision.
    const springArm = createSpringArm(ctx.camera as PerspectiveCamera);

    const scenery = createScenery(materials.rock, materials.ridge, createRandom(20_260_821));
    let refinementStarted = false;
    this.#scenery = scenery;
    ctx.add(scenery.object);
    ctx.entities.add("scenery.ridge", scenery);
    // Two sentinels, both read by seed.playtest as an out-of-range value rather than as a
    // transition: state.levelX starts at -99, so a level that never builds stays out of range,
    // and seededLevelX becomes 2 if this draw did not advance ctx.random — which is what happens
    // if someone swaps it for Math.random. Neither depends on WHEN the runner samples.
    const randomStateBeforeLevel = ctx.random.state;
    const levelX = ctx.random.range(-1, 1);
    const seededLevelX = ctx.random.state === randomStateBeforeLevel ? 2 : levelX;
    const pickupX = 1.2 + createRandom(Math.round((levelX + 1) * 1000))() * 0.8;
    const floorMesh = new Mesh(roundedBox(10, 0.2, 4.2, 0.1), materials.floor);
    floorMesh.position.y = -0.1;
    // The collision slab remains the authoritative support surface, while the coastal renderer
    // supplies the oval beach and grass top. Showing both makes a rectangular floating raft under
    // the island, which is a visual artefact rather than a useful part of the scene.
    floorMesh.visible = false;
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
    void ctx.tween(pickupVisual.position, { y: 0.65 }, 0.4, { ease: pickupRiseEase });
    springArm.snap(player.mesh.position);
    // The packaged proof asset earns its place here: it is the pennant on the finish flag,
    // not a debug object parked over the level. The texture and the glTF still load in
    // `load()` above, which is what the native asset gate greps for.
    const goal = ctx.entities.add("goal", new Goal(ctx, materials, this.#assetProof));
    const supportSurfaceY = (position: { readonly x: number; readonly z: number }):
      | number
      | undefined => {
      if (
        position.x >= FLOOR_BOUNDS.minX &&
        position.x <= FLOOR_BOUNDS.maxX &&
        position.z >= FLOOR_BOUNDS.minZ &&
        position.z <= FLOOR_BOUNDS.maxZ
      )
        return FLOOR_SURFACE_Y;
      if (
        position.x >= ISLAND.x - ISLAND.width / 2 &&
        position.x <= ISLAND.x + ISLAND.width / 2 &&
        position.z >= ISLAND.z - ISLAND.depth / 2 &&
        position.z <= ISLAND.z + ISLAND.depth / 2
      )
        return ISLAND.top;
      return undefined;
    };
    // The area says the character is over the island; the run is only won once it is also
    // standing on it. Ending on the overlap alone freezes the character in mid-air at the
    // lip of the island, half a metre short of a landing, which is what it looks like.
    let overGoal = false;
    goal.area.on("bodyEntered", (body) => {
      if (body === player.body) overGoal = true;
    });
    let entityCount = 4;
    ctx.state.set({ entityCount });
    const pickup = new Area3D({
      physics: ctx.physics,
      position: { x: pickupX, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    pickup.on("bodyEntered", (body) => {
      if (body !== player.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
      ctx.entities.remove("pickup");
      entityCount -= 1;
      ctx.state.set({ entityCount });
      pickup.monitoring = false;
      pickupVisual.visible = false;
      ctx.after(3, () => {
        ctx.entities.add("pickup", pickupVisual);
        entityCount += 1;
        ctx.state.set({ entityCount });
        pickupVisual.visible = true;
        pickup.monitoring = true;
      });
      void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
    });
    if (state.score > 0) {
      ctx.entities.remove("pickup");
      entityCount -= 1;
      ctx.state.set({ entityCount });
      pickup.monitoring = false;
      pickupVisual.visible = false;
    }

    // Set with the level, not 0.25 s later. The delay existed so the playtest could observe the
    // -99 -> seeded transition, which made the assertion a race against boot time: it was sampled
    // at tick 6 on a workstation and tick 47 in CI, and only the slow sample missed the change.
    ctx.state.set({ levelX: seededLevelX });
    const frameState: Partial<GameState> = {};
    let elapsed = 0;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: starter frame coordinates existing gameplay state transitions.
    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;
      waves.setTime(elapsed);
      // Restart resets the store before clearing entities and scheduled callbacks.
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      const previous = frameCtx.state.getState();
      // A finished run stops simulating the character and keeps drawing the world behind
      // the banner. R, or the restart button, rebuilds the scene from `initialState`.
      if (previous.status !== "playing") return;
      if (frameCtx.input.justPressed("flagGust")) {
        goal.pennant.wind.set(0, 0.4, 4.5);
        frameCtx.state.set((state) => ({ flagGusts: state.flagGusts + 1 }));
      }
      const touch = touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      const move = frameCtx.input.vector("move");
      if (
        !refinementStarted &&
        (move.x !== 0 || move.y !== 0 || (touch?.move.x ?? 0) !== 0 || (touch?.move.y ?? 0) !== 0)
      ) {
        scenery.rebuild();
        refinementStarted = true;
      }
      player.update(frameCtx, dt, supportSurfaceY, touch);
      let respawned = false;
      let lives = previous.lives;
      if (player.mesh.position.y < KILL_PLANE) {
        lives -= 1;
        player.respawn();
        springArm.snap(player.mesh.position);
        respawned = true;
      }
      springArm.dolly(frameCtx.input.axis("zoom"), dt);
      springArm.follow(player.mesh.position, dt);
      // `status` is written only on the frame that ends the run, and never in the bulk
      // write below, which would stamp this frame's stale copy back over it.
      if (lives <= 0) frameCtx.state.set({ status: "lost" });
      else if (overGoal && player.grounded) {
        frameCtx.state.set({ status: "won" });
        frameCtx.state.flush();
      }
      frameState.coyoteJumps = player.coyoteJumps;
      frameState.flagDisplacement = Math.max(previous.flagDisplacement, goal.flagDisplacement());
      frameState.flagReadbacks = goal.readbackLands();
      frameState.flagSteps = goal.pennant.steps;
      frameState.jumps = player.jumps;
      frameState.lives = lives;
      frameState.odometer = player.odometer;
      frameState.peakRise = Math.max(previous.peakRise, player.mesh.position.y - 0.5);
      frameState.playerX = player.mesh.position.x;
      frameState.respawns = previous.respawns + (respawned ? 1 : 0);
      const current = frameCtx.state.getState();
      const changed =
        frameState.coyoteJumps !== current.coyoteJumps ||
        frameState.flagDisplacement !== current.flagDisplacement ||
        frameState.flagReadbacks !== current.flagReadbacks ||
        frameState.flagSteps !== current.flagSteps ||
        frameState.jumps !== current.jumps ||
        frameState.lives !== current.lives ||
        frameState.odometer !== current.odometer ||
        frameState.peakRise !== current.peakRise ||
        frameState.playerX !== current.playerX ||
        frameState.respawns !== current.respawns;
      if (changed) frameCtx.state.set(frameState);
      if (respawned) frameCtx.state.flush();
    };
  }

  override exit(ctx: GameCtx): void {
    this.#scenery?.dispose();
    this.#scenery = undefined;
    super.exit(ctx);
  }
}
