import { runAdb } from "./adb.mjs";
import { readAndroidConfig } from "../package-android.mjs";

export const MINIMUM_BATTERY_PERCENT = 50;

export function resolveAndroidPackageId(configPath) {
  return readAndroidConfig(configPath).app.id;
}

export function verifyInstalledPackage(execute, appId) {
  const installedPath = String(execute(["shell", "pm", "path", appId])).trim();
  if (!installedPath.startsWith("package:")) {
    throw new DevicePreflightError(
      "TN_DEVICE_INSTALL_MISSING",
      `pm path ${appId} returned '${installedPath}'`,
      { appId, observed: installedPath },
    );
  }
  return installedPath;
}

export async function verifyInstalledPackageAsync(execute, appId) {
  const installedPath = String(await execute(["shell", "pm", "path", appId])).trim();
  if (!installedPath.startsWith("package:")) {
    throw new DevicePreflightError(
      "TN_DEVICE_INSTALL_MISSING",
      `pm path ${appId} returned '${installedPath}'`,
      { appId, observed: installedPath },
    );
  }
  return installedPath;
}

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
  const statusMatch = /^[ \t]*status:[ \t]*([^\r\n]*?)[ \t]*$/imu.exec(source);
  const statusText = statusMatch?.[1] ?? null;
  const statusIsCanonical = statusText !== null && /^(?:0|[1-9][0-9]*)$/u.test(statusText);
  const status = statusIsCanonical ? Number(statusText) : null;
  if (
    statusText !== null &&
    (!statusIsCanonical || !Number.isInteger(status) || status < 1 || status > 5)
  ) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_CHARGING_PARSE",
      `dumpsys battery has unrecognised status: ${statusText}`,
      { condition: "charging", observed: statusText },
    );
  }
  if (status === 1) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_CHARGING_PARSE",
      "dumpsys battery status UNKNOWN cannot prove discharging",
      { condition: "charging", observed: statusText },
    );
  }
  if (presentSources.length !== sources.length && status === null) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_CHARGING_PARSE",
      "dumpsys battery has incomplete charging sources and no status",
      { condition: "charging", observed: source },
    );
  }

  const activeSource = poweredBy.find((entry) => entry?.powered === true)?.name;
  const chargingByStatus = status === 2 || status === 5;
  const charging = activeSource !== undefined || chargingByStatus;
  return {
    batteryPercent,
    charging,
    chargingSource: activeSource ?? (chargingByStatus ? "STATUS" : "NONE"),
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

/**
 * The panel's *active* mode, not the app's vote and not the settings value.
 *
 * A Pixel 8 found with Smooth Display off reports `peak_refresh_rate 60.0` and an active mode of
 * 60 Hz while `supportedModes` still lists 120 — so the app's `Surface.setFrameRate(120)` is
 * clamped away rather than declined, and an fps arm silently measures a different machine than the
 * one it believes. The tell in the data is a SurfaceFlinger histogram of 16 ms and 33 ms intervals
 * with no 8 ms bucket. Reading it here is cheaper than recognising it later.
 */
export function parseActiveDisplayMode(output) {
  const source = String(output);
  const active = /mActiveSfDisplayMode\s*=\s*DisplayMode\{[^}]*?peakRefreshRate\s*=\s*([0-9.]+)/u.exec(
    source,
  );
  if (!active) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_DISPLAY_PARSE",
      "dumpsys display has no mActiveSfDisplayMode",
      { condition: "display", observed: source.slice(0, 200) },
    );
  }
  const supported = /mSupportedRefreshRates\s*=\s*\[([^\]]*)\]/u.exec(source);
  const supportedRefreshHz = supported
    ? supported[1]
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry))
        .map((entry) => Math.round(entry))
    : [];
  return {
    activeRefreshHz: Math.round(Number(active[1])),
    supportedRefreshHz: [...new Set(supportedRefreshHz)].sort((a, b) => b - a),
  };
}

/** `settings get` prints the literal `null` when a key was never written; that is "unset", not 0. */
function settingNumber(value) {
  const trimmed = String(value).trim();
  if (trimmed === "" || trimmed === "null") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

export function parseRefreshRateSettings({ peak, min, lowPower }) {
  const power = String(lowPower ?? "").trim();
  if (power !== "" && power !== "null" && power !== "0" && power !== "1") {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_DISPLAY_PARSE",
      `unrecognised low_power value: ${power}`,
      { condition: "lowPower", observed: power },
    );
  }
  return {
    peakRefreshRateSetting: settingNumber(peak),
    minRefreshRateSetting: settingNumber(min),
    lowPower: power === "1",
  };
}

async function readDisplayState(execute) {
  const [display, peak, min, lowPower] = await Promise.all([
    execute(["shell", "dumpsys", "display"]),
    execute(["shell", "settings", "get", "system", "peak_refresh_rate"]),
    execute(["shell", "settings", "get", "system", "min_refresh_rate"]),
    execute(["shell", "settings", "get", "global", "low_power"]),
  ]);
  return { ...parseActiveDisplayMode(display), ...parseRefreshRateSettings({ peak, min, lowPower }) };
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
  // Opt-in, and only one caller sets it. See the emulator branch in assertDeviceReady for why a
  // qualification lane must never pass this and a benchmark reasonably may.
  const allowEmulator = options.allowEmulator ?? false;
  if (typeof allowEmulator !== "boolean") {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_OPTIONS", "allowEmulator must be a boolean");
  }
  // Capture of the panel state is unconditional; the *gate* is opt-in, so a cold-start or physics
  // arm is unaffected while an fps arm cannot run on a panel it did not declare.
  const requireRefreshHz = options.requireRefreshHz;
  if (
    requireRefreshHz !== undefined &&
    (!Number.isInteger(requireRefreshHz) || requireRefreshHz <= 0 || requireRefreshHz > 1000)
  ) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_OPTIONS",
      "requireRefreshHz must be a whole number of hertz between 1 and 1000",
    );
  }
  const maximumThermal = thermalStatusFromValue(maxThermalStatus);
  return {
    allowEmulator,
    minBatteryPercent,
    requireDischarging,
    maximumThermal,
    allowOverride,
    requireRefreshHz,
  };
}

function conditionFailure(condition, threshold, observed) {
  return { condition, threshold, observed };
}

// The Play Protect verifier dialog ("Android App Compatibility") appears on every `adb install`
// of a newly versioned APK, and its own "don't show again" is keyed to the APK rather than the
// device, so the next build asks again (Pixel 8, 2026-08-27). These three global settings turn
// verification off for installs and persist on the device across builds and reboots. The dialog
// is a modal that eats injected touches mid-run, so a suppression that silently failed is worse
// than none: the readback below fails closed with a named error.
const PLAY_PROTECT_INSTALL_SETTINGS = [
  "package_verifier_enable",
  "upload_apk_enable",
  "verifier_verify_adb_installs",
];

export function suppressPlayProtectOnAdbInstalls(serial, dependencies = {}) {
  if (
    (typeof serial !== "string" || serial.length === 0) &&
    typeof dependencies.adb !== "function"
  ) {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_NO_DEVICE", "a device serial is required");
  }
  const execute = dependencies.adb ?? ((args) =>
    runAdb(serial, args, {
      environment: dependencies.environment,
      spawnSyncImpl: dependencies.spawnSyncImpl,
      mapError: (error) => new DevicePreflightError(
        "TN_DEVICE_PREFLIGHT_ADB",
        `${args.join(" ")} failed: ${error.detail}`,
        { serial, args, exitCode: error.exitCode },
      ),
    }));
  for (const setting of PLAY_PROTECT_INSTALL_SETTINGS) {
    let observed;
    try {
      execute(["shell", "settings", "put", "global", setting, "0"]);
      observed = String(execute(["shell", "settings", "get", "global", setting])).trim();
    } catch (error) {
      throw new DevicePreflightError(
        "TN_DEVICE_PREFLIGHT_PLAY_PROTECT",
        `could not disable adb-install verification for ${setting}: ${error?.message ?? error}`,
        { serial, setting },
      );
    }
    if (observed !== "0") {
      throw new DevicePreflightError(
        "TN_DEVICE_PREFLIGHT_PLAY_PROTECT",
        `settings put global ${setting} 0 did not take (observed '${observed}'); the Play Protect install dialog will appear`,
        { serial, setting, observed },
      );
    }
  }
  return [...PLAY_PROTECT_INSTALL_SETTINGS];
}

export async function suppressPlayProtectOnAdbInstallsAsync(serial, dependencies = {}) {
  if (
    (typeof serial !== "string" || serial.length === 0) &&
    typeof dependencies.adb !== "function"
  ) {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_NO_DEVICE", "a device serial is required");
  }
  const execute = dependencies.adb;
  if (typeof execute !== "function") {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_ADB", "an async adb executor is required");
  }
  for (const setting of PLAY_PROTECT_INSTALL_SETTINGS) {
    try {
      await execute(["shell", "settings", "put", "global", setting, "0"]);
      const observed = String(
        await execute(["shell", "settings", "get", "global", setting]),
      ).trim();
      if (observed !== "0") {
        throw new Error(`readback was '${observed}'`);
      }
    } catch (error) {
      throw new DevicePreflightError(
        "TN_DEVICE_PREFLIGHT_PLAY_PROTECT",
        `could not disable adb-install verification for ${setting}: ${error?.message ?? error}`,
        { serial, setting },
      );
    }
  }
  return [...PLAY_PROTECT_INSTALL_SETTINGS];
}

function evaluateDeviceCondition(serial, configuration, battery, thermal, screen, display) {
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
  if (!screen.screenOn) failures.push(conditionFailure("screen", "on", "off"));
  if (configuration.requireRefreshHz !== undefined) {
    if (display.activeRefreshHz !== configuration.requireRefreshHz) {
      failures.push(
        conditionFailure(
          "refreshRate",
          `${configuration.requireRefreshHz} Hz active`,
          `${display.activeRefreshHz} Hz`,
        ),
      );
    }
    if (display.lowPower) failures.push(conditionFailure("lowPower", "off", "on"));
  }
  if (failures.length > 0 && !configuration.allowOverride) {
    const detail = failures
      .map(
        (failure) =>
          `${failure.condition}: expected ${failure.threshold}, observed ${failure.observed}`,
      )
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
    activeRefreshHz: display.activeRefreshHz,
    supportedRefreshHz: display.supportedRefreshHz,
    peakRefreshRateSetting: display.peakRefreshRateSetting,
    minRefreshRateSetting: display.minRefreshRateSetting,
    lowPower: display.lowPower,
    provisional: failures.map((failure) => failure.condition),
  };
}

export async function assertDeviceReady(serial, options, dependencies = {}) {
  if (typeof serial !== "string" || serial.length === 0) {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_NO_DEVICE", "a device serial is required");
  }
  const configuration = normaliseOptions(options);
  // An emulator cannot prove arm64, a real GPU driver, touch hardware, thermal behaviour or battery,
  // so every *qualification* lane must refuse one — that is PRD-070's rule and it is the default here.
  //
  // A *performance regression canary* is a different question, and the answer was measured on
  // 2026-08-17 rather than assumed: on the x86_64 emulator the V8-against-QuickJS ratio at the top
  // rung falls from 12.1x to 2.4x, because swiftshader is a CPU rasteriser and software rendering
  // swamps script time. Still far past any sane tolerance, so an engine revert is catchable there —
  // but the absolute numbers are not performance evidence and must never be quoted as device figures.
  // `allowEmulator` is how a caller says it wants the canary and accepts that.
  if (/^emulator-/u.test(serial) && !configuration.allowEmulator) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_EMULATOR_BLOCKED",
      `${serial} is an emulator; a physical Android device is required`,
      { serial },
    );
  }

  const execute = dependencies.adb ?? ((args) =>
    runAdb(serial, args, {
      environment: dependencies.environment,
      spawnSyncImpl: dependencies.spawnSyncImpl,
      mapError: (error) => new DevicePreflightError(
        "TN_DEVICE_PREFLIGHT_ADB",
        `${args.join(" ")} failed: ${error.detail}`,
        { serial, args, exitCode: error.exitCode },
      ),
    }));
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
  const display = await readDisplayState(execute);
  return evaluateDeviceCondition(serial, configuration, battery, thermal, screen, display);
}

export function assertDeviceReadySync(serial, options, dependencies = {}) {
  if (typeof serial !== "string" || serial.length === 0) {
    throw new DevicePreflightError("TN_DEVICE_PREFLIGHT_NO_DEVICE", "a device serial is required");
  }
  const configuration = normaliseOptions(options);
  if (/^emulator-/u.test(serial) && !configuration.allowEmulator) {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_EMULATOR_BLOCKED",
      `${serial} is an emulator; a physical Android device is required`,
      { serial },
    );
  }
  const execute = dependencies.adb ?? ((args) => runAdb(serial, args, dependencies));
  const state = String(execute(["get-state"])).trim();
  if (state !== "device") {
    throw new DevicePreflightError(
      "TN_DEVICE_PREFLIGHT_NO_DEVICE",
      `${serial} is not online (adb state: ${state || "missing"})`,
      { serial, observed: state || "missing" },
    );
  }
  const battery = parseBatteryState(execute(["shell", "dumpsys", "battery"]));
  const thermal = parseThermalState(execute(["shell", "dumpsys", "thermalservice"]));
  const screen = parseScreenState(execute(["shell", "dumpsys", "power"]));
  const display = {
    ...parseActiveDisplayMode(execute(["shell", "dumpsys", "display"])),
    ...parseRefreshRateSettings({
      peak: execute(["shell", "settings", "get", "system", "peak_refresh_rate"]),
      min: execute(["shell", "settings", "get", "system", "min_refresh_rate"]),
      lowPower: execute(["shell", "settings", "get", "global", "low_power"]),
    }),
  };
  return evaluateDeviceCondition(serial, configuration, battery, thermal, screen, display);
}
