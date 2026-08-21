import { type ICtx, Scene } from "@threenative/core";
import { createReplayMarker } from "../render/marker.js";
import type { ReplayState } from "../state.js";

const INITIAL_HASH = 2_168_613_626;

function nextHash(hash: number, direction: number): number {
  return Math.imul(hash ^ (direction + 1), 16_777_619) >>> 0;
}

export class ReplayScene extends Scene<ReplayState> {
  static override readonly initialState: ReplayState = {
    frozen: false,
    position: 0,
    recordingHash: "",
    recordingRandomState: 0,
    recordingRuntimeAgent: "",
    recordingRuntimeCore: "",
    recordingSeed: 0,
    recordingSha256: "",
    recordingSource: "",
    recordingStep: 0,
    recordingValidated: false,
    skipOuterTick: false,
    stateHash: INITIAL_HASH,
    tick: 0,
  };

  override enter(ctx: ICtx<ReplayState>): void {
    ctx.add(createReplayMarker());
  }

  override update(ctx: ICtx<ReplayState>): void {
    const state = ctx.state.getState();
    if (state.frozen) return;
    if (state.skipOuterTick) {
      ctx.state.set({ skipOuterTick: false });
      return;
    }
    const direction = Math.sign(ctx.input.vector("move").x);
    ctx.state.set({
      position: state.position + direction,
      skipOuterTick: false,
      stateHash: nextHash(state.stateHash, direction),
      tick: state.tick + 1,
    });
  }
}
