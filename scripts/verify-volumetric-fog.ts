import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { loadPlaytestScenario } from "../packages/playtest/dist/index.js";
// Use the built public runner: source-runner browser callbacks under tsx may capture __name.
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../packages/playtest/dist/runner/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(root, "examples/abyss-framework/vq-fog");
const artifacts = path.join(root, "artifacts/volumetric-fog");
const cases = [
  ["off", "KeyO"],
  ["zero", "KeyZ"],
  ["fog", "KeyF"],
  ["inside", "KeyI"],
  ["sunOff", "KeyS"],
  ["pointOff", "KeyP"],
  ["overlap", "KeyB"],
  ["half", "KeyH"],
  ["wallOff", "KeyW"],
] as const;

export function fogCaptureScenario(mode: string, key: string) {
  return {
    schemaVersion: 1,
    name: `vq-volumetric-fog-${mode}`,
    target: "web",
    viewport: { width: 640, height: 400 },
    warmupFrames: 60,
    steps: [
      { press: [key], holdTicks: 1, release: true },
      { kind: "wait", waitFrames: 60 },
    ],
    assert: {
      components: [
        {
          entity: "fog",
          component: "ready",
          equals: true,
          allowTrivial: "Capture only the ready graph.",
        },
        {
          entity: "fog",
          component: "mode",
          equals: mode,
          allowTrivial: "A fixed named variant is the screenshot subject.",
        },
        {
          entity: "fog",
          component: "targets",
          equals: mode === "off" || mode === "zero" ? 0 : 1,
          allowTrivial: "Observe the owned allocation baseline for this variant.",
        },
      ],
      diagnostics: { noConsoleErrors: true, noRuntimeDiagnostics: true, runtimeReady: true },
      visual: [{ region: { x: 0, y: 0, width: 640, height: 400, minNonblankPixelRatio: 0.05 } }],
    },
    artifacts: { screenshots: "after", console: true, runtimeTrace: true },
  };
}

export function fogCaptureIsValid(report: {
  pass: boolean;
  capture?: {
    rendererKind?: string;
    adapter?: Record<string, string>;
    viewport?: { width: number; height: number };
  };
  diagnostics: readonly { code: string; severity: string }[];
}): boolean {
  return (
    report.pass &&
    report.capture?.rendererKind === "webgpu" &&
    report.capture.viewport?.width === 640 &&
    report.capture.viewport.height === 400 &&
    Object.values(report.capture.adapter ?? {}).some(
      (value) => value.trim() !== "" && !/^(unknown|unavailable)$/i.test(value),
    ) &&
    !report.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.code === "TN_PLAYTEST_SOFTWARE_DEVICE_LOST",
    )
  );
}

async function main(): Promise<void> {
  await mkdir(artifacts, { recursive: true });
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty !== "")
    throw new Error("VQ07 captures require a clean committed source tree for SHA provenance.");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const results: Record<string, unknown>[] = [];
  const summary = {
    sourceSha,
    qualification:
      "Software correctness captures only; no hardware performance or native claim. Wall/shaft appearance awaits pixel inspection.",
    results,
  };
  try {
    for (const [mode, key] of cases) {
      const directory = path.join(artifacts, mode);
      await mkdir(directory, { recursive: true });
      const scenarioPath = path.join(directory, "scenario.playtest.json");
      await writeFile(scenarioPath, `${JSON.stringify(fogCaptureScenario(mode, key), null, 2)}\n`);
      await loadPlaytestScenario(root, scenarioPath);
      const report = await runStandalonePlaytest({
        artifactDirectory: directory,
        projectPath: fixture,
        scenarioPath,
        target: "browser",
        headless: false,
        allowSoftwareAdapter: true,
        browserArgs: WEBGPU_BROWSER_ARGS,
        port: 0,
        url: "http://127.0.0.1:5173/",
        timeoutMs: 120_000,
        trace: false,
        server: {
          cwd: root,
          command:
            `VQ_FOG_HTTP_LOG=${JSON.stringify(path.join(directory, "http-errors.jsonl"))} ` +
            "node examples/abyss-framework/node_modules/vite/bin/vite.js preview --config examples/abyss-framework/vq-fog/vite.config.ts --host 127.0.0.1 --port ${PORT}",
          timeoutMs: 60_000,
        },
      });
      await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(
        path.join(directory, "observations.json"),
        `${JSON.stringify(report.observations, null, 2)}\n`,
      );
      const valid = fogCaptureIsValid(report);
      results.push({
        mode,
        sourceSha,
        pass: valid,
        capture: report.capture,
        diagnostics: report.diagnostics,
      });
      await writeFile(
        path.join(artifacts, "summary.json"),
        `${JSON.stringify(summary, null, 2)}\n`,
      );
      if (!valid)
        throw new Error(
          `VQ07 ${mode}: rejected runtime/capture diagnostics; preserve artifacts as diagnostic only.`,
        );
      await readFile(path.join(directory, "after.png"));
    }
    const off = PNG.sync.read(await readFile(path.join(artifacts, "off/after.png")));
    const zero = PNG.sync.read(await readFile(path.join(artifacts, "zero/after.png")));
    if (off.width !== zero.width || off.height !== zero.height || !off.data.equals(zero.data))
      throw new Error("VQ07 zero-density identity failed: rendered off/zero pixels differ.");
    results.push({ assertion: "zero-density pixel identity", pass: true });
  } finally {
    await writeFile(path.join(artifacts, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
}
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
