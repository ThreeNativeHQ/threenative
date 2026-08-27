import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));

export function desktopPreset() {
  if (process.platform === "darwin") return "tn-macos";
  if (process.platform === "win32") return "tn-windows";
  return "tn-linux";
}

export function desktopBuildDirectory(suffix = "") {
  const name = suffix === "" ? desktopPreset() : `${desktopPreset()}-${suffix}`;
  return join(runtimeRoot, "build", name);
}

export function resolveCmake() {
  const windows = process.platform === "win32";
  const venvCmake = join(
    runtimeRoot,
    ".runtime",
    "tools-venv",
    windows ? "Scripts" : "bin",
    windows ? "cmake.exe" : "cmake",
  );
  const cmake =
    spawnSync("cmake", ["--version"], { stdio: "ignore" }).status === 0 ? "cmake" : venvCmake;
  if (cmake === venvCmake && !existsSync(venvCmake)) {
    throw new Error("cmake was not found on PATH or in .runtime/tools-venv; run pnpm native:build");
  }
  return cmake;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? runtimeRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 120_000,
  });
  if (result.error) throw result.error;
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}:\n${log}`);
  return log;
}

export function buildNativeTarget(cmake, buildDirectory, target, timeout = 1_800_000) {
  return run(cmake, ["--build", buildDirectory, "--target", target, "--parallel"], { timeout });
}

export function nativeTestExecutable(buildDirectory, target) {
  return join(buildDirectory, process.platform === "win32" ? `${target}.exe` : target);
}

function configureVerificationBuild(cmake, suffix, cacheVariables) {
  const buildDirectory = desktopBuildDirectory(suffix);
  const shippingCache = join(desktopBuildDirectory(), "CMakeCache.txt");
  if (!existsSync(shippingCache)) {
    throw new Error(`${shippingCache} does not exist; run pnpm native:build`);
  }
  const cache = readFileSync(shippingCache, "utf8");
  const cached = (name) => {
    const match = cache.match(new RegExp(`^${name}:[^=]*=(.*)$`, "mu"));
    if (match?.[1] === undefined || match[1] === "") {
      throw new Error(`${name} is not set in ${shippingCache}; run pnpm native:build`);
    }
    return match[1];
  };
  const windows = process.platform === "win32";
  const localNinja = join(
    runtimeRoot,
    ".runtime",
    "tools-venv",
    windows ? "Scripts" : "bin",
    windows ? "ninja.exe" : "ninja",
  );
  const ninja = existsSync(localNinja) ? localNinja : cached("CMAKE_MAKE_PROGRAM");
  run(
    cmake,
    [
      "--preset",
      desktopPreset(),
      "-B",
      buildDirectory,
      `-DCMAKE_MAKE_PROGRAM=${ninja}`,
      `-DCMAKE_C_COMPILER=${cached("CMAKE_C_COMPILER")}`,
      `-DCMAKE_CXX_COMPILER=${cached("CMAKE_CXX_COMPILER")}`,
      ...cacheVariables.map(([name, value]) => `-D${name}=${value}`),
    ],
    { timeout: 900_000 },
  );
  return buildDirectory;
}

export function configureVideoVerificationBuild(cmake) {
  return configureVerificationBuild(cmake, "contracts-video", [["TN_ENABLE_VIDEO", "ON"]]);
}

export function configurePhysicsVerificationBuild(cmake) {
  run(process.execPath, [join(runtimeRoot, "scripts", "build-native-physics.mjs"), "--desktop"], {
    timeout: 1_800_000,
  });
  const rustVersion = run("rustc", ["-vV"]);
  const host = /^host:\s*(\S+)$/mu.exec(rustVersion)?.[1];
  if (!host) throw new Error("rustc -vV did not report a host target for desktop physics");
  const libraryName =
    process.platform === "win32"
      ? "threenative_native_physics.lib"
      : "libthreenative_native_physics.a";
  const library = join(runtimeRoot, ".runtime", "physics-target", host, "release", libraryName);
  if (!existsSync(library)) {
    throw new Error(`desktop native physics build did not produce ${library}`);
  }
  return configureVerificationBuild(cmake, "contracts-physics", [
    ["THREENATIVE_PHYSICS_LIBRARY", library],
    ["TN_ENABLE_NATIVE_PHYSICS", "ON"],
  ]);
}
