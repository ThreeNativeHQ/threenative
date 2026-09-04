import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { PlaytestCliUsageError } from "./config.js";
import {
  analyseSamples,
  audioExitCode,
  checkClip,
  formatAudioReport,
  parseAudioArgs,
  parseAudioManifest,
  spectrogramPng,
  type IAudioAnalysis,
  type IAudioCheck,
  type IAudioClipReport,
  type IAudioReport,
} from "./audio.js";

/**
 * The ffmpeg half of `threenative-playtest audio`: find the decoder, decode each declared clip at
 * its own sample rate, write the pictures, and hand the samples to `audio.ts`, which owns every
 * judgement and is where the unit tests are.
 *
 * No browser, no display, no capture lock. Inspecting audio is a file-reading job, and taking the
 * capture queue for it would block the machine's pixel work for nothing.
 */

/**
 * Exit 69 — `EX_UNAVAILABLE` — when ffmpeg is not installed.
 *
 * Its own code because "I could not check" and "I checked and it is fine" must never be the same
 * answer. CI can treat 69 as a skip on a machine without ffmpeg and still treat 1 as a defect,
 * which a shared exit code makes impossible.
 */
export const AUDIO_NO_DECODER_EXIT = 69;

class MissingDecoderError extends Error {}

/** Anything ffmpeg would decode, so a clip the manifest forgot is still noticed. */
const AUDIO_EXTENSIONS = new Set([
  ".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".webm",
]);

export async function audioCommand(argv: readonly string[]): Promise<number> {
  const args = parseAudioArgs(argv);
  try {
    const report = await inspectAudio(args);
    const exitCode = audioExitCode(report);
    process.stdout.write(
      args.text ? formatAudioReport(report) : `${JSON.stringify(report, replacer, 2)}\n`,
    );
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    if (error instanceof PlaytestCliUsageError) throw error;
    if (error instanceof MissingDecoderError) {
      process.stderr.write(
        `${JSON.stringify(
          {
            diagnostics: [
              {
                code: "TN_AUDIO_NO_DECODER",
                fix: { instruction: "Install ffmpeg and re-run; nothing was inspected." },
                message: error.message,
                severity: "error",
              },
            ],
            inspected: false,
            pass: false,
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = AUDIO_NO_DECODER_EXIT;
      return AUDIO_NO_DECODER_EXIT;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify(
        {
          diagnostics: [{ code: "TN_AUDIO_RUN_FAILED", message, severity: "error" }],
          pass: false,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
    return 2;
  }
}

/** The spectrum arrays are the picture's input, not report content; 900 of them is not a report. */
function replacer(key: string, value: unknown): unknown {
  return key === "columns" ? undefined : value;
}

async function inspectAudio(args: ReturnType<typeof parseAudioArgs>): Promise<IAudioReport> {
  await assertDecoder();
  const manifestPath = resolve(args.root, args.expect);
  const manifest = parseAudioManifest(await readManifest(manifestPath), manifestPath);

  const checks: IAudioCheck[] = [];
  const clips: IAudioClipReport[] = [];
  if (args.spectrograms) await mkdir(args.out, { recursive: true });

  for (const expectation of manifest.clips) {
    const file = resolve(args.root, expectation.path);
    let analysis: IAudioAnalysis;
    try {
      const decoded = await decodeAudio(file);
      analysis = analyseSamples(decoded.channels, decoded.sampleRate);
    } catch (error) {
      // A clip that will not decode is a failure of the clip, named against the clip, and never a
      // reason to abandon the other nineteen.
      checks.push({
        detail: `${expectation.path} did not decode: ${error instanceof Error ? error.message : String(error)}`,
        fix: "Check the file exists at that path and is a container ffmpeg reads.",
        name: `${expectation.path} decodes`,
        status: "fail",
      });
      continue;
    }
    checks.push(...checkClip(expectation.path, analysis, expectation));
    let spectrogram: string | undefined;
    if (args.spectrograms) {
      spectrogram = join(args.out, `${basename(expectation.path, extname(expectation.path))}.png`);
      await writeFile(spectrogram, spectrogramPng(analysis.columns));
    }
    clips.push({ analysis, path: expectation.path, ...(spectrogram === undefined ? {} : { spectrogram }) });
  }

  if (args.dir !== undefined) checks.push(await coverageCheck(args.root, args.dir, manifest.clips));
  return { checks, clips, pass: !checks.some(({ status }) => status === "fail") };
}

async function readManifest(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new PlaytestCliUsageError(`audio: cannot read the expectation manifest at ${path}.`);
  }
}

/**
 * Every audio file in the directory has to be declared.
 *
 * Without this the gate is only as good as the manifest, and a clip added later is a clip nobody
 * checks — which is the same silent-skip failure the manifest parser fails closed on, arriving
 * through the other door.
 */
async function coverageCheck(
  root: string,
  dir: string,
  clips: readonly { path: string }[],
): Promise<IAudioCheck> {
  const base = resolve(root, dir);
  const declared = new Set(clips.map(({ path }) => resolve(root, path)));
  let found: string[];
  try {
    found = (await readdir(base, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => resolve(entry.parentPath, entry.name));
  } catch {
    return {
      detail: `${dir} could not be listed`,
      fix: "Point --dir at the directory the game's audio actually ships from.",
      name: "declared",
      status: "fail",
    };
  }
  const undeclared = found.filter((path) => !declared.has(path)).map((path) => relative(root, path));
  if (undeclared.length > 0) {
    return {
      detail: `${String(undeclared.length)} audio file(s) in ${dir} are not declared: ${undeclared.sort().join(", ")}`,
      fix: "Add each to the expectation manifest. An undeclared clip is one nothing checks.",
      name: "declared",
      status: "fail",
    };
  }
  return {
    detail: `all ${String(found.length)} audio file(s) in ${dir} are declared`,
    name: "declared",
    status: "ok",
  };
}

async function assertDecoder(): Promise<void> {
  try {
    await run("ffmpeg", ["-hide_banner", "-version"]);
  } catch {
    throw new MissingDecoderError(
      "ffmpeg is not on PATH, so no audio was decoded and nothing was checked.",
    );
  }
}

interface IDecodedAudio {
  readonly channels: readonly Float64Array[];
  readonly sampleRate: number;
}

/**
 * Decode to 32-bit float WAV on stdout and read the header for the rate and channel count.
 *
 * **No `-ar`.** Resampling is the one thing that must not happen here: the resampler's FIR window
 * runs off the end of the data at the first and last output sample, so those are the only wrong
 * samples in the file, and a loop seam test looks at exactly those two. Letting ffmpeg pick the
 * rate also means one subprocess instead of an ffprobe call to learn the layout first.
 */
async function decodeAudio(path: string): Promise<IDecodedAudio> {
  const wav = await run("ffmpeg", ["-v", "error", "-i", path, "-c:a", "pcm_f32le", "-f", "wav", "-"]);
  return parseWav(wav);
}

export function parseWav(wav: Buffer): IDecodedAudio {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("ffmpeg did not return a RIFF/WAVE stream.");
  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bits = 0;
  while (offset + 8 <= wav.length) {
    const kind = wav.toString("ascii", offset, offset + 4);
    const declared = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    // A stream written to a pipe cannot know its own length, so ffmpeg writes a placeholder.
    const size = declared === 0 || declared === 0xffffffff || body + declared > wav.length
      ? wav.length - body
      : declared;
    if (kind === "fmt ") {
      channelCount = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (kind === "data") {
      if (channelCount === 0 || sampleRate === 0)
        throw new Error("the WAV stream carried data before its format.");
      if (bits !== 32) throw new Error(`expected 32-bit float samples, got ${String(bits)}-bit.`);
      const frames = Math.floor(size / (4 * channelCount));
      if (frames === 0) throw new Error("the file decoded to no samples.");
      const channels = Array.from({ length: channelCount }, () => new Float64Array(frames));
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const value = wav.readFloatLE(body + (frame * channelCount + channel) * 4);
          const target = channels[channel];
          if (target !== undefined) target[frame] = value;
        }
      }
      return { channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("the WAV stream had no data chunk.");
}

function run(command: string, args: readonly string[]): Promise<Buffer> {
  return new Promise<Buffer>((settle, fail) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.once("error", fail);
    child.once("close", (code) => {
      if (code === 0) settle(Buffer.concat(out));
      else fail(new Error(Buffer.concat(err).toString("utf8").trim() || `${command} exited ${String(code)}`));
    });
  });
}
