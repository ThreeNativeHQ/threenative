import { makeTempDir } from "../../../test-support/temp-dir.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

import { parseLaunchedPid, XcrunIosDriver } from "../src/runner/ios.js";

test("simctl installs, launches with mailbox environment, and uses the app data container", async () => {
  const root = await makeTempDir("playtest-ios-driver-");
  const appPath = join(root, "ThreeNative.app");
  const container = join(root, "data-container");
  await mkdir(appPath);
  const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
  const driver = new XcrunIosDriver({
    appPath,
    bundleId: "dev.threenative.runtime",
    device: "SIM-123",
    transport: "simulator",
  }, async (args, options) => {
    calls.push({ args, env: options?.env });
    if (args[1] === "get_app_container") return `${container}\n`;
    if (args[1] === "launch") return `dev.threenative.runtime: ${process.pid}\n`;
    if (args.includes("log")) return '[info] TN_UI_SAMPLE:{"sequence":321}\n[error] broken user script\n[info] {"failed":0}\n';
    return "";
  });

  await driver.prepare("http://127.0.0.1:41777/playtest");
  await expect(driver.isAlive()).resolves.toBe(true);

  expect(driver.getMailboxRoot()).toBe(join(container, "Documents"));
  expect(calls.map(({ args }) => args.slice(0, 2))).toEqual([
    ["simctl", "bootstatus"],
    ["simctl", "install"],
    ["simctl", "get_app_container"],
    ["simctl", "terminate"],
    ["simctl", "launch"],
  ]);
  const launch = calls.at(-1);
  expect(launch?.env?.SIMCTL_CHILD_TN_PLAYTEST_ENDPOINT).toBe("http://127.0.0.1:41777/playtest");
  expect(launch?.env?.SIMCTL_CHILD_TN_PLAYTEST_MAILBOX_ROOT).toBe(join(container, "Documents"));
  await expect(driver.captureConsole()).resolves.toEqual([
    { text: '[info] TN_UI_SAMPLE:{"sequence":321}', type: "log" },
    { text: "[error] broken user script", type: "error" },
    { text: '[info] {"failed":0}', type: "log" },
  ]);
  expect(calls.at(-1)?.args).toContain(`processIdentifier == ${process.pid}`);
});

test("iOS console severity follows the OS token, not incidental error text", async () => {
  const root = await makeTempDir("playtest-ios-severity-");
  const appPath = join(root, "ThreeNative.app");
  const container = join(root, "data-container");
  await mkdir(appPath);

  // Captured verbatim from the failed simulator run: a Default asset catalog record whose text
  // mentions an error domain, real E/F records with no error keyword, a JS marker transported as
  // Default, a non-Apple record whose message embeds an Apple-looking subsystem field behind a
  // custom one, and an unrecognised line that must keep the conservative text scan.
  const assetManagerDefault =
    `2026-09-22 15:07:18.517 Df threenative-ios[40455:17a9f] [com.apple.UIKit:AssetManager] Could not load asset catalog from bundle NSBundle </Users/runner/Library/Developer/CoreSimulator/Devices/E952A9B0-CC78-435C-BF08-06AD47FE1076/data/Containers/Bundle/Application/D80D5F1D-0655-4437-8221-6085BE423D2E/threenative-ios.app> (loaded): Error Domain=NSCocoaErrorDomain Code=260 "RunTimeThemeRefForBundleIdentifierAndName() couldn't find Assets.car in bundle with identifier: dev.threenative.runtime" UserInfo={NSLocalizedDescription=RunTimeThemeRefForBundleIdentifierAndName() couldn't find Assets.car in bundle with identifier: dev.threenative.runtime}`;
  const pluginFault =
    "2026-09-22 15:07:18.506 F  threenative-ios[40455:17a9f] [com.apple.runtime-issues:UIKit App Config] `UIScene` lifecycle will soon be required. Failure to adopt will result in an assert in the future.";
  const launchMeasurementError =
    "2026-09-22 15:07:18.566 E  threenative-ios[40455:17aa3] [com.apple.app_launch_measurement:General] Failed to send CA Event for app launch measurements for ca_event_type: 0 event_name: com.apple.app_launch_measurement.FirstFramePresentationMetric";
  const appMarkerInDefault =
    "2026-09-22 15:07:18.700 Df threenative-ios[40455:17a9f] [com.apple.Foundation:general] [error] TN_UI bridge failed";
  // A custom-subsystem Default record whose *message* quotes `[com.apple.UIKit:AssetManager]`.
  // The Apple-looking field is not in the compact prefix, so this is not an OS record: the text
  // carries a real Error and must stay `error` rather than being read as a benign Apple log.
  const embeddedAppleFieldInCustomSubsystem =
    "2026-09-22 15:07:20.123 Df threenative-ios[40455:17a9f] [com.example.game:ui] bridge note referencing [com.apple.UIKit:AssetManager]: Error Domain=NSCocoaErrorDomain Code=260 could not find Assets.car";
  const unknownFormat = "[info] Error Domain=NSCocoaErrorDomain Code=260 could not find Assets.car";

  const driver = new XcrunIosDriver({
    appPath,
    bundleId: "dev.threenative.runtime",
    device: "SIM-123",
    transport: "simulator",
  }, async (args) => {
    if (args[1] === "get_app_container") return `${container}\n`;
    if (args[1] === "launch") return `dev.threenative.runtime: ${process.pid}\n`;
    if (args.includes("log")) {
      return `${[
        assetManagerDefault,
        pluginFault,
        launchMeasurementError,
        appMarkerInDefault,
        embeddedAppleFieldInCustomSubsystem,
        unknownFormat,
      ].join("\n")}\n`;
    }
    return "";
  });

  await driver.prepare("http://127.0.0.1:41777/playtest");
  await expect(driver.captureConsole()).resolves.toEqual([
    { text: assetManagerDefault, type: "log" },
    { text: pluginFault, type: "error" },
    { text: launchMeasurementError, type: "error" },
    { text: appMarkerInDefault, type: "error" },
    { text: embeddedAppleFieldInCustomSubsystem, type: "error" },
    { text: unknownFormat, type: "error" },
  ]);
});

test("simulator mailbox paths are remapped after simctl resolves the container", async () => {
  const root = await makeTempDir("playtest-ios-mailbox-");
  const appPath = join(root, "ThreeNative.app");
  const container = join(root, "container");
  await mkdir(appPath);
  const driver = new XcrunIosDriver({ appPath, bundleId: "dev.example", transport: "simulator" }, async (args) => {
    if (args[1] === "get_app_container") return container;
    if (args[1] === "launch") return "dev.example: 22";
    return "";
  });
  await driver.prepare("http://127.0.0.1:41777/playtest");

  await driver.writeFile("/placeholder/tn-playtest-request.json", "request");
  await writeFile(join(container, "Documents", "tn-playtest-response.json"), "response");

  await expect(driver.readFile("/placeholder/tn-playtest-response.json")).resolves.toBe("response");
  await expect(driver.readFile("/placeholder/tn-playtest-request.json")).resolves.toBe("request");
  await driver.removeFile("/placeholder/tn-playtest-response.json");
  await expect(driver.readFile("/placeholder/tn-playtest-response.json")).resolves.toBeUndefined();
});

test("devicectl mode requires an explicit physical device and uses install plus process launch", async () => {
  const root = await makeTempDir("playtest-ios-device-");
  const appPath = join(root, "ThreeNative.app");
  await mkdir(appPath);
  const calls: readonly string[][] = [];
  const driver = new XcrunIosDriver({
    appPath,
    bundleId: "dev.example",
    device: "PHONE-123",
    transport: "device",
  }, async (args) => {
    (calls as string[][]).push([...args]);
    return args.includes("launch") ? "Launched application with pid 9001" : "";
  });

  await driver.prepare("http://127.0.0.1:41777/playtest");

  expect(calls[0]).toEqual(expect.arrayContaining(["devicectl", "install", "PHONE-123", appPath]));
  expect(calls[1]).toEqual(expect.arrayContaining(["devicectl", "launch", "--terminate-existing", "PHONE-123", "dev.example"]));
});

test("launch parsing and a missing app fail closed", async () => {
  expect(() => parseLaunchedPid("launch succeeded without an id")).toThrow(/process id/u);
  const driver = new XcrunIosDriver({
    appPath: "/missing/ThreeNative.app",
    bundleId: "dev.example",
    transport: "simulator",
  }, async () => "");
  await expect(driver.prepare("http://127.0.0.1:41777/playtest")).rejects.toThrow(/not found/u);
  await expect(driver.captureConsole()).rejects.toThrow(/launched process/u);
});
