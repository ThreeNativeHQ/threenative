/** Deterministic 32-bit PRNG. Same seed, same sequence, on every run and every machine. */
export class Rng {
  #state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed)) throw new Error(`Rng seed must be an integer, received ${seed}.`);
    this.#state = seed >>> 0;
  }

  /** Current internal state, exposed so a run can be fingerprinted. */
  get state(): number {
    return this.#state;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform in [-magnitude, magnitude). */
  jitter(magnitude: number): number {
    return this.range(-magnitude, magnitude);
  }

  /** Uniform integer in [0, count). */
  int(count: number): number {
    return Math.min(count - 1, Math.floor(this.next() * count));
  }
}

/** Order-independent 32-bit fold, used to fingerprint a simulation's final pose. */
export function foldHash(hash: number, value: number): number {
  let next = hash ^ (value | 0);
  next = Math.imul(next, 0x01000193) >>> 0;
  return next >>> 0;
}

/** Quantises a float so that two runs agreeing to 0.1 mm hash identically. */
export function quantise(value: number): number {
  return Math.round(value * 10000);
}
