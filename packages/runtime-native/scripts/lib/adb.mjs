import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  if (options.executable) return options.executable;
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

export function buildAdbInvocation(serial, args, environment = process.env, options = {}) {
  const selectedSerial = serial || environment.THREENATIVE_ADB_SERIAL;
  if (typeof selectedSerial !== "string" || selectedSerial.length === 0) {
    if (options.allowDefaultTransport === true) {
      return { executable: resolveAdbExecutable(environment, options), args: [...args], serial: undefined };
    }
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
    executable: resolveAdbExecutable(environment, options),
    args: ["-s", selectedSerial, ...args],
    serial: selectedSerial,
  };
}

function commandOptions(options, environment) {
  return {
    allowFailure: options.allowFailure,
    binary: options.binary,
    cwd: options.cwd,
    encoding: options.binary ? null : "utf8",
    env: environment,
    maxBuffer: options.maxBuffer ?? DEFAULT_ADB_MAX_BUFFER,
    timeout: options.timeoutMs ?? DEFAULT_ADB_TIMEOUT_MS,
  };
}

function commandResult(result, invocation, options, fallbackStatus) {
  const rawStatus = fallbackStatus === undefined ? result.status : (result.status ?? fallbackStatus);
  return {
    error: result.error,
    invocation,
    rawStatus,
    status: rawStatus ?? 1,
    stderr: options.binary ? result.stderr : String(result.stderr ?? ""),
    stdout: options.binary ? result.stdout : String(result.stdout ?? ""),
  };
}

function commandError(args, result) {
  const rawDetail = String(result.stderr || result.stdout || result.error?.message || "");
  return new AdbCommandError({
    args,
    detail: rawDetail.trim() || "unknown adb error",
    exitCode: result.rawStatus ?? 2,
    rawDetail,
    serial: result.invocation.serial,
    spawnFailed: Boolean(result.error && result.rawStatus == null),
  });
}

function commandOverrides(overrides) {
  return typeof overrides === "number" ? { timeoutMs: overrides } : overrides;
}

export function runAdbResult(serial, args, options = {}) {
  const environment = options.environment ?? process.env;
  const invocation = buildAdbInvocation(serial, args, environment, options);
  const executionOptions = commandOptions(options, environment);
  const result = options.commandImpl
    ? options.commandImpl(invocation.executable, invocation.args, executionOptions)
    : (options.spawnSyncImpl ?? spawnSync)(invocation.executable, invocation.args, executionOptions);
  return commandResult(result, invocation, options);
}

export function runAdb(serial, args, options = {}) {
  const result = runAdbResult(serial, args, options);
  if (result.error || result.status !== 0) {
    const error = commandError(args, result);
    throw options.mapError ? options.mapError(error) : error;
  }
  return String(result.stdout ?? "");
}

export async function runAdbResultAsync(serial, args, options = {}) {
  const environment = options.environment ?? process.env;
  const invocation = buildAdbInvocation(serial, args, environment, options);
  const executionOptions = commandOptions(options, environment);
  try {
    const result = options.commandImpl
      ? await options.commandImpl(invocation.executable, invocation.args, executionOptions)
      : await execFileAsync(invocation.executable, invocation.args, executionOptions);
    return commandResult(result, invocation, options, 0);
  } catch (error) {
    const status = typeof error?.code === "number" ? error.code : 2;
    return commandResult({ ...error, error, status }, invocation, options, status);
  }
}

export function createAdbClient(serial, options = {}) {
  return {
    async asyncResult(args, overrides = {}) {
      return await runAdbResultAsync(serial, args, { ...options, ...overrides });
    },
    async asyncRun(args, overrides = {}) {
      const result = await runAdbResultAsync(serial, args, { ...options, ...overrides });
      if (result.error || result.status !== 0) throw commandError(args, result);
      return result.stdout;
    },
    command(args, overrides = {}) {
      const result = runAdbResult(serial, args, { ...options, ...commandOverrides(overrides) });
      if (result.error) throw options.mapSpawnError?.(result.error) ?? result.error;
      return String(result.stdout ?? "");
    },
    executable: resolveAdbExecutable(options.environment ?? process.env, options),
    result(args, overrides = {}) {
      return runAdbResult(serial, args, { ...options, ...commandOverrides(overrides) });
    },
    run(args, overrides = {}) {
      return runAdb(serial, args, { ...options, ...overrides });
    },
    serial,
  };
}

export function createResolvedAdbClient(serial, environment, options = {}) {
  const executable = resolveAdbExecutable(environment, options);
  if (!executable) throw options.missingError();
  return createAdbClient(serial, { ...options, environment, executable });
}
