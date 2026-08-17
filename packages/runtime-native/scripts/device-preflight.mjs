import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const MINIMUM_BATTERY_PERCENT = 50;

const THERMAL_STATUS_CODES = {
  NONE: 0,
  LIGHT: 1,
  MODERATE: 2,
  SEVERE: 3,
  CRITICAL: 4,
  EMERGENCY: 5,
  SHUTDOWN: 6,
};

export class DevicePreflightError extends Error {
  constructor(code, detail, details = {}) {
    super(`${code}: ${detail}`);
    this.name = code;
    this.code = code;
    this.details = details;
    this.exitCode = 2;
  }
}

function parseBoolean(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new DevicePreflightError(
    `TN_DEVICE_PREFLIGHT_${label.toUpperCase()}_PARSE`,
    `expected true or false, received ${value}`,
    { condition: label, observed: value },
  );
}

export function parseBatteryState(output) {
  const source = String(output);
  const levelMatch = /^\s*level:\s*(\d+)\s*$/imu.exec(source);
  if (!levelMatch) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_BATTERY_PARSE",
      "dumpsys battery has no numeric level",
      { condition: "battery", observed: source },
    );
  }
  const batteryPercent = Number(levelMatch[1]);
  if (!Number.isInteger(batteryPercent) || batteryPercent < 0 || batteryPercent > 100) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_BATTERY_PARSE",
      `battery level is outside 0..100: ${levelMatch[1]}`,
      { condition: "battery", observed: levelMatch[1] },
    );
  }

  const sources = [
    ["AC", /^\s*AC powered:\s*(true|false)\s*$/imu],
    ["USB", /^\s*USB powered:\s*(true|false)\s*$/imu],
    ["WIRELESS", /^\s*Wireless powered:\s*(true|false)\s*$/imu],
  ];
  const poweredBy = sources.map(([name, pattern]) => {
    const match = pattern.exec(source);
    return match ? { name, powered: parseBoolean(match[1].toLowerCase(), "charging") } : null;
  });
  const presentSources = poweredBy.filter(Boolean);
  const statusMatch = /^\s*status:\s*(\d+)\s*$/imu.exec(source);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  if (presentSources.length !== sources.length && status === null) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_CHARGING_PARSE",
      "dumpsys battery has incomplete charging sources and no status",
      { condition: "charging", observed: source },
    );
  }

  const activeSource = poweredBy.find((entry) => entry?.powered === true)?.name;
  const charging = activeSource !== undefined || status === 2;
  return {
    batteryPercent,
    charging,
    chargingSource: activeSource ?? (status === 2 ? "STATUS" : "NONE"),
  };
}

function thermalStatusFromValue(value) {
  const normalized = String(value).trim().toUpperCase().replace(/^THERMAL_STATUS_/u, "");
  if (/^\d+$/u.test(normalized)) {
    const code = Number(normalized);
    const status = Object.entries(THERMAL_STATUS_CODES).find(([, candidate]) => candidate === code)?.[0];
    if (status !== undefined) return { code, status };
  }
  const code = THERMAL_STATUS_CODES[normalized];
  if (code !== undefined) return { code, status: normalized };
  throw new DevicePreflightError(
    "TN_DEVICE_PREFLIGHT_THERMAL_PARSE",
    `unrecognised thermal status: ${value}`,
    { condition: "thermal", observed: value },
  );
}

export function parseThermalState(output) {
  const source = String(output);
  const match =
    /(?:current\s+)?thermal\s+status\s*[:=]\s*([A-Za-z_]+|\d+)/iu.exec(source) ??
    /mThermalStatus\s*[:=]\s*([A-Za-z_]+|\d+)/iu.exec(source);
  if (!match) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_THERMAL_PARSE",
      "dumpsys thermalservice has no thermal status",
      { condition: "thermal", observed: source },
    );
  }
  const parsed = thermalStatusFromValue(match[1]);
  return { thermalStatus: parsed.status, thermalStatusCode: parsed.code };
}

export function parseScreenState(output) {
  const source = String(output);
  const screenMatch = /(?:^|\n)\s*(?:mScreenOn|screenOn)\s*[:=]\s*(true|false)\s*$/imu.exec(source);
  if (screenMatch) return { screenOn: parseBoolean(screenMatch[1].toLowerCase(), "screen") };

  const displayMatch = /display\s+power:\s*state\s*=\s*(ON|OFF)\b/iu.exec(source);
  if (displayMatch) return { screenOn: displayMatch[1].toUpperCase() === "ON" };

  const wakefulnessMatch = /mWakefulness(?:Raw)?\s*=\s*(Awake|Asleep|Dozing)\b/iu.exec(source);
  if (wakefulnessMatch) return { screenOn: wakefulnessMatch[1].toLowerCase() === "awake" };

  throw new DevicePreflightError(
    "TN_DEVICE_PREFLIGHT_SCREEN_PARSE",
    "dumpsys power has no recognised screen state",
    { condition: "screen", observed: source },
  );
}

function adbPath(environment = process.env) {
  if (environment.THREENATIVE_ADB) return environment.THREENATIVE_ADB;
  const sdk =
    environment.THREENATIVE_ANDROID_SDK ??
    environment.ANDROID_SDK_ROOT ??
    environment.ANDROID_HOME ??
    join(homedir(), "Android", "Sdk");
  const candidate = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  if (existsSync(candidate)) return candidate;
  return "adb";
}

function runAdb(serial, args, environment = process.env) {
  const result = spawnSync(adbPath(environment), ["-s", serial, ...args], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message || "unknown adb error";
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_ADB",
      `${args.join(" ")} failed: ${String(detail).trim()}`,
      { serial, args, exitCode: result.status ?? 2 },
    );
  }
  return String(result.stdout ?? "");
}

function normaliseOptions(options) {
  if (!options || typeof options !== "object") {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_OPTIONS", "options are required");
  }
  const { minBatteryPercent, requireDischarging, maxThermalStatus, allowOverride } = options;
  if (
    !Number.isFinite(minBatteryPercent) ||
    minBatteryPercent < 0 ||
    minBatteryPercent > 100 ||
    typeof requireDischarging !== "boolean" ||
    typeof maxThermalStatus !== "string" ||
    typeof allowOverride !== "boolean"
  ) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_OPTIONS",
      "expected minBatteryPercent, requireDischarging, maxThermalStatus and allowOverride",
    );
  }
  const maximumThermal = thermalStatusFromValue(maxThermalStatus);
  return { minBatteryPercent, requireDischarging, maximumThermal, allowOverride };
}

function conditionFailure(condition, threshold, observed) {
  return { condition, threshold, observed };
}

export async function assertDeviceReady(serial, options, dependencies = {}) {
  if (typeof serial !== "string" || serial.length === 0) {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_NO_DEVICE", "a device serial is required");
  }
  if (/^emulator-/u.test(serial)) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_EMULATOR_BLOCKED",
      `${serial} is an emulator; a physical Android device is required`,
      { serial },
    );
  }

  const configuration = normaliseOptions(options);
  const execute = dependencies.adb ?? ((args) => runAdb(serial, args, dependencies.environment));
  const state = String(await execute(["get-state"])).trim();
  if (state !== "device") {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_NO_DEVICE",
      `${serial} is not online (adb state: ${state || "missing"})`,
      { serial, observed: state || "missing" },
    );
  }

  const battery = parseBatteryState(await execute(["shell", "dumpsys", "battery"]));
  const thermal = parseThermalState(await execute(["shell", "dumpsys", "thermalservice"]));
  const screen = parseScreenState(await execute(["shell", "dumpsys", "power"]));
  const failures = [];
  if (battery.batteryPercent < configuration.minBatteryPercent) {
    failures.push(
      conditionFailure(
        "battery",
        `>= ${configuration.minBatteryPercent}%`,
        `${battery.batteryPercent}%`,
      ),
    );
  }
  if (configuration.requireDischarging && battery.charging) {
    failures.push(conditionFailure("charging", "discharging", battery.chargingSource));
  }
  if (thermal.thermalStatusCode > configuration.maximumThermal.code) {
    failures.push(
      conditionFailure(
        "thermal",
        `<= ${configuration.maximumThermal.status}`,
        thermal.thermalStatus,
      ),
    );
  }
  if (!screen.screenOn) {
    failures.push(conditionFailure("screen", "on", "off"));
  }

  if (failures.length > 0 && !configuration.allowOverride) {
    const detail = failures
      .map((failure) => `${failure.condition}: expected ${failure.threshold}, observed ${failure.observed}`)
      .join("; ");
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_CONDITION_FAILED", detail, {
      serial,
      failures,
    });
  }

  return {
    serial,
    batteryPercent: battery.batteryPercent,
    charging: battery.charging,
    chargingSource: battery.chargingSource,
    thermalStatus: thermal.thermalStatus,
    thermalStatusCode: thermal.thermalStatusCode,
    screenOn: screen.screenOn,
    provisional: failures.map((failure) => failure.condition),
  };
}
