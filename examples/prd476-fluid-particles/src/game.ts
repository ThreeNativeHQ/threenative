import { FluidParticles3D, type ICtx, Scene, type SceneFrame, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { createPointsView } from "./render/points.js";

export interface IFluidParticlesState extends Record<string, unknown> {
  count: number;
  steps: number;
  meanCompression: number;
  maxSpeed: number;
  frontX: number;
  peakFrontX: number;
  minY: number;
  maxY: number;
  inBounds: number;
  released: number;
  staleFrames: number;
}

/** The dam gate comes out after this many fixed steps (0.8 s, as in the lab). */
const GATE_STEPS = 48;
const GATE = { kind: "box", center: [-0.9, 2.4, 0], halfExtents: [0.05, 2.4, 1.6] } as const;

class DamBreakScene extends Scene<IFluidParticlesState> {
  static override readonly initialState: IFluidParticlesState = {
    count: 0,
    steps: 0,
    meanCompression: 1,
    maxSpeed: 99,
    frontX: 0,
    peakFrontX: 0,
    minY: 0,
    maxY: 0,
    inBounds: 0,
    released: 0,
    staleFrames: 0,
  };

  override enter(ctx: ICtx<IFluidParticlesState>): SceneFrame<IFluidParticlesState> {
    const water = new FluidParticles3D({ capacity: 6000 });
    ctx.add(water);
    ctx.add(createPointsView(water, ctx.scene, ctx.camera));
    water.setColliders([GATE]);
    water.fill([-2.8, 0.1, -1.5], [-1.0, 2.8, 1.5]);

    let peakFrontX = 0;
    return (frame) => {
      if (water.steps === GATE_STEPS) water.setColliders([]);
      const stats = water.stats;
      const { min, max } = water.bounds;
      const slack = 0.01;
      peakFrontX = Math.max(peakFrontX, stats?.max[0] ?? 0);
      frame.state.set({
        count: stats?.count ?? 0,
        steps: water.steps,
        meanCompression: stats?.meanCompression ?? 1,
        maxSpeed: stats?.maxSpeed ?? 99,
        frontX: stats?.max[0] ?? 0,
        peakFrontX,
        minY: stats?.min[1] ?? 0,
        maxY: stats?.max[1] ?? 0,
        inBounds:
          stats !== undefined &&
          [0, 1, 2].every(
            (axis) =>
              (stats.min[axis] as number) >= (min[axis] as number) - slack &&
              (stats.max[axis] as number) <= (max[axis] as number) + slack,
          )
            ? 1
            : 0,
        released: water.steps > GATE_STEPS ? 1 : 0,
        staleFrames: stats?.staleFrames ?? 0,
      });
    };
  }
}

const game = defineGame<IFluidParticlesState>({
  step: 1 / 60,
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { dam: DamBreakScene },
  start: "dam",
});

export default game;
