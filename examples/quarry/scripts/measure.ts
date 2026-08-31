// Runs one arm's route and reports the frame it produced. Exists so the number PRD-280 opens or
// closes the batch on can be re-taken by CI or by another agent with one command, rather than
// recovered by hand out of a log — every number in this repository's Android-fps hunt was read out
// of these markers by hand once, and that is what `playtest perf` was written to stop.
//
//   pnpm --filter quarry measure -- --arm dense --url http://127.0.0.1:5191
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUARRY_ARMS, type QuarryArm, parseArm } from "../src/quarry/arm.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");

interface IPhase {
  readonly p50: number;
  readonly p95: number;
  readonly samples: number;
}

interface IFrameBudgetWindow {
  readonly fps: number;
  readonly frame: IPhase;
  readonly gpuMs?: number;
  readonly phases: Readonly<Record<string, IPhase>>;
  readonly presented?: IPhase;
  readonly surface?: { readonly drawingBufferHeight: number; readonly drawingBufferWidth: number };
  readonly window: number;
}

export interface IArmMeasurement {
  readonly adapter: unknown;
  readonly arm: QuarryArm;
  readonly target: string;
  readonly drawCalls: number;
  readonly framePresentedMsP50: number;
  readonly fps: number;
  readonly gpuMs: number | null;
  readonly hostGapMsP50: number;
  readonly renderMsP50: number;
  readonly renderMsP95: number;
  readonly steadyWindows: number;
  readonly triangles: number;
  readonly viewport: string;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("TN_QUARRY_NO_SAMPLES: nothing to take a median of.");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`TN_QUARRY_MEASURE_MISSING_ARG: --${name} is required.`);
  }
  return value;
}

function main(): void {
  const arm = parseArm(argument("arm"));
  const target = argument("target", "browser");
  if (target !== "browser" && target !== "desktop")
    throw new Error(
      `TN_QUARRY_MEASURE_TARGET: --target must be browser or desktop, not '${target}'.`,
    );
  const url = argument("url", "http://127.0.0.1:5191");
  const artifacts = resolve(
    repositoryRoot,
    target === "browser" ? `artifacts/quarry/${arm}` : `artifacts/quarry/native-${arm}`,
  );
  mkdirSync(artifacts, { recursive: true });

  const browserArguments = [
    resolve(here, "../playtests/quarry-route.playtest.json"),
    "--url",
    `${url}/?arm=${arm}`,
    "--browser-recipe",
    "webgpu",
    // Headed against the real adapter: under the runner's private Xvfb a heavy scene can fall
    // back to SwiftShader, and a software adapter would invent a difference between the arms
    // out of nothing.
    "--headed",
  ];
  const desktopArguments = [
    "playtests/quarry-route-desktop.playtest.json",
    "--target",
    "desktop",
    "--executable",
    `dist-native/quarry-${arm}`,
    "--project",
    resolve(here, ".."),
  ];

  const report = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve(repositoryRoot, "packages/playtest/dist/runner/cli.js"),
        ...(target === "browser" ? browserArguments : desktopArguments),
        "--timeout",
        "300000",
        "--artifacts",
        artifacts,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        // The native host picks Wayland otherwise and then reports no display at all.
        env: { ...process.env, SDL_VIDEODRIVER: "x11" },
        maxBuffer: 256 * 1024 * 1024,
      },
    ),
  ) as {
    observations: {
      console: readonly { text: string }[];
      resourceSeries?: readonly { snapshots: Record<string, Record<string, number>> }[];
    };
    pass: boolean;
  };

  if (report.pass !== true)
    throw new Error(`TN_QUARRY_MEASURE_SCENARIO_FAILED: the ${arm} route did not pass.`);

  const windows: IFrameBudgetWindow[] = [];
  for (const line of report.observations.console) {
    // The browser lane reports the marker bare; the native host's console arrives through the
    // mailbox with a `[log] ` level prefix, so the marker is found rather than required at
    // column zero.
    const marker = line.text.indexOf("TN_FRAME_BUDGET:");
    if (marker === -1) continue;
    // Fails closed, like `playtest perf`: a marker whose JSON will not parse is a measurement
    // that did not happen, never a sample that quietly vanishes.
    windows.push(
      JSON.parse(line.text.slice(marker + "TN_FRAME_BUDGET:".length)) as IFrameBudgetWindow,
    );
  }
  // Window 1 always lies: it holds the load, the first shader compiles and the first uploads.
  const steady = windows.filter((entry) => entry.window > 1);
  if (steady.length < 2)
    throw new Error(
      `TN_QUARRY_MEASURE_NOT_ENOUGH_WINDOWS: ${steady.length} steady windows, need at least 2.`,
    );

  const last = report.observations.resourceSeries?.at(-1)?.snapshots.GameState;
  if (last === undefined)
    throw new Error("TN_QUARRY_MEASURE_NO_STATE: the run reported no game state.");

  const gpuSamples = steady
    .map((entry) => entry.gpuMs)
    .filter((value): value is number => typeof value === "number");
  const surface = steady[0]?.surface;
  const measurement: IArmMeasurement = {
    // The browser lane names its adapter in `capture.json`; the desktop lane's adapter is the one
    // the host printed into its own log, and claiming otherwise would be inventing evidence.
    adapter:
      target === "browser"
        ? (
            JSON.parse(readFileSync(resolve(artifacts, "capture.json"), "utf8")) as {
              adapter: unknown;
            }
          ).adapter
        : "packed Linux desktop native host (see the run's console.json)",
    arm,
    target,
    drawCalls: last.drawCalls as number,
    framePresentedMsP50: median(
      steady.map((entry) => entry.presented?.p50).filter((v): v is number => v !== undefined),
    ),
    fps: median(steady.map((entry) => entry.fps)),
    gpuMs: gpuSamples.length === 0 ? null : median(gpuSamples),
    hostGapMsP50: median(steady.map((entry) => entry.phases.hostGap?.p50 ?? 0)),
    renderMsP50: median(steady.map((entry) => entry.phases.render?.p50 ?? 0)),
    renderMsP95: median(steady.map((entry) => entry.phases.render?.p95 ?? 0)),
    steadyWindows: steady.length,
    triangles: last.triangles as number,
    viewport:
      surface === undefined
        ? "unknown"
        : `${surface.drawingBufferWidth}x${surface.drawingBufferHeight}`,
  };

  writeFileSync(
    resolve(artifacts, "measurement.json"),
    `${JSON.stringify(measurement, null, 2)}\n`,
  );
  console.log(JSON.stringify(measurement, null, 2));
}

if (!QUARRY_ARMS.includes(process.argv[process.argv.indexOf("--arm") + 1] as QuarryArm))
  throw new Error(`TN_QUARRY_MEASURE_ARM: --arm must be one of ${QUARRY_ARMS.join(", ")}.`);
main();
