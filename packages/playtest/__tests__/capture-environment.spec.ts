import { expect, test } from "vitest";

import {
  childEnvForDisplay,
  decideDisplayStrategy,
  provideDisplay,
  runNeedsPixels,
} from "../src/runner/captureEnvironment.js";

const socketPresent = () => true;

const pixelScenario = {
  artifacts: { screenshots: "after" as const },
  steps: [],
};

test("a non-Linux platform always delegates to the host display", () => {
  expect(decideDisplayStrategy({ env: {}, platform: "darwin" })).toEqual({ kind: "host" });
  expect(
    decideDisplayStrategy({ env: { WAYLAND_DISPLAY: "wayland-0" }, platform: "win32" }),
  ).toEqual({ kind: "host" });
});

test("a live X display is NOT taken by default — a run must not paint on the operator's desktop", () => {
  expect(
    decideDisplayStrategy({ env: { DISPLAY: ":0" }, platform: "linux", displaySocketExists: socketPresent }),
  ).toMatchObject({ kind: "private-xvfb" });
});

test("TN_PLAYTEST_HOST_DISPLAY opts a run back onto the live X display", () => {
  expect(
    decideDisplayStrategy({
      displaySocketExists: socketPresent,
      env: { DISPLAY: ":99", TN_PLAYTEST_HOST_DISPLAY: "1" },
      platform: "linux",
    }),
  ).toEqual({ kind: "existing", display: ":99" });
});

test("asking for the host display when it is unusable still falls to a private Xvfb, never blind", () => {
  expect(
    decideDisplayStrategy({
      displaySocketExists: () => false,
      env: { DISPLAY: ":7", TN_PLAYTEST_HOST_DISPLAY: "1" },
      platform: "linux",
    }),
  ).toMatchObject({ kind: "private-xvfb" });
});

test("a DISPLAY whose socket is gone is treated as unusable, not trusted", () => {
  expect(
    decideDisplayStrategy({ env: { DISPLAY: ":7" }, platform: "linux", displaySocketExists: () => false }),
  ).toMatchObject({ kind: "private-xvfb" });
});

test("Wayland alone never satisfies the run — that session hung Chromium at 120s vs 175ms", () => {
  const strategy = decideDisplayStrategy({
    env: { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
    platform: "linux",
    displaySocketExists: () => false,
  });
  expect(strategy).toMatchObject({ kind: "private-xvfb" });
});

test("the screen geometry follows TN_XVFB_SCREEN like the wrapper", () => {
  expect(
    decideDisplayStrategy({
      env: { TN_XVFB_SCREEN: "1280x720x16" },
      platform: "linux",
      displaySocketExists: () => false,
    }),
  ).toEqual({ kind: "private-xvfb", screen: "1280x720x16" });
  expect(decideDisplayStrategy({ env: {}, platform: "linux" })).toEqual({
    kind: "private-xvfb",
    screen: "1600x900x24",
  });
});

test("the browser child environment carries DISPLAY and no Wayland vars", () => {
  const child = childEnvForDisplay(
    { PATH: "/usr/bin", WAYLAND_DISPLAY: "wayland-0", WAYLAND_SOCKET: "wayland-0", XDG_SESSION_TYPE: "wayland" },
    ":42",
  );
  expect(child.DISPLAY).toBe(":42");
  expect(child.WAYLAND_DISPLAY).toBeUndefined();
  expect(child.WAYLAND_SOCKET).toBeUndefined();
  expect(child.XDG_SESSION_TYPE).toBeUndefined();
  expect(child.PATH).toBe("/usr/bin");
});

test("childEnvForDisplay never mutates the parent environment", () => {
  const parent = { DISPLAY: undefined, WAYLAND_DISPLAY: "wayland-0" } as NodeJS.ProcessEnv;
  childEnvForDisplay(parent, ":5");
  expect(parent).toEqual({ DISPLAY: undefined, WAYLAND_DISPLAY: "wayland-0" });
});

test("runs that produce pixels need a display; pure assertion runs do not", () => {
  expect(runNeedsPixels({ headless: true }, pixelScenario)).toBe(true);
  expect(runNeedsPixels({ headless: false }, { artifacts: { screenshots: false }, steps: [] })).toBe(true);
  expect(
    runNeedsPixels(
      { headless: true },
      { artifacts: { screenshots: false }, steps: [{ release: true, screenshot: "mid" }] },
    ),
  ).toBe(true);
  // Screenshots are on by default: only an explicit opt-out removes the pixel requirement.
  expect(runNeedsPixels({ headless: true }, { artifacts: undefined, steps: [] })).toBe(true);
  expect(runNeedsPixels({ headless: true }, { artifacts: { screenshots: false }, steps: [] })).toBe(false);
});

test("without Xvfb installed a pixel run fails closed naming the cause", async () => {
  await expect(
    provideDisplay({
      commandExists: () => false,
      displaySocketExists: () => false,
      env: {},
      platform: "linux",
    }),
  ).rejects.toThrow(/Xvfb is not installed/);
});

test("a private Xvfb is spawned, adopted, and released", async () => {
  let spawnedCommand: string | undefined;
  let killed = false;
  const fakeChild = {
    exitCode: null,
    kill: () => {
      killed = true;
      return true;
    },
    stdio: [] as unknown[],
  } as never;
  const { spawn } = await import("node:child_process");
  const { EventEmitter } = await import("node:events");
  const fd3 = new EventEmitter();
  (fakeChild as unknown as { stdio: unknown[] }).stdio = [undefined, undefined, undefined, fd3];
  const originalSpawn = spawn;
  const provided = await provideDisplay({
    commandExists: () => true,
    displaySocketExists: () => false,
    env: { PATH: "/usr/bin", WAYLAND_DISPLAY: "wayland-0" },
    platform: "linux",
    spawnProcess: ((command: string) => {
      spawnedCommand = command;
      queueMicrotask(() => fd3.emit("data", Buffer.from("57\n")));
      return fakeChild;
    }) as typeof originalSpawn,
  });
  expect(spawnedCommand).toBe("Xvfb");
  expect(provided.display).toBe(":57");
  expect(provided.strategy).toMatchObject({ kind: "private-xvfb" });
  expect(provided.env.DISPLAY).toBe(":57");
  expect(provided.env.WAYLAND_DISPLAY).toBeUndefined();
  await provided.release();
  expect(killed).toBe(true);
});
