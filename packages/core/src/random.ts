export interface Random {
  (): number;
  pick<T>(items: readonly T[]): T;
  range(min: number, max: number): number;
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
  return random;
}
