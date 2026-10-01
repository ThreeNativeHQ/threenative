import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { Heightfield } from "@threenative/core/world";
import {
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
  rapier,
} from "@threenative/physics";
import {
  CapsuleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { createOcean, createWaterMesh } from "./render/ocean.js";
import { createTerrain } from "./render/terrain.js";
import baked from "./world/baked.json";

const initialState = {
  world: "forest",
  frames: 0,
  travel: 0,
  grounded: false,
  contactSamples: 0,
  maxContactError: 0,
  bilinearDifference: 0,
  oceanSteps: 0,
  waveSamples: 0,
  waveRange: 0,
  sampleSlopeRange: 0,
  sunX: -180,
};
type TerrainState = typeof initialState;
type TerrainCtx = ICtx<TerrainState, IPhysicsContext>;

function terrainScene(world: "forest" | "coastal"): new () => Scene<TerrainState, IPhysicsContext> {
  return class TerrainScene extends Scene<TerrainState, IPhysicsContext> {
    static override readonly initialState = initialState;
    #player: CharacterBody3D | undefined;
    #elapsed = 0;
    #sun: DirectionalLight | undefined;
    #ocean: ReturnType<typeof createOcean> | undefined;

    override enter(ctx: TerrainCtx): void {
      ctx.add(ctx.camera);
      const data = baked[world];
      const { field, mesh } = createTerrain(data, ctx.assets);
      ctx.add(mesh);
      const ground = new RigidBody3D({
        object: mesh,
        physics: ctx.physics,
        type: "fixed",
        entity: "terrain",
        collisionLayer: 4,
        shape: CollisionShape3D.heightfield(field.rows, field.columns, field.toColliderHeights(), {
          x: data.size,
          y: 1,
          z: data.size,
        }),
      });
      ctx.entities.add("terrain", {
        mesh,
        dispose: () => {
          ground.dispose();
          mesh.geometry.dispose();
          (mesh.material as MeshStandardMaterial).dispose();
        },
      });
      ctx.scene.background = new Color(0x9dc2d2);
      ctx.scene.fog = new FogExp2(0x9dc2d2, 0.0008);
      // 2.8 with a 1.2 hemisphere filled every sunlit surface past 1.0, and nothing here tone maps,
      // so the ground clipped to a flat warm haze and its albedo detail had nowhere left to live.
      const sun = new DirectionalLight(0xffeed0, 1.9);
      sun.position.set(-180, 240, 120);
      ctx.add(sun);
      this.#sun = sun;
      ctx.entities.add("sun", { object: sun, debug: () => ({ x: sun.position.x }) });
      ctx.add(new HemisphereLight(0xbcd4ed, 0x5e6548, 0.55));

      const actor = new Mesh(
        new CapsuleGeometry(0.35, 1.0, 6, 12),
        new MeshStandardMaterial({ color: 0xffc76d }),
      );
      const start = world === "forest" ? [-190, 160] : [180, 100];
      actor.position.set(
        start[0] as number,
        field.heightAt(start[0] as number, start[1] as number) + 2,
        start[1] as number,
      );
      actor.name = "player";
      ctx.add(actor);
      const player = new CharacterBody3D({
        object: actor,
        physics: ctx.physics,
        entity: "player",
        shape: CollisionShape3D.capsule(0.5, 0.35),
        snapToGround: 0.4,
        collisionMask: 4,
      });
      this.#player = player;
      ctx.entities.add("player", {
        mesh: actor,
        debug: () => ({ grounded: player.grounded, position: actor.position.toArray() }),
        dispose: () => {
          player.dispose();
          actor.geometry.dispose();
          actor.material.dispose();
        },
      });

      // A deliberately asymmetric nonplanar fixture, on the same runtime/physics path.
      const fixture = new Heightfield({
        rows: 17,
        columns: 17,
        width: 16,
        depth: 16,
        origin: { x: 0, z: 0 },
        heights: Float32Array.from(
          { length: 17 * 17 },
          (_, i) =>
            ((i % 17) * 13 + Math.floor(i / 17) * 7 + (i % 17) * Math.floor(i / 17) * 3) % 11,
        ),
      });
      const probeMesh = new Mesh(
        fixture.toGeometry(),
        new MeshStandardMaterial({ color: 0xd3a168 }),
      );
      probeMesh.position.x = 600;
      ctx.add(probeMesh);
      const probeBody = new RigidBody3D({
        object: probeMesh,
        physics: ctx.physics,
        type: "fixed",
        collisionLayer: 2,
        shape: CollisionShape3D.heightfield(17, 17, fixture.toColliderHeights(), {
          x: 16,
          y: 1,
          z: 16,
        }),
      });
      ctx.entities.add("asymmetric-terrain", {
        mesh: probeMesh,
        dispose: () => {
          probeBody.dispose();
          probeMesh.geometry.dispose();
          probeMesh.material.dispose();
        },
      });

      const ocean = world === "coastal" ? ctx.add(createOcean()) : undefined;
      this.#ocean = ocean;
      if (ocean) {
        const water = createWaterMesh(ocean, data);
        ctx.add(water);
        ctx.entities.add("sea", {
          object: ocean,
          debug: () => ({ steps: ocean.steps, staleFrames: ocean.staleFrames }),
          dispose: () => {
            water.geometry.dispose();
            (water.material as MeshStandardMaterial).dispose();
          },
        });
      }
      let frames = 0;
      let travel = 0;
      const previous = actor.position.clone();
      let contactSamples = 0;
      let maxContactError = 0;
      let bilinearDifference = 0;
      let waveSamples = 0;
      let minWave = Number.POSITIVE_INFINITY;
      let maxWave = Number.NEGATIVE_INFINITY;
      let minSlope = Number.POSITIVE_INFINITY;
      let maxSlope = Number.NEGATIVE_INFINITY;
      ctx.afterPhysics(() => {
        travel += Math.hypot(actor.position.x - previous.x, actor.position.z - previous.z);
        previous.copy(actor.position);
        // Query actual triangles, not bilinear interpolation, after the shared solver step.
        if (frames === 0) {
          probeMesh.updateMatrixWorld(true);
          mesh.updateMatrixWorld(true);
          const points = [
            [-7.75, -7.75],
            [-7.25, -7.25],
            [-7.75, -7.25],
            [-7.25, -7.75],
            [-8, -8],
            [-7, -8],
            [0, 0],
            [7.5, 7.5],
          ];
          for (const [x, z] of points) {
            const wx = 600 + (x as number);
            const visual = ctx.raycast({
              origin: new Vector3(wx, 200, z),
              direction: new Vector3(0, -1, 0),
              targets: probeMesh,
            });
            const physical = ctx.physics.directSpaceState.intersectRay({
              from: { x: wx, y: 200, z: z as number },
              to: { x: wx, y: -100, z: z as number },
              collisionMask: 2,
            });
            if (!visual || !physical) throw new Error("Missing asymmetric terrain contact");
            maxContactError = Math.max(
              maxContactError,
              Math.abs(visual.point.y - physical.position.y),
            );
            bilinearDifference = Math.max(
              bilinearDifference,
              Math.abs(visual.point.y - fixture.heightAt(x as number, z as number)),
            );
            contactSamples++;
          }
        }
        // An oblique traversal crosses cells; exact vertical edge/corner probes remain above.
        const visual = ctx.raycast({
          origin: new Vector3(actor.position.x, 300, actor.position.z),
          direction: new Vector3(1, -400, 1).normalize(),
          targets: mesh,
        });
        const physical = ctx.physics.directSpaceState.intersectRay({
          from: { x: actor.position.x, y: 300, z: actor.position.z },
          to: { x: actor.position.x + 1, y: -100, z: actor.position.z + 1 },
          collisionMask: 4,
        });
        if (!visual || !physical)
          throw new Error(
            `Missing playable terrain contact: world=${world}, frame=${frames}, player=${actor.position.toArray()}, visual=${!!visual}, physical=${!!physical}, terrain=${mesh.position.toArray()}`,
          );
        maxContactError = Math.max(maxContactError, Math.abs(visual.point.y - physical.position.y));
        contactSamples++;
        const wave = ocean?.sampleHeight(130, 140);
        const east = ocean?.sampleHeight(131, 140);
        if (wave && east) {
          waveSamples++;
          minWave = Math.min(minWave, wave.height);
          maxWave = Math.max(maxWave, wave.height);
          // Stale CPU sample slopes are a proxy; they do not qualify rendered normals.
          const slope = east.height - wave.height;
          minSlope = Math.min(minSlope, slope);
          maxSlope = Math.max(maxSlope, slope);
        }
        frames++;
        ctx.state.set({
          world,
          sunX: sun.position.x,
          frames,
          travel,
          grounded: player.grounded,
          contactSamples,
          maxContactError,
          bilinearDifference,
          oceanSteps: ocean?.steps ?? 0,
          waveSamples,
          waveRange: waveSamples ? maxWave - minWave : 0,
          sampleSlopeRange: waveSamples ? maxSlope - minSlope : 0,
        });
      });
      const cameraOffset = world === "coastal" ? new Vector3(28, 18, 34) : new Vector3(28, 24, 42);
      ctx.beforeRender(() => {
        ctx.camera.position.copy(actor.position).add(cameraOffset);
        ctx.camera.lookAt(actor.position.x, actor.position.y + 2, actor.position.z - 12);
      });
    }

    override update(ctx: TerrainCtx, dt: number): void {
      this.#elapsed += dt;
      this.#ocean?.advance(this.#elapsed);
      if (ctx.input.justPressed("light") && this.#sun) {
        const sun = this.#sun;
        sun.position.set(sun.position.x < 0 ? 180 : -180, 240, 120);
      }
      const player = this.#player;
      if (!player) return;
      const move = ctx.input.vector("move");
      player.velocity.x = move.x * 9;
      player.velocity.z = move.y * 9;
      if (ctx.input.justPressed("jump") && player.grounded) player.velocity.y = 5;
      player.moveAndSlide(dt);
      if (ctx.input.justPressed("coast")) void ctx.goto(world === "forest" ? "coastal" : "forest");
    }
  };
}

const game = defineGame<TerrainState, IPhysicsContext>({
  camera: { projection: "perspective", fov: 60, far: 5000 },
  initialState,
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    jump: { keys: ["Space"] },
    coast: { keys: ["KeyC"] },
    light: { keys: ["KeyL"] },
  },
  plugins: [rapier({ deterministicRestart: true }), playtest()],
  render: { preferWebGPU: true },
  scenes: { forest: terrainScene("forest"), coastal: terrainScene("coastal") },
  start: "forest",
});

export default game;
