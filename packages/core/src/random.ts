export interface Random {
  (): number;
  pick<T>(items: readonly T[]): T;
  range(min: number, max: number): number;
  state: number;
}

export function createRandom(seed?: number): Random {
  if (seed !== undefined && !Number.isFinite(seed)) throw new TypeError("seed must be finite.");
  let state = seed === undefined ? 0 : seed >>> 0;
  const deterministic = seed !== undefined;
  const random = (() => {
    if (!deterministic) return Math.random();
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  }) as Random;
  random.range = (min, max) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new RangeError("range requires finite bounds with max greater than min.");
    }
    return min + random() * (max - min);
  };
  random.pick = <T>(items: readonly T[]) => {
    if (items.length === 0) throw new RangeError("pick requires a non-empty list.");
    return items[Math.floor(random() * items.length)] as T;
  };
  Object.defineProperty(random, "state", {
    get: () => {
      if (!deterministic) throw new Error("state is unavailable on an unseeded random.");
      return state;
    },
    set: (value: number) => {
      if (!deterministic) throw new Error("state is unavailable on an unseeded random.");
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError("state must be a finite integer.");
      }
      state = value >>> 0;
    },
  });
  return random;
}
