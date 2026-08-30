import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { connectDevicePlaytestBridge, type IDeviceBridgeInstallation } from "../src/three/device.js";
import { deviceTimeoutDiagnostic } from "../src/runner/deviceTransport.js";
import { playtestDiagnostic } from "../src/index.js";
import type { IPlaytestBridgeV1 } from "../src/index.js";

interface IWatchdogWorld {
  errors: string[];
  frames: Array<() => void>;
  receives: number;
  restore(): void;
}

function installWithFramePatch(): IWatchdogWorld {
  const errors: string[] = [];
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map((part) => String(part)).join(" "));
  });
  const frames: Array<() => void> = [];
  let receives = 0;
  const globals = globalThis as typeof globalThis & {
    // biome-ignore lint/style/useNamingConvention: mirrors the native host's global name
    TN_PLAYTEST_MAILBOX?: unknown;
    // biome-ignore lint/style/useNamingConvention: mirrors the native host's global name
    __THREENATIVE_NATIVE__?: unknown;
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  };
  const previous = {
    mailbox: globals.TN_PLAYTEST_MAILBOX,
    native: globals.__THREENATIVE_NATIVE__,
    raf: globals.requestAnimationFrame,
    caf: globals.cancelAnimationFrame,
  };
  globals.TN_PLAYTEST_MAILBOX = { request: "/mailbox/request.json", response: "/mailbox/response.json" };
  globals.__THREENATIVE_NATIVE__ = {
    playtest: {
      receive: () => {
        receives += 1;
        return undefined;
      },
      respond: () => true,
    },
  };
  globals.requestAnimationFrame = (callback: (time: number) => void): number => {
    frames.push(() => callback(0));
    return frames.length;
  };
  globals.cancelAnimationFrame = () => undefined;

  const bridge = {
    describe: () => ({ capabilities: [], limits: {}, name: "test", protocolVersion: "1" }),
  } as unknown as IPlaytestBridgeV1;
  const installation: IDeviceBridgeInstallation = connectDevicePlaytestBridge(bridge, "http://127.0.0.1:1/playtest");

  return {
    errors,
    frames,
    get receives() {
      return receives;
    },
    restore(): void {
      installation.close();
      errorSpy.mockRestore();
      globals.TN_PLAYTEST_MAILBOX = previous.mailbox;
      globals.__THREENATIVE_NATIVE__ = previous.native;
      globals.requestAnimationFrame = previous.raf;
      globals.cancelAnimationFrame = previous.caf;
    },
  };
}

describe("native mailbox silence is named, never silent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a stopped frame pump is reported as a named stall diagnostic while timers still run", () => {
    const world = installWithFramePatch();
    try {
      vi.advanceTimersByTime(250 * 9);
      const stalls = world.errors.filter((text) => text.includes("TN_PLAYTEST_MAILBOX_POLL_STALLED"));
      expect(stalls).toHaveLength(1);
      expect(stalls[0]).toMatch(/frame pump/iu);
    } finally {
      world.restore();
    }
  });

  test("a stopped frame pump still polls the mailbox within the operation timeout", () => {
    const world = installWithFramePatch();
    try {
      vi.advanceTimersByTime(250 * 9);
      expect(world.receives).toBeGreaterThan(0);
    } finally {
      world.restore();
    }
  });

  test("a live frame pump never reports a stall", () => {
    const world = installWithFramePatch();
    try {
      for (let beat = 0; beat < 20; beat += 1) {
        vi.advanceTimersByTime(250);
        for (const frame of world.frames.splice(0)) frame();
      }
      expect(world.errors.filter((text) => text.includes("TN_PLAYTEST_MAILBOX_POLL_STALLED"))).toHaveLength(0);
    } finally {
      world.restore();
    }
  });

  test("a runner timeout against a dead host is named as a host exit, with the host's last words", () => {
    const timeout = playtestDiagnostic(
      "TN_PLAYTEST_OPERATION_TIMEOUT",
      "Device mailbox operation '5' exceeded 5000ms.",
      "Confirm the app is running and its native mailbox is polling the configured files.",
    );
    const named = deviceTimeoutDiagnostic(timeout, false, [
      "[Mystral] Caught signal SIGSEGV, exiting gracefully",
    ]);
    expect(named.code).toBe("TN_PLAYTEST_HOST_EXITED");
    expect(named.message).toContain("SIGSEGV");
  });

  test("a runner timeout against a live host keeps the operation-timeout name", () => {
    const timeout = playtestDiagnostic(
      "TN_PLAYTEST_OPERATION_TIMEOUT",
      "Device mailbox operation '5' exceeded 5000ms.",
      "Confirm the app is running and its native mailbox is polling the configured files.",
    );
    expect(deviceTimeoutDiagnostic(timeout, true, []).code).toBe("TN_PLAYTEST_OPERATION_TIMEOUT");
    expect(deviceTimeoutDiagnostic(timeout, undefined, []).code).toBe("TN_PLAYTEST_OPERATION_TIMEOUT");
  });

  test("non-timeout diagnostics pass through untouched", () => {
    const other = playtestDiagnostic("TN_PLAYTEST_DEVICE_FAILED", "device unreachable", "check the device");
    expect(deviceTimeoutDiagnostic(other, false, ["ignored"])).toBe(other);
  });

  test("protocol diagnostics preserve a corrective next command", () => {
    expect(
      playtestDiagnostic(
        "TN_PLAYTEST_DEVICE_FAILED",
        "device unreachable",
        "check the device",
        { capability: "native-device", nextCommand: "pnpm doctor", path: "device.status" },
      ),
    ).toMatchObject({ capability: "native-device", fix: { nextCommand: "pnpm doctor" }, path: "device.status" });
  });
});
