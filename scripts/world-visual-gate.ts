/**
 * PRD-477 Phase 1. Capture with the existing playtest runner, then:
 *   pnpm visuals:world --before reference/world.json --after candidate/world.json --out artifacts/world-gate
 *   pnpm visuals:world --score artifacts/world-gate --verdict critic-1.json --verdict critic-2.json --verdict critic-3.json
 * Share only out/blind with critics. Never share seal.json, poses/reveal.json or walk-reveal.json.
 * Exit 0 = judged pass; 1 = measured regression; 2 = invalid or not yet judged.
 * This is a model instrument, not the human blind session or Machinefall acceptance proof.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { softwareAdapterName } from "../packages/playtest/src/runner/browser.js";
import { assertFrameShowsSomething } from "./capture-guard.js";
import { createImageBlindBundle, sha256Text } from "./score-blind.js";
import {
  VISUAL_FLOOR,
  type VisualAbScore,
  buildVisualAbBundle,
  scoreVisualAb,
} from "./visual-ab.js";

type Vector = readonly [number, number, number];
interface IFrame {
  id: string;
  image: string;
  position: Vector;
  target: Vector;
  timeMs?: number;
}
interface ILandmark {
  id: string;
  position: Vector;
}
/** Paths are relative to the manifest; poses and times must be actual captured observations. */
export interface IWorldCaptureManifest {
  schemaVersion: 1;
  world: string;
  build: string;
  route: string;
  seed: string;
  nearBandMeters: number;
  capture: string;
  landmarks: readonly ILandmark[];
  samePose: readonly IFrame[];
  walk: readonly IFrame[];
}
interface ICapture {
  adapter: Record<string, string>;
  viewport: { width: number; height: number };
}
interface ILoaded {
  manifest: IWorldCaptureManifest;
  capture: ICapture;
  files: string[];
}
interface IBlindImage {
  label: string;
  image: string;
  sha256: string;
}
interface IWalkFrame extends IBlindImage {
  timeMs: number;
  position: Vector;
  target: Vector;
  distances: readonly { landmark: string; meters: number }[];
}
interface ISeries {
  label: string;
  frames: IWalkFrame[];
}
interface IBundle {
  schemaVersion: 1;
  evidenceSha256: string;
  promptSha256: string;
  nearBandMeters: number;
  landmarks: readonly ILandmark[];
  samePose: IBlindImage[];
  walk: ISeries[];
}
interface ISeal {
  bundleContentSha256: string;
  files: { file: string; sha256: string }[];
  candidateSeries: string;
  poseNames: Record<string, string>;
  adapters: { before: Record<string, string>; after: Record<string, string> };
}
export interface IWorldVisualBundle {
  bundle: string;
  bundleSha256: string;
}
export interface IPoppingEvent {
  critic: string;
  series: string;
  from: string;
  to: string;
  element: string;
  kind: "appear" | "disappear" | "lod-swap";
  distanceMeters: number;
  description: string;
  candidate: boolean;
  disallowed: boolean;
}
export interface IWorldVisualScore {
  exitCode: 0 | 1;
  verdict: "pass" | "regression";
  bundleSha256: string;
  samePose: VisualAbScore;
  popping: IPoppingEvent[];
  adapters: ISeal["adapters"];
  verdicts: { file: string; sha256: string }[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "docs/product/VISUAL-BASELINE.md");
const RUBRIC = path.join(ROOT, "docs/product/WORLD-VISUAL-GATE.md");
function fail(message: string): never {
  throw new Error(`TN_WORLD_VISUAL_INVALID: ${message}`);
}
const json = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const hash = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const write = (file: string, value: unknown): void =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    return fail(`${name} must be nonempty text`);
  return value;
}
function finite(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    return fail(`${name} must be a finite number >= ${minimum}`);
  return value;
}
function vector(value: unknown, name: string): Vector {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    return fail(`${name} must be three finite coordinates`);
  return value as unknown as Vector;
}
function list(value: unknown, name: string, minimum = 1): unknown[] {
  if (!Array.isArray(value) || value.length < minimum)
    return fail(`${name} requires at least ${minimum} entries`);
  return value;
}
function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) fail(`${name} contains duplicates`);
}
function equal(a: unknown, b: unknown, name: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${name} does not match`);
}
function distance(a: Vector, b: Vector): number {
  return Math.hypot(...a.map((value, index) => value - (b[index] as number)));
}

function loadCapture(file: string): ILoaded {
  const value = record(json(file), file);
  if (value.schemaVersion !== 1) fail("unsupported capture manifest schemaVersion");
  for (const key of ["world", "build", "route", "seed"]) text(value[key], key);
  if (finite(value.nearBandMeters, "nearBandMeters") === 0) fail("nearBandMeters must be positive");
  const directory = path.dirname(file);
  const captureFile = path.resolve(directory, text(value.capture, "capture"));
  const capture = record(json(captureFile), "capture provenance");
  const adapter = record(capture.adapter, "adapter");
  const names = Object.values(adapter);
  if (
    names.length === 0 ||
    names.some((name) => typeof name !== "string") ||
    !["vendor", "architecture", "device", "description"].some((key) => {
      const name = adapter[key];
      return (
        typeof name === "string" &&
        name.trim() !== "" &&
        !/^(unknown|unavailable|none|n\/a)$/i.test(name.trim())
      );
    })
  )
    fail("a named hardware adapter is required");
  if (
    softwareAdapterName(adapter as Record<string, string>) !== undefined ||
    capture.rendererKind !== "webgpu" ||
    capture.target !== "web" ||
    capture.captureMethod !== "page.screenshot"
  )
    fail("requires hardware WebGPU browser capture provenance");
  const args = list(capture.browserArgs, "browserArgs");
  if (args.some((arg) => typeof arg !== "string") || !args.includes("--enable-unsafe-webgpu"))
    fail("capture must use the WebGPU browser recipe");
  const viewport = record(capture.viewport, "viewport");
  for (const key of ["width", "height"])
    if (!Number.isSafeInteger(finite(viewport[key], key, 1))) fail(`invalid viewport ${key}`);
  const files = [path.resolve(file), captureFile];
  const parseFrames = (name: "samePose" | "walk"): IFrame[] => {
    const frames = list(value[name], name, name === "walk" ? 2 : 1).map((raw): IFrame => {
      const frame = record(raw, name);
      const id = text(frame.id, "frame id");
      const image = path.resolve(directory, text(frame.image, "frame image"));
      const position = vector(frame.position, "position");
      const target = vector(frame.target, "target");
      if (distance(position, target) === 0) fail("camera position and target must differ");
      const stats = assertFrameShowsSomething(readFileSync(image), image);
      if (stats.width !== viewport.width || stats.height !== viewport.height)
        fail("image dimensions do not match capture viewport");
      files.push(image);
      return {
        id,
        image,
        position,
        target,
        ...(name === "walk" ? { timeMs: finite(frame.timeMs, "walk timeMs") } : {}),
      };
    });
    unique(
      frames.map((frame) => frame.id),
      `${name} ids`,
    );
    unique(
      frames.map((frame) => realpathSync(frame.image)),
      `${name} image paths`,
    );
    return frames;
  };
  const samePose = parseFrames("samePose");
  const walk = parseFrames("walk");
  if (
    walk.some(
      (frame, index) =>
        index > 0 && (frame.timeMs as number) <= (walk[index - 1]?.timeMs as number),
    )
  )
    fail("walk timeMs must be strictly chronological");
  if (walk.every((frame) => distance(frame.position, walk[0]?.position as Vector) === 0))
    fail("walk camera never moved");
  const landmarks = list(value.landmarks, "landmarks").map((raw): ILandmark => {
    const landmark = record(raw, "landmark");
    return {
      id: text(landmark.id, "landmark id"),
      position: vector(landmark.position, "landmark position"),
    };
  });
  unique(
    landmarks.map((landmark) => landmark.id),
    "landmark ids",
  );
  return {
    manifest: { ...(value as unknown as IWorldCaptureManifest), samePose, walk, landmarks },
    capture: capture as unknown as ICapture,
    files,
  };
}

export function buildWorldVisualBundle(
  beforeFile: string,
  afterFile: string,
  output: string,
): IWorldVisualBundle {
  const before = loadCapture(beforeFile);
  const after = loadCapture(afterFile);
  for (const key of ["world", "route", "seed", "nearBandMeters", "landmarks"] as const)
    equal(before.manifest[key], after.manifest[key], key);
  equal(before.capture.viewport, after.capture.viewport, "viewport");
  const metadata = (frames: readonly IFrame[]) => frames.map(({ image: _image, ...rest }) => rest);
  equal(
    metadata(before.manifest.samePose),
    metadata(after.manifest.samePose),
    "same-pose coverage/poses",
  );
  equal(
    metadata(before.manifest.walk),
    metadata(after.manifest.walk),
    "walk coverage/timing/poses",
  );
  const out = path.resolve(output);
  if (existsSync(out) && readdirSync(out).length !== 0)
    fail("output must be empty; score an existing bundle with --score");
  const blind = path.join(out, "blind");
  mkdirSync(blind, { recursive: true });
  const prompt = `${readFileSync(BASELINE, "utf8")}\n\n${readFileSync(RUBRIC, "utf8")}`;
  const promptFile = path.join(blind, "rubric.md");
  writeFileSync(promptFile, prompt);
  const staging = path.join(out, "staging");
  for (const arm of ["before", "after"]) mkdirSync(path.join(staging, arm), { recursive: true });
  // visual-ab has a public deterministic shuffle. Secretly swapping its two input arms prevents
  // its shuffle seed/order from revealing which arm is the candidate; restore only private reveal.
  const swap = randomInt(2) === 1;
  const names = before.manifest.samePose.map(() => randomBytes(12).toString("hex"));
  for (const [arm, loaded] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const directory = swap ? (arm === "before" ? "after" : "before") : arm;
    loaded.manifest.samePose.forEach((frame, index) =>
      writeFileSync(
        path.join(staging, directory, `${names[index]}.png`),
        readFileSync(frame.image),
      ),
    );
  }
  const poses = buildVisualAbBundle(
    path.join(staging, "before"),
    path.join(staging, "after"),
    path.join(out, "poses"),
    promptFile,
    Math.min(2, names.length),
  );
  if (swap) {
    const reveal = json(poses.reveal) as { arm: string; id: string; label: string }[];
    write(
      poses.reveal,
      reveal.map((entry) => ({
        ...entry,
        arm: entry.arm.replace(
          /::(before|after)/u,
          (_, arm: string) => `::${arm === "before" ? "after" : "before"}`,
        ),
      })),
    );
  }
  renameSync(poses.bundle, path.join(blind, "poses"));
  rmSync(staging, { recursive: true });
  const imageEntry = (label: string, image: string): IBlindImage => ({
    label,
    image,
    sha256: hash(path.join(blind, image)),
  });
  const poseBundle = json(path.join(blind, "poses", "bundle.json")) as {
    samples: { label: string; image: string }[];
  };
  const samePose = poseBundle.samples.map(({ label, image }) =>
    imageEntry(label, `poses/${image}`),
  );
  const walkArtifacts = [before, after].flatMap((arm, armIndex) =>
    arm.manifest.walk.map((frame, index) => ({
      arm: `${armIndex}:${index}`,
      id: `${armIndex}:${index}`,
      content: readFileSync(frame.image),
    })),
  );
  const walkRevealFile = path.join(out, "walk-reveal.json");
  createImageBlindBundle(
    sha256Text(prompt),
    walkArtifacts,
    path.join(blind, "walk"),
    walkRevealFile,
    randomBytes(24).toString("hex"),
    walkArtifacts.map(({ arm }) => arm),
  );
  const walkReveal = json(walkRevealFile) as { arm: string; label: string }[];
  const labels = new Map(walkReveal.map(({ arm, label }) => [arm, label]));
  const order = randomInt(2) === 1 ? [1, 0] : [0, 1];
  const walk = order.map(
    (armIndex, seriesIndex): ISeries => ({
      label: `series-${seriesIndex + 1}`,
      frames: ([before, after][armIndex] as ILoaded).manifest.walk.map((frame, index) => {
        const label = labels.get(`${armIndex}:${index}`) as string;
        return {
          ...imageEntry(`frame-${String(index + 1).padStart(3, "0")}`, `walk/${label}/image.png`),
          timeMs: frame.timeMs as number,
          position: frame.position,
          target: frame.target,
          distances: before.manifest.landmarks.map((landmark) => ({
            landmark: landmark.id,
            meters: distance(frame.position, landmark.position),
          })),
        };
      }),
    }),
  );
  const boundFiles = [
    ...before.files,
    ...after.files,
    BASELINE,
    RUBRIC,
    promptFile,
    poses.reveal,
    walkRevealFile,
    path.join(blind, "poses/bundle.json"),
    path.join(blind, "walk/bundle.json"),
    ...samePose.map(({ image }) => path.join(blind, image)),
    ...walk.flatMap(({ frames }) => frames.map(({ image }) => path.join(blind, image))),
  ];
  const content: Omit<IBundle, "evidenceSha256"> = {
    schemaVersion: 1,
    promptSha256: sha256Text(prompt),
    nearBandMeters: before.manifest.nearBandMeters,
    landmarks: before.manifest.landmarks,
    samePose,
    walk,
  };
  const seal: ISeal = {
    bundleContentSha256: sha256Text(JSON.stringify(content)),
    files: [...new Set(boundFiles)].map((file) => ({ file, sha256: hash(file) })),
    candidateSeries: `series-${order.indexOf(1) + 1}`,
    poseNames: Object.fromEntries(
      names.map((name, index) => [name, before.manifest.samePose[index]?.id as string]),
    ),
    adapters: { before: before.capture.adapter, after: after.capture.adapter },
  };
  const sealFile = path.join(out, "seal.json");
  write(sealFile, seal);
  const bundle: IBundle = { ...content, evidenceSha256: hash(sealFile) };
  const bundleFile = path.join(blind, "bundle.json");
  write(bundleFile, bundle);
  return { bundle: blind, bundleSha256: hash(bundleFile) };
}

function poppingVerdict(
  value: Record<string, unknown>,
  bundle: IBundle,
  seal: ISeal,
  critic: string,
): IPoppingEvent[] {
  const series = list(value.series, "verdict series");
  equal(
    series.map((raw) => record(raw, "series").label).sort(),
    bundle.walk.map(({ label }) => label).sort(),
    "series coverage",
  );
  return series.flatMap((raw) => {
    const entry = record(raw, "series");
    const label = text(entry.label, "series label");
    const frames = (bundle.walk.find((item) => item.label === label) as ISeries).frames;
    const transitions = list(entry.transitions, "transitions");
    const expected = frames.slice(1).map((frame, index) => [frames[index]?.label, frame.label]);
    equal(
      transitions.map((raw) => {
        const t = record(raw, "transition");
        return [t.from, t.to];
      }),
      expected,
      "chronological transition coverage",
    );
    return transitions.flatMap((raw) => {
      const transition = record(raw, "transition");
      return list(transition.events, "events (use [] when none)", 0).map((raw): IPoppingEvent => {
        const event = record(raw, "event");
        const kind = text(event.kind, "event kind");
        if (!["appear", "disappear", "lod-swap"].includes(kind))
          fail("unsupported popping event kind");
        const distanceMeters = finite(event.distanceMeters, "event distanceMeters");
        const candidate = label === seal.candidateSeries;
        return {
          critic,
          series: label,
          from: transition.from as string,
          to: transition.to as string,
          element: text(event.element, "event element"),
          kind: kind as IPoppingEvent["kind"],
          distanceMeters,
          description: text(event.description, "event description"),
          candidate,
          disallowed: candidate && distanceMeters <= bundle.nearBandMeters,
        };
      });
    });
  });
}

export function scoreWorldVisualBundle(
  output: string,
  verdictFiles: readonly string[],
): IWorldVisualScore {
  if (verdictFiles.length !== 3) fail("exactly three independent verdict files are required");
  unique(
    verdictFiles.map((file) => realpathSync(file)),
    "critic file paths",
  );
  const out = path.resolve(output);
  const bundleFile = path.join(out, "blind/bundle.json");
  const bundle = json(bundleFile) as IBundle;
  const sealFile = path.join(out, "seal.json");
  if (bundle.evidenceSha256 !== hash(sealFile)) fail("private evidence seal changed");
  const seal = json(sealFile) as ISeal;
  const { evidenceSha256: _evidenceSha256, ...content } = bundle;
  if (sha256Text(JSON.stringify(content)) !== seal.bundleContentSha256)
    fail("public bundle metadata changed");
  for (const { file, sha256 } of seal.files)
    if (hash(file) !== sha256) fail(`bound artifact changed: ${file}`);
  const bundleSha256 = hash(bundleFile);
  const verdicts = verdictFiles.map((file) => record(json(file), "verdict"));
  unique(
    verdicts.map((verdict) => text(verdict.critic, "critic identity").trim().toLowerCase()),
    "critic identities",
  );
  const popping = verdicts.flatMap((value) => {
    if (value.bundleSha256 !== bundleSha256 || value.promptSha256 !== bundle.promptSha256)
      fail("verdict does not bind this bundle and rubric");
    const samples = list(value.samples, "samples");
    equal(
      samples.map((raw) => record(raw, "sample").label).sort(),
      bundle.samePose.map(({ label }) => label).sort(),
      "same-pose verdict coverage",
    );
    return poppingVerdict(value, bundle, seal, text(value.critic, "critic"));
  });
  const samePose = scoreVisualAb(path.join(out, "poses/reveal.json"), verdictFiles, 3);
  const regression =
    samePose.rows.some((row) => row.after < VISUAL_FLOOR || row.classification === "LOSS") ||
    popping.some(({ disallowed }) => disallowed);
  return {
    exitCode: regression ? 1 : 0,
    verdict: regression ? "regression" : "pass",
    bundleSha256,
    samePose: {
      ...samePose,
      rows: samePose.rows.map((row) => ({
        ...row,
        template: seal.poseNames[row.template] as string,
      })),
    },
    popping,
    adapters: seal.adapters,
    verdicts: verdictFiles.map((file) => ({ file: path.resolve(file), sha256: hash(file) })),
  };
}

function cliOptions(args: readonly string[]): Map<string, string[]> {
  const options = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i] as string;
    const value = args[i + 1];
    if (
      !["--before", "--after", "--out", "--score", "--verdict"].includes(key) ||
      !value ||
      value.startsWith("--")
    )
      fail(
        "Usage: --before <manifest> --after <manifest> --out <new-dir> | --score <dir> --verdict <file> (exactly three times)",
      );
    if (key !== "--verdict" && options.has(key)) fail(`duplicate option ${key}`);
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  return options;
}

export function runCli(args: readonly string[]): number {
  try {
    const options = cliOptions(args);
    const scoring = options.get("--score")?.[0];
    if (scoring !== undefined) {
      if (["--before", "--after", "--out"].some((key) => options.has(key)))
        fail("score an existing bundle without rebuilding it");
      rmSync(path.join(scoring, "score.json"), { force: true });
      const result = scoreWorldVisualBundle(scoring, options.get("--verdict") ?? []);
      write(path.join(scoring, "score.json"), result);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.exitCode;
    }
    const before = options.get("--before")?.[0];
    const after = options.get("--after")?.[0];
    const out = options.get("--out")?.[0];
    if (!before || !after || !out || options.has("--verdict"))
      fail(
        "bundle first with --before <manifest> --after <manifest> --out <new-dir>; then use --score",
      );
    const built = buildWorldVisualBundle(before, after, out);
    process.stdout.write(
      `${JSON.stringify({ ...built, verdict: "unjudged", exitCode: 2 }, null, 2)}\n`,
    );
    return 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = runCli(process.argv.slice(2));
