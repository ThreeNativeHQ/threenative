export type ThermalStatus =
  | "NONE"
  | "LIGHT"
  | "MODERATE"
  | "SEVERE"
  | "CRITICAL"
  | "EMERGENCY"
  | "SHUTDOWN";

export type ChargingSource = "AC" | "USB" | "WIRELESS" | "STATUS" | "NONE";

export interface IDisplayState {
  /** The panel's *active* mode in whole hertz — not the app's vote and not the settings value. */
  activeRefreshHz: number;
  /** Whole-hertz rates the panel advertises, highest first. A rate here may still be unreachable. */
  supportedRefreshHz: number[];
  /** `settings get system peak_refresh_rate`; `undefined` when the key was never written. */
  peakRefreshRateSetting?: number;
  /** `settings get system min_refresh_rate`; `undefined` when the key was never written. */
  minRefreshRateSetting?: number;
  /** Battery Saver, which clamps the panel's mode range independently of the Smooth Display setting. */
  lowPower: boolean;
}

export interface IDeviceCondition extends IDisplayState {
  batteryPercent: number;
  charging: boolean;
  chargingSource: ChargingSource;
  provisional: string[];
  screenOn: boolean;
  serial: string;
  thermalStatus: ThermalStatus;
  thermalStatusCode: number;
}

export interface IDeviceReadyOptions {
  /**
   * Permit an `emulator-*` serial. Defaults to false, and a qualification lane must leave it that
   * way: an emulator proves nothing about arm64, a real GPU driver, touch, thermal or battery. Only
   * the performance-regression canary sets it, and only because the engine cliff it watches for
   * survives software rendering — see the emulator branch in `assertDeviceReady`.
   */
  allowEmulator?: boolean;
  allowOverride: boolean;
  maxThermalStatus: ThermalStatus;
  minBatteryPercent: number;
  requireDischarging: boolean;
  /**
   * Refuse to run unless the panel's *active* mode is this rate. Capture of the display state is
   * unconditional; only this gate is opt-in, so a cold-start or physics arm is unaffected while an
   * fps arm cannot silently measure a downclocked panel. Battery Saver is refused alongside it.
   */
  requireRefreshHz?: number;
}

export interface IDevicePreflightDependencies {
  adb?: (args: readonly string[]) => string | Promise<string>;
  environment?: NodeJS.ProcessEnv;
}

export declare const MINIMUM_BATTERY_PERCENT: number;
export declare class DevicePreflightError extends Error {
  code: string;
  details: Record<string, unknown>;
  exitCode: number;
}
export declare function parseBatteryState(
  output: string,
): Omit<
  IDeviceCondition,
  "provisional" | "screenOn" | "serial" | "thermalStatus" | "thermalStatusCode"
>;
export declare function parseThermalState(
  output: string,
): Pick<IDeviceCondition, "thermalStatus" | "thermalStatusCode">;
export declare function parseScreenState(output: string): Pick<IDeviceCondition, "screenOn">;
export declare function parseActiveDisplayMode(
  output: string,
): Pick<IDisplayState, "activeRefreshHz" | "supportedRefreshHz">;
export declare function parseRefreshRateSettings(values: {
  peak?: string;
  min?: string;
  lowPower?: string;
}): Pick<IDisplayState, "peakRefreshRateSetting" | "minRefreshRateSetting" | "lowPower">;
export declare function assertDeviceReady(
  serial: string,
  options: IDeviceReadyOptions,
  dependencies?: IDevicePreflightDependencies,
): Promise<IDeviceCondition>;

/**
 * Turn off Play Protect's verifier dialog for `adb install` on this device, and fail closed when
 * the device does not accept it — the dialog is a modal that eats injected touches mid-run.
 */
export declare function suppressPlayProtectOnAdbInstalls(
  serial: string,
  dependencies?: Pick<IDevicePreflightDependencies, "adb" | "environment"> & {
    adb?: (args: readonly string[]) => string;
  },
): string[];
