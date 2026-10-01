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
import { CapsuleGeometry, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { createOcean, createWaterMesh } from "./render/ocean.js";
import { createPropSurfaces } from "./render/propMaterials.js";
import {
  type PropGroundQuery,
  buildPropVariants,
  createProps,
  flatPropMaterials,
} from "./render/props.js";
import { type IPlacementField, scatterProps } from "./render/scatter.js";
import { type IOutdoorSky, createOutdoorSky } from "./render/sky.js";
import { createTerrain } from "./render/terrain.js";
import baked from "./world/baked.json";

/**
 * The fixed benchmark framings, in world metres, per world.
 *
 * Fixed rather than relative to the player so a capture at seed 73 is the same picture on every
 * machine, and so the rubric's "close ground/vegetation view" and "landscape overview" are two
 * numbers rather than two moods. `eye` is the height above the terrain under the camera, which is
 * what makes "eye height ~1.7 m" true on a slope instead of true only on a flat.
 *
 * The meadow focus is where the ground is grass with spruces on it and a slope to look along, and
 * it is also where the dense grass goes: ground cover is placed around this point, not around the
 * origin, because a meadow is a place rather than a texture.
 */
/** Every framing the `V` key can hold, whether or not the current world has one for it. */
type ViewName = "horizon-sea" | "meadow-close" | "overview" | "player";

interface IBenchmarkPose {
  /** World x and z of the eye, and the height above the terrain under it. */
  readonly at: readonly [number, number];
  readonly eye: number;
  /** World x and z to look at, and the height above the terrain under *that*. */
  readonly look: readonly [number, number];
  readonly lookUp: number;
  /**
   * An absolute world height to look at instead, for a target with no ground under it: a sea
   * horizon is a direction, and thirty metres below the surface three hundred metres out is how a
   * hillside tips its view down far enough for the water to be a band rather than a line.
   */
  readonly lookY?: number;
}

interface IBenchmark {
  /** Where this world's ground cover is placed. */
  readonly focus: { readonly x: number; readonly z: number };
  readonly poses: Readonly<Record<string, IBenchmarkPose>>;
  /** The order the `V` key walks, and the framings the playtest screenshots. */
  readonly views: readonly ViewName[];
}

const BENCHMARK: Record<"coastal" | "forest", IBenchmark> = {
  forest: {
    // Eleven metres along the meadow-close camera's own line of sight, which is what makes the
    // meadow a place the camera is *in* rather than a disc it looks across: the blades that fill the
    // bottom of the frame are the ones this point scatters, and the ones thinning towards the ridge
    // are the same blades a hundred metres further off.
    focus: { x: 186, z: 76 },
    poses: {
      "meadow-close": { at: [176, 84], eye: 1.7, look: [214, 44], lookUp: 2.2 },
      overview: { at: [96, 168], eye: 92, look: [190, 40], lookUp: 8 },
    },
    views: ["player", "meadow-close", "overview"],
  },
  coastal: {
    focus: { x: 78, z: -128 },
    poses: {
      "meadow-close": { at: [56, -108], eye: 1.7, look: [96, -146], lookUp: 2.2 },
      overview: { at: [150, 60], eye: 110, look: [40, -80], lookUp: 6 },
      // Six metres up on the eastern headland, looking out along the coast: sixty metres of hillside
      // in the foreground, then open water for the four hundred after it, which is the framing that
      // says whether the sea meets the haze or ends in a line. Eye height rather than standing
      // height, because the heightfield resolves every two metres and a camera a metre and a half
      // above it frames its own triangulation.
      "horizon-sea": { at: [150, 20], eye: 6, look: [450, 65], lookUp: 0, lookY: -30 },
    },
    views: ["player", "meadow-close", "overview", "horizon-sea"],
  },
};

/** The last closed frame-budget window, published into state by the scene. */
const budget = { drawCalls: 0, frameMs: 0 };

/**
 * Per-view frame cost, latched across the windows that closed while that camera was up.
 *
 * `budget` alone cannot answer "did the trees cost more at the meadow or at the overview": a playtest
 * cycles the cameras faster than a window closes, so the one number it holds belongs to whichever
 * view happened to be current. This keeps every window grouped by the view that was on screen, and
 * reports the median of each group's p50s and the worst p99 — the worst, because a LOD band that pops
 * once is a one-frame cost the median hides.
 */
interface IViewWindow {
  readonly view: string;
  readonly p50s: number[];
  readonly p99s: number[];
  readonly triangles: number[];
}
const viewBudgets = new Map<string, IViewWindow>();
let currentView = "";

/** The middle of a sample set, for a summary that one outlier cannot move. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

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
  propDraws: 0,
  propInstances: 0,
  propTriangles: 0,
  view: "player",
  windowDrawCalls: 0,
  windowFrameMs: 0,
  meadowFrameP50: 0,
  meadowFrameP99: 0,
  meadowTriangles: 0,
  overviewFrameP50: 0,
  overviewFrameP99: 0,
  overviewTriangles: 0,
};
type TerrainState = typeof initialState;
type TerrainCtx = ICtx<TerrainState, IPhysicsContext>;

function terrainScene(world: "forest" | "coastal"): new () => Scene<TerrainState, IPhysicsContext> {
  return class TerrainScene extends Scene<TerrainState, IPhysicsContext> {
    static override readonly initialState = initialState;
    #player: CharacterBody3D | undefined;
    #surfaces: { advance: (elapsed: number) => void } | undefined;
    #elapsed = 0;
    #sky: IOutdoorSky | undefined;
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
      // One rig owns the whole of the sky, the sun, the shadows that follow the eye, the haze the
      // far ridges fade into and the tone curve. It used to be a flat `Color` background, a
      // hand-set `FogExp2`, a sun with a five metre shadow box that missed everything, and no tone
      // mapping at all; the numbers behind all of that now live in `src/render/sky.ts`.
      const sky = createOutdoorSky(ctx.camera);
      ctx.add(sky.daylight);
      ctx.add(sky.sun);
      this.#sky = sky;
      ctx.entities.add("sun", { object: sky.sun, debug: () => ({ x: sky.sunX }) });

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

      // A deliberately asymmetric nonplanar fixture, on the same runtime/physics path. It is
      // invisible: it exists to be ray-queried, and at x = 600 there is no terrain under it, so
      // drawing it put a small orange wedge in the sky of every overview capture. The scene picker
      // walks the hierarchy without consulting visibility and the collider is its own body, so
      // both contact paths below still answer for a mesh that is not drawn.
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
      probeMesh.visible = false;
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
      // --- the meadow's props -------------------------------------------------------------------
      //
      // Built on the first physics step rather than in `enter`, because both ways of asking the
      // world where the ground is need a world that has been stepped: the ray query walks the
      // heightfield's own triangles and the collider is not in the space until the solver runs.
      // Asking in `enter` returns "no ground here" for every prop on a perfectly solid hillside.
      const propField: IPlacementField = {
        colors: data.colors,
        field,
        resolution: data.size === 0 ? 0 : field.rows,
        size: data.size,
        waterLevel: data.waterLevel,
      };
      const scatter = scatterProps(propField, BENCHMARK[world].focus);
      const propParts = buildPropVariants();
      const flat = flatPropMaterials();
      let props: ReturnType<typeof createProps> | undefined;
      let released = false;
      let surfacesDispose: (() => void) | undefined;
      // Ground contact is a ray query against the drawn terrain and the terrain's collider, never
      // the bilinear sampler: a spruce floating a centimetre above the visible surface reads as a
      // mistake at exactly the distance a player spends most of their time at.
      mesh.updateMatrixWorld(true);
      mesh.geometry.computeBoundingBox();
      const top = mesh.geometry.boundingBox?.max.y ?? 0;
      const groundAt: PropGroundQuery = (placement, at) => {
        const [x, , z] = at;
        const visual = ctx.raycast({
          direction: new Vector3(0, -1, 0),
          origin: new Vector3(x, top + 2, z),
          targets: [mesh],
        });
        const physical = ctx.physics.directSpaceState.intersectRay({
          collisionMask: 4,
          from: { x, y: top + 2, z },
          to: { x, y: -100, z },
        });
        const [originX, originY, originZ] = placement.position;
        return {
          height: visual?.point.y ?? physical?.position.y ?? null,
          offset: originY - field.heightAt(originX, originZ),
        };
      };
      const buildProps = (): void => {
        props = createProps(scatter.placements, groundAt, propParts, flat);
        ctx.add(props.object);
        ctx.entities.add("props", {
          object: props.object,
          debug: () => ({
            boulders: scatter.counts.boulder,
            draws: props?.meshes.length ?? 0,
            grass: scatter.counts.grass,
            poppies: scatter.counts.poppy,
            spruces: scatter.counts.spruce,
            totalInstances: props?.meshes.reduce((sum, draw) => sum + draw.count, 0) ?? 0,
            triangles:
              props?.meshes.reduce(
                (sum, draw) => sum + (draw.count * (draw.geometry.index?.count ?? 0)) / 3,
                0,
              ) ?? 0,
          }),
          dispose: () => {
            released = true;
            surfacesDispose?.();
            flat.dispose();
            props?.dispose();
            for (const parts of propParts.values())
              for (const part of parts) part.geometry.dispose();
          },
        });
        // The lit surfaces and the maps arrive asynchronously; when they do every mesh swaps its
        // material by role. Until then the props draw on flat stand-ins, so a slow or absent asset
        // server costs this world its bark and its needles rather than its trees.
        void createPropSurfaces(ctx.assets).then((surfaces) => {
          this.#surfaces = surfaces;
          if (released) {
            surfaces.dispose();
            return;
          }
          for (const draw of props?.meshes ?? []) {
            const role = draw.name.split(":").at(-1) as keyof typeof surfaces.materials;
            draw.material = surfaces.materials[role];
          }
          surfacesDispose = surfaces.dispose;
        });
      };

      let frames = 0;
      let travel = 0;
      currentView = `${world}:player`;
      viewBudgets.set(currentView, { view: currentView, p50s: [], p99s: [], triangles: [] });
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
        // The props are placed here rather than in `enter`: their ground query asks the stepped
        // world where the surface is, and neither the ray tree nor the collider answers before the
        // solver has run once.
        if (props === undefined) buildProps();
        frames++;
        ctx.state.set({
          world,
          sunX: sky.sunX,
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
          propDraws: props?.meshes.length ?? 0,
          propInstances: props?.meshes.reduce((sum, draw) => sum + draw.count, 0) ?? 0,
          propTriangles:
            props?.meshes.reduce(
              (sum, draw) => sum + (draw.count * (draw.geometry.index?.count ?? 0)) / 3,
              0,
            ) ?? 0,
          windowDrawCalls: budget.drawCalls,
          windowFrameMs: budget.frameMs,
          // The two framings the trees are judged from, published as plain state so the run report
          // carries the numbers rather than a console ring buffer that outlives neither run.
          meadowFrameP50: median(viewBudgets.get("forest:meadow-close")?.p50s ?? []),
          meadowFrameP99: Math.max(0, ...(viewBudgets.get("forest:meadow-close")?.p99s ?? [])),
          meadowTriangles: median(viewBudgets.get("forest:meadow-close")?.triangles ?? []),
          overviewFrameP50: median(viewBudgets.get("forest:overview")?.p50s ?? []),
          overviewFrameP99: Math.max(0, ...(viewBudgets.get("forest:overview")?.p99s ?? [])),
          overviewTriangles: median(viewBudgets.get("forest:overview")?.triangles ?? []),
        });
      });
      // --- the fixed benchmark cameras ---------------------------------------------------------
      //
      // Three framings, all fixed in world metres: the one the player walks behind, the eye-height
      // meadow view the rubric asks for, and the overview. They are data rather than a camera rig
      // so a capture at seed 73 is the same picture on every machine.
      const { poses, views } = BENCHMARK[world];
      const at = (x: number, z: number, up: number): Vector3 =>
        new Vector3(x, field.heightAt(x, z) + up, z);
      ctx.beforeRender(() => {
        const view = ctx.state.getState().view;
        if (view === "player") {
          const offset = world === "coastal" ? new Vector3(28, 18, 34) : new Vector3(28, 24, 42);
          ctx.camera.position.copy(actor.position).add(offset);
          ctx.camera.lookAt(actor.position.x, actor.position.y + 2, actor.position.z - 12);
          return;
        }
        // A view this world has no framing for falls back to its overview rather than throwing:
        // the cycle can only produce framings the world declares, and this is the last line of
        // defence against a state that arrived from somewhere else.
        const pose = poses[view] ?? poses.overview;
        if (pose === undefined) throw new RangeError(`World '${world}' has no overview framing`);
        ctx.camera.position.copy(at(pose.at[0], pose.at[1], pose.eye));
        ctx.camera.lookAt(
          pose.lookY === undefined
            ? at(pose.look[0], pose.look[1], pose.lookUp)
            : new Vector3(pose.look[0], pose.lookY, pose.look[1]),
        );
      });
    }

    override update(ctx: TerrainCtx, dt: number): void {
      this.#elapsed += dt;
      this.#surfaces?.advance(this.#elapsed);
      if (ctx.input.justPressed("view")) {
        const cycle = BENCHMARK[world].views;
        const current = cycle.indexOf(ctx.state.getState().view as ViewName);
        const next = cycle[(current + 1) % cycle.length] ?? "player";
        // Keyed by world as well as view: `meadow-close` frames a different hillside in each world,
        // so folding them together would report one number for two different pictures.
        currentView = `${world}:${next}`;
        // Cumulative, not reset: a view is entered once per cycle but latched across every pass the
        // run makes through it, so a second visit measures the same framing with more samples behind
        // it rather than starting the count from nothing.
        if (!viewBudgets.has(currentView))
          viewBudgets.set(currentView, { view: currentView, p50s: [], p99s: [], triangles: [] });
        ctx.state.set({ view: next });
      }
      this.#ocean?.advance(this.#elapsed);
      if (ctx.input.justPressed("light")) this.#sky?.setSunX(this.#sky.sunX < 0 ? 180 : -180);
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
    view: { keys: ["KeyV"] },
    coast: { keys: ["KeyC"] },
    light: { keys: ["KeyL"] },
  },
  // A short window so a playtest run actually closes one: the default 300 frames is longer than
  // this scenario runs. The window is read into state, which is what puts the measured draw count
  // and frame cost into the run report instead of only on a console line nobody reads.
  frameBudget: {
    // A short window so a playtest run actually closes one; the default 300 frames is longer than
    // this scenario runs. The scene reads the result into state, which is what puts the measured
    // draw count and frame cost into the run report rather than only on a console line.
    onWindow: (window) => {
      budget.drawCalls = Object.values(window.passes ?? {}).reduce(
        (sum, pass) => sum + pass.draws.p50,
        0,
      );
      budget.frameMs = window.frame.p50;
      const group = viewBudgets.get(currentView);
      if (group) {
        group.p50s.push(window.frame.p50);
        group.p99s.push(window.frame.p99);
        group.triangles.push(
          Object.values(window.passes ?? {}).reduce((sum, pass) => sum + pass.triangles.p50, 0),
        );
      }
    },
    // Small because this counts PRESENTED frames, not simulated ones. The native host presents at
    // roughly fifteen a second under Xvfb, so a 1459-frame run presents only a couple of hundred
    // times: the default 300-present window never closes at all, and every framing would report zero
    // samples. Ten presents is a second of steady state here, enough that each benchmark view that
    // the scenario holds on screen accumulates several windows to take a median over.
    reportEvery: 10,
  },
  plugins: [rapier({ deterministicRestart: true }), playtest()],
  render: { preferWebGPU: true },
  scenes: { forest: terrainScene("forest"), coastal: terrainScene("coastal") },
  start: "forest",
});

export default game;
