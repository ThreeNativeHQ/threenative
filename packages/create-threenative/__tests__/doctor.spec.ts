import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  type IProjectSnapshot,
  diagnoseProject,
  formatDoctorReport,
  probeDesktopOverlay,
  readProject,
} from "../src/doctor.js";

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
    ["@threenative/runtime-native", "0.4.0"],
  ]),
  packageJson: {
    dependencies: { "@threenative/core": "0.4.0", "@threenative/physics": "0.4.0" },
    name: "my-game",
    optionalDependencies: { "@threenative/runtime-native": "0.4.0" },
  },
  readText: (relative) => (relative === "src/game.ts" ? "export default defineGame({})" : ""),
  readRuntimeText: (relative) =>
    relative === "prebuilt/install-status.json"
      ? JSON.stringify({
          key: `${process.platform}-${process.arch}`,
          ok: true,
          reason: "installed",
          url: "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.4.0/prebuilt-lock.json",
          version: "0.4.0",
        })
      : undefined,
  runtimeFileExists: (relative) =>
    relative ===
      `prebuilt/${process.platform}-${process.arch}/${process.platform === "win32" ? "threenative-runtime.exe" : "threenative-runtime"}` ||
    relative === "scripts/package-android.mjs" ||
    relative === "scripts/package-ios.mjs",
  runtimeManifestUrl:
    "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.4.0/prebuilt-lock.json",
  runtimeRoot: "/runtime-native",
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
  it("names the compositor-less X11 blocker before a build", () => {
    const probe = probeDesktopOverlay({ DISPLAY: ":99" }, () => false);
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/game.ts", ui: { renderer: "web" } },
        desktopOverlay: probe,
      }),
    );

    expect(check(report, "desktop overlay")).toMatchObject({
      detail: expect.stringContaining("no compositing manager is running"),
      status: "fail",
    });
    expect(formatDoctorReport(report)).toContain("Start a compositing manager");
  });

  it("names the Wayland transparent-container blocker before a build", () => {
    const probe = probeDesktopOverlay(
      { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" },
      () => true,
    );
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/game.ts", ui: { renderer: "web" } },
        desktopOverlay: probe,
      }),
    );

    expect(probe).toMatchObject({
      detail: expect.stringContaining("transparent container could not be created"),
      status: "fail",
    });
    expect(check(report, "desktop overlay")).toMatchObject({
      detail: expect.stringContaining("transparent container could not be created"),
      status: "fail",
    });
  });

  it("does not report a desktop overlay blocker for native UI", () => {
    const probe = probeDesktopOverlay({ DISPLAY: ":99" }, () => false);
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/game.ts", ui: { renderer: "native" } },
        desktopOverlay: probe,
      }),
    );

    expect(report.checks.some(({ name }) => name === "desktop overlay")).toBe(false);
    expect(report.pass).toBe(true);
  });

  it("passes a healthy scaffolded project", () => {
    const report = diagnoseProject(HEALTHY);
    expect(report.pass).toBe(true);
    expect(report.checks.every(({ status }) => status !== "fail")).toBe(true);
    expect(check(report, "native runtime")).toMatchObject({ status: "ok" });
    expect(check(report, "native runtime").detail).toMatch(/^available/u);
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

  it("fails when the native runtime install recorded a failure", () => {
    const report = diagnoseProject(
      snapshot({
        readRuntimeText: () =>
          JSON.stringify({
            key: `${process.platform}-${process.arch}`,
            ok: false,
            reason:
              "Prebuilt release manifest fetch failed at https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.4.0/prebuilt-lock.json: HTTP 404.",
          }),
      }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "native runtime").status).toBe("fail");
    expect(check(report, "native runtime").detail).toMatch(/linux-x64|native runtime/u);
    expect(check(report, "native runtime").detail).toMatch(/HTTP 404/u);
  });

  it("fails when the recorded native runtime binary is gone", () => {
    const report = diagnoseProject(snapshot({ runtimeFileExists: () => false }));
    expect(report.pass).toBe(false);
    expect(check(report, "native runtime").detail).toMatch(/prebuilt binary.*gone|missing/u);
  });

  it("reports an unknown native state when the install status file is deleted", () => {
    const report = diagnoseProject(snapshot({ readRuntimeText: () => undefined }));
    expect(check(report, "native runtime")).toMatchObject({ status: "warn" });
    expect(check(report, "native runtime").detail).toMatch(/unknown.*install status/u);
  });

  it("lists web, desktop, Android, and iOS target availability", () => {
    const report = diagnoseProject(HEALTHY);
    for (const target of ["web", "desktop", "android", "ios"])
      expect(check(report, `target ${target}`).detail).toMatch(/available|unavailable/u);
    expect(check(report, "target web").status).toBe("ok");
    expect(check(report, "target desktop").status).toBe("ok");
    expect(check(report, "target android").status).toBe("ok");
    if (process.platform === "darwin" && process.arch === "arm64") {
      expect(check(report, "target ios").status).toBe("ok");
    } else {
      expect(check(report, "target ios")).toMatchObject({ status: "warn" });
      expect(check(report, "target ios").detail).toMatch(/requires darwin-arm64.*received/u);
    }
  });

  it("fails when install status belongs to a stale runtime version", () => {
    const report = diagnoseProject(
      snapshot({
        readRuntimeText: () =>
          JSON.stringify({
            key: `${process.platform}-${process.arch}`,
            ok: true,
            reason: "installed",
            url: "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.9/prebuilt-lock.json",
            version: "0.3.9",
          }),
      }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "native runtime").detail).toMatch(/version.*0\.3\.9.*0\.4\.0/u);
  });

  it("fails when install status names a stale release URL", () => {
    const report = diagnoseProject(
      snapshot({
        readRuntimeText: () =>
          JSON.stringify({
            key: `${process.platform}-${process.arch}`,
            ok: true,
            reason: "installed",
            url: "https://example.invalid/runtime-native-v0.4.0/prebuilt-lock.json",
            version: "0.4.0",
          }),
      }),
    );
    expect(report.pass).toBe(false);
    expect(check(report, "native runtime").detail).toMatch(/release URL.*example\.invalid/u);
  });
});

describe("threenative doctor command", () => {
  it("loads the shipped TypeScript config before deciding whether to probe the web overlay", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-config-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default {};");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "doctor-config", type: "module" }),
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      'export default { nativeEntry: "src/game.ts", ui: { renderer: "web" } };\n',
    );

    const snapshot = await readProject(root);

    expect(snapshot.config).toMatchObject({ ui: { renderer: "web" } });
    expect(snapshot.desktopOverlay).toBeDefined();
  });

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
