// The determinism discipline of `examples/engine-load-test/src/workload.ts`, copied rather than
// reinvented: one stated recurrence, one stated hash, and a number two machines can compare
// before anybody publishes a frame time taken on either of them.

/** state = (state * 1664525 + 1013904223) mod 2^32 — the same recurrence the load test states. */
export function createLcg(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error("createLcg requires a 32-bit unsigned integer seed.");
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Value noise over a seeded 256-entry permutation. Value rather than gradient noise because the
 * quarry only needs a repeatable displacement field, and because a table this small is the same
 * table on every machine — a gradient table built from floats is not.
 */
export class ValueNoise3D {
  readonly #permutation: Uint8Array;

  constructor(seed: number) {
    const random = createLcg(seed);
    const table = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) table[index] = index;
    // Fisher-Yates, drawing from the stated recurrence so the shuffle is part of the seed.
    for (let index = 255; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const held = table[index] as number;
      table[index] = table[swap] as number;
      table[swap] = held;
    }
    this.#permutation = table;
  }

  #hash(x: number, y: number, z: number): number {
    const table = this.#permutation;
    const a = table[(x & 255) as number] as number;
    const b = table[((a + y) & 255) as number] as number;
    return ((table[((b + z) & 255) as number] as number) / 255) * 2 - 1;
  }

  /** One octave, trilinear, with a smoothstep fade so the field has no grid creases. */
  sample(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const zf = fade(z - zi);
    const c000 = this.#hash(xi, yi, zi);
    const c100 = this.#hash(xi + 1, yi, zi);
    const c010 = this.#hash(xi, yi + 1, zi);
    const c110 = this.#hash(xi + 1, yi + 1, zi);
    const c001 = this.#hash(xi, yi, zi + 1);
    const c101 = this.#hash(xi + 1, yi, zi + 1);
    const c011 = this.#hash(xi, yi + 1, zi + 1);
    const c111 = this.#hash(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, xf);
    const x10 = lerp(c010, c110, xf);
    const x01 = lerp(c001, c101, xf);
    const x11 = lerp(c011, c111, xf);
    return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
  }

  /** Fractal sum. Amplitude halves and frequency doubles, so the result stays in [-1, 1]. */
  fractal(x: number, y: number, z: number, octaves: number): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let normalizer = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += this.sample(x * frequency, y * frequency, z * frequency) * amplitude;
      normalizer += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return normalizer === 0 ? 0 : total / normalizer;
  }
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * FNV-1a/32 over every position quantised to millimetres.
 *
 * Quantised first so two machines agree on the integers even where their float printing would
 * not, and taken over the whole buffer rather than a prefix: a generator that diverges only in
 * its last ten thousand vertices is still a different body, and a prefix hash would call it the
 * same one.
 */
export function positionHash(positions: Float32Array): string {
  let hash = 2166136261;
  for (let index = 0; index < positions.length; index += 1) {
    // Round-half-away-from-zero, written out: `Math.round(-0.5)` is `-0` in JavaScript and `0`
    // in most other languages, and a hash must not depend on which one a port picked.
    const value = (positions[index] as number) * 1000;
    const quantised = value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
    const unsigned = quantised >>> 0;
    for (let byte = 0; byte < 4; byte += 1) {
      hash = (hash ^ ((unsigned >>> (byte * 8)) & 255)) >>> 0;
      // 32-bit throughout: the FNV prime times a full 32-bit accumulator exceeds 2^53, so a
      // plain `*` would lose bits and disagree with any port of this function.
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}
