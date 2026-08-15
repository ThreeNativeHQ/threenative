// PRD-117 desktop arms. Both engines ship a native desktop binary, and both print the §5.1 run
// report between two markers because a native process has no `window` for the collector to read.
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BEGIN = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END = "ENGINE_LOAD_TEST_JSON_END";

export interface IDesktopLadder {
  frames: number;
  ladder: string;
  modes: string;
  repeats: number;
  warmup: number;
}

// The native host talks to X11 and this machine's session is Wayland, so the run is wrapped in a
// virtual X server. `SDL_VIDEODRIVER=x11` is required as well: with `WAYLAND_DISPLAY` still set,
// SDL picks Wayland, the host reports "X11 display not available", and the arm never starts.
function x11Environment(): NodeJS.ProcessEnv {
  const { WAYLAND_DISPLAY: _dropped, ...rest } = process.env;
  return { ...rest, SDL_VIDEODRIVER: "x11" };
}

async function runCapturing(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<unknown> {
  const output: string[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    child.once("error", reject);
    child.once("close", (value) => resolve(value ?? 1));
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

export async function runTnDesktop(repoRoot: string, options: IDesktopLadder): Promise<unknown> {
  const example = path.join(repoRoot, "examples/engine-load-test");
  await mkdir(path.join(example, "dist"), { recursive: true });
  const buildEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    TN_BENCH_FRAMES: String(options.frames),
    TN_BENCH_LADDER: options.ladder,
    TN_BENCH_MODES: options.modes,
    TN_BENCH_REPEATS: String(options.repeats),
    TN_BENCH_TARGET: "native",
    TN_BENCH_WARMUP: String(options.warmup),
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
  return runCapturing(
    "xvfb-run",
    [
      "-a",
      "-s",
      "-screen 0 1600x900x24",
      binary,
      "run",
      bundle,
      "--width",
      "1280",
      "--height",
      "720",
    ],
    { cwd: repoRoot, env: x11Environment() },
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

  const query = `ladder=${options.ladder}&modes=${options.modes}&frames=${options.frames}&warmup=${options.warmup}&repeats=${options.repeats}`;
  return runCapturing(binary, ["--rendering-driver", "vulkan", "--", `--query=${query}`], {
    cwd: repoRoot,
  });
}
