import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { type IResolvedThreeNativeConfig, loadConfig } from "./config.js";

export type BuildTarget = "android" | "desktop" | "ios" | "web";
type NativeBuildTarget = Exclude<BuildTarget, "web">;
export type NativeOrientation = IResolvedThreeNativeConfig["display"]["orientation"];

export interface IBuildOptions {
  cwd?: string;
  target: BuildTarget;
  viteArgs?: readonly string[];
}

const TARGETS: readonly BuildTarget[] = ["web", "desktop", "android", "ios"];
function projectRequire(cwd: string): NodeJS.Require {
  return createRequire(path.join(cwd, "package.json"));
}

function packageRoot(cwd: string, packageName: string): string {
  try {
    return path.dirname(projectRequire(cwd).resolve(`${packageName}/package.json`));
  } catch {
    throw new Error(
      `Cannot build a native target because '${packageName}' is not installed in ${cwd}.`,
    );
  }
}

function executable(cwd: string, name: string): string {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(cwd, "node_modules", ".bin", `${name}${suffix}`);
}

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function projectName(cwd: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as {
    name?: string;
  };
  const name = manifest.name?.replace(/^@[^/]+\//u, "").replace(/[^a-zA-Z0-9._-]/gu, "-");
  if (name === undefined || name.length === 0) throw new Error("package.json must name the game.");
  return name;
}

export async function assertNativeBundleCompatible(
  bundle: string,
  target: NativeBuildTarget,
): Promise<void> {
  const source = await readFile(bundle, "utf8");
  const webOnlyUi = [
    ["React DOM", /\breact-dom(?:\/client)?\b|\bcreateRoot\s*\(/u],
    ["document.getElementById", /\bdocument\.getElementById\s*\(/u],
  ].filter(([, pattern]) => (pattern as RegExp).test(source));
  if (webOnlyUi.length > 0) {
    throw new Error(
      `TN_NATIVE_WEB_ONLY_UI: ${target} bundle contains ${webOnlyUi.map(([label]) => label).join(", ")}. Keep the portable game in src/game.ts and move DOM or React mounting to src/main.ts; native UI is owned by PRD-051.`,
    );
  }
  if (target === "desktop") return;
  const wasm = [
    ["WebAssembly", /\bWebAssembly\b/u],
    ["Rapier WASM", /rapier_wasm|RAPIER_VERSION|rawrapier/u],
    ["Recast WASM", /recast-navigation\.wasm|recastnavigationwasm/u],
  ].filter(([, pattern]) => (pattern as RegExp).test(source));
  if (wasm.length === 0) return;
  throw new Error(
    `TN_NATIVE_WASM_ON_MOBILE: ${target} bundle contains ${wasm.map(([label]) => label).join(", ")}. Move web-only WASM imports out of src/game.ts or provide a threenative-native conditional backend; mobile navigation is owned by PRD-052.`,
  );
}

export async function buildWeb(cwd: string, viteArgs: readonly string[] = []): Promise<void> {
  await loadConfig(cwd);
  await run(executable(cwd, "vite"), ["build", ...viteArgs], cwd);
}

async function nativeEntry(cwd: string, config?: IResolvedThreeNativeConfig): Promise<string> {
  const relative = (config ?? (await loadConfig(cwd))).nativeEntry;
  const entry = path.resolve(cwd, relative);
  try {
    if (!(await stat(entry)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`TN_NATIVE_ENTRY_MISSING: ${relative} does not exist.`);
  }
  return entry;
}

export async function nativeOrientation(cwd: string): Promise<NativeOrientation> {
  return (await loadConfig(cwd)).display.orientation;
}

async function writePackagingConfig(
  cwd: string,
  config: IResolvedThreeNativeConfig,
): Promise<string> {
  const directory = path.join(cwd, ".threenative", "build");
  await mkdir(directory, { recursive: true });
  const artifact = {
    ...config,
    app: {
      ...config.app,
      ...(config.app.icon === undefined ? {} : { icon: path.resolve(cwd, config.app.icon) }),
    },
  };
  const output = path.join(directory, "config.json");
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  return output;
}

async function bundleNative(
  cwd: string,
  runtimeRoot: string,
  entry: string,
  target: NativeBuildTarget,
): Promise<string> {
  const output = path.join(cwd, ".threenative", "build", "game.js");
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "bundle.mjs"),
      "--project",
      cwd,
      "--entry",
      entry,
      "--target",
      target,
      "--output",
      output,
    ],
    cwd,
  );
  return output;
}

function installedRuntime(runtimeRoot: string): string {
  if (process.env.THREENATIVE_RUNTIME_BINARY)
    return path.resolve(process.env.THREENATIVE_RUNTIME_BINARY);
  const key = `${process.platform}-${process.arch}`;
  const filename = process.platform === "win32" ? "threenative-runtime.exe" : "threenative-runtime";
  return path.join(runtimeRoot, "prebuilt", key, filename);
}

async function buildNative(target: NativeBuildTarget, cwd: string): Promise<void> {
  const config = await loadConfig(cwd);
  const entry = await nativeEntry(cwd, config);
  const orientation = config.display.orientation;
  const configPath = await writePackagingConfig(cwd, config);
  const runtimeRoot = packageRoot(cwd, "@threenative/runtime-native");
  const bundle = await bundleNative(cwd, runtimeRoot, entry, target);
  await assertNativeBundleCompatible(bundle, target);
  const assets = path.join(cwd, "public");
  if (target === "ios") {
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.app`);
    await run(
      process.execPath,
      [
        path.join(runtimeRoot, "scripts", "package-ios.mjs"),
        "--bundle",
        bundle,
        "--assets",
        assets,
        "--orientation",
        orientation,
        "--config",
        configPath,
        "--output",
        output,
      ],
      runtimeRoot,
    );
    return;
  }
  if (target === "android") {
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.apk`);
    await run(
      process.execPath,
      [
        path.join(runtimeRoot, "scripts", "package-android.mjs"),
        "--bundle",
        bundle,
        "--assets",
        assets,
        "--orientation",
        orientation,
        "--config",
        configPath,
        "--output",
        output,
      ],
      runtimeRoot,
    );
    return;
  }
  const output = path.join(cwd, "dist-native", await projectName(cwd));
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "package-desktop.mjs"),
      "--bundle",
      bundle,
      "--assets",
      assets,
      "--config",
      configPath,
      "--runtime",
      installedRuntime(runtimeRoot),
      "--output",
      output,
    ],
    cwd,
  );
}

export async function build(options: IBuildOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.target === "web") await buildWeb(cwd, options.viteArgs);
  else {
    if ((options.viteArgs?.length ?? 0) > 0) {
      throw new Error(
        `${options.target} build does not accept ${options.viteArgs?.join(" ")}. iOS output is simulator-only; device signing remains OPEN.`,
      );
    }
    await buildNative(options.target, cwd);
  }
}

export function buildHelp(): string {
  return `${[
    "Usage: threenative build [--target web|desktop|android|ios]",
    "",
    "Options:",
    "  --target <target>  Choose web, desktop, android, or ios (default: web).",
    "  --help             Show this help.",
  ].join("\n")}\n`;
}

export function parseBuildArgs(argv: readonly string[]): IBuildOptions {
  if (argv[0] !== "build") {
    throw new Error("Usage: threenative build [--target web|desktop|android|ios]");
  }
  const targetIndex = argv.indexOf("--target");
  const value = targetIndex === -1 ? "web" : argv[targetIndex + 1];
  if (!TARGETS.includes(value as BuildTarget)) {
    throw new Error(`Unknown build target '${value ?? ""}'. Choose ${TARGETS.join(", ")}.`);
  }
  const consumed = new Set([0]);
  if (targetIndex !== -1) {
    consumed.add(targetIndex);
    consumed.add(targetIndex + 1);
  }
  return {
    target: value as BuildTarget,
    viteArgs: argv.filter((_, index) => !consumed.has(index)),
  };
}
