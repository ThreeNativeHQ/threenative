import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export type BuildTarget = "android" | "desktop" | "ios" | "web";

export interface BuildOptions {
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

export async function assertMobileBundleCompatible(bundle: string): Promise<void> {
  const source = await readFile(bundle, "utf8");
  const incompatible = [
    ["WebAssembly", /\bWebAssembly\b/u],
    ["Rapier WASM", /rapier_wasm|RAPIER_VERSION|rawrapier/u],
    ["Recast WASM", /recast-navigation\.wasm|recastnavigationwasm/u],
  ].filter(([, pattern]) => (pattern as RegExp).test(source));
  if (incompatible.length === 0) return;
  throw new Error(
    `Mobile target rejected: native bundle contains ${incompatible.map(([label]) => label).join(", ")}. Use a threenative-native conditional backend; Android QuickJS and iOS JSC cannot execute these WASM paths.`,
  );
}

export async function buildWeb(cwd: string, viteArgs: readonly string[] = []): Promise<void> {
  await run(executable(cwd, "vite"), ["build", ...viteArgs], cwd);
}

async function bundleNative(cwd: string, runtimeRoot: string): Promise<string> {
  const output = path.join(cwd, ".threenative", "build", "game.js");
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "bundle.mjs"),
      "--project",
      cwd,
      "--entry",
      "src/main.ts",
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

async function buildNative(target: Exclude<BuildTarget, "web">, cwd: string): Promise<void> {
  const runtimeRoot = packageRoot(cwd, "@threenative/runtime-native");
  const bundle = await bundleNative(cwd, runtimeRoot);
  if (target === "ios") {
    await assertMobileBundleCompatible(bundle);
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.app`);
    await run(
      process.execPath,
      [
        path.join(runtimeRoot, "scripts", "package-ios.mjs"),
        "--bundle",
        bundle,
        "--output",
        output,
      ],
      runtimeRoot,
    );
    return;
  }
  if (target === "android") {
    await assertMobileBundleCompatible(bundle);
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.apk`);
    await run(
      process.execPath,
      [
        path.join(runtimeRoot, "scripts", "package-android.mjs"),
        "--bundle",
        bundle,
        "--output",
        output,
      ],
      runtimeRoot,
    );
    return;
  }
  const output = path.join(cwd, "dist-native", await projectName(cwd));
  const assets = path.join(cwd, "public");
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "package-desktop.mjs"),
      "--bundle",
      bundle,
      "--assets",
      assets,
      "--runtime",
      installedRuntime(runtimeRoot),
      "--output",
      output,
    ],
    cwd,
  );
}

export async function build(options: BuildOptions): Promise<void> {
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

export function parseBuildArgs(argv: readonly string[]): BuildOptions {
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
