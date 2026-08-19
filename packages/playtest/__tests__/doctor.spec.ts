import { describe, expect, it } from "vitest";

import { diagnoseHarness, type IHarnessEnvironment } from "../src/runner/doctor.js";

const EQUIPPED: IHarnessEnvironment = {
  browserExecutable: () => "/home/agent/.cache/ms-playwright/chromium/headless_shell",
  display: ":0",
  hasCommand: () => true,
  nodeVersion: "22.11.0",
  platform: "linux",
  resolveModule: () => "/repo/node_modules/playwright/index.js",
};

function environment(overrides: Partial<IHarnessEnvironment>): IHarnessEnvironment {
  return { ...EQUIPPED, ...overrides };
}

function check(report: ReturnType<typeof diagnoseHarness>, name: string) {
  const found = report.checks.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no check named '${name}' in ${report.checks.map((c) => c.name).join(", ")}`);
  return found;
}

describe("playtest doctor", () => {
  it("passes on a fully equipped machine and still reports every check it made", () => {
    const report = diagnoseHarness(EQUIPPED);
    expect(report.pass).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);
    expect(report.checks.every(({ status }) => status === "ok")).toBe(true);
  });

  it("fails when playwright is absent, because no browser target can run without it", () => {
    const report = diagnoseHarness(environment({ resolveModule: () => undefined }));
    expect(report.pass).toBe(false);
    expect(check(report, "playwright").status).toBe("fail");
    expect(check(report, "playwright").fix).toMatch(/install/i);
  });

  it("fails when the browser binary was never downloaded, and says which command downloads it", () => {
    const report = diagnoseHarness(environment({ browserExecutable: () => undefined }));
    expect(report.pass).toBe(false);
    expect(check(report, "chromium").status).toBe("fail");
    expect(check(report, "chromium").fix).toMatch(/playwright install/);
  });

  it("warns rather than fails when a headless Linux box has no display and no Xvfb", () => {
    const report = diagnoseHarness(
      environment({ display: undefined, hasCommand: (command) => command !== "Xvfb" }),
    );
    expect(check(report, "display").status).toBe("warn");
    expect(check(report, "display").fix).toMatch(/xvfb\.sh/);
    expect(report.pass).toBe(true);
  });

  it("does not ask a platform that owns its display for Xvfb", () => {
    const report = diagnoseHarness(
      environment({ display: undefined, hasCommand: () => false, platform: "darwin" }),
    );
    expect(check(report, "display").status).toBe("ok");
  });

  it("names the target each missing device tool costs, without failing the run", () => {
    const report = diagnoseHarness(environment({ hasCommand: (command) => command === "Xvfb" }));
    expect(check(report, "adb").status).toBe("warn");
    expect(check(report, "adb").detail).toMatch(/--target android/);
    expect(check(report, "xcrun").status).toBe("warn");
    expect(check(report, "xcrun").detail).toMatch(/--target ios/);
    expect(report.pass).toBe(true);
  });

  it("fails a node old enough to break the runner", () => {
    const report = diagnoseHarness(environment({ nodeVersion: "18.19.0" }));
    expect(check(report, "node").status).toBe("fail");
    expect(report.pass).toBe(false);
  });
});

describe("threenative-playtest doctor", () => {
  it("is reachable as a command and reports this machine as JSON", async () => {
    const { main } = await import("../src/runner/cli.js");
    const written: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let exitCode: number;
    try {
      exitCode = await main(["doctor"]);
    } finally {
      process.stdout.write = write;
      process.exitCode = 0;
    }
    const report = JSON.parse(written.join("")) as { checks: { name: string; status: string }[]; pass: boolean };
    expect(report.checks.map(({ name }) => name)).toContain("chromium");
    expect(report.checks.every(({ status }) => ["ok", "warn", "fail"].includes(status))).toBe(true);
    expect(exitCode).toBe(report.pass ? 0 : 1);
  });

  it("is listed in the usage text, so an agent reading --help can find it", async () => {
    const { formatUsage } = await import("../src/runner/config.js");
    expect(formatUsage()).toMatch(/doctor/);
  });
});
