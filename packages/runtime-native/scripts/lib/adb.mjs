import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ADB_TIMEOUT_MS = 120_000;
export const DEFAULT_ADB_MAX_BUFFER = 8 * 1024 * 1024;

export class AdbCommandError extends Error {
  constructor({ args, detail, exitCode, serial }) {
    const commandArgs = Array.isArray(args) ? args : [];
    super(`adb ${commandArgs.join(" ")} failed: ${detail}`);
    this.name = "AdbCommandError";
    this.args = [...commandArgs];
    this.detail = detail;
    this.exitCode = exitCode;
    this.serial = serial;
  }
}

export function resolveAdbExecutable(environment = process.env) {
  if (environment.THREENATIVE_ADB) return environment.THREENATIVE_ADB;
  const sdk =
    environment.THREENATIVE_ANDROID_SDK ??
    environment.ANDROID_SDK_ROOT ??
    environment.ANDROID_HOME ??
    join(homedir(), "Android", "Sdk");
  const candidate = join(
    sdk,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
  return existsSync(candidate) ? candidate : "adb";
}

export function buildAdbInvocation(serial, args, environment = process.env) {
  const selectedSerial = serial || environment.THREENATIVE_ADB_SERIAL;
  if (typeof selectedSerial !== "string" || selectedSerial.length === 0) {
    throw new AdbCommandError({
      args,
      detail: "a device serial or THREENATIVE_ADB_SERIAL is required",
      exitCode: 2,
      serial: selectedSerial,
    });
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new AdbCommandError({
      args: Array.isArray(args) ? args : [],
      detail: "command arguments must be an array of strings",
      exitCode: 2,
      serial: selectedSerial,
    });
  }
  return {
    executable: resolveAdbExecutable(environment),
    args: ["-s", selectedSerial, ...args],
    serial: selectedSerial,
  };
}

export function runAdb(serial, args, options = {}) {
  const environment = options.environment ?? process.env;
  const invocation = buildAdbInvocation(serial, args, environment);
  const result = (options.spawnSyncImpl ?? spawnSync)(invocation.executable, invocation.args, {
    encoding: "utf8",
    env: environment,
    maxBuffer: options.maxBuffer ?? DEFAULT_ADB_MAX_BUFFER,
    timeout: options.timeoutMs ?? DEFAULT_ADB_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    const detail = String(
      result.stderr || result.stdout || result.error?.message || "unknown adb error",
    ).trim();
    const error = new AdbCommandError({
      args,
      detail,
      exitCode: result.status ?? 2,
      serial: invocation.serial,
    });
    throw options.mapError ? options.mapError(error) : error;
  }
  return String(result.stdout ?? "");
}
