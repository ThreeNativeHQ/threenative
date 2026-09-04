import { type IAssetPass, type IAssetPassOutput, classify } from "../compile.js";
import type { IAudioRow } from "../report.js";
import {
  DEFAULT_CROSS_FADE_MS,
  DEFAULT_PEAK_DB,
  DEFAULT_QUALITY,
  DEFAULT_SEAM_MAX_RATIO,
  DEFAULT_SPLICE_TOLERANCE_MS,
  type IAudioLoopOptions,
  type IAudioPassOptions,
  type IAudioSpectrumExpectation,
} from "./audio-config.js";
import {
  type ISeamMeasurement,
  bandEnergyFraction,
  crossFadeLoop,
  downmixToMono,
  measureDcOffset,
  measurePeak,
  measureSeam,
  normalisePeak,
  removeDcOffset,
  spliceForQuietestSeam,
} from "./audio-dsp.js";
import { type IDecodedAudio, decodeAudioBytes, encodeVorbis } from "./audio-pcm.js";
import { globMatch } from "./glob.js";

/**
 * Conditions a game's audio at build time and proves it did not destroy it.
 *
 * `AssetKind` has classified `.ogg`, `.wav` and `.mp3` as audio since the pipeline was written and
 * nothing acted on it: audio was classified and then shipped through untouched. A lane generated
 * nineteen clips for a game and conditioned them in a one-off script instead — downmix, cross-fade,
 * DC removal, peak, encode — and the script reported success on every one while having measured
 * nothing at all.
 *
 * What it actually got wrong was **content**, not joins: a chime that came back 92% low-mid with
 * nothing above 1 kHz, and footsteps carrying heavy sub-bass. The joins were fine — an early
 * reading that one bed was clicking came from comparing bare wrap steps between clips, and by the
 * measurement that reflects audibility that bed has the *cleaner* join of the two. That correction
 * is why the seam gate here judges a ratio and not a magnitude, and why the declared-band check
 * exists at all: the defect that shipped was the one nobody thought to measure.
 *
 * So this is `model.ts`'s shape rather than a filter chain: it transforms bytes and then measures
 * the result, and every measurement it takes is reported whether or not it was asked to assert on
 * it. Turning a convention off must not turn its measurement off — an undeclared clip's seam is
 * measured and lands in the receipt, it just does not fail the build.
 *
 * What it deliberately does not do:
 *
 * - **Own the mix.** Peak handling defaults to a *ceiling*, which only ever attenuates. Normalising
 *   every clip up to the same peak would make a footstep as loud as a chime and force the game to
 *   undo the pipeline in its volume settings; that is deciding how the game sounds, and it belongs
 *   to the game. `normalise: "peak"` asks for the lift by name.
 * - **Guess intent.** See `audio-config.ts`.
 * - **Process at runtime.** Every measurement and every transform here happens once, at build time.
 */
export function audioPass(options: IAudioPassOptions = {}): IAssetPass {
  return {
    configuration: {
      normalise: options.normalise ?? "ceiling",
      overrides: options.overrides ?? [],
      peakDb: options.peakDb ?? DEFAULT_PEAK_DB,
      quality: options.quality ?? DEFAULT_QUALITY,
      seamMaxRatio: options.seamMaxRatio ?? DEFAULT_SEAM_MAX_RATIO,
    },
    apply: async (input: Buffer, logicalPath: string): Promise<Buffer | IAssetPassOutput> => {
      if (classify(logicalPath) !== "audio") return input;
      return await condition(input, logicalPath, resolve(logicalPath, options));
    },
    name: "audio",
  };
}

/** Every setting for one asset, after the first matching override won. */
interface IResolved {
  readonly conditioned: boolean;
  readonly crossFadeMs: number;
  readonly loop: boolean;
  readonly normalise: "ceiling" | "peak";
  readonly peakCeiling: number;
  readonly positional: boolean;
  readonly quality: number;
  readonly seamMaxRatio: number;
  readonly spectrum: IAudioSpectrumExpectation | undefined;
  readonly spliceToleranceMs: number;
}

function resolve(logicalPath: string, options: IAudioPassOptions): IResolved {
  const override = (options.overrides ?? []).find((candidate) =>
    globMatch(candidate.glob, logicalPath),
  );
  const loopDeclaration: boolean | IAudioLoopOptions | undefined = override?.loop;
  const loopOptions = typeof loopDeclaration === "object" ? loopDeclaration : {};
  const peakDb = override?.peakDb ?? options.peakDb ?? DEFAULT_PEAK_DB;
  return {
    conditioned: override?.conditioning !== "none",
    crossFadeMs: loopOptions.crossFadeMs ?? DEFAULT_CROSS_FADE_MS,
    loop: loopDeclaration !== undefined && loopDeclaration !== false,
    normalise: override?.normalise ?? options.normalise ?? "ceiling",
    peakCeiling: 10 ** (peakDb / 20),
    positional: override?.positional === true,
    quality: override?.quality ?? options.quality ?? DEFAULT_QUALITY,
    seamMaxRatio: override?.seamMaxRatio ?? options.seamMaxRatio ?? DEFAULT_SEAM_MAX_RATIO,
    spectrum: override?.spectrum,
    spliceToleranceMs: loopOptions.spliceToleranceMs ?? DEFAULT_SPLICE_TOLERANCE_MS,
  };
}

/** One Vorbis block: the most the encoder's own framing may move the frame count. */
const FRAME_DRIFT_TOLERANCE = 1024;

async function condition(
  input: Buffer,
  logicalPath: string,
  declared: IResolved,
): Promise<IAssetPassOutput> {
  // Decoded before anything else, so a container no native target reads fails the bake here —
  // naming the file while it is still cheap — instead of at package time or, worse, as silence
  // on a player's device. This is the throw an `.mp3` in the source tree gets.
  const source = await decodeAudioBytes(input, logicalPath);
  const before = {
    channels: source.channels.length,
    dcOffset: measureDcOffset(source.channels),
    peak: measurePeak(source.channels),
    seam: measureSeam(source.channels, source.sampleRate),
  };

  const produced = declared.conditioned
    ? await transform(input, source, logicalPath, declared)
    : { bytes: input, crossFadeFrames: 0, decoded: source, reencoded: false };
  const after = produced.decoded;

  assertNoDrift(logicalPath, source, after, produced.crossFadeFrames);
  const seam = measureSeam(after.channels, after.sampleRate);
  assertSeam(logicalPath, declared, seam, produced.crossFadeFrames, after.sampleRate);
  const spectrumFraction =
    declared.spectrum === undefined
      ? undefined
      : bandEnergyFraction(after.channels, after.sampleRate, declared.spectrum.bandHz);
  assertSpectrum(logicalPath, declared.spectrum, spectrumFraction);

  const row: IAudioRow = {
    bytesAfter: produced.bytes.length,
    bytesBefore: input.length,
    channelsAfter: after.channels.length,
    channelsBefore: before.channels,
    conditioned: declared.conditioned,
    container: after.container,
    reencoded: produced.reencoded,
    ...(declared.loop && produced.crossFadeFrames > 0
      ? {
          crossFadeMs: (produced.crossFadeFrames / after.sampleRate) * 1000,
          crossFadeMsRequested: declared.crossFadeMs,
        }
      : declared.loop
        ? { crossFadeMs: 0, crossFadeMsRequested: declared.crossFadeMs }
        : {}),
    dcOffsetAfter: measureDcOffset(after.channels),
    dcOffsetBefore: before.dcOffset,
    // What the device's memory pays, which is the larger of the two costs and the reason a
    // positional clip is worth downmixing: a 21-second stereo bed is 220 KB on the wire and
    // 7.5 MB decoded.
    decodedBytesAfter: after.frames * after.channels.length * 4,
    decodedBytesBefore: source.frames * before.channels * 4,
    durationSeconds: after.frames / after.sampleRate,
    frames: after.frames,
    logicalPath,
    loop: declared.loop,
    peakAfter: measurePeak(after.channels),
    peakBefore: before.peak,
    sampleRate: after.sampleRate,
    seamNearP99: seam.nearP99,
    seamRatio: seam.ratio,
    seamRatioBefore: before.seam.ratio,
    seamWrap: seam.wrap,
    seamWrapBefore: before.seam.wrap,
    ...(declared.loop ? { seamMaxRatio: declared.seamMaxRatio } : {}),
    ...(declared.spectrum === undefined
      ? {}
      : {
          spectrumBandHz: declared.spectrum.bandHz,
          spectrumFraction: spectrumFraction ?? 0,
          spectrumMinFraction: declared.spectrum.minFraction,
        }),
  };
  // The extension follows the bytes, not the intent: a clip the game declared unconditioned keeps
  // its own container, and naming WAV bytes `.ogg` would put a lie in the manifest next to a
  // `container` field that said otherwise.
  return {
    buffer: produced.bytes,
    entry: { audio: row },
    outputExtension: after.container === "RIFF/WAVE" ? ".wav" : ".ogg",
  };
}

interface IProduced {
  readonly bytes: Buffer;
  readonly crossFadeFrames: number;
  readonly decoded: IDecodedAudio;
  /** False when the source bytes were shipped as they came, because nothing moved the PCM. */
  readonly reencoded: boolean;
}

/**
 * Enough DC to waste headroom and thump on a wrap. Below it, removing the offset would move the
 * samples by less than the encoder's own noise and buy a whole generation of Vorbis loss for it.
 * The same line the audio inspector draws before it says a word about DC.
 */
const DC_WORTH_REMOVING = 0.01;
/**
 * How far off the ceiling a peak may sit before the pass touches the gain, as a linear factor for
 * half a decibel.
 *
 * Without it the ceiling is not idempotent: a clip attenuated to exactly -1 dBFS comes back from
 * the Vorbis round trip a shade *over* it, so the next build attenuates again, re-encodes again,
 * and every rebuild costs another generation. Half a decibel is comfortably more than the codec's
 * overshoot and far less than any level difference a person would set on purpose.
 */
const GAIN_TOLERANCE = 10 ** (0.5 / 20);

async function transform(
  input: Buffer,
  source: IDecodedAudio,
  logicalPath: string,
  declared: IResolved,
): Promise<IProduced> {
  let pcm: readonly Float32Array[] = declared.positional
    ? downmixToMono(source.channels)
    : source.channels;
  if (pcm.length > 2) {
    throw new Error(
      `TN_ASSETS_AUDIO_CHANNELS: '${logicalPath}' has ${String(pcm.length)} channels, and a surround downmix is a mix decision this pass will not make for a game. Declare it positional to fold it to mono, or supply a mono or stereo source.`,
    );
  }
  let changed = declared.positional && source.channels.length > 1;
  let crossFadeFrames = 0;
  if (declared.loop && declared.crossFadeMs > 0) {
    const requested = Math.round((declared.crossFadeMs / 1000) * source.sampleRate);
    if (requested * 2 >= source.frames) {
      throw new Error(
        `TN_ASSETS_AUDIO_FADE_TOO_LONG: '${logicalPath}' is ${(source.frames / source.sampleRate).toFixed(3)} s and the declared ${String(declared.crossFadeMs)} ms cross-fade would consume at least half of it. Declare a shorter crossFadeMs, or 0 to keep the clip's own length.`,
      );
    }
    const splice = spliceForQuietestSeam(
      pcm,
      requested,
      Math.round((declared.spliceToleranceMs / 1000) * source.sampleRate),
    );
    pcm = crossFadeLoop(pcm, splice.fadeFrames);
    crossFadeFrames = splice.fadeFrames;
    changed = true;
  }
  if (Math.abs(measureDcOffset(pcm)) > DC_WORTH_REMOVING) {
    pcm = removeDcOffset(pcm);
    changed = true;
  }
  const peak = measurePeak(pcm);
  // A ceiling attenuates and never lifts, so the relative loudness the game authored survives
  // the pipeline; "peak" is the game asking for the lift by name. Either way the gain only moves
  // when the peak is more than a tolerance off the ceiling, so a rebuild of an already-conditioned
  // clip is a no-op rather than another generation of loss.
  const tooLoud = peak > declared.peakCeiling * GAIN_TOLERANCE;
  const tooQuiet = declared.normalise === "peak" && peak < declared.peakCeiling / GAIN_TOLERANCE;
  if (peak > 0 && (tooLoud || tooQuiet)) {
    pcm = normalisePeak(pcm, declared.peakCeiling);
    changed = true;
  }
  // A source that is already the right container and that nothing here moved is shipped as it
  // came. Re-encoding it would cost a generation of lossy Vorbis and roughly 4% more bytes to
  // deliver the identical audio — measured across wildwood's sixteen footsteps, where the only
  // thing "conditioning" had to do was leave them alone.
  if (!changed && source.container === "Ogg Vorbis") {
    return { bytes: input, crossFadeFrames, decoded: source, reencoded: false };
  }
  const bytes = await encodeVorbis(pcm, source.sampleRate, declared.quality, logicalPath);
  return {
    bytes,
    crossFadeFrames,
    decoded: await decodeAudioBytes(bytes, logicalPath),
    reencoded: true,
  };
}

/**
 * The transform is allowed to change the audio; it is not allowed to lose it.
 *
 * `model.ts` verifies triangles, vertices, joints, clips and bounds against the source and throws
 * `TN_ASSETS_MODEL_DRIFT` rather than trusting that a chain of optimizers behaved. The audio
 * equivalents are the sample rate, the channel count and the frame count: a resample, a dropped
 * channel or a truncated tail are all silent in a byte count and loud in a game.
 */
function assertNoDrift(
  logicalPath: string,
  source: IDecodedAudio,
  output: IDecodedAudio,
  crossFadeFrames: number,
): void {
  if (output.sampleRate !== source.sampleRate) {
    throw new Error(
      `TN_ASSETS_AUDIO_DRIFT: '${logicalPath}' came back at ${String(output.sampleRate)} Hz from a ${String(source.sampleRate)} Hz source; the pass does not resample, so this is a codec fault and the clip would play at the wrong pitch.`,
    );
  }
  const expectedFrames = source.frames - crossFadeFrames;
  if (Math.abs(output.frames - expectedFrames) > FRAME_DRIFT_TOLERANCE) {
    throw new Error(
      `TN_ASSETS_AUDIO_DRIFT: '${logicalPath}' came back ${String(output.frames)} frames against the ${String(expectedFrames)} expected (${String(source.frames)} source frames less a ${String(crossFadeFrames)}-frame cross-fade); more than ${String(FRAME_DRIFT_TOLERANCE)} frames of drift is lost audio, not encoder framing.`,
    );
  }
}

/**
 * The one assertion a game cannot declare away.
 *
 * A clip declared a forever-loop that clicks at every wrap is the defect this pass was built for,
 * and it shipped once already because the conditioning was a hand pass that reported nothing. So
 * there is no `seam: "none"`: `conditioning: "none"` still lands here, and `crossFadeMs: 0` — the
 * bar-accurate loop that cannot be shortened by a fade — still lands here. The threshold can be
 * moved, because some material genuinely needs a different number, but only inside a bound that
 * keeps it an assertion (`MAX_SEAM_THRESHOLD`), and the value used is reported either way.
 *
 * Measured on the decoded output bytes, never on the intermediate PCM: a cross-fade that is exact
 * in the PCM and undone by the encoder is still a click in the player's ears. Over real material
 * the PCM lands near 1e-6 and the shipped bytes near 0.002, and the gap is the codec.
 */
function assertSeam(
  logicalPath: string,
  declared: IResolved,
  seam: ISeamMeasurement,
  crossFadeFrames: number,
  sampleRate: number,
): void {
  if (!declared.loop || seam.ratio <= declared.seamMaxRatio) return;
  const applied =
    crossFadeFrames === 0
      ? "no cross-fade was applied, because the clip was declared to keep its own length"
      : `an equal-power cross-fade of ${((crossFadeFrames / sampleRate) * 1000).toFixed(0)} ms was applied and the seam survived it`;
  throw new Error(
    `TN_ASSETS_AUDIO_SEAM: '${logicalPath}' loops with a wrap step of ${seam.wrap.toFixed(4)} against a neighbourhood whose largest ordinary step is ${seam.nearP99.toFixed(4)} — ${seam.ratio.toFixed(2)}x, which exceeds the ${String(declared.seamMaxRatio)}x this loop may ship with, and is an audible click on every cycle of something that repeats forever. ${applied}. Either the material has no quiet splice near the declared cross-fade (widen loop.spliceToleranceMs or change loop.crossFadeMs), or the clip was never made to loop and should be declared loop: false.`,
  );
}

function assertSpectrum(
  logicalPath: string,
  expectation: IAudioSpectrumExpectation | undefined,
  measured: number | undefined,
): void {
  if (expectation === undefined || measured === undefined) return;
  if (measured >= expectation.minFraction) return;
  throw new Error(
    `TN_ASSETS_AUDIO_SPECTRUM: '${logicalPath}' puts ${(measured * 100).toFixed(1)}% of its energy in ${String(expectation.bandHz[0])}-${String(expectation.bandHz[1])} Hz, against the ${(expectation.minFraction * 100).toFixed(1)}% this clip was declared to need. The bytes are not what the game says this clip is for.`,
  );
}
