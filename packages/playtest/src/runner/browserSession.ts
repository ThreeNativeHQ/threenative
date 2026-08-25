import type { Browser, BrowserContext, Page } from "playwright";

import type { IPlaytestScenario } from "../index.js";
import type { IPlaytestBridgeClient } from "./bridgeClient.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import type { IPlaytestDeviceMetricsObservation } from "./deviceMetrics.js";
import { boundedTeardownStep, openPageAndConnectBridge, settledTeardownValue } from "./sampling.js";

/** Internal lifecycle contract for a browser the runner attaches to but does not own. */
export interface IRemoteBrowserSession {
  close(): Promise<void>;
  connect(config: IStandalonePlaytestConfig): Promise<Browser>;
  context(browser: Browser): Promise<BrowserContext>;
  finish(): Promise<IPlaytestDeviceMetricsObservation | undefined>;
  navigationUrl(config: IStandalonePlaytestConfig): string;
  prepare(config: IStandalonePlaytestConfig): Promise<void>;
}

export function openRunnerPage(
  page: Page,
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
  remoteBrowser: Pick<IRemoteBrowserSession, "navigationUrl"> | undefined,
): Promise<IPlaytestBridgeClient | undefined> {
  const navigationUrl = remoteBrowser?.navigationUrl(config) ?? config.url;
  // This copy is navigation-only. Reports and operator diagnostics retain the URL supplied on
  // the command line, while Android Chrome reaches the same server through its reverse tunnel.
  return openPageAndConnectBridge(page, { ...config, url: navigationUrl }, scenario);
}

export async function teardownBrowserSession(
  page: Pick<Page, "close"> | undefined,
  context: Pick<BrowserContext, "close"> | undefined,
  browser: Pick<Browser, "close"> | undefined,
  browserLaunch: Promise<Browser> | undefined,
  remoteBrowser: { close(): Promise<void> } | undefined,
): Promise<void> {
  if (remoteBrowser !== undefined) {
    // CDP attaches to the user's default Android Chrome context. Closing that context or the
    // connected Browser shuts down pre-existing tabs and the Chrome process; this run owns only
    // the page it created and its adb plumbing.
    await boundedTeardownStep(page?.close(), 5_000);
    await settledTeardownValue(browserLaunch, 10_000);
    await boundedTeardownStep(remoteBrowser.close(), 10_000);
    return;
  }
  await boundedTeardownStep(context?.close(), 5_000);
  const launched = browser ?? (await settledTeardownValue(browserLaunch, 10_000));
  await boundedTeardownStep(launched?.close(), 10_000);
}
