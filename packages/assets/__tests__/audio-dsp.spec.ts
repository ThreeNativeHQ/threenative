import { describe, expect, it } from "vitest";
import {
  crossFadeLoop,
  downmixToMono,
  measureBands,
  measureDcOffset,
  measurePeak,
  measureSeam,
  normalisePeak,
  removeDcOffset,
  spliceForQuietestSeam,
} from "../src/passes/audio-dsp.js";

/**
 * The measurements and transforms the audio pass reports, pinned without a bake.
 *
 * The cross-fade's endpoint property is the load-bearing one: it is what makes the resulting seam
 * predictable, and therefore what makes choosing the splice the right fix for a seam that would
 * otherwise be a lottery draw from the material's own delta distribution.
 */

const RATE = 44_100;

function ramp(frames: number, from: number, to: number): Float32Array {
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    out[index] = from + ((to - from) * index) / (frames - 1);
  }
  return out;
}

function tone(frames: number, hz: number, amplitude = 1): Float32Array {
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
  }
  return out;
}

describe("the cross-fade", () => {
  it("should leave the tail at the head and the head's own neighbour at the end", () => {
    // After a tail-onto-head fade of length L over N frames, out[0] is x[N-L] and out[last] is
    // x[N-L-1]: the seam becomes an ordinary adjacent-sample delta from the middle of the source.
    // Every seam claim this pass makes rests on this identity holding exactly.
    const source = ramp(1000, -1, 1);

    const faded = crossFadeLoop([source], 100) as Float32Array[];

    const out = faded[0] as Float32Array;
    expect(out.length).toBe(900);
    expect(out[0]).toBeCloseTo(source[900] as number, 6);
    expect(out[899]).toBeCloseTo(source[899] as number, 6);
    expect(measureSeam(faded, RATE).wrap).toBeCloseTo(
      Math.abs((source[900] as number) - (source[899] as number)),
      6,
    );
  });

  it("should hold loudness through the fade where a linear pair would dip", () => {
    // sin against cos keeps sin^2 + cos^2 = 1, so uncorrelated material holds its power. A
    // linear cross-fade of two decorrelated signals loses 3 dB at the midpoint.
    const head = tone(4000, 1000, 0.5);
    const tail = tone(4000, 4321, 0.5);
    const joined = new Float32Array(8000);
    joined.set(head, 0);
    joined.set(tail, 4000);

    const faded = crossFadeLoop([joined], 4000) as Float32Array[];

    const middle = (faded[0] as Float32Array).subarray(1900, 2100);
    let power = 0;
    for (const sample of middle) power += sample * sample;
    // Two uncorrelated 0.5-amplitude tones each carry power 0.125; equal-power keeps the sum.
    expect(power / middle.length).toBeGreaterThan(0.1);
    expect(power / middle.length).toBeLessThan(0.16);
  });

  it("should pick the splice with the quietest seam inside the declared tolerance", () => {
    // A signal that is steep everywhere except one flat notch: the search has to find the notch
    // rather than land on the requested length.
    const source = new Float32Array(2000);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = index % 2 === 0 ? 0.8 : -0.8;
    }
    // Frames 1500 and 1499 are equal, so a fade of 500 is the one quiet splice.
    source[1499] = 0.5;
    source[1500] = 0.5;

    const chosen = spliceForQuietestSeam([source], 480, 40);

    expect(chosen.fadeFrames).toBe(500);
    expect(chosen.seam).toBeCloseTo(0, 6);
  });

  it("should not search outside the tolerance it was given", () => {
    const source = new Float32Array(2000);
    for (let index = 0; index < source.length; index += 1) {
      source[index] = index % 2 === 0 ? 0.8 : -0.8;
    }
    source[1499] = 0.5;
    source[1500] = 0.5;

    // The quiet splice at 500 is outside a +/-5 window around 480, so it must not be taken.
    const chosen = spliceForQuietestSeam([source], 480, 5);

    expect(chosen.fadeFrames).toBeGreaterThanOrEqual(475);
    expect(chosen.fadeFrames).toBeLessThanOrEqual(485);
    expect(chosen.seam).toBeCloseTo(1.6, 3);
  });
});

describe("the level measurements", () => {
  it("should report the worst channel's mean as the DC offset and remove it", () => {
    const quiet = new Float32Array(1000).fill(0.05);
    const loud = new Float32Array(1000).fill(-0.4);

    expect(measureDcOffset([quiet, loud])).toBeCloseTo(-0.4, 6);
    expect(measureDcOffset(removeDcOffset([quiet, loud]))).toBeCloseTo(0, 6);
  });

  it("should scale every channel by one shared gain so the stereo image survives", () => {
    const left = new Float32Array(100).fill(0.5);
    const right = new Float32Array(100).fill(0.25);

    const normalised = normalisePeak([left, right], 0.891) as Float32Array[];

    expect(measurePeak(normalised)).toBeCloseTo(0.891, 5);
    // The 2:1 balance the author set is still 2:1 afterwards.
    expect((normalised[0] as Float32Array)[0] as number).toBeCloseTo(
      ((normalised[1] as Float32Array)[0] as number) * 2,
      5,
    );
  });

  it("should leave silence alone rather than dividing by its peak", () => {
    const silence = new Float32Array(100);

    expect(measurePeak(normalisePeak([silence], 0.891))).toBe(0);
  });
});

describe("the downmix", () => {
  it("should average the channels", () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([0, 0, 1]);

    const mono = downmixToMono([left, right]) as Float32Array[];

    expect([...(mono[0] as Float32Array)]).toEqual([0.5, 0, 0]);
  });

  it("should show phase cancellation as a peak that dropped rather than hiding it", () => {
    // Out-of-phase stereo sums to nothing. The pass reports peak before and after precisely so a
    // clip that half-disappears when folded is visible instead of mysteriously quiet.
    const left = tone(4000, 1000);
    const right = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) right[index] = -(left[index] as number);

    expect(measurePeak([left, right])).toBeCloseTo(1, 3);
    expect(measurePeak(downmixToMono([left, right]))).toBeLessThan(0.001);
  });
});

describe("the band measurement", () => {
  it("should put a tone's energy in the band that contains it", () => {
    const bands = measureBands([tone(RATE, 3000, 0.6)], RATE);

    expect(bands.high).toBeGreaterThan(90);
    expect(bands.low).toBeLessThan(1);
  });

  it("should read a hum as a hum, which is the check the chime failed", () => {
    const bands = measureBands([tone(RATE, 200, 0.6)], RATE);

    expect(bands.low).toBeGreaterThan(80);
    expect(bands.high).toBeLessThan(1);
  });

  it("should read sub-bass as sub-bass, which is the check fifteen footsteps failed", () => {
    // A 60 Hz thud under a click. The real footsteps carried up to 45% of their energy here,
    // below 100 Hz, where a wood has nothing and a phone's speaker has no headroom to spare.
    const thud = new Float32Array(RATE);
    const click = tone(RATE, 3000, 0.15);
    for (let index = 0; index < thud.length; index += 1) {
      thud[index] = 0.8 * Math.sin((2 * Math.PI * 60 * index) / RATE) + (click[index] as number);
    }

    expect(measureBands([thud], RATE).sub).toBeGreaterThan(40);
  });

  it("should sum to 100 percent across the five bands, so a share is a share", () => {
    const bands = measureBands([tone(RATE, 1200, 0.5)], RATE);
    const total = bands.sub + bands.low + bands.mid + bands.high + bands.air;

    expect(total).toBeCloseTo(100, 6);
  });

  it("should report zeroes for a clip with no samples rather than dividing by nothing", () => {
    const bands = measureBands([new Float32Array(0)], RATE);

    expect(bands.sub + bands.low + bands.mid + bands.high + bands.air).toBe(0);
  });
});
