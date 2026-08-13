export class Boost {
  readonly duration: number;
  readonly multiplier: number;
  #remaining = 0;
  #uses = 0;

  constructor(duration = 1.4, multiplier = 1.8) {
    if (!(duration > 0) || !(multiplier > 1))
      throw new Error("Boost duration must be positive and multiplier must exceed one.");
    this.duration = duration;
    this.multiplier = multiplier;
  }

  get active(): boolean {
    return this.#remaining > 0;
  }

  get remaining(): number {
    return this.#remaining;
  }

  get uses(): number {
    return this.#uses;
  }

  activate(): boolean {
    if (this.active) return false;
    this.#remaining = this.duration;
    this.#uses += 1;
    return true;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("Boost.update requires a finite time step.");
    this.#remaining = Math.max(0, this.#remaining - dt);
  }
}
