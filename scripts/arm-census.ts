import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type BenchmarkArm,
  FRAMEWORK_PORT_FILES,
  collectLoc,
  normaliseSource,
} from "./count-loc.js";

export const CENSUS_CLASSES = ["look", "game", "pattern", "plumbing"] as const;
export type CensusClass = (typeof CENSUS_CLASSES)[number];

export interface CensusCounts {
  game: number;
  look: number;
  pattern: number;
  plumbing: number;
}

export interface CensusLine {
  readonly kind: CensusClass;
  readonly line: number;
  readonly source: string;
}

export interface CensusFile {
  readonly arm: BenchmarkArm;
  readonly counts: CensusCounts;
  readonly file: string;
  readonly lines: readonly CensusLine[];
  readonly raw: number;
  readonly total: number;
}

export interface ArmCensus {
  readonly files: readonly CensusFile[];
}

export interface CensusSummary {
  readonly arm: BenchmarkArm;
  readonly counts: CensusCounts;
  readonly raw: number;
  readonly total: number;
}

const GAME_LINE =
  /\b(?:status|state|score|hull|energy|elapsed|nextHunter|best|pulsing|pulse|playing|usingPointer|usingKeys|target|move|pointer|wantPulse|chase|gameOver|distanceTo|START_EVENT|MathUtils\.clamp|frameCtx\.input|ctx\.input|pressed|vector)\b/u;
const LOOK_LINE =
  /\b(?:THREE|WebGPURenderer|OrthographicCamera|SpriteNodeMaterial|MeshBasicNodeMaterial|NodeMaterial|Geometry|Material|AmbientLight|PointLight|Color|AdditiveBlending|toneMapped|transparent|depthWrite|colorNode|scaleNode|positionNode|frustumCulled|background|lookAt|camera|bloom|pass|Fn|If|hash|instanceIndex|deltaTime|uniform|uv|vec[234]|float|mix|sin|cos|time|createLighting|createPostProcessing|GPUParticles3D|positions|velocities|uField|uLamp|uReach|uPull|toLamp|falloff|compute|post|scenePass|colour)\b/u;
const PATTERN_LINE =
  /\b(?:forEach|Array\.from)\b|\bfor\s*\(|\.push\(|removeFromParent|scene\.remove|ctx\.add\(|\.length\s*=\s*0|\b(?:drift|temporary)\b/u;
const PLUMBING_LINE =
  /\b(?:defineGame|createRoot|URLSearchParams|document|getElementById|SceneFrame|globalThis|requestAnimationFrame|ctx\.viewport|ctx\.renderer|ctx\.entities|state\.flush|renderer\.(?:compute|init|set|domElement)|post\.render|return|throw new Error)\b/u;

function sourceLines(source: string): string[] {
  const withoutFinalNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split(/\r?\n/u);
}

function rawLineCount(source: string): number {
  return sourceLines(source).length;
}

function zeroCounts(): CensusCounts {
  return { game: 0, look: 0, pattern: 0, plumbing: 0 };
}

function countTotal(counts: CensusCounts): number {
  return CENSUS_CLASSES.reduce((total, kind) => total + counts[kind], 0);
}

function isCensusClass(value: unknown): value is CensusClass {
  return typeof value === "string" && CENSUS_CLASSES.includes(value as CensusClass);
}

/**
 * Classify one normalized source line. Imports and comments are plumbing;
 * otherwise any line matching more than one class falls to game so ambiguity
 * can never improve the framework's number.
 */
export function classifyCensusLine(line: string): CensusClass {
  const trimmed = line.trim();
  if (
    trimmed.length === 0 ||
    /^(?:\/\/|\/\*|\*\/|\*|import\b|export\s+(?:type|interface)\b|type\b|interface\b)/u.test(
      trimmed,
    )
  ) {
    return "plumbing";
  }
  const matches = CENSUS_CLASSES.filter((kind) => {
    if (kind === "game") return GAME_LINE.test(trimmed);
    if (kind === "look") return LOOK_LINE.test(trimmed);
    if (kind === "pattern") return PATTERN_LINE.test(trimmed);
    return PLUMBING_LINE.test(trimmed);
  });
  return matches.length === 1 && matches[0] !== undefined ? matches[0] : "game";
}

function inputFiles(root: string): readonly { arm: BenchmarkArm; absolute: string }[] {
  return [
    { arm: "vanilla", absolute: join(root, "examples/abyss-vanilla/src/main.js") },
    ...FRAMEWORK_PORT_FILES.map((file) => ({
      arm: "framework" as const,
      absolute: join(root, "examples/abyss-framework/src", file),
    })),
  ];
}

function classifyFile(
  root: string,
  arm: BenchmarkArm,
  absolute: string,
  locTotal: number,
): CensusFile {
  const source = readFileSync(absolute, "utf8");
  const normalized = normaliseSource(source, absolute, root);
  const lines = sourceLines(normalized);
  if (lines.length !== locTotal) {
    throw new Error(
      `${relative(root, absolute)} census has ${lines.length} normalized lines; count-loc reports ${locTotal}.`,
    );
  }
  const counts = zeroCounts();
  const classifiedLines = lines.map((line, index) => {
    const kind = classifyCensusLine(line);
    counts[kind] += 1;
    return { kind, line: index + 1, source: line };
  });
  return {
    arm,
    counts,
    file: relative(root, absolute).replaceAll("\\", "/"),
    lines: classifiedLines,
    raw: rawLineCount(source),
    total: lines.length,
  };
}

export function validateCensus(census: ArmCensus): ArmCensus {
  if (!Array.isArray(census.files) || census.files.length === 0)
    throw new Error("Arm census must contain at least one file.");

  const seen = new Set<string>();
  for (const file of census.files) {
    const identity = `${file.arm}:${file.file}`;
    if (seen.has(identity)) throw new Error(`Arm census contains duplicate file ${identity}.`);
    seen.add(identity);
    if (file.arm !== "vanilla" && file.arm !== "framework")
      throw new Error(`Arm census file ${file.file} has an invalid arm.`);
    if (!Number.isInteger(file.raw) || file.raw < 0)
      throw new Error(`Arm census file ${file.file} has an invalid raw line count.`);
    if (!Number.isInteger(file.total) || file.total <= 0)
      throw new Error(`Arm census file ${file.file} has an invalid total line count.`);
    if (!Array.isArray(file.lines) || file.lines.length !== file.total)
      throw new Error(`Arm census file ${file.file} does not contain one row per line.`);
    const lines: readonly CensusLine[] = file.lines;
    for (const [index, line] of lines.entries()) {
      if (line.line !== index + 1 || typeof line.source !== "string" || !isCensusClass(line.kind))
        throw new Error(`Arm census file ${file.file} has a malformed line ${index + 1}.`);
    }
    const observedCounts = zeroCounts();
    for (const line of lines) observedCounts[line.kind] += 1;
    for (const kind of CENSUS_CLASSES) {
      const count = file.counts[kind];
      if (!Number.isInteger(count) || count < 0)
        throw new Error(`Arm census file ${file.file} has an invalid ${kind} count.`);
      if (count !== observedCounts[kind]) {
        throw new Error(
          `Arm census file ${file.file} ${kind} count ${count} does not match classified lines ${observedCounts[kind]}.`,
        );
      }
    }
    const classifiedTotal = countTotal(file.counts);
    if (classifiedTotal !== file.total) {
      throw new Error(
        `Arm census file ${file.file} class counts ${classifiedTotal} do not reconcile with total ${file.total}.`,
      );
    }
  }
  if (!census.files.some((file) => file.arm === "vanilla"))
    throw new Error("Arm census is missing the vanilla control.");
  if (!census.files.some((file) => file.arm === "framework"))
    throw new Error("Arm census is missing the framework arm.");
  return census;
}

export function collectArmCensus(rootDirectory = process.cwd()): ArmCensus {
  const root = resolve(rootDirectory);
  const locRows = collectLoc(root);
  const locTotals = new Map(locRows.map((row) => [row.file, row.total]));
  const files = inputFiles(root).map(({ arm, absolute }) => {
    const file = relative(root, absolute).replaceAll("\\", "/");
    const locTotal = locTotals.get(file);
    if (locTotal === undefined) throw new Error(`count-loc did not report ${file}.`);
    return classifyFile(root, arm, absolute, locTotal);
  });
  return validateCensus({ files });
}

export function summariseCensus(census: ArmCensus, arm: BenchmarkArm): CensusSummary {
  validateCensus(census);
  const files = census.files.filter((file) => file.arm === arm);
  if (files.length === 0) throw new Error(`Arm census has no ${arm} files.`);
  const counts = zeroCounts();
  return {
    arm,
    counts: files.reduce((total, file) => {
      for (const kind of CENSUS_CLASSES) total[kind] += file.counts[kind];
      return total;
    }, counts),
    raw: files.reduce((total, file) => total + file.raw, 0),
    total: files.reduce((total, file) => total + file.total, 0),
  };
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

function classRanges(file: CensusFile, kind: CensusClass): string {
  const ranges: string[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const line of file.lines) {
    if (line.kind === kind) {
      start ??= line.line;
      previous = line.line;
      continue;
    }
    if (start !== undefined && previous !== undefined) ranges.push(rangeLabel(start, previous));
    start = undefined;
    previous = undefined;
  }
  if (start !== undefined && previous !== undefined) ranges.push(rangeLabel(start, previous));
  return ranges.length === 0 ? "—" : ranges.join(", ");
}

export function renderArmCensus(census: ArmCensus, date: string): string {
  validateCensus(census);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error(`Invalid census date '${date}'.`);
  const vanilla = summariseCensus(census, "vanilla");
  const framework = summariseCensus(census, "framework");
  const ratio = ((framework.total / vanilla.total) * 100).toFixed(1);
  const fileRows = census.files.map(
    (file) =>
      `| ${file.arm} | \`${file.file}\` | ${file.raw} | ${file.counts.look} | ${file.counts.game} | ${file.counts.pattern} | ${file.counts.plumbing} | ${file.total} |`,
  );
  const rangeRows = census.files.flatMap((file) => [
    `### ${file.arm}: \`${file.file}\``,
    "",
    ...CENSUS_CLASSES.map((kind) => `- **${kind}:** ${classRanges(file, kind)}`),
    "",
  ]);
  return [
    `# Arm census — ${date}`,
    "",
    "This census runs one classifier over the Biome-normalized source of the frozen vanilla control and the framework arm. Every normalized line has exactly one class; ambiguous lines fall to `game`.",
    "",
    `Measured ratio: **${framework.total} / ${vanilla.total} = ${ratio}%** framework / vanilla normalized LOC.`,
    "",
    "## Totals",
    "",
    "| Arm | Look | Game | Pattern | Plumbing | Normalized LOC | Raw LOC |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| vanilla | ${vanilla.counts.look} | ${vanilla.counts.game} | ${vanilla.counts.pattern} | ${vanilla.counts.plumbing} | ${vanilla.total} | ${vanilla.raw} |`,
    `| framework | ${framework.counts.look} | ${framework.counts.game} | ${framework.counts.pattern} | ${framework.counts.plumbing} | ${framework.total} | ${framework.raw} |`,
    "",
    "## Per-file reconciliation",
    "",
    "Each class total must sum to the normalized total; the last column is the independent `count-loc.ts` total.",
    "",
    "| Arm | File | Raw LOC | Look | Game | Pattern | Plumbing | Normalized LOC |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...fileRows,
    "",
    "## Classified line ranges",
    "",
    "Ranges are inclusive and refer to the normalized source. The script retains the individual line rows used to produce these ranges.",
    "",
    ...rangeRows,
  ].join("\n");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function censusPath(root: string, date: string, output: string | undefined): string {
  return resolve(root, output ?? join("docs/verification", `arm-census-${date}.md`));
}

export function writeArmCensus(
  rootDirectory = process.cwd(),
  date = today(),
  output?: string,
): string {
  const root = resolve(rootDirectory);
  const destination = censusPath(root, date, output);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${renderArmCensus(collectArmCensus(root), date)}\n`);
  return destination;
}

export function checkArmCensus(
  rootDirectory = process.cwd(),
  date = today(),
  output?: string,
): string {
  const root = resolve(rootDirectory);
  const destination = censusPath(root, date, output);
  const expected = `${renderArmCensus(collectArmCensus(root), date)}\n`;
  const actual = readFileSync(destination, "utf8");
  if (actual !== expected) throw new Error(`${destination} is stale; rerun scripts/arm-census.ts.`);
  return destination;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const date = optionValue(args, "--date") ?? today();
  const output = optionValue(args, "--out");
  try {
    const destination = args.includes("--check")
      ? checkArmCensus(process.cwd(), date, output)
      : writeArmCensus(process.cwd(), date, output);
    process.stdout.write(
      `${args.includes("--check") ? "arm census valid" : "arm census written"}: ${destination}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
