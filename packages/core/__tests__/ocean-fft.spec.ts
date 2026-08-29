import { describe, expect, it } from "vitest";
import {
  bitReverseIndices,
  butterflyPairs,
  butterflyStageCount,
  log2Exact,
} from "../src/ocean/fft.js";

/**
 * The naive inverse DFT, O(n²), used only as the thing the fast transform has to agree with.
 *
 * A wrong FFT still produces an animated field that looks like water. Nothing downstream — not a
 * screenshot, not a frame meter, not a buoyancy assertion within tolerance of its own wrong
 * surface — can tell the difference. This is the only place the arithmetic is actually checked.
 */
function inverseDftReference(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe = new Array<number>(n).fill(0);
  const outIm = new Array<number>(n).fill(0);
  for (let out = 0; out < n; out += 1) {
    for (let index = 0; index < n; index += 1) {
      const angle = (2 * Math.PI * out * index) / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      outRe[out] =
        (outRe[out] as number) + (re[index] as number) * cos - (im[index] as number) * sin;
      outIm[out] =
        (outIm[out] as number) + (re[index] as number) * sin + (im[index] as number) * cos;
    }
  }
  return { re: outRe, im: outIm };
}

/**
 * The same transform the GPU kernel runs, driven entirely from the exported plan.
 *
 * It walks `bitReverseIndices` then every stage of `butterflyPairs`, so if the plan is wrong this
 * disagrees with the reference and the kernel that shares the plan is wrong in the same way.
 */
function inverseFftFromPlan(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const reversal = bitReverseIndices(n);
  const workRe = new Array<number>(n);
  const workIm = new Array<number>(n);
  for (let index = 0; index < n; index += 1) {
    workRe[index] = re[reversal[index] as number] as number;
    workIm[index] = im[reversal[index] as number] as number;
  }
  for (let stage = 0; stage < butterflyStageCount(n); stage += 1) {
    for (const pair of butterflyPairs(n, stage)) {
      const angle = (2 * Math.PI * pair.twiddleIndex) / (2 * pair.half);
      const wRe = Math.cos(angle);
      const wIm = Math.sin(angle);
      const hiRe = workRe[pair.high] as number;
      const hiIm = workIm[pair.high] as number;
      const mulRe = hiRe * wRe - hiIm * wIm;
      const mulIm = hiRe * wIm + hiIm * wRe;
      const loRe = workRe[pair.low] as number;
      const loIm = workIm[pair.low] as number;
      workRe[pair.low] = loRe + mulRe;
      workIm[pair.low] = loIm + mulIm;
      workRe[pair.high] = loRe - mulRe;
      workIm[pair.high] = loIm - mulIm;
    }
  }
  return { re: workRe, im: workIm };
}

function randomSignal(n: number, seed: number): { re: number[]; im: number[] } {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296 - 0.5;
  };
  return {
    re: Array.from({ length: n }, next),
    im: Array.from({ length: n }, next),
  };
}

describe("ocean fft plan", () => {
  it("should refuse a size that is not a power of two", () => {
    expect(() => log2Exact(100)).toThrow("must be a power of two");
    expect(() => log2Exact(0)).toThrow("must be a power of two");
    expect(() => log2Exact(-8)).toThrow("must be a power of two");
    expect(log2Exact(256)).toBe(8);
  });

  it("should refuse a stage outside the transform", () => {
    expect(() => butterflyPairs(16, 4)).toThrow("stage must be within [0, 4)");
    expect(() => butterflyPairs(16, -1)).toThrow("stage must be within [0, 4)");
  });

  it("should bit-reverse an 8-point transform the way the textbook does", () => {
    expect([...bitReverseIndices(8)]).toStrictEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });

  it("should give every slot to exactly one pair in a stage, so a stage is race-free in place", () => {
    for (const n of [8, 16, 64, 256]) {
      for (let stage = 0; stage < butterflyStageCount(n); stage += 1) {
        const touched = new Set<number>();
        for (const pair of butterflyPairs(n, stage)) {
          // Two threads writing the same slot in one dispatch is a corruption that shows up as
          // a slightly wrong wave and nothing else. The GPU has no barrier inside a stage, so
          // this disjointness is the only thing making that impossible.
          expect(touched.has(pair.low)).toBe(false);
          expect(touched.has(pair.high)).toBe(false);
          touched.add(pair.low);
          touched.add(pair.high);
        }
        expect(touched.size).toBe(n);
      }
    }
  });

  it("should agree with a naive inverse DFT at every size the ocean uses", () => {
    for (const n of [8, 16, 32, 64, 128, 256]) {
      const signal = randomSignal(n, n * 7919);
      const fast = inverseFftFromPlan(signal.re, signal.im);
      const reference = inverseDftReference(signal.re, signal.im);
      for (let index = 0; index < n; index += 1) {
        expect(fast.re[index]).toBeCloseTo(reference.re[index] as number, 8);
        expect(fast.im[index]).toBeCloseTo(reference.im[index] as number, 8);
      }
    }
  });

  it("should transform a real Hermitian spectrum into a real signal", () => {
    // The ocean relies on this: h(-k) = conj(h(k)) is what makes the inverse transform of a
    // complex spectrum a real height field, and it is why two real fields can share one complex
    // transform. If the plan broke it, the height would carry an imaginary part nothing reads and
    // the surface would be quietly halved.
    const n = 64;
    const source = randomSignal(n, 4242);
    const re = new Array<number>(n).fill(0);
    const im = new Array<number>(n).fill(0);
    for (let index = 0; index < n; index += 1) {
      const mirror = (n - index) % n;
      re[index] = source.re[index] as number;
      im[index] = source.im[index] as number;
      re[mirror] = source.re[index] as number;
      im[mirror] = -(source.im[index] as number);
    }
    im[0] = 0;
    im[n / 2] = 0;
    const result = inverseFftFromPlan(re, im);
    for (let index = 0; index < n; index += 1) {
      expect(result.im[index]).toBeCloseTo(0, 8);
    }
  });
});
