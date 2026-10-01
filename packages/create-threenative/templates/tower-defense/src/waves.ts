import { AUTO_SEND_DELAY, type ISpawn, TOTAL_WAVES, buildWave } from "./balance.js";

export type WavePhase = "build" | "combat";

/**
 * Launches waves and knows when one is over. Pure game-time bookkeeping: it is told how many
 * enemies and shells are still alive and never looks at a scene, so it runs the same in a spec.
 */
export class WaveDirector {
  autoSend = false;
  #wave = 0;
  #phase: WavePhase = "build";
  #queue: ISpawn[] = [];
  #cursor = 0;
  #timer = 0;
  #leaked = false;
  #idle = 0;
  #won = false;
  readonly #onSpawn: (spawn: ISpawn, wave: number) => void;
  readonly #onCleared: (wave: number, leaked: boolean) => void;

  constructor(options: {
    readonly onSpawn: (spawn: ISpawn, wave: number) => void;
    readonly onCleared: (wave: number, leaked: boolean) => void;
  }) {
    this.#onSpawn = options.onSpawn;
    this.#onCleared = options.onCleared;
  }

  get wave(): number {
    return this.#wave;
  }

  get phase(): WavePhase {
    return this.#phase;
  }

  get won(): boolean {
    return this.#won;
  }

  /** Enemies still to be released in the wave that is running. */
  get queued(): number {
    return this.#queue.length - this.#cursor;
  }

  /** Starts the next wave. Only from the build phase, and never past the last wave. */
  launch(): boolean {
    if (this.#phase !== "build" || this.#wave >= TOTAL_WAVES) return false;
    this.#wave += 1;
    this.#queue = buildWave(this.#wave);
    this.#cursor = 0;
    this.#timer = this.#queue[0]?.delay ?? 0;
    this.#leaked = false;
    this.#idle = 0;
    this.#phase = "combat";
    return true;
  }

  markLeak(): void {
    this.#leaked = true;
  }

  update(dt: number, alive: number, inFlight = 0): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("WaveDirector delta must be finite.");
    if (this.#phase === "build") {
      if (this.autoSend && !this.#won && this.#wave < TOTAL_WAVES) {
        this.#idle += dt;
        if (this.#idle >= AUTO_SEND_DELAY) this.launch();
      }
      return;
    }
    this.#timer -= dt;
    // `alive` was counted before this call, so an enemy released now is not in it yet.
    let released = 0;
    while (this.#cursor < this.#queue.length && this.#timer <= 0) {
      const spawn = this.#queue[this.#cursor];
      if (spawn === undefined) break;
      this.#cursor += 1;
      released += 1;
      this.#onSpawn(spawn, this.#wave);
      this.#timer += this.#queue[this.#cursor]?.delay ?? 0;
    }
    if (this.#cursor < this.#queue.length || alive + released > 0 || inFlight > 0) return;
    this.#phase = "build";
    this.#idle = 0;
    if (this.#wave >= TOTAL_WAVES) this.#won = true;
    this.#onCleared(this.#wave, this.#leaked);
  }
}
