import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debugFlag, exposeDebug } from "../src/debug.js";

interface IDevTools {
  __THREENATIVE__?: { debug?: Record<string, unknown> } & Record<string, unknown>;
}

/** The one global `exposeDebug` writes, as a game sees it. */
function devTools(): ({ debug?: Record<string, unknown> } & Record<string, unknown>) | undefined {
  return (globalThis as unknown as IDevTools).__THREENATIVE__;
}

describe("debugFlag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("should read the query string by its camelCase name", () => {
    vi.stubGlobal("location", { search: "?freeCam&seed=7" });

    expect(debugFlag("freeCam")).toBe(true);
    expect(debugFlag("free_camera")).toBe(false);
  });

  it("should read a switch the URL spells as 0 or false as off", () => {
    vi.stubGlobal("location", { search: "?freeCam=0" });
    expect(debugFlag("freeCam")).toBe(false);

    vi.stubGlobal("location", { search: "?freeCam=false" });
    expect(debugFlag("freeCam")).toBe(false);
  });

  it("should read TN_DEBUG_<UPPER_SNAKE> from the environment", () => {
    vi.stubEnv("TN_DEBUG_FREE_CAM", "1");

    expect(debugFlag("freeCam")).toBe(true);
    expect(debugFlag("free_camera")).toBe(false);
  });

  it("should read a switch the environment spells as 0 or false as off", () => {
    vi.stubEnv("TN_DEBUG_FREE_CAM", "0");
    expect(debugFlag("freeCam")).toBe(false);

    vi.stubEnv("TN_DEBUG_FREE_CAM", "false");
    expect(debugFlag("freeCam")).toBe(false);
  });

  it("should answer false on a host that publishes neither global", () => {
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("location", undefined);

    expect(debugFlag("freeCam")).toBe(false);
  });
});

describe("exposeDebug", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("should publish under __THREENATIVE__.debug in a dev build and keep other keys", () => {
    const snapshot = (): Record<string, never> => ({});
    vi.stubGlobal("__THREENATIVE__", { snapshot });

    exposeDebug("player", { hp: 3 });
    exposeDebug("ship", { hull: 12 });

    expect(devTools()?.debug).toEqual({ player: { hp: 3 }, ship: { hull: 12 } });
    expect(devTools()?.snapshot).toBe(snapshot);
  });

  it("should publish nothing outside a bundler dev build, and read TN_DEBUG_* in a plain ESM process", () => {
    // The production branch cannot be reached from inside vitest, where `import.meta.env` is
    // always the bundler's own and a dynamic import of the build is transformed by the same
    // pipeline. A separate node process loading the built package is the honest stand-in: the same
    // plain ESM file the native bundle is, with no `import.meta.env` and the `process.env` the host
    // publishes `TN_DEBUG_*` into. It proves both halves at once.
    const dist = pathToFileURL(path.resolve("packages/core/dist/index.js")).href;
    const source = [
      `const core = await import(${JSON.stringify(dist)});`,
      "core.exposeDebug('player', { hp: 3 });",
      "process.stdout.write(JSON.stringify({",
      "  flag: core.debugFlag('freeCam'),",
      "  off: core.debugFlag('radar'),",
      "  published: globalThis.__THREENATIVE__ !== undefined,",
      "}));",
    ].join("\n");
    const run = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8",
      env: { ...process.env, TN_DEBUG_FREE_CAM: "1" },
    });

    expect(JSON.parse(run)).toEqual({ flag: true, off: false, published: false });
  });
});
