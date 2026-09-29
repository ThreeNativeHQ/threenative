// PRD-117 desktop arms. Both engines ship a native desktop binary, and both print the §5.1 run
// report between two markers because a native process has no `window` for the collector to read.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FOX_RELATIVE_PATH, FOX_SHA256 } from "../../examples/engine-load-test/src/ladder.js";
import type { IWorkloadAxes } from "../../examples/engine-load-test/src/workload.js";

const BEGIN = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END = "ENGINE_LOAD_TEST_JSON_END";

export interface IDesktopLadder {
  axes: IWorkloadAxes;
  frames: number;
  /** The host surface both engines are given, and therefore both engines' `display`. */
  height: number;
  ladder: string;
  modes: string;
  repeats: number;
  warmup: number;
  width: number;
}

// The native host talks to X11 and this machine's session is Wayland, so the run is wrapped in a
// virtual X server. `SDL_VIDEODRIVER=x11` is required as well: with `WAYLAND_DISPLAY` still set,
// SDL picks Wayland, the host reports "X11 display not available", and the arm never starts.
function x11Environment(): NodeJS.ProcessEnv {
  const { WAYLAND_DISPLAY: _dropped, ...rest } = process.env;
  return { ...rest, SDL_VIDEODRIVER: "x11" };
}

/** Exported for the regression test that pins "returns on the marker, not on process exit". */
export async function runCapturing(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<unknown> {
  const output: string[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    // Its own process group: the desktop arms run behind `xvfb-run`, so signalling the child only
    // reaches the wrapper and leaves the host it spawned running. The group reaches both.
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      detached: true,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    // The report is complete at the END marker, so that is what this waits for — not process exit.
    // The native desktop host currently spins instead of exiting once its script finishes (it
    // reaches `_exit` and never leaves userspace), and waiting on `close` turned a finished
    // benchmark into a silent hang with the answer already sitting in the buffer. The Android
    // runner has always read its marker and then stopped the app; this now matches it.
    let settled = false;
    const finish = (value: number): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const collect = (chunk: unknown): void => {
      output.push(String(chunk));
      if (!settled && output.join("").includes(END)) {
        // Let the host print whatever trails the marker, then take the process down.
        setTimeout(() => {
          stop();
          finish(0);
        }, 1_000);
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("error", reject);
    child.once("close", (value) => finish(value ?? 1));
  });
  const text = output.join("");
  const start = text.indexOf(BEGIN);
  const stop = text.indexOf(END);
  if (start === -1 || stop === -1) {
    throw new Error(
      `TN_BENCH_NO_REPORT: ${command} exited ${code} without a run report.\n${text.slice(-2_000)}`,
    );
  }
  // The payload is emitted in `TNJSON:` chunks so Android's ~1 KB logcat line cap cannot cut it;
  // a desktop run emits the same chunks and rejoins identically.
  const body = text.slice(start + BEGIN.length, stop);
  const chunks = body
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("TNJSON:");
      return marker === -1 ? "" : line.slice(marker + "TNJSON:".length);
    })
    .join("");
  return JSON.parse((chunks.trim().length > 0 ? chunks : body).trim());
}

/**
 * PRD-464 R3's character, checked once per run against the digest
 * `benchmark/engine-load-test/sources.lock.json` pins. The bytes live in the git-ignored artifact
 * tree, so a missing or substituted file has to fail here — before either engine spends a run on it —
 * rather than as a count mismatch in the report half an hour later. Returns undefined when no
 * ladder rung was asked for, so an L-only run never needs the asset to exist.
 */
function resolveFoxAsset(repoRoot: string, modes: string): string | undefined {
  // Any realistic rung resolves it: R1 and R2 build nothing, but the runner cannot know that the
  // ladder's own factory will not be constructed for them, and a missing file must be reported
  // here rather than as a rung that failed to draw characters.
  if (!modes.split(",").some((mode) => /^R[1-5]$/u.test(mode.trim()))) return undefined;
  const file = path.resolve(repoRoot, process.env.TN_BENCH_FOX ?? FOX_RELATIVE_PATH);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(
      `TN_BENCH_FOX_MISSING: ${file} could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== FOX_SHA256)
    throw new Error(`TN_BENCH_FOX_HASH: ${file} is ${digest}, not the pinned ${FOX_SHA256}.`);
  return file;
}

export async function runTnDesktop(repoRoot: string, options: IDesktopLadder): Promise<unknown> {
  const example = path.join(repoRoot, "examples/engine-load-test");
  const fox = resolveFoxAsset(repoRoot, options.modes);
  await mkdir(path.join(example, "dist"), { recursive: true });
  const buildEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ...(fox === undefined ? {} : { TN_BENCH_FOX: fox }),
    TN_BENCH_FRAMES: String(options.frames),
    TN_BENCH_GEOMETRY: options.axes.geometry,
    TN_BENCH_HIERARCHY_DEPTH: String(options.axes.hierarchyDepth),
    TN_BENCH_LADDER: options.ladder,
    TN_BENCH_MATERIAL: options.axes.material,
    TN_BENCH_MODES: options.modes,
    TN_BENCH_MUTATION_RATE: String(options.axes.mutationRate),
    TN_BENCH_PASSES: String(options.axes.passCount),
    TN_BENCH_REPEATS: String(options.repeats),
    TN_BENCH_SHADOW_CASTER_SHARE: String(options.axes.shadowCasterShare),
    TN_BENCH_TARGET: "native",
    TN_BENCH_VISIBLE_FRACTION: String(options.axes.visibleFraction),
    TN_BENCH_WARMUP: String(options.warmup),
    TN_BENCH_HEIGHT: String(options.height),
    TN_BENCH_WIDTH: String(options.width),
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["vite", "build"], {
      cwd: example,
      env: buildEnvironment,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`TN_BENCH_NATIVE_BUILD_FAILED: exit ${code}`)),
    );
  });

  const binary = path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral");
  const bundle = path.join(example, "dist/engine-load-test-desktop.js");
  const hostArgs = [
    "run",
    bundle,
    "--width",
    String(options.width),
    "--height",
    String(options.height),
  ];
  // Godot's desktop arm reports `vsync off`, so the host has to present uncapped too or the two
  // arms are not comparable: pinned to a 60 Hz display ThreeNative reads 16.6 ms at every rung and
  // its real cost is unknowable. The host refuses to fall back to FIFO, so this fails loudly.
  if (process.env.TN_BENCH_VSYNC !== "on") hostArgs.push("--no-vsync");
  // Use Godot's display by default. A caller may explicitly select another display; with no
  // display at all, the headless lane still provisions Xvfb below.
  const display = process.env.TN_BENCH_DISPLAY ?? process.env.DISPLAY;
  if (display !== undefined && display.length > 0) {
    return runCapturing(binary, hostArgs, {
      cwd: repoRoot,
      env: { ...x11Environment(), DISPLAY: display },
    });
  }
  return runCapturing(
    "xvfb-run",
    ["-a", "-s", `-screen 0 ${options.width}x${options.height + 180}x24`, binary, ...hostArgs],
    {
      cwd: repoRoot,
      env: x11Environment(),
    },
  );
}

export async function runGodotDesktop(repoRoot: string, options: IDesktopLadder): Promise<unknown> {
  const godot = process.env.GODOT_BIN ?? "godot";
  const exportDir = path.join(repoRoot, "artifacts/engine-load-test/godot-desktop");
  await mkdir(exportDir, { recursive: true });
  const binary = path.join(exportDir, "load_test.x86_64");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      godot,
      [
        "--headless",
        "--path",
        path.join(repoRoot, "benchmark/godot-load-test"),
        "--export-release",
        "Linux",
        binary,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    child.once("error", (error) =>
      reject(new Error(`TN_BENCH_GODOT_MISSING: could not run \`${godot}\` (${error.message})`)),
    );
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`TN_BENCH_GODOT_EXPORT_FAILED: exit ${code}`)),
    );
  });

  // The window size is the surface both engines are given, so it travels on the same query the
  // rest of the ladder does. The 3D viewport inside it is a per-rung decision (PRD-464's R5 is the
  // rung that draws at 1920x1080), and the rung records that separately.
  const fox = resolveFoxAsset(repoRoot, options.modes);
  const query = new URLSearchParams({
    frames: String(options.frames),
    height: String(options.height),
    ladder: options.ladder,
    modes: options.modes,
    repeats: String(options.repeats),
    warmup: String(options.warmup),
    width: String(options.width),
    ...(fox === undefined ? {} : { fox }),
  }).toString();
  return runCapturing(binary, ["--rendering-driver", "vulkan", "--", `--query=${query}`], {
    cwd: repoRoot,
  });
}
