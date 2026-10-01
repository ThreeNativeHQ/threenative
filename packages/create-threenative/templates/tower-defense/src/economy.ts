import { START_CREDITS, START_LIVES } from "./balance.js";

function positive(amount: number, what: string): void {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(`Economy.${what} requires a positive amount.`);
}

/** Credits, reactor lives and score. Nothing here ticks: money moves only when the game says so. */
export class Economy {
  #credits = START_CREDITS;
  #lives = START_LIVES;
  #score = 0;
  #spent = 0;

  get credits(): number {
    return this.#credits;
  }

  get lives(): number {
    return this.#lives;
  }

  get score(): number {
    return this.#score;
  }

  get spent(): number {
    return this.#spent;
  }

  /** False, and no change, when the credits are not there. */
  spend(amount: number): boolean {
    positive(amount, "spend");
    if (amount > this.#credits) return false;
    this.#credits -= amount;
    this.#spent += amount;
    return true;
  }

  /** A kill: the credits arrive at once and the score is ten times them. */
  reward(amount: number): void {
    positive(amount, "reward");
    this.#credits += amount;
    this.#score += amount * 10;
  }

  /** A wave-clear payout: worth five score a credit. */
  bonus(amount: number): void {
    positive(amount, "bonus");
    this.#credits += amount;
    this.#score += amount * 5;
  }

  /** Recycling a tower. Not income, so the score does not move. */
  refund(amount: number): void {
    positive(amount, "refund");
    this.#credits += amount;
  }

  leak(lives: number): void {
    positive(lives, "leak");
    this.#lives = Math.max(0, this.#lives - lives);
  }
}
