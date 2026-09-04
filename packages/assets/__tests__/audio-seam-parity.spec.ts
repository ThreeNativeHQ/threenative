import { describe, expect, it } from "vitest";
import { analyseSamples } from "../../playtest/src/runner/audio.js";
import { measureSeam } from "../src/passes/audio-dsp.js";
import { bandLimitedNoise, noise } from "./audio-fixtures.js";

/**
 * The build gate and the audio inspector must not disagree about the same file.
 *
 * `packages/playtest/src/runner/audio.ts` measures the loop seam for the inspector a person runs;
 * `audio-dsp.ts` measures it for the pass that refuses to ship the clip. Two implementations of one
 * metric is two metrics, and the failure mode is the worst kind: a clip the build passed and the
 * inspector fails, or the reverse, with no way to tell which number to believe.
 *
 * `@threenative/assets` cannot depend on the playtest runner at runtime — a published tarball must
 * not drag the harness in — so the measurement is reimplemented rather than imported, and this
 * file is what keeps the copy honest. If either side changes its window, its percentile or its
 * definition of the wrap, this fails.
 *
 * The metric itself is the ratio of the wrap step to the largest ordinary step beside it, not the
 * bare step: a click is a step that is anomalous *where it happens*, and an absolute bound
 * condemns dense clips while excusing quiet ones. On wildwood's three real loops the bare step
 * ranks `forest-birds` worse than the bed while the ratio ranks it better, so a magnitude gate
 * would have failed the clip with the cleaner join.
 */

const RATE = 44_100;

/** The same PCM, handed to both implementations in the precision each one takes. */
function bothViews(
  frames: number,
  sample: (frame: number, channel: number) => number,
  channelCount = 1,
): { readonly doubles: Float64Array[]; readonly floats: Float32Array[] } {
  const floats: Float32Array[] = [];
  const doubles: Float64Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const float = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) float[frame] = sample(frame, channel);
    floats.push(float);
    // Widened from the Float32 values, not recomputed, so both sides see identical numbers and a
    // difference in the result is a difference in the measurement.
    doubles.push(Float64Array.from(float));
  }
  return { doubles, floats };
}

const CLIPS: readonly (readonly [
  string,
  number,
  (frame: number, channel: number) => number,
  number,
])[] = [
  ["a band-limited bed", RATE * 2, bandLimitedNoise(41), 1],
  ["untreated white noise", RATE, noise(43), 1],
  ["a stereo bed", RATE, bandLimitedNoise(47), 2],
  [
    "a sine looped over whole cycles",
    RATE,
    (frame) => 0.7 * Math.sin((2 * Math.PI * 100 * frame) / RATE),
    1,
  ],
  ["a ramp that jumps at the wrap", RATE, (frame) => (frame / RATE) * 1.8 - 0.9, 1],
];

describe("the seam metric the pass and the inspector share", () => {
  for (const [name, frames, sample, channelCount] of CLIPS) {
    it(`should agree on the wrap, the neighbourhood and the ratio for ${name}`, () => {
      const { doubles, floats } = bothViews(frames, sample, channelCount);

      const mine = measureSeam(floats, RATE);
      const theirs = analyseSamples(doubles, RATE).seam;

      expect(theirs).toBeDefined();
      expect(mine.wrap).toBeCloseTo(theirs?.wrap ?? -1, 10);
      expect(mine.nearP99).toBeCloseTo(theirs?.nearP99 ?? -1, 10);
      expect(mine.ratio).toBeCloseTo(theirs?.ratio ?? -1, 8);
    });
  }

  it("should score a whole-cycle sine loop at about 1.0, which is why the bound is not 1.0", () => {
    // The finding the bound's default rests on: a flawless join whose wrap lands on the signal's
    // steepest point legitimately *is* the largest step in its neighbourhood.
    const { floats } = bothViews(
      RATE,
      (frame) => 0.7 * Math.sin((2 * Math.PI * 100 * frame) / RATE),
    );

    expect(measureSeam(floats, RATE).ratio).toBeCloseTo(1, 2);
  });

  it("should read a wrap in silence as infinite rather than as a pass", () => {
    // A flat neighbourhood has no ordinary step to divide by, and a step in the middle of silence
    // is audible however small it is. Failing closed here is the difference between a gate and a
    // gate-shaped hole.
    const flat = new Float32Array(RATE);
    flat.fill(0.5);
    flat[RATE - 1] = 0.4;

    expect(measureSeam([flat], RATE).ratio).toBe(Number.POSITIVE_INFINITY);
  });
});
