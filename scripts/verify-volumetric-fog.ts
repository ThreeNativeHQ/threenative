import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { type IPlaytestScenario, loadPlaytestScenario } from "../packages/playtest/dist/index.js";
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
  ["blackOff", "KeyN"],
  ["scatter", "KeyL"],
  ["scatterSunOff", "KeyK"],
  ["scatterPointOff", "KeyJ"],
] as const;

export function fogCaptureScenario(mode: string, key: string): IPlaytestScenario {
  return {
    schemaVersion: 1,
    name: `vq-volumetric-fog-${mode}`,
    target: "web",
    viewport: { width: 640, height: 400 },
    warmupFrames: 60,
    steps: [
      { press: [key], holdTicks: 1, release: true },
      { kind: "wait", waitFrames: 60, release: true },
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
          equals: ["off", "zero", "blackOff"].includes(mode) ? 0 : 1,
          allowTrivial: "Observe the owned allocation baseline for this variant.",
        },
        ...[
          ["sun", mode !== "sunOff" && mode !== "scatterSunOff"],
          ["point", mode !== "pointOff" && mode !== "scatterPointOff"],
          ["scatteringOnly", mode.startsWith("scatter") || mode === "blackOff"],
        ].map(([component, equals]) => ({
          entity: "fog",
          component: String(component),
          equals,
          allowTrivial: "Observe the declared lighting and surface isolation for this arm.",
        })),
      ],
      diagnostics: { noConsoleErrors: true, noRuntimeDiagnostics: true, runtimeReady: true },
      visual: [
        {
          region: {
            x: 0,
            y: 0,
            width: 640,
            height: 400,
            minNonblankPixelRatio: 0.05,
          },
        },
        ...(mode === "blackOff"
          ? [
              {
                region: {
                  x: 0,
                  y: 0,
                  width: 500,
                  height: 400,
                  minNonblankPixelRatio: 0,
                  minDarkPixelRatio: 1,
                  maxLuminance: 0,
                },
              },
            ]
          : []),
      ],
    },
    artifacts: { screenshots: "after", console: true, runtimeTrace: true },
  };
}

export async function fogCaptureScenarios() {
  const result = cases.map(([mode, key]) => ({
    mode: String(mode),
    scenario: fogCaptureScenario(mode, key),
  }));
  const { sourcePath: _sourcePath, ...lifecycle } = await loadPlaytestScenario(
    root,
    "examples/abyss-framework/playtests/vq-volumetric-fog.playtest.json",
  );
  result.push({ mode: "lifecycle", scenario: lifecycle });
  const off = fogCaptureScenario("off", "KeyO");
  off.name = "vq-volumetric-fog-lifecycle-off";
  off.steps = [...lifecycle.steps, ...off.steps];
  off.assert?.components?.push(
    ...["createdTargets", "releasedTargets", "releasedMaterials", "liveTargets"].map(
      (component) => ({
        entity: "fog",
        component,
        equals: component === "liveTargets" ? 0 : 4,
        allowTrivial: "After four actual fog graphs, off returns the owned allocation baseline.",
      }),
    ),
  );
  result.push({ mode: "lifecycleOff", scenario: off });
  return result;
}

interface IPixelFrame {
  width: number;
  height: number;
  data: Uint8Array;
}
// Pinned before capture: room interior excludes the foreground plate (x < 238),
// while the second patch lies wholly inside that plate. No single bright pixel can pass.
const SCATTER_ROI = { x: 260, y: 155, width: 150, height: 90 };
const FOG_EVALUATION_ROI = { x: 0, y: 0, width: 500, height: 400 };
const CALIBRATION_ROI = { x: 515, y: 25, width: 110, height: 110 };
const WALL_ROI = { x: 184, y: 216, width: 18, height: 18 };
export function fogLightPixelMetrics(
  black: IPixelFrame,
  both: IPixelFrame,
  sunOff: IPixelFrame,
  pointOff: IPixelFrame,
) {
  const images = [black, both, sunOff, pointOff];
  if (
    images.some(
      (image) => image.width !== 640 || image.height !== 400 || image.data.length !== 640 * 400 * 4,
    )
  )
    throw new Error("VQ07 scattering evidence requires complete 640x400 RGBA pixels.");
  const maxRgb = (image: IPixelFrame, roi: typeof SCATTER_ROI) => {
    let maximum = 0;
    for (let y = roi.y; y < roi.y + roi.height; y += 1)
      for (let x = roi.x; x < roi.x + roi.width; x += 1)
        for (let c = 0; c < 3; c += 1)
          maximum = Math.max(maximum, image.data[(y * image.width + x) * 4 + c] ?? Number.NaN);
    return maximum;
  };
  const delta = (without: IPixelFrame) => {
    let total = 0;
    let changed = 0;
    for (let y = SCATTER_ROI.y; y < SCATTER_ROI.y + SCATTER_ROI.height; y += 1)
      for (let x = SCATTER_ROI.x; x < SCATTER_ROI.x + SCATTER_ROI.width; x += 1) {
        let strongest = 0;
        for (let c = 0; c < 3; c += 1) {
          const i = (y * both.width + x) * 4 + c;
          const difference = (both.data[i] ?? Number.NaN) - (without.data[i] ?? Number.NaN);
          total += difference;
          strongest = Math.max(strongest, difference);
        }
        if (strongest > 2) changed += 1;
      }
    const pixels = SCATTER_ROI.width * SCATTER_ROI.height;
    return { meanRgbDelta: total / (pixels * 3), changedPixelRatio: changed / pixels };
  };
  const baselineMaxRgb = maxRgb(black, FOG_EVALUATION_ROI);
  let calibrationMinimum = 255;
  let calibrationMaxDifference = 0;
  for (let y = CALIBRATION_ROI.y; y < CALIBRATION_ROI.y + CALIBRATION_ROI.height; y += 1)
    for (let x = CALIBRATION_ROI.x; x < CALIBRATION_ROI.x + CALIBRATION_ROI.width; x += 1)
      for (let c = 0; c < 3; c += 1) {
        const i = (y * 640 + x) * 4 + c;
        const reference = black.data[i] ?? Number.NaN;
        calibrationMinimum = Math.min(calibrationMinimum, reference);
        for (const image of images)
          calibrationMaxDifference = Math.max(
            calibrationMaxDifference,
            Math.abs((image.data[i] ?? Number.NaN) - reference),
          );
      }
  const wallMaxRgb = Math.max(...images.map((image) => maxRgb(image, WALL_ROI)));
  const sun = delta(sunOff);
  const point = delta(pointOff);
  return {
    baselineMaxRgb,
    wallMaxRgb,
    roi: SCATTER_ROI,
    wallRoi: WALL_ROI,
    evaluationRoi: FOG_EVALUATION_ROI,
    calibrationRoi: CALIBRATION_ROI,
    calibrationMinimum,
    calibrationMaxDifference,
    sun,
    point,
    thresholds: {
      minMeanRgbDelta: 1,
      minChangedPixelRatio: 0.1,
      maxBlackRgb: 0,
      minCalibrationRgb: 32,
      maxCalibrationDifference: 0,
    },
    pass:
      baselineMaxRgb === 0 &&
      calibrationMinimum >= 32 &&
      calibrationMaxDifference === 0 &&
      wallMaxRgb === 0 &&
      [sun, point].every((metric) => metric.meanRgbDelta >= 1 && metric.changedPixelRatio >= 0.1),
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
    for (const { mode, scenario } of await fogCaptureScenarios()) {
      const directory = path.join(artifacts, mode);
      await mkdir(directory, { recursive: true });
      const scenarioPath = path.join(directory, "scenario.playtest.json");
      await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
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
          command: `VQ_FOG_HTTP_LOG=${JSON.stringify(path.join(directory, "http-errors.jsonl"))} node examples/abyss-framework/node_modules/vite/bin/vite.js preview --config examples/abyss-framework/vq-fog/vite.config.ts --host 127.0.0.1 --port \${PORT}`,
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
        lights: {
          directional: {
            name: "fog-directional",
            type: "DirectionalLight",
            shadow: "ordinary-map",
          },
          point: { name: "fog-point", type: "PointLight", shadow: "none", range: 8 },
        },
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
    const restored = PNG.sync.read(await readFile(path.join(artifacts, "lifecycleOff/after.png")));
    if (!off.data.equals(restored.data))
      throw new Error("VQ07 lifecycle off did not restore the baseline pixels.");
    results.push({ assertion: "repeated lifecycle restores baseline pixels", pass: true });
    const lightFrames = await Promise.all(
      ["blackOff", "scatter", "scatterSunOff", "scatterPointOff"].map(async (mode) =>
        PNG.sync.read(await readFile(path.join(artifacts, mode, "after.png"))),
      ),
    );
    const [black, both, sunOff, pointOff] = lightFrames;
    if (!black || !both || !sunOff || !pointOff)
      throw new Error("Missing scattering-control frame.");
    const metrics = fogLightPixelMetrics(black, both, sunOff, pointOff);
    results.push({ assertion: "isolated light-scattering pixels", ...metrics });
    if (!metrics.pass)
      throw new Error("VQ07 isolated light-scattering/black-control pixel gates failed.");
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
