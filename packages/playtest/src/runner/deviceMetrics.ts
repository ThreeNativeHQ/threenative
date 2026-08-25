/**
 * Device thermal, power and battery state as a first-class measured observation.
 *
 * Why this exists, measured on 2026-08-24 against a physical Pixel 8: two cold-launch runs
 * reported 44 s to first frame against a 14.7 s baseline, and the difference was attributed to a
 * code change. It was not. The device had climbed to 43.2 °C at thermal status 2 while the
 * baseline ran at 38.2 °C at status 0 — the run was throttled, and nothing in the playtest report
 * said so. Every agent that needs this answer has been hand-rolling `adb shell dumpsys` for it.
 *
 * Two rules this module holds to:
 *
 * 1. **Never report a zero for something that was not measured.** A rail breakdown a device does
 *    not expose comes back `{ available: false, reason }`, never `0 mW`. Google's per-rail ODPM
 *    numbers exist on Pixel hardware and nowhere else.
 * 2. **Never discard a confounded run's numbers, and never let it pass as comparable.** The
 *    samples are always reported; the verdict says whether the run may be compared with a cool
 *    one. A missing sample is a failure, not a skip.
 *
 * The parsers here read real `dumpsys` and `logcat` text. Captured samples of every format live in
 * `__tests__/fixtures/device-metrics/`.
 */

/** Battery temperature at or above which a run is treated as having started hot, in °C. */
export const HOT_START_TEMPERATURE_C = 40;

/** How often the recorder samples while a scenario runs, in milliseconds. */
export const DEVICE_METRICS_CADENCE_MS = 5000;

/** Ceiling on retained samples, so a long run cannot outgrow the bridge payload budget. */
export const DEVICE_METRICS_MAX_SAMPLES = 240;

const THERMAL_STATUS_NAMES = [
  "NONE",
  "LIGHT",
  "MODERATE",
  "SEVERE",
  "CRITICAL",
  "EMERGENCY",
  "SHUTDOWN",
] as const;

/** Android `Temperature.THROTTLING_*` type for the skin sensor. */
const SKIN_SENSOR_TYPE = 3;

const METRICS_SOURCE =
  "adb shell dumpsys battery; adb shell dumpsys thermalservice; " +
  "adb shell cat /sys/class/power_supply/battery/current_now; adb logcat -s pixel-thermal";

export class DeviceMetricsError extends Error {
  readonly code: string;
  readonly observed: string;

  constructor(code: string, detail: string, observed: string) {
    super(`${code}: ${detail}`);
    this.name = code;
    this.code = code;
    this.observed = observed;
  }
}

/** A reading that a given device may simply not expose. Absent means absent, never zero. */
export type PlaytestDeviceMeasurement<T> =
  | { available: false; reason: string }
  | { available: true; value: T };

export interface IPlaytestDeviceBattery {
  chargeCounterUah?: number;
  charging: boolean;
  levelPercent: number;
  /** `dumpsys battery` status: 2 charging, 3 discharging, 4 not charging, 5 full. */
  status: number;
  temperatureC: number;
  voltageMv?: number;
}

export interface IPlaytestDeviceThermal {
  sensors: Record<string, number>;
  skinSensorName?: string;
  skinTemperatureC: PlaytestDeviceMeasurement<number>;
  status: number;
  statusName: string;
}

export type PlaytestDevicePowerRails =
  | { available: false; reason: string }
  | { at: string; available: true; rails: Record<string, number>; totalMw: number; windowMs: number };

export interface IPlaytestDeviceMetricsSample {
  /** Milliseconds since the recorder was created. */
  at: number;
  batteryLevelPercent: number;
  batteryStatus: number;
  batteryTemperatureC: number;
  charging: boolean;
  /** Negative is discharge, matching the sysfs sign convention. */
  currentMa: PlaytestDeviceMeasurement<number>;
  phase: "after" | "before" | "during";
  powerRails: PlaytestDevicePowerRails;
  skinTemperatureC: PlaytestDeviceMeasurement<number>;
  thermalStatus: number;
  thermalStatusName: string;
}

export interface IPlaytestDeviceMetricsVerdict {
  endTemperatureC: number | null;
  endThermalStatus: number | null;
  maxThermalStatus: number | null;
  peakTemperatureC: number | null;
  /**
   * Whether a fresh per-rail power window was logged between the first and last sample. When it
   * is false the rail figures describe a window that predates the run and are not attributable
   * to it; `null` when the device exposes no rails at all.
   */
  powerRailWindowAdvanced: boolean | null;
  /** Named codes: charging, hot-start, incomplete, thermal-status-rose, throttled-start. */
  reasons: string[];
  startTemperatureC: number | null;
  startThermalStatus: number | null;
  temperatureRiseC: number | null;
  thermallyConfounded: boolean;
}

export interface IPlaytestDeviceMetricsObservation {
  available: boolean;
  /** Probe failures, kept rather than dropped: an unexplained gap is itself the finding. */
  errors: string[];
  samples: IPlaytestDeviceMetricsSample[];
  serial?: string;
  source: string;
  verdict: IPlaytestDeviceMetricsVerdict;
}

export function parseDeviceBattery(output: string): IPlaytestDeviceBattery {
  const source = String(output);
  const temperature = integerField(source, "temperature", "BATTERY");
  const levelPercent = integerField(source, "level", "BATTERY");
  const status = integerField(source, "status", "BATTERY");
  if (levelPercent < 0 || levelPercent > 100) {
    throw new DeviceMetricsError(
      "TN_PLAYTEST_DEVICE_METRICS_BATTERY_PARSE",
      `battery level is outside 0..100: ${levelPercent}`,
      source,
    );
  }
  const chargeCounterUah = optionalIntegerField(source, "Charge counter");
  const voltageMv = optionalIntegerField(source, "voltage");
  const powered = ["AC", "USB", "Wireless"].some((name) =>
    new RegExp(`^\\s*${name} powered:\\s*true\\s*$`, "imu").test(source),
  );
  return {
    ...(chargeCounterUah === undefined ? {} : { chargeCounterUah }),
    charging: powered || status === 2 || status === 5,
    levelPercent,
    status,
    // deci-°C on every Android build that ships dumpsys battery.
    temperatureC: temperature / 10,
    ...(voltageMv === undefined ? {} : { voltageMv }),
  };
}

export function parseDeviceThermal(output: string): IPlaytestDeviceThermal {
  const source = String(output);
  const match = /^\s*(?:Current\s+)?Thermal\s+Status:\s*(\d+)\s*$/imu.exec(source);
  if (match?.[1] === undefined) {
    throw new DeviceMetricsError(
      "TN_PLAYTEST_DEVICE_METRICS_THERMAL_PARSE",
      "dumpsys thermalservice printed no 'Thermal Status:' line",
      source,
    );
  }
  const status = Number(match[1]);
  const sensors = thermalSensors(source);
  const skin = skinSensor(sensors.entries);
  return {
    sensors: sensors.values,
    ...(skin === undefined ? {} : { skinSensorName: skin.name }),
    skinTemperatureC:
      skin === undefined
        ? {
            available: false,
            reason:
              "this device exposes no skin thermal sensor (no VIRTUAL-SKIN entry and no mType=3 temperature)",
          }
        : { available: true, value: skin.value },
    status,
    statusName: THERMAL_STATUS_NAMES[status] ?? `UNKNOWN_${status}`,
  };
}

/**
 * `/sys/class/power_supply/battery/current_now` in microamps. A device that does not expose the
 * node answers with `cat`'s error text, which is unavailability, not a zero-current reading.
 */
export function parseDeviceCurrent(output: string): PlaytestDeviceMeasurement<number> {
  const text = String(output).trim();
  const match = /^-?\d+$/u.exec(text);
  if (match === null) {
    return {
      available: false,
      reason: `/sys/class/power_supply/battery/current_now is not readable on this device: ${
        text.length === 0 ? "empty response" : text.split("\n")[0]
      }`,
    };
  }
  return { available: true, value: Number(text) / 1000 };
}

/**
 * Pixel's on-device power monitor writes a whole-rail breakdown to logcat once per ~60 s window,
 * as `Power rails total power: 547.76 mW for 60014 ms` followed by `[RAIL: n mW]` groups. Devices
 * without Google's ODPM hardware log nothing here, and must say so rather than report zeros.
 */
export function parseDevicePowerRails(output: string): PlaytestDevicePowerRails {
  let current: { at: string; rails: Record<string, number>; totalMw: number; windowMs: number } | undefined;
  let last: typeof current;
  for (const line of String(output).split("\n")) {
    const total = /Power rails total power:\s*([\d.]+)\s*mW\s+for\s+(\d+)\s*ms/u.exec(line);
    if (total?.[1] !== undefined && total[2] !== undefined) {
      current = { at: logcatTimestamp(line), rails: {}, totalMw: Number(total[1]), windowMs: Number(total[2]) };
      last = current;
      continue;
    }
    if (current === undefined || !line.includes("Power rails [")) continue;
    for (const rail of line.matchAll(/\[([A-Za-z0-9_]+):\s*([\d.]+)\s*mW\]/gu)) {
      if (rail[1] === undefined || rail[2] === undefined) continue;
      current.rails[rail[1]] = Number(rail[2]);
    }
  }
  if (last === undefined || Object.keys(last.rails).length === 0) {
    return {
      available: false,
      reason:
        "no pixel-thermal power rail window in the captured log; per-rail power is Pixel/Google ODPM hardware only",
    };
  }
  return { at: last.at, available: true, rails: last.rails, totalMw: last.totalMw, windowMs: last.windowMs };
}

/**
 * The thermal verdict. It never removes a number — a confounded run reports everything it
 * measured — it only states whether this run may be compared with a cool one.
 */
export function summarizeDeviceMetrics(
  samples: readonly IPlaytestDeviceMetricsSample[],
): IPlaytestDeviceMetricsVerdict {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const reasons = new Set<string>();
  // Fail closed: a run that produced no start and end sample cannot prove it was not throttled.
  if (first === undefined || last === undefined || samples.length < 2) reasons.add("incomplete");
  if (first !== undefined && first.batteryTemperatureC >= HOT_START_TEMPERATURE_C) reasons.add("hot-start");
  if (first !== undefined && first.thermalStatus > 0) reasons.add("throttled-start");
  const maxThermalStatus = samples.length === 0
    ? null
    : Math.max(...samples.map(({ thermalStatus }) => thermalStatus));
  if (first !== undefined && maxThermalStatus !== null && maxThermalStatus > first.thermalStatus) {
    reasons.add("thermal-status-rose");
  }
  if (samples.some(({ charging }) => charging)) reasons.add("charging");
  const railTimestamps = samples.map((entry) => (entry.powerRails.available ? entry.powerRails.at : undefined));
  const observedRailWindows = new Set(railTimestamps.filter((at): at is string => at !== undefined));
  return {
    endTemperatureC: last?.batteryTemperatureC ?? null,
    endThermalStatus: last?.thermalStatus ?? null,
    maxThermalStatus,
    peakTemperatureC: samples.length === 0
      ? null
      : Math.max(...samples.map(({ batteryTemperatureC }) => batteryTemperatureC)),
    powerRailWindowAdvanced: observedRailWindows.size === 0 ? null : observedRailWindows.size > 1,
    reasons: [...reasons].sort(),
    startTemperatureC: first?.batteryTemperatureC ?? null,
    startThermalStatus: first?.thermalStatus ?? null,
    temperatureRiseC:
      first === undefined || last === undefined
        ? null
        : round(last.batteryTemperatureC - first.batteryTemperatureC),
    thermallyConfounded: reasons.size > 0,
  };
}

export interface IDeviceMetricsRecorderOptions {
  adb(args: readonly string[]): Promise<string>;
  cadenceMs?: number;
  now?(): number;
  serial?: string;
}

/**
 * Samples the device around and during a run. The periodic sampler is wall-clock paced on
 * purpose and deliberately reads nothing the scenario depends on: it observes the phone, it
 * never advances or gates a tick, so scenario determinism is untouched.
 */
export class DeviceMetricsRecorder {
  private readonly errors: string[] = [];
  private readonly samples: IPlaytestDeviceMetricsSample[] = [];
  private readonly startedAt: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: IDeviceMetricsRecorderOptions) {
    this.startedAt = this.now();
  }

  async sampleNow(phase: IPlaytestDeviceMetricsSample["phase"]): Promise<IPlaytestDeviceMetricsSample> {
    const at = this.now() - this.startedAt;
    let battery: IPlaytestDeviceBattery;
    let thermal: IPlaytestDeviceThermal;
    try {
      battery = parseDeviceBattery(await this.options.adb(["shell", "dumpsys", "battery"]));
      thermal = parseDeviceThermal(await this.options.adb(["shell", "dumpsys", "thermalservice"]));
    } catch (error) {
      const failure = error instanceof DeviceMetricsError
        ? error
        : new DeviceMetricsError(
            "TN_PLAYTEST_DEVICE_METRICS_PROBE_FAILED",
            error instanceof Error ? error.message : String(error),
            "",
          );
      this.errors.push(`${phase}: ${failure.message}`);
      throw failure;
    }
    const currentMa = await this.probe(
      ["shell", "cat", "/sys/class/power_supply/battery/current_now"],
      parseDeviceCurrent,
      (reason) => ({ available: false as const, reason }),
    );
    const powerRails = await this.probe(
      ["logcat", "-d", "-s", "pixel-thermal:I", "-t", "400"],
      parseDevicePowerRails,
      (reason) => ({ available: false as const, reason }),
    );
    const sample: IPlaytestDeviceMetricsSample = {
      at,
      batteryLevelPercent: battery.levelPercent,
      batteryStatus: battery.status,
      batteryTemperatureC: battery.temperatureC,
      charging: battery.charging,
      currentMa,
      phase,
      powerRails,
      skinTemperatureC: thermal.skinTemperatureC,
      thermalStatus: thermal.status,
      thermalStatusName: thermal.statusName,
    };
    if (this.samples.length < DEVICE_METRICS_MAX_SAMPLES) this.samples.push(sample);
    return sample;
  }

  /** Begins periodic `during` sampling. A periodic probe failure is recorded, never thrown away. */
  start(): void {
    if (this.timer !== undefined) return;
    const cadenceMs = this.options.cadenceMs ?? DEVICE_METRICS_CADENCE_MS;
    this.timer = setInterval(() => {
      void this.sampleNow("during").catch(() => undefined);
    }, cadenceMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  observation(): IPlaytestDeviceMetricsObservation {
    return {
      available: this.samples.length > 0 && this.errors.length === 0,
      errors: [...this.errors],
      samples: [...this.samples],
      ...(this.options.serial === undefined ? {} : { serial: this.options.serial }),
      source: METRICS_SOURCE,
      verdict: summarizeDeviceMetrics(this.samples),
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async probe<T>(
    args: readonly string[],
    parse: (output: string) => T,
    unavailable: (reason: string) => T,
  ): Promise<T> {
    try {
      return parse(await this.options.adb(args));
    } catch (error) {
      return unavailable(
        `adb ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function integerField(source: string, field: string, code: string): number {
  const value = optionalIntegerField(source, field);
  if (value === undefined) {
    throw new DeviceMetricsError(
      `TN_PLAYTEST_DEVICE_METRICS_${code}_PARSE`,
      `dumpsys battery printed no integer '${field}:' line`,
      source,
    );
  }
  return value;
}

function optionalIntegerField(source: string, field: string): number | undefined {
  const match = new RegExp(`^\\s*${field}:\\s*(-?\\d+)\\s*$`, "imu").exec(source);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

interface IThermalSensor {
  name: string;
  type: number;
  value: number;
}

/**
 * `Current temperatures from HAL` is the live block; `Cached temperatures` is the last broadcast
 * and can be minutes stale, so it is only a fallback.
 */
function thermalSensors(source: string): { entries: IThermalSensor[]; values: Record<string, number> } {
  const live = sensorBlock(source, "Current temperatures from HAL:");
  const entries = live.length > 0 ? live : sensorBlock(source, "Cached temperatures:");
  const values: Record<string, number> = {};
  for (const entry of entries) values[entry.name] = entry.value;
  return { entries, values };
}

function sensorBlock(source: string, heading: string): IThermalSensor[] {
  const start = source.indexOf(heading);
  if (start < 0) return [];
  const entries: IThermalSensor[] = [];
  for (const line of source.slice(start + heading.length).split("\n")) {
    const match = /Temperature\{mValue=(-?[\d.]+),\s*mType=(-?\d+),\s*mName=([^,]+),/u.exec(line);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      // A heading with no further Temperature{...} line ends the block.
      if (entries.length > 0 && /^[A-Z]/u.test(line)) break;
      continue;
    }
    entries.push({ name: match[3].trim(), type: Number(match[2]), value: Number(match[1]) });
  }
  return entries;
}

function skinSensor(entries: readonly IThermalSensor[]): IThermalSensor | undefined {
  return entries.find(({ name }) => name === "VIRTUAL-SKIN")
    ?? entries.find(({ type }) => type === SKIN_SENSOR_TYPE);
}

function logcatTimestamp(line: string): string {
  return /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/u.exec(line)?.[1] ?? "";
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
