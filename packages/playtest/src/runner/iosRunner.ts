import { join } from "node:path";

import { runDevicePlaytest, type IDevicePlaytestDriver } from "./androidRunner.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import { deviceMailboxPaths, type IDevicePlaytestTransport } from "./deviceTransport.js";
import { XcrunIosDriver } from "./ios.js";
import type { IStandalonePlaytestReport } from "./runner.js";

export interface IIosPlaytestDependencies {
  driver?: IDevicePlaytestDriver & { getMailboxRoot?(): string };
  transport?: IDevicePlaytestTransport;
}

export async function runIosPlaytest(
  config: IStandalonePlaytestConfig,
  dependencies: IIosPlaytestDependencies = {},
): Promise<IStandalonePlaytestReport> {
  const ios = config.ios;
  if (ios?.appPath === undefined) {
    throw new Error("iOS playtest requires --app with a built .app bundle.");
  }
  const driver = dependencies.driver ?? new XcrunIosDriver({
    appPath: ios.appPath,
    bundleId: ios.bundleId,
    ...(config.device === undefined ? {} : { device: config.device }),
    transport: ios.transport,
    ...(config.xcrunPath === undefined ? {} : { xcrunPath: config.xcrunPath }),
  });
  const defaultRoot = config.mailboxRoot ?? join(config.artifactDirectory, ".ios-mailbox-pending");
  return runDevicePlaytest(config, {
    driver,
    mailboxPaths: deviceMailboxPaths(defaultRoot),
    name: "ios",
    processName: ios.bundleId,
    ...(dependencies.transport === undefined ? {} : { transport: dependencies.transport }),
  });
}
