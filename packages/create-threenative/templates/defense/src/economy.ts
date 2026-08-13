export const STARTING_BALANCE = 120;
export const TOWER_COST = 40;
export const INCOME_RATE = 6;

export class Economy {
  #balance = STARTING_BALANCE;
  #income = 0;
  #spent = 0;

  get balance(): number {
    return this.#balance;
  }

  get income(): number {
    return this.#income;
  }

  get spent(): number {
    return this.#spent;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new Error("Economy.update requires a finite delta.");
    this.#income += INCOME_RATE * dt;
    this.#balance = STARTING_BALANCE + this.#income - this.#spent;
  }

  spend(amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Economy.spend requires a positive amount.");
    if (amount > this.#balance) return false;
    this.#spent += amount;
    this.#balance = STARTING_BALANCE + this.#income - this.#spent;
    return true;
  }
}
