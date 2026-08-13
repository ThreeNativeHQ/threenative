import type { ICtx, ScheduleHandle } from "@threenative/core";
import type { GameState } from "./state.js";

type GameCtx = ICtx<GameState, unknown>;

export class WaveDirector {
  static readonly MAX_WAVES = 5;
  wave = 0;
  cleared = 0;
  won = false;
  #pending = false;
  #nextHandle: ScheduleHandle | undefined;

  start(create: (wave: number) => void): void {
    if (this.wave !== 0) throw new Error("WaveDirector can only start once.");
    this.wave = 1;
    create(this.wave);
  }

  reset(): void {
    this.#nextHandle?.cancel();
    this.#nextHandle = undefined;
    this.#pending = false;
    this.cleared = 0;
    this.wave = 1;
    this.won = false;
  }

  update(
    ctx: GameCtx,
    liveTargets: number,
    create: (wave: number) => void,
    onClear: (wave: number) => void,
  ): void {
    if (this.won || this.#pending || liveTargets > 0 || this.wave === 0) return;
    this.cleared = Math.max(this.cleared, this.wave);
    onClear(this.wave);
    if (this.wave >= WaveDirector.MAX_WAVES) {
      this.won = true;
      return;
    }
    this.#pending = true;
    this.#nextHandle = ctx.after(0.6, () => {
      this.#nextHandle = undefined;
      this.wave += 1;
      this.#pending = false;
      create(this.wave);
    });
  }
}
