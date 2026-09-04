/**
 * Measurement and transforms for the audio pass. No configuration reaches this file: every
 * function here takes PCM and numbers and returns PCM and numbers, so the numbers a build reports
 * can be pinned by a unit test without a bake, and the pass above owns every policy decision.
 */

/** Largest absolute sample across every channel. */
export function measurePeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/** The worst channel's mean, which is the offset that eats headroom and thumps on every start. */
export function measureDcOffset(channels: readonly Float32Array[]): number {
  let worst = 0;
  for (const channel of channels) {
    if (channel.length === 0) continue;
    let sum = 0;
    for (const sample of channel) sum += sample;
    const mean = sum / channel.length;
    if (Math.abs(mean) > Math.abs(worst)) worst = mean;
  }
  return worst;
}

export interface ISeamMeasurement {
  /** The 99th-percentile adjacent step within `SEAM_WINDOW_SECONDS` of the join. */
  readonly nearP99: number;
  /** `wrap / nearP99`. At 1.0 the join is as big as the largest ordinary step beside it. */
  readonly ratio: number;
  /** The step across the join, worst channel. */
  readonly wrap: number;
}

/** Seconds either side of the join that a wrap step is judged against. */
const SEAM_WINDOW_SECONDS = 0.05;

/**
 * The step a player hears at every wrap, judged against the steps beside it.
 *
 * **The ratio is the metric, not the magnitude.** A click is a step that is anomalous *where it
 * happens*: the same 0.02 jump is inaudible under a dense bed and an obvious tick in near-silence,
 * so an absolute bound condemns loud clips and excuses quiet ones. Measured on wildwood's three
 * real loops the bare step makes `forest-birds` look worse than the bed (0.021 against 0.015)
 * while by ratio it is the better join (0.23 against 0.51) — so an absolute gate would have failed
 * the clip with the cleaner wrap. A wrong throwing gate is worse than none, because the fix people
 * reach for is deleting it.
 *
 * This is deliberately the same measurement `packages/playtest/src/runner/audio.ts` makes for the
 * audio inspector, down to the window and the percentile, so the build gate and the inspector
 * cannot disagree about the same file. `audio-seam-parity.spec.ts` pins the two together.
 */
export function measureSeam(
  channels: readonly Float32Array[],
  sampleRate: number,
): ISeamMeasurement {
  const first = channels[0];
  if (first === undefined || first.length < 4) return { nearP99: 0, ratio: 0, wrap: 0 };
  const length = first.length;
  const near = Math.max(2, Math.min(Math.floor(SEAM_WINDOW_SECONDS * sampleRate), length >> 1));
  const steps: number[] = [];
  let wrap = 0;
  for (const channel of channels) {
    wrap = Math.max(wrap, Math.abs((channel[0] ?? 0) - (channel[length - 1] ?? 0)));
    for (let index = 1; index < near; index += 1) {
      steps.push(Math.abs((channel[index] ?? 0) - (channel[index - 1] ?? 0)));
    }
    for (let index = length - near + 1; index < length; index += 1) {
      steps.push(Math.abs((channel[index] ?? 0) - (channel[index - 1] ?? 0)));
    }
  }
  steps.sort((left, right) => left - right);
  const nearP99 = steps[Math.min(steps.length - 1, Math.floor(steps.length * 0.99))] ?? 0;
  return {
    nearP99,
    // A perfectly flat neighbourhood has no ordinary step to compare against, and a wrap in the
    // middle of silence is audible however small it is — so a zero reference reads as infinite
    // rather than as a pass.
    ratio: nearP99 <= 0 ? (wrap <= 0 ? 0 : Number.POSITIVE_INFINITY) : wrap / nearP99,
    wrap,
  };
}

/** Copies with the per-channel mean removed. */
export function removeDcOffset(channels: readonly Float32Array[]): Float32Array[] {
  return channels.map((channel) => {
    let sum = 0;
    for (const sample of channel) sum += sample;
    const mean = channel.length === 0 ? 0 : sum / channel.length;
    const out = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      out[index] = (channel[index] as number) - mean;
    }
    return out;
  });
}

/** Scales every channel by one shared gain so the loudest sample lands on `ceiling`. */
export function normalisePeak(channels: readonly Float32Array[], ceiling: number): Float32Array[] {
  const peak = measurePeak(channels);
  if (peak <= 0) return channels.map((channel) => Float32Array.from(channel));
  const gain = ceiling / peak;
  return channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      out[index] = (channel[index] as number) * gain;
    }
    return out;
  });
}

/**
 * Averages every channel into one.
 *
 * Averaging can cancel out-of-phase content, so the pass reports the peak before and after: a
 * stereo source that half-disappears when summed shows up as a peak that dropped, rather than as
 * a quiet asset nobody can account for.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array[] {
  const first = channels[0];
  if (first === undefined) return [];
  if (channels.length === 1) return [Float32Array.from(first)];
  const mono = new Float32Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] as number;
    mono[index] = sum / channels.length;
  }
  return [mono];
}

/**
 * Equal-power tail-onto-head cross-fade, which shortens the clip by the fade.
 *
 * `sin` against `cos` keeps `sin² + cos² = 1`, so uncorrelated material holds its loudness through
 * the fade where a linear pair would dip in the middle. The endpoints are exact: at `t = 0` the
 * output is the tail alone and at `t = 1` the head alone, which is what makes the resulting seam
 * predictable — see `spliceForQuietestSeam`.
 */
export function crossFadeLoop(
  channels: readonly Float32Array[],
  fadeFrames: number,
): Float32Array[] {
  const frames = channels[0]?.length ?? 0;
  const kept = frames - fadeFrames;
  const out = channels.map((channel) => Float32Array.from(channel.subarray(0, kept)));
  for (let index = 0; index < fadeFrames; index += 1) {
    const t = fadeFrames === 1 ? 1 : index / (fadeFrames - 1);
    const fadeIn = Math.sin((Math.PI / 2) * t);
    const fadeOut = Math.cos((Math.PI / 2) * t);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = channels[channel] as Float32Array;
      (out[channel] as Float32Array)[index] =
        (source[index] as number) * fadeIn +
        (source[frames - fadeFrames + index] as number) * fadeOut;
    }
  }
  return out;
}

export interface IChosenSplice {
  readonly fadeFrames: number;
  /** The seam the cross-fade at this splice will produce, before the encoder touches it. */
  readonly seam: number;
}

/**
 * Picks where the fade starts, inside the tolerance the game declared.
 *
 * After the cross-fade above, `out[0]` is the tail's first frame and `out[last]` is the frame
 * before it, so **the wrap step is exactly the source's own adjacent-sample delta at the splice**.
 * Left at a fixed fade length that makes it a lottery draw from the material's delta distribution:
 * measured over the three real ambience beds this pass was built for, the same cross-fade at 250 ms
 * produced a wrap of 0.0084 on one bed and 0.1994 on another, and moving that one bed's fade to
 * 400 ms took it from 0.0084 to 0.0807. So the splice is chosen rather than assumed — with
 * alignment the same three beds land at 0.0019, 0.0103 and 0.0007, all of it the encoder's noise.
 *
 * The objective here is the bare step, not the ratio the gate judges: across a window this narrow
 * the neighbourhood the ratio divides by is effectively fixed, so the two orderings agree, and the
 * step is the one that can be evaluated for every candidate without re-measuring a percentile.
 */
export function spliceForQuietestSeam(
  channels: readonly Float32Array[],
  requestedFrames: number,
  toleranceFrames: number,
): IChosenSplice {
  const frames = channels[0]?.length ?? 0;
  const low = Math.max(2, requestedFrames - toleranceFrames);
  const high = Math.min(Math.floor(frames / 2), requestedFrames + toleranceFrames);
  let best = {
    fadeFrames: Math.min(Math.max(2, requestedFrames), high),
    seam: Number.POSITIVE_INFINITY,
  };
  for (let fadeFrames = low; fadeFrames <= high; fadeFrames += 1) {
    let seam = 0;
    for (const channel of channels) {
      const step = Math.abs(
        (channel[frames - fadeFrames] as number) - (channel[frames - fadeFrames - 1] as number),
      );
      if (step > seam) seam = step;
    }
    if (seam < best.seam) best = { fadeFrames, seam };
  }
  return best;
}

const WINDOW = 4096;

/**
 * The share of the clip's energy that falls inside a band, in [0, 1].
 *
 * Hann-windowed power spectra summed over 50%-overlapped windows. The band is the game's to
 * declare — the pass never decides what a clip should sound like, it only measures whether the
 * bytes match what the game said the clip was for. The chime that came back as a hum measured
 * 92.4% of its energy in 100-500 Hz and nothing at all above 1 kHz.
 */
export function bandEnergyFraction(
  channels: readonly Float32Array[],
  sampleRate: number,
  band: readonly [number, number],
): number {
  const frames = channels[0]?.length ?? 0;
  if (frames < WINDOW) return 0;
  const mono = downmixToMono(channels)[0] as Float32Array;
  const real = new Float64Array(WINDOW);
  const imaginary = new Float64Array(WINDOW);
  let inside = 0;
  let total = 0;
  for (let start = 0; start + WINDOW <= frames; start += WINDOW / 2) {
    for (let index = 0; index < WINDOW; index += 1) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW - 1));
      real[index] = (mono[start + index] as number) * hann;
      imaginary[index] = 0;
    }
    transform(real, imaginary);
    for (let bin = 1; bin < WINDOW / 2; bin += 1) {
      const hertz = (bin * sampleRate) / WINDOW;
      const power = (real[bin] as number) ** 2 + (imaginary[bin] as number) ** 2;
      total += power;
      if (hertz >= band[0] && hertz < band[1]) inside += power;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/** In-place radix-2 FFT; `real.length` is a power of two by construction above. */
function transform(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j] as number, real[i] as number];
      [imaginary[i], imaginary[j]] = [imaginary[j] as number, imaginary[i] as number];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const evenReal = real[start + index] as number;
        const evenImaginary = imaginary[start + index] as number;
        const oddReal = real[start + index + length / 2] as number;
        const oddImaginary = imaginary[start + index + length / 2] as number;
        const rotatedReal = oddReal * twiddleReal - oddImaginary * twiddleImaginary;
        const rotatedImaginary = oddReal * twiddleImaginary + oddImaginary * twiddleReal;
        real[start + index] = evenReal + rotatedReal;
        imaginary[start + index] = evenImaginary + rotatedImaginary;
        real[start + index + length / 2] = evenReal - rotatedReal;
        imaginary[start + index + length / 2] = evenImaginary - rotatedImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}
