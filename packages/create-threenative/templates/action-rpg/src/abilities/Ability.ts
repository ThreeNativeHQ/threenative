export interface IAbilityOptions {
  readonly cooldown: number;
  readonly duration: number;
  readonly onExpire: () => void;
  readonly onStart: () => void;
}

export class Ability {
  readonly cooldown: number;
  readonly duration: number;
  #cooldownRemaining = 0;
  #effectRemaining = 0;
  #onExpire: () => void;
  #onStart: () => void;

  constructor(options: IAbilityOptions) {
    this.cooldown = options.cooldown;
    this.duration = options.duration;
    this.#onExpire = options.onExpire;
    this.#onStart = options.onStart;
  }

  cast(): boolean {
    if (this.#cooldownRemaining > 0 || this.#effectRemaining > 0) return false;
    this.#cooldownRemaining = this.cooldown;
    this.#effectRemaining = this.duration;
    this.#onStart();
    return true;
  }

  update(dt: number): void {
    this.#cooldownRemaining = Math.max(0, this.#cooldownRemaining - dt);
    if (this.#effectRemaining <= 0) return;
    this.#effectRemaining = Math.max(0, this.#effectRemaining - dt);
    if (this.#effectRemaining === 0) this.#onExpire();
  }

  get active(): boolean {
    return this.#effectRemaining > 0;
  }

  get cooldownRemaining(): number {
    return this.#cooldownRemaining;
  }
}
