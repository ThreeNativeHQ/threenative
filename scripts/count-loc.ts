import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type LocKind = "plumbing" | "game";
export type BenchmarkArm = "vanilla" | "framework";

export interface LocCount {
  readonly arm: BenchmarkArm;
  readonly file: string;
  readonly plumbing: number;
  readonly game: number;
  readonly total: number;
}

export type LineClassifier = (line: string, lineNumber: number) => LocKind;

const README_START = "<!-- benchmark:loc:start -->";
const README_END = "<!-- benchmark:loc:end -->";

const VANILLA_PLUMBING = [
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*\//,
  /^\s*import\b/,
  /^\s*(const|let|var)\s+(el|fmt|clock|veil|card|hud)\b/,
  /^\s*(async\s+)?function\s+(fail|layout|pointAt|main)\b/,
  /\b(document|navigator|window|innerWidth|innerHeight|devicePixelRatio)\b/,
  /\b(renderer|post)\.(setPixelRatio|setSize|setClearColor|domElement|init|compute|render)\b/,
  /\bdocument\.body\.appendChild\b/,
  /^\s*(addEventListener|el\([^)]*\))\.addEventListener\b/,
  /^\s*requestAnimationFrame\b/,
  /^\s*const\s+(post|scenePass|colour|target|keys|pointerDown|usingKeys|state|score|hull|energy|elapsed|pulse|nextHunter|best|tmp|prev|fpsAcc|fpsN|hudAcc)\b/,
  /\b(hud|veil|card|startBtn|againBtn|fps|scoreOut|timeOut|hunterCount|depth|energyPct|hullPct|energyBar|hullBar|hullWrap|hint)\b/,
] as const;

const FRAMEWORK_IMPORT_OR_SHAPE = [
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*\//,
  /^\s*import\b/,
  /^\s*(export\s+)?(type|interface)\b/,
  /^\s*#\w+/,
] as const;

// Note: src/ui/ is deliberately absent. Neither arm's UI is counted — the
// vanilla arm's equivalent lives in index.html and style.css, which this
// classifier does not read either. Counting one and not the other would tilt
// the comparison; changing that is a benchmark decision, not a classifier fix.
// See docs/benchmark/PROTOCOL.md.
const FRAMEWORK_PORT_FILES = [
  "main.tsx",
  "render/lighting.ts",
  "render/postprocessing.ts",
  "scenes/Abyss.ts",
] as const;

function sourceLines(source: string): string[] {
  const withoutFinalNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split(/\r?\n/);
}

export function countLines(
  source: string,
  classify: LineClassifier,
): Pick<LocCount, "plumbing" | "game" | "total"> {
  let plumbing = 0;
  let game = 0;
  for (const [index, line] of sourceLines(source).entries()) {
    if (classify(line, index + 1) === "plumbing") plumbing += 1;
    else game += 1;
  }
  return { plumbing, game, total: plumbing + game };
}

function matchesAny(line: string, rules: readonly RegExp[]): boolean {
  return line.trim() === "" || rules.some((rule) => rule.test(line));
}

export function classifyVanillaLine(line: string, _lineNumber: number): LocKind {
  return matchesAny(line, VANILLA_PLUMBING) ? "plumbing" : "game";
}

export function classifyFrameworkLine(file: string): LineClassifier {
  const isEntryPoint = file === "src/main.ts";
  return (line) => {
    if (isEntryPoint) return "plumbing";
    return matchesAny(line, FRAMEWORK_IMPORT_OR_SHAPE) ? "plumbing" : "game";
  };
}

function countFile(
  root: string,
  arm: BenchmarkArm,
  path: string,
  classify: LineClassifier,
): LocCount {
  const source = readFileSync(path, "utf8");
  const count = countLines(source, classify);
  return {
    arm,
    file: relative(root, path),
    ...count,
  };
}

export function collectLoc(rootDirectory = process.cwd()): LocCount[] {
  const root = resolve(rootDirectory);
  const vanillaPath = join(root, "examples/abyss-vanilla/src/main.js");
  const frameworkRoot = join(root, "examples/abyss-framework/src");
  const rows = [countFile(root, "vanilla", vanillaPath, classifyVanillaLine)];
  for (const file of FRAMEWORK_PORT_FILES) {
    const path = join(frameworkRoot, file);
    rows.push(countFile(root, "framework", path, classifyFrameworkLine(`src/${file}`)));
  }
  return rows;
}

function summary(rows: readonly LocCount[], arm: BenchmarkArm): LocCount {
  const selected = rows.filter((row) => row.arm === arm);
  return {
    arm,
    file: arm === "vanilla" ? "control total" : "framework total",
    plumbing: selected.reduce((sum, row) => sum + row.plumbing, 0),
    game: selected.reduce((sum, row) => sum + row.game, 0),
    total: selected.reduce((sum, row) => sum + row.total, 0),
  };
}

function winner(vanilla: LocCount, framework: LocCount): string {
  if (vanilla.total < framework.total) return "vanilla wins";
  if (framework.total < vanilla.total) return "framework wins";
  return "tie";
}

export function renderLocTable(rows: readonly LocCount[]): string {
  const vanilla = summary(rows, "vanilla");
  const framework = summary(rows, "framework");
  const detail = rows.map(
    (row) =>
      `| ${row.arm === "vanilla" ? "Vanilla" : "ThreeNative"} | \`${row.file}\` | ${row.plumbing} | ${row.game} | ${row.total} | — |`,
  );
  return [
    "| Arm | File | Plumbing LOC | Game LOC | Total LOC | Vanilla wins? |",
    "|---|---|---:|---:|---:|---|",
    ...detail,
    `| **Vanilla** | **control total** | **${vanilla.plumbing}** | **${vanilla.game}** | **${vanilla.total}** | ${winner(vanilla, framework) === "vanilla wins" ? "yes" : "—"} |`,
    `| **ThreeNative** | **framework total** | **${framework.plumbing}** | **${framework.game}** | **${framework.total}** | ${winner(vanilla, framework) === "vanilla wins" ? "no" : "—"} |`,
    "",
    `**Static result:** ${winner(vanilla, framework)}. Vanilla wins are shown per summary row; the framework example remains the independently playable proof scene until the manual Abyss parity run is completed.`,
  ].join("\n");
}

function replaceTable(readme: string, table: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`README.md must contain ${README_START} and ${README_END}.`);
  }
  return `${readme.slice(0, start + README_START.length)}\n${table}\n${readme.slice(end)}`;
}

export function updateReadme(rootDirectory = process.cwd(), check = false): void {
  const root = resolve(rootDirectory);
  const readmePath = join(root, "README.md");
  const current = readFileSync(readmePath, "utf8");
  const expected = replaceTable(current, renderLocTable(collectLoc(root)));
  if (check) {
    if (expected !== current)
      throw new Error("README.md benchmark table is stale; run pnpm tsx scripts/count-loc.ts.");
    return;
  }
  writeFileSync(readmePath, expected);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  updateReadme(process.cwd(), process.argv.includes("--check"));
}
