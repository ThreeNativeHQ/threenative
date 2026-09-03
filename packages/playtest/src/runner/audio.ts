import { deflateSync } from "node:zlib";
import { resolve } from "node:path";

import { PlaytestCliUsageError } from "./config.js";

/**
 * Everything `threenative-playtest audio` decides, with nothing that touches a disk or a
 * subprocess. `audioRun.ts` decodes the files and writes the pictures; this file is what says
 * whether a clip is what the game asked for, and it is the half that is unit-tested.
 *
 * ## Why a game needs this at all
 *
 * Every check that does not involve listening — the file exists, it is served, it decodes, no page
 * error, it is inside the byte budget — passes on a clip that is a hum where a chime should be, or
 * a bed with a click once a cycle. Those are the two defects that actually shipped here. Neither is
 * visible from a size, a duration, or a green "loaded" marker; both are unmistakable in a band
 * profile and a spectrogram.
 *
 * ## Two rules this obeys, both learned by getting them wrong
 *
 * **Decode at the file's own sample rate.** A seam measured on a resampled decode is measuring the
 * resampler: its FIR window runs off the end of the data at the first and last output sample and
 * is zero-padded, so the edge samples are the only wrong ones in the file — exactly where a seam
 * test looks. On one real set that inflated the reported step by three to seven times and
 * reordered which clip looked worst. `audioRun.ts` therefore never passes `-ar` to ffmpeg.
 *
 * **Compare the wrap against the steps beside it.** A click is a step that is anomalous *where it
 * happens*. A sparse clip is mostly quiet, so a whole-clip percentile flatters its seam; a dense
 * one is mostly loud, so the same percentile condemns a seam nobody could hear. The 50 ms either
 * side of the join is what a listener hears the wrap against, so that is the reference.
 */

/**
 * The five bands, contiguous and gapless up to Nyquist.
 *
 * Chosen for what they separate in practice rather than for musical intervals: below 100 Hz a
 * wood has nothing (there is no engine in a forest), 100-500 Hz is where a "warm" generation
 * collapses into a hum, 500 Hz-2 kHz is body, 2-8 kHz is leaf rustle and birdsong and the
 * brightness of a struck bell, and above 8 kHz is air.
 */
export const AUDIO_BANDS = {
  sub: [0, 100],
  low: [100, 500],
  mid: [500, 2_000],
  high: [2_000, 8_000],
  air: [8_000, Number.POSITIVE_INFINITY],
} as const satisfies Record<string, readonly [number, number]>;

export type AudioBand = keyof typeof AUDIO_BANDS;
const BAND_NAMES = Object.keys(AUDIO_BANDS) as readonly AudioBand[];

/** Window for the analysis STFT. 1024 at 44.1 kHz is a 43 Hz bin, fine enough to place a hum. */
const WINDOW = 1_024;
/** Columns in the written picture. More than this is wider than anything looks at it. */
const MAX_COLUMNS = 900;
/**
 * Columns the picture aims for, which sets the frame hop.
 *
 * A half-second footstep holds twenty non-overlapping 1024-sample frames, and a twenty-column
 * spectrogram is a sliver nobody can read a transient off — which defeats the only reason the
 * picture exists. So the hop shrinks for a short clip and the frames overlap. Band energy stays
 * unbiased: summed Hann windows at a hop well under the window length are very nearly constant
 * across the signal, so every sample still contributes about equally.
 */
const TARGET_COLUMNS = 400;
/** Seconds either side of the join that a wrap step is judged against. */
const SEAM_WINDOW_SECONDS = 0.05;

/** Defaults for the checks a game does not tune. Every one of these is overridable per clip. */
const DEFAULT_PEAK_MAX = 0.98;
/** Below this a clip is a generation failure wearing a valid container. */
const DEFAULT_SILENCE_RMS = 1e-4;
/**
 * A wrap step this many times the 99th-percentile step beside it is a click.
 *
 * Not 1.0, which looks like the natural line and fails a flawless loop. A perfectly continuous
 * wrap whose join happens to land on the signal's steepest point *is* the largest step in its
 * neighbourhood, so it measures exactly 1.0 — a pure sine looped over a whole number of cycles
 * scores 1.000000000000223 here, on float error alone. 1.5 keeps every clean join and still
 * catches the real thing, which overshoots by five times and up.
 */
const DEFAULT_SEAM_MAX_RATIO = 1.5;
/** Enough DC to waste headroom and thump on a loop wrap, not enough to be worth failing over. */
const DC_WARN = 0.01;
/** A clip that decoded but is barely there. Not silence, but worth a word. */
const QUIET_WARN_PEAK = 0.1;

export type AudioStatus = "fail" | "ok" | "warn";

export interface IAudioBandBound {
  readonly max?: number;
  readonly min?: number;
}

export interface IAudioClipExpectation {
  /** Where the file is, relative to `--root`. */
  readonly path: string;
  /**
   * Whether this clip loops. Required rather than defaulted, because it is the one fact that
   * decides whether the seam is checked, and a default would silently skip the check that catches
   * the worst defect an ambient bed can have.
   */
  readonly loop: boolean;
  readonly bands?: Partial<Record<AudioBand, IAudioBandBound>>;
  readonly peakMax?: number;
  readonly seamMaxRatio?: number;
  readonly silenceRms?: number;
}

export interface IAudioManifest {
  readonly clips: readonly IAudioClipExpectation[];
  readonly version: 1;
}

export interface IAudioSeam {
  /** The step across the join, worst channel. */
  readonly wrap: number;
  /** The 99th-percentile step within `SEAM_WINDOW_SECONDS` of the join. */
  readonly nearP99: number;
  /** `wrap / nearP99`. At 1.0 the join is as big as the largest ordinary step there. */
  readonly ratio: number;
}

export interface IAudioAnalysis {
  readonly bands: Record<AudioBand, number>;
  readonly channels: number;
  /** Mean magnitude spectrum per column, low bin first. Written as the picture. */
  readonly columns: readonly Float64Array[];
  readonly dc: number;
  readonly peak: number;
  readonly rms: number;
  readonly sampleRate: number;
  readonly seam: IAudioSeam | undefined;
  readonly seconds: number;
}

export interface IAudioCheck {
  readonly detail: string;
  readonly fix?: string;
  readonly name: string;
  readonly status: AudioStatus;
}

export interface IAudioClipReport {
  readonly analysis: IAudioAnalysis;
  readonly path: string;
  readonly spectrogram?: string;
}

export interface IAudioReport {
  readonly checks: readonly IAudioCheck[];
  readonly clips: readonly IAudioClipReport[];
  readonly pass: boolean;
}

export interface IAudioArgs {
  readonly dir: string | undefined;
  readonly expect: string;
  readonly out: string;
  readonly root: string;
  readonly spectrograms: boolean;
  readonly text: boolean;
}

export function parseAudioArgs(argv: readonly string[]): IAudioArgs {
  let expect: string | undefined;
  let dir: string | undefined;
  let out: string | undefined;
  let root = process.cwd();
  let text = false;
  let spectrograms = true;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new PlaytestCliUsageError(`audio: ${String(flag)} needs a value.`);
      index += 1;
      return value;
    };
    switch (flag) {
      case "--expect":
        expect = next();
        break;
      case "--dir":
        dir = next();
        break;
      case "--out":
        out = next();
        break;
      case "--root":
        root = resolve(next());
        break;
      case "--text":
        text = true;
        break;
      case "--no-spectrograms":
        spectrograms = false;
        break;
      default:
        // Never ignored: a mistyped flag that is skipped is a check the caller believes is running.
        throw new PlaytestCliUsageError(`audio: unknown option ${String(flag)}.`);
    }
  }
  if (expect === undefined)
    throw new PlaytestCliUsageError("audio: --expect <manifest.json> is required.");
  return {
    dir,
    expect,
    out: out === undefined ? resolve(root, "artifacts", "audio") : resolve(out),
    root,
    spectrograms,
    text,
  };
}

const CLIP_KEYS = new Set(["bands", "loop", "path", "peakMax", "seamMaxRatio", "silenceRms"]);
const MANIFEST_KEYS = new Set(["clips", "version"]);

/**
 * Read the game's declaration of what its own audio should be.
 *
 * The inspector cannot know that a forest bed should be broadband and a discovery chime should be
 * bright — the game knows. Everything here fails closed: an unknown key, a band nobody measures, a
 * bound that can never hold, a seam bound on a clip that never wraps, a duplicate path, an empty
 * list. A gate that skips what it cannot parse is the gate that reported green while asserting
 * nothing, which is the specific failure this project's harness rules exist to prevent.
 */
export function parseAudioManifest(text: string, path: string): IAudioManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlaytestCliUsageError(`audio: ${path} is not valid JSON: ${message}`);
  }
  if (!isRecord(raw)) throw new PlaytestCliUsageError(`audio: ${path} must be a JSON object.`);
  rejectUnknown(raw, MANIFEST_KEYS, path, "manifest");
  if (raw.version !== 1)
    throw new PlaytestCliUsageError(
      `audio: ${path} declares version ${JSON.stringify(raw.version)}; this inspector implements version 1.`,
    );
  if (!Array.isArray(raw.clips))
    throw new PlaytestCliUsageError(`audio: ${path} must carry a "clips" array.`);
  if (raw.clips.length === 0)
    throw new PlaytestCliUsageError(
      `audio: ${path} declares no clips; a manifest must assert at least one clip.`,
    );
  const seen = new Set<string>();
  const clips = raw.clips.map((entry, index) => {
    const where = `${path} clips[${String(index)}]`;
    if (!isRecord(entry)) throw new PlaytestCliUsageError(`audio: ${where} must be an object.`);
    rejectUnknown(entry, CLIP_KEYS, where, "clip");
    const clipPath = entry.path;
    if (typeof clipPath !== "string" || clipPath.length === 0)
      throw new PlaytestCliUsageError(`audio: ${where} needs a non-empty "path".`);
    if (typeof entry.loop !== "boolean")
      throw new PlaytestCliUsageError(
        `audio: ${where} needs "loop" as a boolean; it decides whether the loop seam is checked.`,
      );
    if (seen.has(clipPath))
      throw new PlaytestCliUsageError(`audio: ${where} repeats the path ${clipPath}.`);
    seen.add(clipPath);
    if (entry.seamMaxRatio !== undefined && !entry.loop)
      throw new PlaytestCliUsageError(
        `audio: ${where} sets "seamMaxRatio" on a clip whose "loop" is false; a one-shot has no wrap.`,
      );
    return {
      ...(entry.bands === undefined ? {} : { bands: parseBands(entry.bands, where) }),
      loop: entry.loop,
      path: clipPath,
      ...(entry.peakMax === undefined
        ? {}
        : { peakMax: positive(entry.peakMax, `${where} peakMax`) }),
      ...(entry.seamMaxRatio === undefined
        ? {}
        : { seamMaxRatio: positive(entry.seamMaxRatio, `${where} seamMaxRatio`) }),
      ...(entry.silenceRms === undefined
        ? {}
        : { silenceRms: positive(entry.silenceRms, `${where} silenceRms`) }),
    } satisfies IAudioClipExpectation;
  });
  return { clips, version: 1 };
}

function parseBands(raw: unknown, where: string): Partial<Record<AudioBand, IAudioBandBound>> {
  if (!isRecord(raw)) throw new PlaytestCliUsageError(`audio: ${where} "bands" must be an object.`);
  const bands: Partial<Record<AudioBand, IAudioBandBound>> = {};
  for (const [name, bound] of Object.entries(raw)) {
    if (!BAND_NAMES.includes(name as AudioBand)) {
      throw new PlaytestCliUsageError(
        `audio: ${where} names band "${name}"; the measured bands are ${BAND_NAMES.join(", ")}.`,
      );
    }
    if (!isRecord(bound))
      throw new PlaytestCliUsageError(`audio: ${where} band "${name}" must be an object.`);
    rejectUnknown(bound, new Set(["max", "min"]), `${where} band "${name}"`, "bound");
    const min = bound.min === undefined ? undefined : percent(bound.min, `${where} band "${name}" min`);
    const max = bound.max === undefined ? undefined : percent(bound.max, `${where} band "${name}" max`);
    if (min === undefined && max === undefined) {
      throw new PlaytestCliUsageError(
        `audio: ${where} band "${name}" declares neither "min" nor "max", so it asserts nothing.`,
      );
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new PlaytestCliUsageError(
        `audio: ${where} band "${name}" has min ${String(min)} above max ${String(max)}, which can never hold.`,
      );
    }
    bands[name as AudioBand] = {
      ...(max === undefined ? {} : { max }),
      ...(min === undefined ? {} : { min }),
    };
  }
  if (Object.keys(bands).length === 0)
    throw new PlaytestCliUsageError(`audio: ${where} "bands" is empty, so it asserts nothing.`);
  return bands;
}

function rejectUnknown(
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
  kind: string,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new PlaytestCliUsageError(
        `audio: ${where} has unknown ${kind} key "${key}"; a typo here is a check that never runs.`,
      );
    }
  }
}

function percent(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)
    throw new PlaytestCliUsageError(`audio: ${where} must be a percentage between 0 and 100.`);
  return value;
}

function positive(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new PlaytestCliUsageError(`audio: ${where} must be a finite positive number.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Everything measurable about one decoded clip.
 *
 * Band energy comes from non-overlapping Hann-windowed frames covering the whole signal, summed
 * bin by bin — a Welch estimate rather than one giant transform, which is both cheaper and steadier
 * on a 21-second bed. The percentages are fractions of summed magnitude, so they are not directly
 * comparable to a tool that sums power or takes a single whole-file FFT; what they are comparable
 * to is each other and the numbers a game declares against them.
 */
export function analyseSamples(
  channels: readonly Float64Array[],
  sampleRate: number,
): IAudioAnalysis {
  const first = channels[0];
  if (first === undefined || first.length === 0)
    throw new Error("audio: a clip decoded to no samples.");
  const length = first.length;

  let peak = 0;
  let squares = 0;
  let sum = 0;
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      const value = channel[index] ?? 0;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
      squares += value * value;
      sum += value;
    }
  }
  const count = length * channels.length;

  // Never longer than the window (so a long clip stays non-overlapping and cheap) and never zero.
  const hop = Math.max(1, Math.min(WINDOW, Math.floor(length / TARGET_COLUMNS)));
  const frames = Math.max(1, Math.floor((length - WINDOW) / hop) + 1);
  const bins = WINDOW / 2 + 1;
  const spectra: Float64Array[] = [];
  const totals = new Float64Array(bins);
  const hann = hannWindow(WINDOW);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  for (let frame = 0; frame < frames; frame += 1) {
    re.fill(0);
    im.fill(0);
    const start = frame * hop;
    // Mono for the spectrum: a band profile is about content, and two channels of the same wind
    // are one answer. The seam below stays per-channel, where a difference is a real defect.
    for (let index = 0; index < WINDOW; index += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[start + index] ?? 0;
      re[index] = (mixed / channels.length) * (hann[index] ?? 0);
    }
    fft(re, im);
    const spectrum = new Float64Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
      const magnitude = Math.hypot(re[bin] ?? 0, im[bin] ?? 0);
      spectrum[bin] = magnitude;
      totals[bin] = (totals[bin] ?? 0) + magnitude;
    }
    spectra.push(spectrum);
  }

  return {
    bands: bandEnergy(totals, sampleRate),
    channels: channels.length,
    columns: decimate(spectra),
    dc: count === 0 ? 0 : sum / count,
    peak,
    rms: count === 0 ? 0 : Math.sqrt(squares / count),
    sampleRate,
    seam: measureSeam(channels, sampleRate),
    seconds: length / sampleRate,
  };
}

function bandEnergy(totals: Float64Array, sampleRate: number): Record<AudioBand, number> {
  const nyquist = sampleRate / 2;
  const bins = totals.length;
  let sum = 0;
  for (const value of totals) sum += value;
  const scale = sum <= 0 ? 0 : 100 / sum;
  const bands = {} as Record<AudioBand, number>;
  for (const name of BAND_NAMES) {
    const [low, high] = AUDIO_BANDS[name];
    let band = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const hz = (bin / (bins - 1)) * nyquist;
      if (hz >= low && hz < high) band += totals[bin] ?? 0;
    }
    bands[name] = band * scale;
  }
  return bands;
}

/**
 * The wrap step and the steps beside it.
 *
 * `undefined` only when the clip is too short to have a neighbourhood, which no real clip is.
 * Whether this gets *checked* is the manifest's `loop` flag, not anything measured here: a
 * one-shot's first and last samples never meet, so its wrap number is not a measurement of
 * anything and must never be printed as if it were.
 */
function measureSeam(
  channels: readonly Float64Array[],
  sampleRate: number,
): IAudioSeam | undefined {
  const first = channels[0];
  if (first === undefined || first.length < 4) return undefined;
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
  const at = Math.min(steps.length - 1, Math.floor(steps.length * 0.99));
  const nearP99 = steps[at] ?? 0;
  return {
    nearP99,
    // A perfectly flat neighbourhood has no ordinary step to compare against, and a wrap in the
    // middle of silence is audible however small it is — so a zero reference reads as infinite
    // rather than as a pass.
    ratio: nearP99 <= 0 ? (wrap <= 0 ? 0 : Number.POSITIVE_INFINITY) : wrap / nearP99,
    wrap,
  };
}

/** Every check one clip earns, in the order a reader wants them. */
export function checkClip(
  path: string,
  analysis: IAudioAnalysis,
  expectation: IAudioClipExpectation,
): readonly IAudioCheck[] {
  const checks: IAudioCheck[] = [];
  const label = (name: string): string => `${path} ${name}`;
  const silenceRms = expectation.silenceRms ?? DEFAULT_SILENCE_RMS;
  if (analysis.rms < silenceRms) {
    checks.push({
      detail: `${label("")}rms ${analysis.rms.toExponential(2)} is below ${silenceRms.toExponential(2)}; the clip decoded to nothing`,
      fix: "Regenerate or re-encode the clip; every other check passes on a silent file.",
      name: "silence",
      status: "fail",
    });
  } else {
    checks.push({
      detail: `${label("")}rms ${analysis.rms.toFixed(4)}, peak ${analysis.peak.toFixed(3)}, ${analysis.seconds.toFixed(2)}s, ${String(analysis.channels)}ch @ ${String(analysis.sampleRate)} Hz`,
      name: "silence",
      status: "ok",
    });
  }

  const peakMax = expectation.peakMax ?? DEFAULT_PEAK_MAX;
  if (analysis.peak > peakMax) {
    checks.push({
      detail: `${label("")}peak ${analysis.peak.toFixed(3)} exceeds ${peakMax.toFixed(3)}`,
      fix: "Normalise lower. A lossy codec overshoots a transient on decode, so headroom has to survive the encode, not just precede it.",
      name: "headroom",
      status: "fail",
    });
  } else if (analysis.peak < QUIET_WARN_PEAK) {
    checks.push({
      detail: `${label("")}peak ${analysis.peak.toFixed(3)} is very low; the clip will need most of a bus to be heard`,
      name: "headroom",
      status: "warn",
    });
  } else {
    checks.push({
      detail: `${label("")}peak ${analysis.peak.toFixed(3)} within ${peakMax.toFixed(3)}`,
      name: "headroom",
      status: "ok",
    });
  }

  if (Math.abs(analysis.dc) > DC_WARN) {
    checks.push({
      detail: `${label("")}dc ${analysis.dc.toFixed(5)} wastes headroom and can thump at the start`,
      fix: "Subtract the mean before encoding, or high-pass the source.",
      name: "dc",
      status: "warn",
    });
  } else {
    checks.push({ detail: `${label("")}dc ${analysis.dc.toFixed(5)}`, name: "dc", status: "ok" });
  }

  if (expectation.loop) {
    const seam = analysis.seam;
    const limit = expectation.seamMaxRatio ?? DEFAULT_SEAM_MAX_RATIO;
    if (seam === undefined) {
      checks.push({
        detail: `${label("")}is too short to measure a loop seam`,
        fix: "A loop needs enough samples either side of the join to have a neighbourhood.",
        name: "seam",
        status: "fail",
      });
    } else {
      const ok = seam.ratio <= limit;
      checks.push({
        detail: `${label("")}wrap ${seam.wrap.toFixed(6)} is ${formatRatio(seam.ratio)} of the 99th-percentile step beside it (${seam.nearP99.toFixed(6)}), limit ${limit.toFixed(2)}x`,
        ...(ok
          ? {}
          : {
              fix: "Cross-fade the tail onto the head and drop it, so the last sample and the first were adjacent in the source.",
            }),
        name: "seam",
        status: ok ? "ok" : "fail",
      });
    }
  }

  for (const name of BAND_NAMES) {
    const bound = expectation.bands?.[name];
    if (bound === undefined) continue;
    const measured = analysis.bands[name];
    const problems: string[] = [];
    if (bound.min !== undefined && measured < bound.min)
      problems.push(`below the declared minimum ${bound.min.toFixed(1)}%`);
    if (bound.max !== undefined && measured > bound.max)
      problems.push(`above the declared maximum ${bound.max.toFixed(1)}%`);
    const [low, high] = AUDIO_BANDS[name];
    const range = `${String(low)}-${Number.isFinite(high) ? String(high) : "Nyquist"} Hz`;
    checks.push({
      detail: `${label("")}${name} (${range}) is ${measured.toFixed(1)}%${problems.length === 0 ? "" : `, ${problems.join(" and ")}`}`,
      ...(problems.length === 0
        ? {}
        : { fix: "The clip's content is wrong, not its encoding; regenerate it and look at the spectrogram." }),
      name: `band ${name}`,
      status: problems.length === 0 ? "ok" : "fail",
    });
  }
  return checks;
}

function formatRatio(ratio: number): string {
  return Number.isFinite(ratio) ? `${ratio.toFixed(2)}x` : "unbounded";
}

export function audioExitCode(report: Pick<IAudioReport, "checks" | "pass">): 0 | 1 {
  if (report.checks.length === 0) return 1;
  return report.pass && !report.checks.some(({ status }) => status === "fail") ? 0 : 1;
}

export function formatAudioReport(report: IAudioReport): string {
  const symbols: Record<AudioStatus, string> = { fail: "✗", ok: "✓", warn: "!" };
  if (report.checks.length === 0) {
    return "no checks ran; the inspector asserted nothing, which is a failure and not a pass.\n";
  }
  const lines = report.checks.map(
    ({ detail, fix, name, status }) =>
      `${symbols[status]} ${name}: ${detail}${fix === undefined || status === "ok" ? "" : `\n    fix: ${fix}`}`,
  );
  const pictures = report.clips.filter(({ spectrogram }) => spectrogram !== undefined);
  if (pictures.length > 0) {
    lines.push("");
    // The numbers are the gate; the picture is what a person or an agent looks at when it fires.
    lines.push("spectrograms:");
    for (const { path, spectrogram } of pictures) lines.push(`  ${path} -> ${String(spectrogram)}`);
  }
  const failed = report.checks.filter(({ status }) => status === "fail").length;
  lines.push("");
  lines.push(
    failed === 0
      ? `${String(report.checks.length)} checks, none failed.`
      : `${String(failed)} of ${String(report.checks.length)} checks failed; this audio is not what the game declared.`,
  );
  return `${lines.join("\n")}\n`;
}

/** Average adjacent frames down to something no wider than a screen. */
function decimate(spectra: readonly Float64Array[]): readonly Float64Array[] {
  if (spectra.length <= MAX_COLUMNS) return spectra;
  const group = Math.ceil(spectra.length / MAX_COLUMNS);
  const columns: Float64Array[] = [];
  for (let start = 0; start < spectra.length; start += group) {
    const end = Math.min(start + group, spectra.length);
    const first = spectra[start];
    if (first === undefined) continue;
    const column = new Float64Array(first.length);
    for (let index = start; index < end; index += 1) {
      const spectrum = spectra[index];
      if (spectrum === undefined) continue;
      for (let bin = 0; bin < column.length; bin += 1)
        column[bin] = (column[bin] ?? 0) + (spectrum[bin] ?? 0);
    }
    for (let bin = 0; bin < column.length; bin += 1)
      column[bin] = (column[bin] ?? 0) / (end - start);
    columns.push(column);
  }
  return columns;
}

/**
 * The spectrogram, as a PNG.
 *
 * Hand-rolled rather than pulled from a plotting library, because this package must stay
 * installable in a game repo and a chart dependency for one picture is not a trade worth making.
 * Log magnitude over a 70 dB range so quiet detail is visible instead of crushed to black, low
 * frequency at the bottom the way a spectrogram is read.
 */
export function spectrogramPng(columns: readonly Float64Array[]): Uint8Array {
  const width = columns.length;
  const first = columns[0];
  if (width === 0 || first === undefined || first.length === 0)
    throw new Error("audio: no spectrum to draw.");
  const height = first.length;

  let loudest = 0;
  for (const column of columns) for (const value of column) if (value > loudest) loudest = value;
  const ceiling = 20 * Math.log10(loudest + 1e-9);

  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    const bin = height - 1 - row; // top row is the highest frequency
    let offset = row * (width * 3 + 1);
    raw[offset] = 0; // PNG filter type: none
    offset += 1;
    for (let column = 0; column < width; column += 1) {
      const value = columns[column]?.[bin] ?? 0;
      const db = 20 * Math.log10(value + 1e-9);
      const level = Math.min(1, Math.max(0, (db - ceiling + 70) / 70));
      const [red, green, blue] = viridis(level);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      offset += 3;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(raw, { level: 6 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Five stops of viridis, linearly blended. Perceptually even enough to read a level off. */
const VIRIDIS: readonly (readonly [number, number, number])[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function viridis(level: number): readonly [number, number, number] {
  const position = level * (VIRIDIS.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, VIRIDIS.length - 1);
  const blend = position - low;
  const from = VIRIDIS[low] ?? VIRIDIS[0];
  const to = VIRIDIS[high] ?? VIRIDIS[0];
  if (from === undefined || to === undefined) return [0, 0, 0];
  return [
    Math.round(from[0] * (1 - blend) + to[0] * blend),
    Math.round(from[1] * (1 - blend) + to[1] * blend),
    Math.round(from[2] * (1 - blend) + to[2] * blend),
  ];
}

function pngChunk(kind: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(kind, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const size = re.length;
  for (let index = 1, bit = 0; index < size; index += 1) {
    let mask = size >> 1;
    for (; (bit & mask) !== 0; mask >>= 1) bit ^= mask;
    bit |= mask;
    if (index < bit) {
      const swapRe = re[index] ?? 0;
      re[index] = re[bit] ?? 0;
      re[bit] = swapRe;
      const swapIm = im[index] ?? 0;
      im[index] = im[bit] ?? 0;
      im[bit] = swapIm;
    }
  }
  for (let span = 2; span <= size; span <<= 1) {
    const angle = (-2 * Math.PI) / span;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < size; start += span) {
      let twiddleRe = 1;
      let twiddleIm = 0;
      for (let offset = 0; offset < span >> 1; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + (span >> 1);
        const oddRe = (re[oddIndex] ?? 0) * twiddleRe - (im[oddIndex] ?? 0) * twiddleIm;
        const oddIm = (re[oddIndex] ?? 0) * twiddleIm + (im[oddIndex] ?? 0) * twiddleRe;
        re[oddIndex] = (re[evenIndex] ?? 0) - oddRe;
        im[oddIndex] = (im[evenIndex] ?? 0) - oddIm;
        re[evenIndex] = (re[evenIndex] ?? 0) + oddRe;
        im[evenIndex] = (im[evenIndex] ?? 0) + oddIm;
        const nextRe = twiddleRe * stepRe - twiddleIm * stepIm;
        twiddleIm = twiddleRe * stepIm + twiddleIm * stepRe;
        twiddleRe = nextRe;
      }
    }
  }
}
