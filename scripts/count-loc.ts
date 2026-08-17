import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

export type LocKind = "plumbing" | "game";
export type BenchmarkArm = "vanilla" | "framework";

export interface LocCount {
  readonly arm: BenchmarkArm;
  readonly file: string;
  readonly raw: number;
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
export const FRAMEWORK_PORT_FILES = [
  "main.tsx",
  "render/lighting.ts",
  "render/postprocessing.ts",
  "scenes/Abyss.ts",
] as const;

export interface UncountedFrameworkFile {
  readonly path: string;
  readonly reason: string;
}

export const FRAMEWORK_UNCOUNTED: readonly UncountedFrameworkFile[] = [
  {
    path: "ui/**",
    reason: "UI is excluded on both arms; the vanilla equivalent is index.html and style.css.",
  },
  {
    path: "replay-proof.ts",
    reason: "Dev-only benchmark instrumentation is proof tooling, not authored gameplay.",
  },
  {
    path: "scenes/ViewportProbe.ts",
    reason: "The viewport probe is a diagnostic scene, not part of the benchmark game.",
  },
  {
    path: "scenes/TerrainProbe.ts",
    reason: "The terrain consumer is a PRD proof scene, not part of the frozen benchmark game.",
  },
  {
    path: "terrain-main.tsx",
    reason: "The terrain entry point is a PRD proof route, not part of the frozen benchmark game.",
  },
] as const;

const PLATFORMER_SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);

function sourceLines(source: string): string[] {
  const withoutFinalNewline = source.endsWith("\n") ? source.slice(0, -1) : source;
  return withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split(/\r?\n/);
}

function lineCount(source: string): number {
  return sourceLines(source).length;
}

function formatSource(source: string, file: string, root: string): string {
  const extension = extname(file);
  const virtualPath = `benchmark/.loc-input${extension}`;
  const biome = resolve(root, "node_modules/.bin/biome");
  try {
    return execFileSync(biome, ["format", "--stdin-file-path", virtualPath], {
      cwd: root,
      encoding: "utf8",
      input: source,
    });
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
    throw new Error(`Biome could not format ${file}: ${stderr.trim()}`);
  }
}

export function normaliseSource(
  source: string,
  file: string,
  rootDirectory = process.cwd(),
): string {
  return formatSource(source, file, resolve(rootDirectory));
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
  const normalised = normaliseSource(source, path, root);
  const count = countLines(normalised, classify);
  return {
    arm,
    file: relative(root, path),
    raw: lineCount(source),
    ...count,
  };
}

const IMPORT_SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']\s*;?/g;
const DYNAMIC_IMPORT_SPECIFIER = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function isRelativeCodeImport(specifier: string): boolean {
  const extension = extname(specifier);
  return (
    (specifier.startsWith(".") || specifier.startsWith("/")) &&
    (extension === "" || CODE_EXTENSIONS.has(extension))
  );
}

function resolveImportPath(from: string, specifier: string): string | undefined {
  const withoutExtension = CODE_EXTENSIONS.has(extname(specifier))
    ? specifier.slice(0, -extname(specifier).length)
    : specifier;
  const candidates = [
    join(from, specifier),
    ...[".ts", ".tsx", ".js", ".jsx"].map((extension) =>
      join(from, `${withoutExtension}${extension}`),
    ),
    ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((entry) =>
      join(from, withoutExtension, entry),
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function matchesUncounted(path: string, entry: UncountedFrameworkFile): boolean {
  return entry.path.endsWith("/**")
    ? path.startsWith(entry.path.slice(0, -2))
    : path === entry.path;
}

export function assertFrameworkImportClosure(
  frameworkRoot: string,
  countedFiles: readonly string[] = FRAMEWORK_PORT_FILES,
  uncounted: readonly UncountedFrameworkFile[] = FRAMEWORK_UNCOUNTED,
): void {
  const root = resolve(frameworkRoot);
  const counted = new Set(countedFiles);
  const queue = [...countedFiles];
  const visited = new Set<string>();
  const failures: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const path = join(root, file);
    const source = readFileSync(path, "utf8");
    const imports = [
      ...source.matchAll(IMPORT_SPECIFIER),
      ...source.matchAll(DYNAMIC_IMPORT_SPECIFIER),
    ];
    for (const match of imports) {
      const specifier = match[1];
      if (!specifier || !isRelativeCodeImport(specifier)) continue;
      const resolvedPath = resolveImportPath(resolve(path, ".."), specifier);
      if (resolvedPath === undefined) {
        failures.push(`${file} imports unresolved relative module ${specifier}`);
        continue;
      }
      const relativePath = relative(root, resolvedPath).replaceAll("\\", "/");
      if (relativePath.startsWith("../")) continue;
      if (
        !counted.has(relativePath) &&
        !uncounted.some((entry) => matchesUncounted(relativePath, entry))
      ) {
        failures.push(`${file} imports uncounted framework file ${relativePath}`);
      }
      if (!visited.has(relativePath)) queue.push(relativePath);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Framework import closure is open:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
}

export function collectLoc(rootDirectory = process.cwd()): LocCount[] {
  const root = resolve(rootDirectory);
  const vanillaPath = join(root, "examples/abyss-vanilla/src/main.js");
  const frameworkRoot = join(root, "examples/abyss-framework/src");
  assertFrameworkImportClosure(frameworkRoot);
  const rows = [countFile(root, "vanilla", vanillaPath, classifyVanillaLine)];
  for (const file of FRAMEWORK_PORT_FILES) {
    const path = join(frameworkRoot, file);
    rows.push(countFile(root, "framework", path, classifyFrameworkLine(`src/${file}`)));
  }
  return rows;
}

function collectPlatformerSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectPlatformerSourceFiles(path);
    return PLATFORMER_SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

export function countPlatformerTemplateLoc(rootDirectory = process.cwd()): number {
  const sourceRoot = join(
    resolve(rootDirectory),
    "packages/create-threenative/templates/platformer/src",
  );
  return collectPlatformerSourceFiles(sourceRoot).reduce(
    (total, path) => total + sourceLines(readFileSync(path, "utf8")).length,
    0,
  );
}

function summary(rows: readonly LocCount[], arm: BenchmarkArm): LocCount {
  const selected = rows.filter((row) => row.arm === arm);
  return {
    arm,
    file: arm === "vanilla" ? "control total" : "framework total",
    raw: selected.reduce((sum, row) => sum + row.raw, 0),
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

interface LocBaseline {
  readonly frameworkNormalised: number;
  readonly vanillaNormalised: number;
}

function readBaseline(root: string): LocBaseline {
  const path = join(root, "benchmark/loc-baseline.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LocBaseline>;
  if (
    typeof raw.frameworkNormalised !== "number" ||
    !Number.isFinite(raw.frameworkNormalised) ||
    raw.frameworkNormalised < 0 ||
    typeof raw.vanillaNormalised !== "number" ||
    !Number.isFinite(raw.vanillaNormalised) ||
    raw.vanillaNormalised <= 0
  ) {
    throw new Error(
      `${path} must declare finite frameworkNormalised and vanillaNormalised values.`,
    );
  }
  return raw as LocBaseline;
}

export function assertFrameworkRatchet(
  rows: readonly LocCount[],
  rootDirectory = process.cwd(),
): { readonly current: number; readonly baseline: number; readonly suggested: number | undefined } {
  const baseline = readBaseline(resolve(rootDirectory));
  const framework = summary(rows, "framework");
  const overage = framework.total - baseline.frameworkNormalised;
  if (overage > 0) {
    throw new Error(
      `Framework normalised LOC ${framework.total} exceeds baseline ${baseline.frameworkNormalised} by ${overage}; this instrument is a regression ratchet, so the total may fall but never grow without a round ledger entry naming what the extra lines bought.`,
    );
  }
  return {
    current: framework.total,
    baseline: baseline.frameworkNormalised,
    suggested: overage < 0 ? framework.total : undefined,
  };
}

export function renderLocTable(rows: readonly LocCount[]): string {
  const vanilla = summary(rows, "vanilla");
  const framework = summary(rows, "framework");
  const detail = rows.map(
    (row) =>
      `| ${row.arm === "vanilla" ? "Vanilla" : "ThreeNative"} | \`${row.file}\` | ${row.raw} | ${row.total} | ${row.plumbing} | ${row.game} | — |`,
  );
  const ratio = ((framework.total / vanilla.total) * 100).toFixed(1);
  const plumbingRatio = ((framework.plumbing / vanilla.plumbing) * 100).toFixed(1);
  return [
    `**LOC measurement:** Raw LOC is the physical source count. Normalised LOC is counted after both arms are formatted in memory with this repository's Biome configuration. Framework plumbing is **${plumbingRatio}%** of the control's — the plumbing column is the addressable surface named in \`CHARTER.md\` §3, because the game column is the model's work in both arms. The total ratio is **${ratio}%**. This table is a **regression ratchet** against frozen hand-written source, not the win condition; the win condition is \`pnpm sweep:pair\`, agent against agent. See \`docs/benchmark/PROTOCOL.md\`.`,
    "",
    "| Arm | File | Raw LOC | Normalised LOC | Plumbing LOC | Game LOC | Vanilla wins? |",
    "|---|---|---:|---:|---:|---:|---|",
    ...detail,
    `| **Vanilla** | **control total** | **${vanilla.raw}** | **${vanilla.total}** | **${vanilla.plumbing}** | **${vanilla.game}** | ${winner(vanilla, framework) === "vanilla wins" ? "yes" : "—"} |`,
    `| **ThreeNative** | **framework total** | **${framework.raw}** | **${framework.total}** | **${framework.plumbing}** | **${framework.game}** | ${winner(vanilla, framework) === "vanilla wins" ? "no" : "—"} |`,
    "",
    `**Static result:** ${winner(vanilla, framework)}. Vanilla wins are shown per summary row; the framework example remains the independently playable proof scene until the manual Abyss parity run is completed.`,
  ].join("\n");
}

function replaceTable(readme: string, table: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`docs/benchmark/LOC.md must contain ${README_START} and ${README_END}.`);
  }
  return `${readme.slice(0, start + README_START.length)}\n${table}\n${readme.slice(end)}`;
}

export function updateReadme(
  rootDirectory = process.cwd(),
  check = false,
  rows = collectLoc(rootDirectory),
): void {
  const root = resolve(rootDirectory);
  const readmePath = join(root, "docs/benchmark/LOC.md");
  const current = readFileSync(readmePath, "utf8");
  const expected = replaceTable(current, renderLocTable(rows));
  if (check) {
    if (expected !== current)
      throw new Error("docs/benchmark/LOC.md benchmark table is stale; run pnpm tsx scripts/count-loc.ts.");
    return;
  }
  writeFileSync(readmePath, expected);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const check = process.argv.includes("--check");
  const rows = collectLoc(root);
  updateReadme(root, check, rows);
  const ratchet = assertFrameworkRatchet(rows, root);
  if (ratchet.suggested !== undefined) {
    process.stdout.write(
      `suggested framework normalised baseline: ${ratchet.suggested} (current baseline ${ratchet.baseline})\n`,
    );
  }
  // Reported, not capped: the template LOC caps were retired by owner decision 2026-08-09.
  process.stdout.write(`platformer template LOC: ${countPlatformerTemplateLoc(root)}\n`);
}
