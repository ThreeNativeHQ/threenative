export type ThermalStatus =
  | "NONE"
  | "LIGHT"
  | "MODERATE"
  | "SEVERE"
  | "CRITICAL"
  | "EMERGENCY"
  | "SHUTDOWN";

export type ChargingSource = "AC" | "USB" | "WIRELESS" | "STATUS" | "NONE";

export interface IDeviceCondition {
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
export declare function parseBatteryState(output: string): Omit<IDeviceCondition, "provisional" | "screenOn" | "serial" | "thermalStatus" | "thermalStatusCode">;
export declare function parseThermalState(output: string): Pick<IDeviceCondition, "thermalStatus" | "thermalStatusCode">;
export declare function parseScreenState(output: string): Pick<IDeviceCondition, "screenOn">;
export declare function assertDeviceReady(
  serial: string,
  options: IDeviceReadyOptions,
  dependencies?: IDevicePreflightDependencies,
): Promise<IDeviceCondition>;
