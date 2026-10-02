import { AnimationPlayer, type ICtx, Scene, type SceneFrame, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
} from "three";

interface IReversalState extends Record<string, unknown> {
  reversals: number;
  maxWeightError: number;
  maxPoseJump: number;
  maxPhaseJump: number;
  activeActions: number;
  disposedActions: number;
}

/** Synthetic bone motion isolates crossfade continuity; it does not qualify a real gait asset. */
class AnimationReversal extends Scene<IReversalState> {
  static override readonly initialState: IReversalState = {
    reversals: 0,
    maxWeightError: 0,
    maxPoseJump: 0,
    maxPhaseJump: 0,
    activeActions: -1,
    disposedActions: -1,
  };

  override enter(ctx: ICtx<IReversalState>): SceneFrame<IReversalState> {
    ctx.camera.position.set(1, 1, 6);
    ctx.camera.lookAt(1, 0, 0);
    const root = new Group();
    const hip = new Bone();
    hip.name = "Hip";
    hip.add(new Mesh(new BoxGeometry(0.5, 1.5, 0.3), new MeshBasicMaterial({ color: 0x41c7c2 })));
    root.add(hip);
    ctx.add(root);
    const clips = ["idle", "walk", "run"].map(
      (name, index) =>
        new AnimationClip(name, 1, [
          new NumberKeyframeTrack("Hip.position[x]", [0, 0.5, 1], [index, index + 1, index]),
        ]),
    );
    const player = new AnimationPlayer({ clips, root, strideSync: false });
    const actions = clips.map((clip) => player.mixer.clipAction(clip));
    ctx.entities.add("locomotion", {
      animation: player,
      mesh: root,
      dispose: () => player.dispose(),
    });
    player.play("idle");
    const trace = new Map<number, readonly string[]>([
      [12, ["walk"]],
      [18, ["run"]],
      [24, ["idle"]],
      [30, ["run"]],
      [36, ["walk"]],
      [42, ["idle"]],
      [48, ["walk", "run", "idle"]],
    ]);
    let tick = 0;
    let reversals = 0;
    let maxWeightError = 0;
    let maxPoseJump = 0;
    let maxPhaseJump = 0;
    return (frameCtx, dt) => {
      tick += 1;
      if (tick > 120) return;
      player.update(dt);
      // Zero-time samples isolate the request's pose jump from normal motion between frames.
      player.update(0);
      for (const name of trace.get(tick) ?? []) {
        const action = player.mixer.clipAction(player.clip(name));
        const live = action.isScheduled() && action.getEffectiveWeight() > 0;
        const phase = action.time;
        const pose = hip.position.x;
        player.play(name, { fade: 0.4 });
        if (live) maxPhaseJump = Math.max(maxPhaseJump, Math.abs(action.time - phase));
        player.update(0);
        maxPoseJump = Math.max(maxPoseJump, Math.abs(hip.position.x - pose));
        reversals += 1;
      }
      const weights = actions.map((action) => action.getEffectiveWeight());
      if (weights.some((weight) => !Number.isFinite(weight) || weight < 0))
        throw new Error("Animation reversal produced an invalid weight.");
      maxWeightError = Math.max(
        maxWeightError,
        Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1),
      );
      frameCtx.state.set({
        reversals,
        maxWeightError,
        maxPoseJump,
        maxPhaseJump,
        activeActions: player.mixer.stats.actions.inUse,
      });
      if (tick === 120) {
        player.dispose();
        frameCtx.state.set({ disposedActions: player.mixer.stats.actions.total });
        frameCtx.state.flush();
      }
    };
  }
}

const game = defineGame<IReversalState>({
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { reversal: AnimationReversal },
  start: "reversal",
});

export default game;
