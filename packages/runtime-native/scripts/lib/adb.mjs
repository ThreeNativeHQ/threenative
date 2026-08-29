import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ADB_TIMEOUT_MS = 120_000;
export const DEFAULT_ADB_MAX_BUFFER = 8 * 1024 * 1024;

export class AdbCommandError extends Error {
  constructor({ args, detail, exitCode, rawDetail = detail, serial, spawnFailed = false }) {
    const commandArgs = Array.isArray(args) ? args : [];
    super(`adb ${commandArgs.join(" ")} failed: ${detail}`);
    this.name = "AdbCommandError";
    this.args = [...commandArgs];
    this.detail = detail;
    this.exitCode = exitCode;
    this.rawDetail = rawDetail;
    this.serial = serial;
    this.spawnFailed = spawnFailed;
  }
}

export function resolveAdbExecutable(environment = process.env, options = {}) {
  if (environment.THREENATIVE_ADB) return environment.THREENATIVE_ADB;
  const sdkEnvironmentKeys = options.sdkEnvironmentKeys ?? [
    "THREENATIVE_ANDROID_SDK",
    "ANDROID_SDK_ROOT",
    "ANDROID_HOME",
  ];
  const configuredSdk = sdkEnvironmentKeys
    .map((key) => environment[key])
    .find((value) => typeof value === "string" && value.length > 0);
  const sdk = configuredSdk ?? options.defaultSdkRoot ?? join(homedir(), "Android", "Sdk");
  const candidate = join(
    sdk,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
  if ((options.existsSyncImpl ?? existsSync)(candidate)) return candidate;
  return options.allowPathFallback === false ? undefined : "adb";
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
    const rawDetail = String(result.stderr || result.stdout || result.error?.message || "");
    const detail = rawDetail.trim() || "unknown adb error";
    const error = new AdbCommandError({
      args,
      detail,
      exitCode: result.status ?? 2,
      rawDetail,
      serial: invocation.serial,
      spawnFailed: Boolean(result.error && result.status == null),
    });
    throw options.mapError ? options.mapError(error) : error;
  }
  return String(result.stdout ?? "");
}

export function createAdbClient(serial, options = {}) {
  return {
    run(args, overrides = {}) {
      return runAdb(serial, args, { ...options, ...overrides });
    },
    serial,
  };
}
