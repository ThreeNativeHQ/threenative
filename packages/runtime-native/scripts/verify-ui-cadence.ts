import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { provideDisplay } from "../../playtest/src/runner/captureEnvironment.js";
import { stopManagedServer } from "../../playtest/src/runner/server.js";
import { resolveContainer } from "./desktop-distribution.mjs";
import { analyzeUiCadence, decodeUiSequence } from "./ui-cadence.mjs";
import { captureAndroidUiCadence } from "./verify-android-ui-cadence.js";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    runtime: { type: "string" },
    executable: { type: "string" },
    artifacts: { type: "string" },
    target: { type: "string", default: "desktop" },
    apk: { type: "string" },
    device: { type: "string" },
    "allow-source-build": { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(`pnpm native:verify:ui --project <installed game> --runtime <host> [--artifacts <empty directory>]
pnpm native:verify:ui --target android --project <installed game> --device <serial> [--allow-source-build]
pnpm native:verify:ui --executable <packaged desktop fixture>
pnpm native:verify:ui --target android --apk <packaged fixture.apk> --device <serial>
Android builds use the existing release signing environment. Desktop capture currently requires Linux/X11.`);
  process.exit(0);
}
const target = values.target;
if (target !== "desktop" && target !== "android")
  throw new Error("TN_UI_CADENCE_TARGET: choose desktop or android.");
if (target === "desktop" && process.platform !== "linux")
  throw new Error(
    "TN_UI_CADENCE_HOST: desktop capture requires Linux/X11; other desktop presentation is unverified.",
  );
if (
  (target === "desktop" && (values.apk || values.device || values["allow-source-build"])) ||
  (target === "android" && (values.executable || values.runtime))
)
  throw new Error(
    "TN_UI_CADENCE_INPUT: --apk, --device and --allow-source-build are Android options; --executable and --runtime are desktop options.",
  );
const root = resolve(values.artifacts ?? `artifacts/ui-cadence/${Date.now()}`);
if (existsSync(root) && readdirSync(root).length !== 0)
  throw new Error(
    `TN_UI_CADENCE_ARTIFACTS: choose an empty directory; preserving prior evidence at ${root}`,
  );
mkdirSync(root, { recursive: true });
let entry: string;
let probeDirectory: string | undefined;
const selected = values.apk ?? values.executable;
if (selected) {
  if (values.project || values.runtime || values["allow-source-build"])
    throw new Error("Choose a packaged fixture or --project, not both.");
  entry = resolve(selected);
  if (target === "android") {
    const retained = join(root, "ui-cadence.apk");
    copyFileSync(entry, retained);
    entry = retained;
  } else {
    const container = dirname(entry);
    const manifest = resolveContainer(container);
    if (!manifest.ui || resolve(container, manifest.executable) !== entry)
      throw new Error(
        "TN_UI_CADENCE_INPUT: executable must be the packaged cadence fixture with WebUI.",
      );
  }
} else {
  if (!values.project || (target === "desktop" && !values.runtime))
    throw new Error(
      "Pass --project <installed game> (--runtime <host> on desktop), or a packaged --executable/--apk fixture. See --help.",
    );
  const project = resolve(values.project);
  const runtime = values.runtime ? resolve(values.runtime) : undefined;
  const cli = join(project, "node_modules/create-threenative/dist/threenative.js");
  if (!existsSync(cli) || (runtime && !existsSync(runtime)))
    throw new Error(
      "TN_UI_CADENCE_INPUT: installed ThreeNative CLI and selected native host are required.",
    );
  // A child project resolves the installed game's dependencies; it never edits its source/config.
  const scratch = join(project, ".threenative/ui-cadence");
  mkdirSync(scratch, { recursive: true });
  const probe = mkdtempSync(join(scratch, "probe-"));
  probeDirectory = probe;
  mkdirSync(join(probe, "src/ui"), { recursive: true });
  const fixture = fileURLToPath(new URL("../tests/fixtures/ui-cadence/", import.meta.url));
  copyFileSync(join(fixture, "game.ts"), join(probe, "src/game.ts"));
  copyFileSync(join(fixture, "main.tsx"), join(probe, "src/ui/main.tsx"));
  writeFileSync(
    join(probe, "package.json"),
    JSON.stringify({ name: "ui-cadence", version: "1.0.0", type: "module" }),
  );
  writeFileSync(
    join(probe, "vite.config.ts"),
    "import react from '@vitejs/plugin-react'; export default { plugins: [react()] };\n",
  );
  writeFileSync(
    join(probe, "threenative.config.ts"),
    `export default { app: {id: 'com.threenative.uicadence', name: 'ui-cadence'}, display: {maxFps: 60, fullscreen: ${target === "android"}, orientation: 'landscape'}, window: {title: 'ui-cadence', width: 640, height: 360} };\n`,
  );
  console.log(`TN_UI_CADENCE_PROJECT: ${probe}`);
  const built = spawnSync(
    process.execPath,
    [
      cli,
      "build",
      "--target",
      target,
      "--mode",
      "release",
      ...(target === "android" ? ["--format", "apk"] : []),
      ...(values["allow-source-build"] ? ["--allow-source-build"] : []),
    ],
    {
      cwd: probe,
      env: { ...process.env, ...(runtime ? { THREENATIVE_RUNTIME_BINARY: runtime } : {}) },
      stdio: "inherit",
      timeout: target === "android" ? 1_800_000 : 180_000,
    },
  );
  if (built.error || built.status !== 0)
    throw new Error(`TN_UI_CADENCE_BUILD: ${built.error?.message ?? built.status}`);
  const archives = readdirSync(join(probe, "dist-native")).filter((name) =>
    name.endsWith(target === "android" ? ".apk" : ".tar.gz"),
  );
  const archiveName = archives[0];
  if (archives.length !== 1 || archiveName === undefined)
    throw new Error("TN_UI_CADENCE_ARCHIVE: expected one final release artifact.");
  const archive = join(root, archiveName);
  copyFileSync(join(probe, "dist-native", archiveName), archive);
  let manifest: ReturnType<typeof resolveContainer> | undefined;
  if (target === "android") entry = archive;
  else {
    const distribution = await import(
      pathToFileURL(
        join(project, "node_modules/@threenative/runtime-native/scripts/desktop-distribution.mjs"),
      ).href
    );
    const relocated = join(root, "relocated game");
    distribution.extractContainer(archive, relocated);
    const container = join(relocated, distribution.locateContainerRoot(relocated));
    manifest = distribution.resolveContainer(container);
    if (!manifest.ui)
      throw new Error("TN_UI_CADENCE_UI: default WebUI is absent from the final container.");
    entry = join(container, manifest.executable);
  }
  writeFileSync(
    join(root, "build.json"),
    JSON.stringify({
      target,
      project,
      probe,
      runtime,
      runtimeSha256: runtime
        ? createHash("sha256").update(readFileSync(runtime)).digest("hex")
        : undefined,
      archive,
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      manifest,
    }),
  );
}
const report =
  target === "android"
    ? await captureAndroidUiCadence(entry, root, values.device)
    : await captureLinuxUiCadence(entry, root);
if (probeDirectory) rmSync(probeDirectory, { recursive: true });
writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2));
console.log(
  `TN_UI_CADENCE_PASS: ${JSON.stringify({ artifacts: root, p95Ms: report.p95Ms, sourceHz: report.sourceHz, visibleHz: report.visibleHz, idleResumes: report.idleResumes })}`,
);

async function captureLinuxUiCadence(executable: string, root: string) {
  if (!existsSync(executable))
    throw new Error(`TN_UI_CADENCE_INPUT: missing executable ${executable}`);
  const display = await provideDisplay({
    env: {
      ...process.env,
      DISPLAY: undefined,
      TN_PLAYTEST_HOST_DISPLAY: "0",
      TN_XVFB_SCREEN: "640x360x24",
    },
  });
  const states: { sequence: number; at: number }[] = [];
  const captures: { sequence: number; at: number; valid: boolean }[] = [];
  let host: ChildProcess | undefined;
  let capture: ChildProcess | undefined;
  let failure: Error | undefined;
  const interrupted = () => {
    failure = new Error("TN_UI_CADENCE_INTERRUPTED: capture cancelled.");
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  let log = "";
  let captureLog = "";
  let pending = Buffer.alloc(0);
  const check = () => {
    if (failure) throw failure;
    if (host && (host.exitCode !== null || host.signalCode !== null))
      throw new Error(`TN_UI_CADENCE_HOST_EXITED: ${host.exitCode ?? host.signalCode}`);
    if (capture && (capture.exitCode !== null || capture.signalCode !== null))
      throw new Error(`TN_UI_CADENCE_CAPTURE_EXITED: ${captureLog}`);
  };
  try {
    host = spawn(executable, ["--windowed"], {
      cwd: root,
      env: { ...display.env, SDL_VIDEODRIVER: "x11", GDK_BACKEND: "x11" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    host.once("error", (error) => {
      failure = error;
    });
    if (!host.stdout || !host.stderr)
      throw new Error("TN_UI_CADENCE_CAPTURE: missing host console pipes");
    for (const stream of [host.stdout, host.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        log += `${line}\n`;
        const at = line.indexOf("TN_UI_SAMPLE:");
        if (at < 0) return;
        try {
          states.push(JSON.parse(line.slice(at + 13)));
        } catch {
          failure = new Error(`TN_UI_CADENCE_STATE: malformed sample ${line}`);
        }
      });
    }
    const deadline = Date.now() + 30_000;
    while (states.length < 120 || !log.includes('TN_UI_OVERLAY:{"attached":true}')) {
      check();
      if (Date.now() > deadline)
        throw new Error(
          "TN_UI_CADENCE_STARTUP: no live cadence fixture with an attached WebUI in 30 seconds.",
        );
      await delay(20);
    }
    capture = spawn(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-draw_mouse",
        "0",
        "-framerate",
        "240",
        "-video_size",
        "160x24",
        "-i",
        `${display.display}+16,16`,
        "-vf",
        "format=rgb24",
        "-fps_mode",
        "passthrough",
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "-flush_packets",
        "1",
        "pipe:1",
      ],
      { env: display.env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    capture.once("error", (error) => {
      failure = error;
    });
    if (!capture.stdout || !capture.stderr)
      throw new Error("TN_UI_CADENCE_CAPTURE: missing capture pipes");
    capture.stderr.on("data", (chunk) => {
      captureLog += chunk;
    });
    capture.stdout.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 160 * 24 * 3) {
        const frame = pending.subarray(0, 160 * 24 * 3);
        pending = pending.subarray(frame.length);
        captures.push({ at: Date.now(), ...decodeUiSequence(frame) });
      }
    });
    const until = Date.now() + 27_000;
    while (Date.now() < until) {
      check();
      await delay(20);
    }
    check();
    await stopManagedServer(capture);
    capture = undefined;
    const screenshot = spawnSync(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-video_size",
        "640x360",
        "-i",
        String(display.display),
        "-frames:v",
        "1",
        "-y",
        join(root, "visible.png"),
      ],
      { env: display.env, encoding: "utf8", timeout: 10_000 },
    );
    if (screenshot.error || screenshot.status !== 0)
      throw new Error(
        `TN_UI_CADENCE_SCREENSHOT: ${screenshot.error?.message ?? screenshot.stderr}`,
      );
  } finally {
    await stopManagedServer(capture);
    await stopManagedServer(host);
    await display.release();
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    writeFileSync(join(root, "console.log"), log);
    writeFileSync(join(root, "capture.log"), captureLog);
    writeFileSync(join(root, "samples.json"), JSON.stringify({ states, captures }));
  }
  if (failure) throw failure;
  return {
    executable,
    executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
    measurement:
      "OS-visible exact React state IDs; capture delay included; 1000 ms capture warm-up",
    backend: "Linux X11 / ffmpeg 240 Hz",
    adapter: log.match(/\[WebGPU\] Adapter: (.+)/u)?.[1] ?? "unreported",
    ...analyzeUiCadence({ states, captures }),
  };
}
