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
});
