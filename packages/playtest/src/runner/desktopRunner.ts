import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { runDevicePlaytest, type IDevicePlaytestDriver } from "./androidRunner.js";
import { DesktopPlaytestDriver, LocalDeviceMailbox } from "./desktop.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import {
  DeviceMailboxTransport,
  deviceMailboxPaths,
  type IDevicePlaytestTransport,
} from "./deviceTransport.js";
import type { IStandalonePlaytestReport } from "./runner.js";

export interface IDesktopPlaytestDependencies {
  driver?: IDevicePlaytestDriver;
  mailboxRoot?: string;
  transport?: IDevicePlaytestTransport;
}

export async function runDesktopPlaytest(
  config: IStandalonePlaytestConfig,
  dependencies: IDesktopPlaytestDependencies = {},
): Promise<IStandalonePlaytestReport> {
  const executable = config.desktop?.executable;
  if (executable === undefined) {
    throw new Error("Desktop playtest requires --executable <native-game-executable>.");
  }
  const abortController = new AbortController();
  const handleSignal = (): void => {
    abortController.abort();
    void startSignalCleanup();
  };
  let mailboxRoot: string | undefined;
  let ownsMailboxRoot = false;
  let driver: IDevicePlaytestDriver | undefined;
  let transport: IDevicePlaytestTransport | undefined;
  let signalCleanup: Promise<void> | undefined;
  let signalCleanupError: Error | undefined;
  let report: IStandalonePlaytestReport | undefined;
  let executionError: unknown;
  let executionFailed = false;

  const startSignalCleanup = (): Promise<void> => {
    if (signalCleanup !== undefined) return signalCleanup;
    if (driver === undefined || transport === undefined) return Promise.resolve();
    const currentDriver = driver;
    const currentTransport = transport;
    signalCleanup = Promise.allSettled([
      Promise.resolve().then(() => currentDriver.stop()),
      Promise.resolve().then(() => currentTransport.close()),
    ]).then((results) => {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (errors.length > 0) signalCleanupError = cleanupFailure(errors);
    });
    return signalCleanup;
  };

  const awaitSignalCleanup = async (): Promise<void> => {
    await startSignalCleanup();
    if (signalCleanupError !== undefined) throw signalCleanupError;
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  try {
    const configuredRoot = dependencies.mailboxRoot ?? config.mailboxRoot;
    const root = configuredRoot === undefined
      ? await mkdtemp(join(tmpdir(), "threenative-playtest-desktop-"))
      : isAbsolute(configuredRoot) ? configuredRoot : resolve(config.projectPath, configuredRoot);
    mailboxRoot = root;
    ownsMailboxRoot = configuredRoot === undefined;
    const paths = deviceMailboxPaths(root);
    driver = dependencies.driver ?? new DesktopPlaytestDriver({
      cwd: config.projectPath,
      executable,
      mailboxRoot: root,
    });
    transport = dependencies.transport ?? new DeviceMailboxTransport(
      new LocalDeviceMailbox(),
      paths,
      config.timeoutMs,
    );
    report = await runDevicePlaytest({ ...config, mailboxRoot }, {
      driver,
      mailboxPaths: paths,
      name: "desktop",
      processName: executable,
      transport,
      abortSignal: abortController.signal,
      abortCleanup: awaitSignalCleanup,
    });
    if (abortController.signal.aborted) throw new Error("Desktop playtest interrupted by signal.");
  } catch (error) {
    executionFailed = true;
    executionError = error;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    const cleanupErrors: unknown[] = [];
    const attemptCleanup = async (cleanup: () => Promise<void>): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (abortController.signal.aborted) await attemptCleanup(awaitSignalCleanup);
    if (mailboxRoot !== undefined) {
      const root = mailboxRoot;
      const paths = deviceMailboxPaths(root);
      if (ownsMailboxRoot) {
        await attemptCleanup(() => rm(root, { force: true, recursive: true }));
      } else {
        await attemptCleanup(async () => {
          await Promise.all([
            rm(paths.request, { force: true }),
            rm(paths.response, { force: true }),
            rm(`${paths.request}.tmp`, { force: true }),
            rm(`${paths.response}.tmp`, { force: true }),
            rm(join(root, "tn-playtest-screenshot-request.txt"), { force: true }),
            rm(join(root, "tn-playtest-screenshot-request.txt.tmp"), { force: true }),
          ]);
        });
      }
    }
    if (cleanupErrors.length > 0) {
      if (executionFailed) {
        executionError = cleanupFailure([executionError, ...cleanupErrors]);
      } else {
        executionError = cleanupFailure(cleanupErrors);
        executionFailed = true;
      }
    }
  }
  if (executionFailed) throw executionError;
  if (report === undefined) throw new Error("Desktop playtest did not produce a report.");
  return report;
}

function cleanupFailure(errors: readonly unknown[]): Error {
  if (errors.length === 1) {
    const error = errors[0];
    return error instanceof Error ? error : new Error(String(error));
  }
  return new AggregateError(errors, "Desktop playtest cleanup failed.");
}
