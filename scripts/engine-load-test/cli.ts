// `pnpm bench:engines` — PRD-117's entry point. Opt-in by construction: nothing here is wired
// into `pnpm test`, and the Godot arms are the only thing that needs Godot installed.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveBenchmarkPage, serveDirectory, startProcess, waitForUrl } from "./browser.js";
import {
  type IRunReport,
  compare,
  parseRunReport,
  renderArmMarkdown,
  renderComparisonMarkdown,
} from "./report.js";
import { runGodotDesktop, runTnDesktop } from "./run-desktop.js";
import { exportGodotWeb } from "./run-godot.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = path.join(repoRoot, "artifacts/engine-load-test");
const TN_PORT = 5199;
const GODOT_PORT = 5198;

interface ILadderOptions {
  frames: number;
  ladder: string;
  modes: string;
  repeats: number;
  warmup: number;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function ladderOptions(): ILadderOptions {
  return {
    frames: Number(flag("frames") ?? 600),
    ladder: flag("ladder") ?? "256,1024,4096,16384",
    modes: flag("modes") ?? "L1,L2",
    repeats: Number(flag("repeats") ?? 3),
    warmup: Number(flag("warmup") ?? 120),
  };
}

function query(options: ILadderOptions): string {
  return `frames=${options.frames}&warmup=${options.warmup}&repeats=${options.repeats}&ladder=${options.ladder}&modes=${options.modes}`;
}

function timeoutFor(options: ILadderOptions): number {
  const cells =
    options.ladder.split(",").length * options.modes.split(",").length * options.repeats;
  // Budget half a second per frame at the top rung; the arm reports long before this fires.
  return Math.max(600_000, cells * options.frames * 500);
}

async function runTnWeb(options: ILadderOptions): Promise<IRunReport> {
  const server = startProcess(
    "pnpm",
    [
      "--filter",
      "threenative-engine-load-test",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(TN_PORT),
      "--strictPort",
    ],
    repoRoot,
  );
  try {
    await waitForUrl(`http://127.0.0.1:${TN_PORT}/`, 120_000);
    const raw = await driveBenchmarkPage({
      onConsole: (text) => process.stderr.write(`[tn-web] ${text}\n`),
      timeoutMs: timeoutFor(options),
      url: `http://127.0.0.1:${TN_PORT}/?${query(options)}`,
    });
    return parseRunReport(raw);
  } finally {
    server.kill("SIGTERM");
  }
}

async function runGodotWeb(options: ILadderOptions): Promise<IRunReport> {
  const exportDir = await exportGodotWeb(repoRoot);
  const server = await serveDirectory(exportDir, GODOT_PORT);
  try {
    await waitForUrl(`http://127.0.0.1:${GODOT_PORT}/index.html`, 60_000);
    const raw = await driveBenchmarkPage({
      onConsole: (text) => process.stderr.write(`[godot-web] ${text}\n`),
      timeoutMs: timeoutFor(options),
      url: `http://127.0.0.1:${GODOT_PORT}/index.html?${query(options)}`,
    });
    return parseRunReport(raw);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function loadArm(arm: string): Promise<IRunReport> {
  const file = path.join(artifactRoot, `${arm}.json`);
  return parseRunReport(JSON.parse(await readFile(file, "utf8")));
}

async function main(): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  const options = ladderOptions();
  const arm = flag("arm");

  if (arm !== undefined) {
    let report: IRunReport;
    if (arm === "tn-web") report = await runTnWeb(options);
    else if (arm === "godot-web") report = await runGodotWeb(options);
    else if (arm === "tn-desktop") report = parseRunReport(await runTnDesktop(repoRoot, options));
    else if (arm === "godot-desktop")
      report = parseRunReport(await runGodotDesktop(repoRoot, options));
    else if (arm === "tn-android" || arm === "godot-android")
      throw new Error(
        `TN_BENCH_DEVICE_REQUIRED: ${arm} needs a physical Android device and an \`adb\` on PATH (PRD-117 Phase 4).`,
      );
    else throw new Error(`TN_BENCH_BAD_ARM: ${arm}`);
    // `--out` names the artifact so a diagnostic run (a floor control, an extended ladder) cannot
    // silently overwrite the ladder the published comparison is built from.
    const file = path.join(artifactRoot, `${flag("out") ?? arm}.json`);
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `${renderArmMarkdown(report)}\n\nwrote ${path.relative(repoRoot, file)}\n`,
    );
    return;
  }

  if (process.argv.includes("--compare")) {
    const left = await loadArm(flag("left") ?? "tn-web");
    const right = await loadArm(flag("right") ?? "godot-web");
    const markdown = renderComparisonMarkdown(compare(left, right));
    const out = flag("doc");
    if (out !== undefined) await writeFile(path.join(repoRoot, out), `${markdown}\n`);
    process.stdout.write(`${markdown}\n`);
    return;
  }

  process.stdout.write(
    "usage: pnpm bench:engines --arm <tn-web|godot-web> [--out name] [--frames N --warmup N --repeats N --ladder a,b --modes L1,L2]\n       pnpm bench:engines --compare [--left tn-web --right godot-web] [--doc path.md]\n",
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
