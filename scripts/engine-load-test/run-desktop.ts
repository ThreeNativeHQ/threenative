// PRD-117 desktop arms. Both engines ship a native desktop binary, and both print the §5.1 run
// report between two markers because a native process has no `window` for the collector to read.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";

const BEGIN = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END = "ENGINE_LOAD_TEST_JSON_END";
/** What a native arm's top-level catch prints when it stopped, which is terminal by definition. */
const FAILED = "ENGINE_LOAD_TEST_FAILED";

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

/** Exported for the regression test that pins "returns on the marker, not on process exit". */
export async function runCapturing(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<unknown> {
  const output: string[] = [];
  const timeoutMs = options.timeoutMs ?? 900_000;
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
    // A child that dies mid-run without printing the marker — an unhandled script error inside a
    // `SceneTree` that then has nothing left to quit it — neither reports nor exits, so this wait
    // had no end of its own and the arm hung until the session did. Bounded, so a hang is a named
    // failure with the child's own last output instead of a stall.
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(
        new Error(
          `TN_BENCH_TIMEOUT: ${command} produced no report within ${timeoutMs} ms.\n${output.join("").slice(-2_000)}`,
        ),
      );
    }, timeoutMs);
    const finish = (value: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    const collect = (chunk: unknown): void => {
      output.push(String(chunk));
      const text = output.join("");
      if (!settled && text.includes(FAILED)) {
        // The arm reported why it stopped and printed no report. Waiting out the full timeout for a
        // child that is never going to print one is the stall this whole bound exists to prevent.
        stop();
        settled = true;
        clearTimeout(deadline);
        reject(new Error(text.slice(text.indexOf(FAILED), text.indexOf(FAILED) + 2_000).trim()));
        return;
      }
      if (!settled && text.includes(END)) {
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
  const hostArgs = ["run", bundle, "--width", "1280", "--height", "720"];
  // Godot's desktop arm reports `vsync off`, so the host has to present uncapped too or the two
  // arms are not comparable: pinned to a 60 Hz display ThreeNative reads 16.6 ms at every rung and
  // its real cost is unknowable. The host refuses to fall back to FIFO, so this fails loudly.
  if (process.env.TN_BENCH_VSYNC !== "on") hostArgs.push("--no-vsync");
  // `TN_BENCH_DISPLAY` puts the host on a real X display instead of a virtual one. It matters:
  // `runGodotDesktop` has always launched its binary straight onto `DISPLAY`, so wrapping only this
  // arm in `xvfb-run` compared one engine on the compositor against the other on a virtual server
  // that costs ~25 ms a frame by itself — 256 cubes measured 26.13 ms under it. Point both arms at
  // the same display and the desktop comparison means something.
  const display = process.env.TN_BENCH_DISPLAY;
  if (display !== undefined && display.length > 0) {
    return runCapturing(binary, hostArgs, {
      cwd: repoRoot,
      env: { ...x11Environment(), DISPLAY: display },
    });
  }
  return runCapturing("xvfb-run", ["-a", "-s", "-screen 0 1600x900x24", binary, ...hostArgs], {
    cwd: repoRoot,
    env: x11Environment(),
  });
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

export interface ICubesOptions {
  /** `static` or `rotating`; the variant is also the arm's optimization question, never both. */
  variant: "static" | "rotating";
  count: number;
  frames: number;
  warmup: number;
  display: string;
  artifacts: string;
  /** `default` is TN's ordinary authoring; `independent` switches its projection off. */
  authoring?: "default" | "independent";
}

async function sha256File(target: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(target))
    .digest("hex");
}

/**
 * The pinned Bevy arm. `many_cubes` is an example of the pinned checkout, so the adapter is compiled
 * *inside* that tree from the tracked source in `benchmark/bevy-prd449/` by symlink: the compiled
 * source is the repository's file, whose SHA-256 the report carries, and no pinned file is edited.
 */
export function bevyCheckout(repoRoot: string): string {
  return path.join(repoRoot, "artifacts/engine-load-test/sources/bevy");
}

export async function prepareBevyArm(repoRoot: string): Promise<{
  binary: string;
  adapter: string;
  upstream: string;
}> {
  const checkout = bevyCheckout(repoRoot);
  await access(path.join(checkout, "examples/stress_tests/many_cubes.rs"));
  const adapter = path.join(repoRoot, "benchmark/bevy-prd449/cubes_arm.rs");
  // The link is what makes the example target exist at all; the path cargo compiles is the tracked file.
  const link = path.join(checkout, "examples/prd449_cubes.rs");
  await rm(link, { force: true });
  await symlink(adapter, link);
  const binary = path.join(checkout, "target/release/examples/prd449_cubes");
  return {
    adapter: await sha256File(adapter),
    binary,
    upstream: await sha256File(path.join(checkout, "examples/stress_tests/many_cubes.rs")),
  };
}

export async function runBevyDesktop(
  repoRoot: string,
  options: ICubesOptions,
  identity: { adapter: string; binary: string; upstream: string },
): Promise<{ fixture: string; report: Record<string, unknown> }> {
  const fixture = path.join(
    options.artifacts,
    `cubes-${options.count}-${options.variant}-bevy-fixture.json`,
  );
  await mkdir(options.artifacts, { recursive: true });
  const args = [
    "--instance-count",
    String(options.count),
    "--warmup-frames",
    String(options.warmup),
    "--measured-frames",
    String(options.frames),
    "--fixture-out",
    fixture,
  ];
  if (options.variant === "rotating") args.push("--rotate-cubes");
  const report = (await runCapturing(identity.binary, args, {
    cwd: bevyCheckout(repoRoot),
    // Bevy's window has to land on the real display, and winit picks Wayland when it is set, so the
    // backend is named rather than left to whatever the session happens to export.
    env: {
      ...process.env,
      DISPLAY: options.display,
      WINIT_UNIX_BACKEND: "x11",
      TN_BENCH_BEVY_ADAPTER_SHA256: identity.adapter,
      TN_BENCH_BEVY_BINARY: identity.binary,
      TN_BENCH_BEVY_FEATURES: "bevy default (pbr, render, winit, x11)",
      TN_BENCH_BEVY_UPSTREAM_SHA256: identity.upstream,
    },
    timeoutMs: 900_000,
  })) as Record<string, unknown>;
  return { fixture, report };
}

export async function runTnCubesDesktop(
  repoRoot: string,
  options: ICubesOptions,
  fixture: string,
): Promise<Record<string, unknown>> {
  const example = path.join(repoRoot, "examples/engine-load-test");
  const authoring = options.authoring ?? "default";
  await mkdir(path.join(example, "dist"), { recursive: true });
  const buildEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    TN_BENCH_PLATFORM: "desktop",
    TN_BENCH_TARGET: "native-cubes",
    TN_CUBES_AUTHORING: authoring,
    TN_CUBES_FIXTURE: fixture,
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["vite", "build"], {
      cwd: example,
      env: buildEnvironment,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`TN_BENCH_CUBES_BUILD_FAILED: exit ${code}`)),
    );
  });
  const binary = path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral");
  const bundle = path.join(example, "dist/engine-load-test-cubes-desktop.js");
  const hostArgs = ["run", bundle];
  if (process.env.TN_BENCH_VSYNC !== "on") hostArgs.push("--no-vsync");
  return (await runCapturing(binary, hostArgs, {
    cwd: repoRoot,
    env: { ...x11Environment(), DISPLAY: options.display },
    timeoutMs: 900_000,
  })) as Record<string, unknown>;
}
