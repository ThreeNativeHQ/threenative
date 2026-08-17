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
