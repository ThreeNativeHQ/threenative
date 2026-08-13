export const TOTAL_WAVES = 10;
export const ATTACKERS_PER_WAVE = 2;
export const WAVE_INTERVAL = 0.5;

export class WaveSchedule {
  #elapsed = WAVE_INTERVAL;
  #spawned = 0;
  #won = false;
  readonly #onSpawn: (wave: number, member: number) => void;
  readonly #onWin: () => void;

  constructor(options: {
    readonly onSpawn: (wave: number, member: number) => void;
    readonly onWin: () => void;
  }) {
    this.#onSpawn = options.onSpawn;
    this.#onWin = options.onWin;
  }

  get spawned(): number {
    return this.#spawned;
  }

  update(dt: number, activeAttackers: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("WaveSchedule delta must be finite.");
    if (this.#spawned < TOTAL_WAVES) {
      this.#elapsed += dt;
      while (this.#elapsed >= WAVE_INTERVAL && this.#spawned < TOTAL_WAVES) {
        this.#elapsed -= WAVE_INTERVAL;
        this.#spawned += 1;
        for (let member = 0; member < ATTACKERS_PER_WAVE; member += 1) {
          this.#onSpawn(this.#spawned, member);
        }
      }
    } else if (!this.#won && activeAttackers === 0) {
      this.#won = true;
      this.#onWin();
    }
  }
}
