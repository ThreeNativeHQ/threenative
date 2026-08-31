// Image difference between two arms' route frames.
//
// The batch's claim is *this detail, cheaper*, not *cheaper*, so every later phase is scored on two
// numbers: frame time, and how far its frames sit from the `dense` reference. This is the second
// number. It is also what AC5 uses to say the control surface did not move between arms — there,
// the expected answer is zero.
//
//   pnpm --filter quarry compare -- --reference artifacts/quarry/dense --candidate artifacts/quarry/decimated
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";

export interface IFrameDifference {
  /** Fraction of pixels differing by more than `threshold` on any channel. */
  readonly changedPixelRatio: number;
  readonly frame: string;
  /** Largest single-channel absolute difference anywhere in the frame, 0–255. */
  readonly maxChannelDelta: number;
  /** Root-mean-square difference over every channel, 0–255. */
  readonly rmse: number;
}

/** Ignores the last bit of colour: an identical draw can land one level apart between runs. */
const THRESHOLD = 2;

export function compareFrames(
  referencePath: string,
  candidatePath: string,
  frame: string,
): IFrameDifference {
  const reference = PNG.sync.read(readFileSync(referencePath));
  const candidate = PNG.sync.read(readFileSync(candidatePath));
  if (reference.width !== candidate.width || reference.height !== candidate.height)
    throw new Error(
      `TN_QUARRY_FRAME_SIZE_MISMATCH: '${frame}' is ${reference.width}x${reference.height} against ${candidate.width}x${candidate.height}.`,
    );
  let changed = 0;
  let maxDelta = 0;
  let squares = 0;
  const pixels = reference.width * reference.height;
  for (let index = 0; index < pixels; index += 1) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const offset = index * 4 + channel;
      const delta = Math.abs(
        (reference.data[offset] as number) - (candidate.data[offset] as number),
      );
      squares += delta * delta;
      if (delta > maxDelta) maxDelta = delta;
      if (delta > THRESHOLD) pixelChanged = true;
    }
    if (pixelChanged) changed += 1;
  }
  return {
    changedPixelRatio: changed / pixels,
    frame,
    maxChannelDelta: maxDelta,
    rmse: Math.sqrt(squares / (pixels * 3)),
  };
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) throw new Error(`TN_QUARRY_COMPARE_MISSING_ARG: --${name} is required.`);
  return value;
}

function main(): void {
  const reference = resolve(argument("reference"));
  const candidate = resolve(argument("candidate"));
  const frames = (
    process.argv.includes("--frames")
      ? (argument("frames") as string)
      : "rim,switchback,floor,approach,contact,nose"
  ).split(",");
  const rows: IFrameDifference[] = [];
  for (const frame of frames) {
    const referenceFrame = resolve(reference, `${frame}.png`);
    const candidateFrame = resolve(candidate, `${frame}.png`);
    // Fails closed: a frame that was never captured is a comparison that did not happen, and a
    // missing frame silently skipped would report a smaller difference than the arms really have.
    if (!existsSync(referenceFrame))
      throw new Error(`TN_QUARRY_COMPARE_MISSING_FRAME: ${referenceFrame}`);
    if (!existsSync(candidateFrame))
      throw new Error(`TN_QUARRY_COMPARE_MISSING_FRAME: ${candidateFrame}`);
    rows.push(compareFrames(referenceFrame, candidateFrame, frame));
  }
  const mean = rows.reduce((total, row) => total + row.changedPixelRatio, 0) / rows.length;
  console.log(
    JSON.stringify({ candidate, frames: rows, meanChangedPixelRatio: mean, reference }, null, 2),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")
)
  main();
