/**
 * The index arithmetic behind a radix-2 inverse FFT, kept separate from the kernel that runs it.
 *
 * This file holds no GPU code on purpose. An FFT that is subtly wrong produces a field that still
 * looks like water — plausible, animated, and wrong — so the arithmetic has to be checkable
 * against a naive transform on the CPU, where a test can actually see it. The compute kernel in
 * `spectral.ts` walks exactly these stages.
 */

/** `log2(n)` when `n` is a power of two, and a thrown error when it is not. */
export function log2Exact(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || (n & (n - 1)) !== 0) {
    throw new Error(`fft size must be a power of two, received ${n}.`);
  }
  return 31 - Math.clz32(n);
}

/**
 * Where each element must move before the butterflies start.
 *
 * A decimation-in-time FFT reads its input bit-reversed. Doing that as an explicit gather costs
 * one pass and makes every later stage a pure in-place butterfly, which is what lets a GPU run a
 * stage with no barrier inside it.
 */
export function bitReverseIndices(n: number): Uint32Array {
  const bits = log2Exact(n);
  const indices = new Uint32Array(n);
  for (let index = 0; index < n; index += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((index >>> bit) & 1);
    }
    indices[index] = reversed;
  }
  return indices;
}

/** One butterfly pair: the two slots it combines and the twiddle exponent between them. */
export interface IButterflyPair {
  readonly low: number;
  readonly high: number;
  /** `k` in `exp(+2πi·k / (2·half))` — positive because this is the inverse transform. */
  readonly twiddleIndex: number;
  readonly half: number;
}

/**
 * The pairs one stage combines, for a transform of length `n`.
 *
 * Every pair touches two slots no other pair in the same stage touches, so a stage is race-free
 * in place with one thread per pair. That property is the reason the GPU passes need no scratch
 * buffer and no barrier, and a test that stops checking it would let a silent corruption in.
 */
export function butterflyPairs(n: number, stage: number): IButterflyPair[] {
  const stages = log2Exact(n);
  if (!Number.isInteger(stage) || stage < 0 || stage >= stages) {
    throw new Error(`fft stage must be within [0, ${stages}), received ${stage}.`);
  }
  const half = 1 << stage;
  const pairs: IButterflyPair[] = [];
  for (let pair = 0; pair < n / 2; pair += 1) {
    const twiddleIndex = pair & (half - 1);
    const low = ((pair >> stage) << (stage + 1)) + twiddleIndex;
    pairs.push({ low, high: low + half, twiddleIndex, half });
  }
  return pairs;
}

/** The number of butterfly stages a transform of length `n` runs. */
export function butterflyStageCount(n: number): number {
  return log2Exact(n);
}
