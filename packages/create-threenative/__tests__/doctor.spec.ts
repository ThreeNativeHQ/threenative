import { describe, expect, it } from "vitest";

import { type IProjectSnapshot, diagnoseProject } from "../src/doctor.js";

const HEALTHY: IProjectSnapshot = {
  config: { nativeEntry: "src/game.ts" },
  files: new Set([
    ".mcp.json",
    "package.json",
    "playtests/smoke.playtest.json",
    "src/game.ts",
    "src/main.ts",
  ]),
  installedVersions: new Map([
    ["@threenative/core", "0.4.0"],
    ["@threenative/physics", "0.4.0"],
  ]),
  packageJson: {
    dependencies: { "@threenative/core": "0.4.0", "@threenative/physics": "0.4.0" },
    name: "my-game",
  },
  readText: (relative) => (relative === "src/game.ts" ? "export default defineGame({})" : ""),
};

function snapshot(overrides: Partial<IProjectSnapshot>): IProjectSnapshot {
  return { ...HEALTHY, ...overrides };
}

function check(report: ReturnType<typeof diagnoseProject>, name: string) {
  const found = report.checks.find((candidate) => candidate.name === name);
  if (found === undefined)
    throw new Error(`no check named '${name}' in ${report.checks.map((c) => c.name).join(", ")}`);
  return found;
}

describe("threenative doctor", () => {
  it("passes a healthy scaffolded project", () => {
    const report = diagnoseProject(HEALTHY);
    expect(report.pass).toBe(true);
    expect(report.checks.every(({ status }) => status === "ok")).toBe(true);
  });

  it("fails when there is no package.json to read", () => {
    const report = diagnoseProject(snapshot({ files: new Set(), packageJson: undefined }));
    expect(report.pass).toBe(false);
    expect(check(report, "package.json").status).toBe("fail");
  });

  it("fails when a declared @threenative dependency was never installed", () => {
    const report = diagnoseProject(
      snapshot({ installedVersions: new Map([["@threenative/core", "0.4.0"]]) }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "dependencies").detail).toMatch(/@threenative\/physics/);
    expect(check(report, "dependencies").fix).toMatch(/install/i);
  });

  it("fails when installed @threenative packages disagree on version, naming both", () => {
    const report = diagnoseProject(
      snapshot({
        installedVersions: new Map([
          ["@threenative/core", "0.4.0"],
          ["@threenative/physics", "0.3.1"],
        ]),
      }),
    );
    expect(report.pass).toBe(false);
    const detail = check(report, "versions").detail;
    expect(detail).toMatch(/0\.4\.0/);
    expect(detail).toMatch(/0\.3\.1/);
  });

  it("fails when the portable entry is missing, because native builds start there", () => {
    const report = diagnoseProject(
      snapshot({
        files: new Set([
          ".mcp.json",
          "package.json",
          "playtests/smoke.playtest.json",
          "src/main.ts",
        ]),
      }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "native entry").detail).toMatch(/src\/game\.ts/);
  });

  it("fails a portable entry that exports no default game, the way the native host does", () => {
    const report = diagnoseProject(
      snapshot({ readText: () => "export const game = defineGame({})" }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "native entry").detail).toMatch(/default/);
  });

  it("honours a configured native entry instead of assuming src/game.ts", () => {
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/entry/native.ts" },
        files: new Set([
          ".mcp.json",
          "package.json",
          "playtests/smoke.playtest.json",
          "src/entry/native.ts",
          "src/main.ts",
        ]),
        readText: (relative) => (relative === "src/entry/native.ts" ? "export default {}" : ""),
      }),
    );
    expect(check(report, "native entry").status).toBe("ok");
  });

  it("warns when nothing proves the game and when the agent has no capability search", () => {
    const report = diagnoseProject(
      snapshot({ files: new Set(["package.json", "src/game.ts", "src/main.ts"]) }),
    );
    expect(check(report, "playtests").status).toBe("warn");
    expect(check(report, "capability search").status).toBe("warn");
    expect(check(report, "capability search").detail).toMatch(/capabilit/i);
    expect(report.pass).toBe(true);
  });
});

describe("threenative doctor command", () => {
  it("reads a real directory and exits 1 when that directory is not a project", async () => {
    const { runDoctorCommand } = await import("../src/threenative.js");
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const empty = await makeTempDir("tn-doctor-");
    const written: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let exitCode: number;
    try {
      exitCode = await runDoctorCommand([], empty);
    } finally {
      process.stdout.write = write;
    }
    expect(exitCode).toBe(1);
    expect(JSON.parse(written.join("")).pass).toBe(false);
  });

  it("names doctor in the top-level help", async () => {
    const { cliHelp } = await import("../src/threenative.js");
    expect(cliHelp()).toMatch(/doctor/);
    expect(cliHelp("doctor")).toMatch(/Exits 0 when nothing failed/);
  });
});
