import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: execFileSyncMock, spawnSync: spawnSyncMock };
});

import { assertNativeAssetsCompatible } from "../src/build.js";
import {
  type IProjectSnapshot,
  MCP_SERVER_SPECS,
  detectX11Compositor,
  diagnoseProject,
  formatDoctorReport,
  nativeRuntimeCheck,
  probeAndroidToolchain,
  probeDesktopOverlay,
  readProject,
} from "../src/doctor.js";

const MCP_CONFIG = JSON.stringify({
  mcpServers: {
    "threenative-assets": {
      command: "node",
      args: ["./node_modules/@threenative/core/mcp/assets.mjs"],
      env: { ASSET_DOWNLOAD_DIR: "./public/assets", AUDIO_DOWNLOAD_DIR: "./public/audio" },
    },
    "threenative-sculpt": {
      command: "node",
      args: ["./node_modules/@threenative/core/mcp/sculpt.mjs"],
    },
    "threenative-engine": {
      command: "node",
      args: ["./node_modules/@threenative/core/mcp/engine.mjs"],
    },
  },
});

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
  readText: (relative) =>
    relative === "src/game.ts"
      ? "export default defineGame({})"
      : relative === ".mcp.json"
        ? MCP_CONFIG
        : "",
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

const APK_SHA256 = "409a7f83ac6b31dc8c77e3ec18038f209bd2f545e0f4177c2e2381aa4e067b49";

function snapshot(overrides: Partial<IProjectSnapshot>): IProjectSnapshot {
  return { ...HEALTHY, ...overrides };
}

function check(report: ReturnType<typeof diagnoseProject>, name: string) {
  const found = report.checks.find((candidate) => candidate.name === name);
  if (found === undefined)
    throw new Error(`no check named '${name}' in ${report.checks.map((c) => c.name).join(", ")}`);
  return found;
}

function withPlatform<T>(platform: NodeJS.Platform, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  if (descriptor === undefined) throw new Error("process.platform descriptor is missing");
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return callback();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({
    stderr: 'openjdk version "17.0.1"',
    stdout: "",
    status: 0,
  });
});

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

  it("fails when the authoring agent has no capability search", () => {
    const report = diagnoseProject(
      snapshot({ files: new Set(["package.json", "src/game.ts", "src/main.ts"]) }),
    );
    expect(check(report, "playtests").status).toBe("warn");
    expect(check(report, "capability search").status).toBe("fail");
    expect(check(report, "capability search").detail).toMatch(/capabilit/i);
    expect(report.pass).toBe(false);
  });

  it("warns when the core package that owns engine discovery is absent", () => {
    const report = diagnoseProject(
      snapshot({
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
      }),
    );
    const engine = report.checks.find(({ name }) => name.includes("@threenative/core"));
    expect(engine).toMatchObject({ status: "warn" });
    expect(engine?.detail).toMatch(/@threenative\/core.*0\.3\.0|0\.3\.0.*@threenative\/core/u);
  });

  it("reports each of the three MCP servers separately", () => {
    const report = diagnoseProject(
      snapshot({
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
      }),
    );
    const serverChecks = report.checks.filter(({ name }) => name.startsWith("capability search:"));
    expect(serverChecks).toHaveLength(3);
    expect(serverChecks.map(({ detail }) => detail).join(" ")).toMatch(/threenative-assets/);
    expect(serverChecks.map(({ detail }) => detail).join(" ")).toMatch(/threenative-sculpt/);
    expect(serverChecks.map(({ detail }) => detail).join(" ")).toMatch(/threenative-engine/);
  });

  it("fails a resolved MCP server whose transport does not initialize", () => {
    const report = diagnoseProject(
      snapshot({
        mcpServerHealth: new Map([
          [
            "threenative-engine",
            { detail: "its MCP transport failed to start: boom", status: "fail" },
          ],
        ]),
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
        resolvePackageDirectory: (name) => (name === "@threenative/core" ? "/engine" : undefined),
      }),
    );
    const engine = report.checks.find(({ name }) => name.includes("@threenative/core"));
    expect(engine).toMatchObject({ status: "fail" });
    expect(engine?.detail).toContain("transport failed to start");
  });

  it("reports malformed capability configuration distinctly", () => {
    const report = diagnoseProject(
      snapshot({
        readText: (relative) => (relative === ".mcp.json" ? "{not-json" : "export default {}"),
      }),
    );
    expect(check(report, "capability search")).toMatchObject({ status: "fail" });
    expect(check(report, "capability search").detail).toMatch(/malformed|invalid JSON/u);
  });

  it("warns before a native build when compiled assets target mobile", () => {
    const report = diagnoseProject(
      snapshot({
        config: {
          nativeEntry: "src/game.ts",
          assets: {
            models: {},
            textures: { overrides: [{ codec: "etc1s", glob: "**/*.png" }] },
          },
        },
        packageJson: {
          ...(HEALTHY.packageJson as Record<string, unknown>),
          scripts: { "build:android": "threenative build --target android" },
        },
      }),
    );
    expect(check(report, "asset pipeline")).toMatchObject({ status: "warn" });
    expect(check(report, "asset pipeline").detail).toMatch(
      /TN_NATIVE_KTX2_UNSUPPORTED.*TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED/u,
    );
  });

  it("warns when mobile targets use the default asset passes", () => {
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/game.ts" },
        packageJson: {
          ...(HEALTHY.packageJson as Record<string, unknown>),
          scripts: { "build:android": "threenative build --target android" },
        },
      }),
    );

    expect(check(report, "asset pipeline")).toMatchObject({ status: "warn" });
    expect(check(report, "asset pipeline").detail).toMatch(
      /TN_NATIVE_KTX2_UNSUPPORTED.*TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED/u,
    );
  });

  it("warns for an omitted asset pass in a partial mobile config", () => {
    const report = diagnoseProject(
      snapshot({
        config: { nativeEntry: "src/game.ts", assets: { textures: "none" } },
        packageJson: {
          ...(HEALTHY.packageJson as Record<string, unknown>),
          scripts: { "build:ios": "threenative build --target ios" },
        },
      }),
    );

    expect(check(report, "asset pipeline")).toMatchObject({ status: "warn" });
    expect(check(report, "asset pipeline").detail).toContain(
      "TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED",
    );
    expect(check(report, "asset pipeline").detail).not.toContain("TN_NATIVE_KTX2_UNSUPPORTED");
  });

  it("keeps explicit mobile asset opt-outs green", () => {
    const report = diagnoseProject(
      snapshot({
        config: {
          nativeEntry: "src/game.ts",
          assets: { models: "none", textures: "none" },
        },
        packageJson: {
          ...(HEALTHY.packageJson as Record<string, unknown>),
          scripts: { "build:android": "threenative build --target android" },
        },
      }),
    );

    expect(check(report, "asset pipeline")).toMatchObject({ status: "ok" });
  });

  it("uses the native build's KTX2 error name for the matching doctor warning", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-native-assets-");
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(
      path.join(root, "public", "assets.manifest.json"),
      JSON.stringify({ entries: { "hero.png": { output: "hero.ktx2" } } }),
    );
    await expect(assertNativeAssetsCompatible(root, "android", {} as never)).rejects.toThrow(
      /TN_NATIVE_KTX2_UNSUPPORTED/u,
    );
  });

  it("warns with the asset path when a download directory cannot be written", () => {
    const report = diagnoseProject(
      snapshot({
        projectRoot: "/tmp/tn-doctor-assets",
        directoryWritable: (relative: string) => relative !== "public/assets",
      } as never),
    );
    expect(check(report, "asset pipeline")).toMatchObject({ status: "warn" });
    expect(check(report, "asset pipeline").detail).toMatch(/public\/assets/u);
  });

  it("reports the playtest runner as missing rather than passing", () => {
    const report = diagnoseProject(
      snapshot({ projectRoot: "/tmp/tn-doctor-playtest", playtestRunnerPath: undefined } as never),
    );
    expect(check(report, "playtest")).toMatchObject({ status: "fail" });
    expect(check(report, "playtest").detail).toMatch(
      /threenative-playtest|@threenative\/playtest/u,
    );
  });

  it("folds the installed playtest doctor result under the playtest heading", () => {
    const report = diagnoseProject(
      snapshot({
        projectRoot: "/tmp/tn-doctor-playtest",
        playtestRunnerPath: "/tmp/tn-doctor-playtest/node_modules/.bin/threenative-playtest",
        runPlaytestDoctor: () => "✓ node: v20.19.6\n✓ chromium: installed",
      } as never),
    );
    expect(check(report, "playtest")).toMatchObject({ status: "ok" });
    expect(check(report, "playtest").detail).toMatch(/chromium.*installed/u);
  });

  it("keeps diagnostics when the delegated playtest doctor exits with output", () => {
    const report = diagnoseProject(
      snapshot({
        projectRoot: "/tmp/tn-doctor-playtest",
        playtestRunnerPath: "/tmp/tn-doctor-playtest/node_modules/.bin/threenative-playtest",
        runPlaytestDoctor: () => {
          throw Object.assign(new Error("runner exited with code 1"), {
            stderr: Buffer.from("stderr blocker"),
            stdout: "stdout context",
          });
        },
      } as never),
    );
    expect(check(report, "playtest")).toMatchObject({ status: "fail" });
    expect(check(report, "playtest").detail).toContain("stderr blocker");
    expect(check(report, "playtest").detail).toContain("stdout context");
  });

  it("executes a POSIX playtest runner directly", () => {
    const runner = "/tmp/tn-doctor-playtest/node_modules/.bin/threenative-playtest";
    execFileSyncMock.mockReturnValue("runner output");
    const report = diagnoseProject(
      snapshot({ projectRoot: "/tmp/tn-doctor-playtest", playtestRunnerPath: runner } as never),
    );

    expect(execFileSyncMock).toHaveBeenCalledWith(
      runner,
      ["doctor", "--text"],
      expect.objectContaining({
        cwd: "/tmp/tn-doctor-playtest",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(check(report, "playtest").detail).toContain("runner output");
  });

  it("executes a Windows .cmd playtest shim through cmd.exe and preserves diagnostics", () => {
    const runner = "C:\\game\\node_modules\\.bin\\threenative-playtest.cmd";
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("runner failed"), {
        stderr: Buffer.from("stderr blocker"),
        stdout: "stdout context",
      });
    });

    const report = withPlatform("win32", () =>
      diagnoseProject(snapshot({ projectRoot: "C:\\game", playtestRunnerPath: runner } as never)),
    );

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "cmd.exe",
      ["/d", "/s", "/c", `"${runner}" doctor --text`],
      expect.objectContaining({
        cwd: "C:\\game",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(check(report, "playtest").detail).toContain("stderr blocker");
    expect(check(report, "playtest").detail).toContain("stdout context");
  });

  it("does not add a runtime dependency on the playtest package", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, unknown> };
    expect(manifest.dependencies?.["@threenative/playtest"]).toBeUndefined();
  });

  it("names the Android JDK and SDK before a native build", () => {
    const report = diagnoseProject(
      snapshot({
        projectRoot: "/tmp/tn-doctor-toolchain",
        androidToolchain: { jdkMajor: 21, jdkVersion: "21.0.1", sdkVersion: "35.0.0" },
      } as never),
    );
    expect(check(report, "target android").detail).toMatch(/JDK 21\.0\.1.*17/u);
    expect(check(report, "target android").status).toBe("warn");
    expect(check(report, "target android").detail).not.toContain("checked by build");
    expect(check(report, "target android").fix).toMatch(/Install Android SDK platform android-35/u);
    expect(check(report, "target android").fix).toMatch(/ANDROID_HOME|ANDROID_SDK_ROOT/u);
    expect(check(report, "target android").fix).not.toContain("THREENATIVE_ANDROID_SDK");
    expect(formatDoctorReport(report)).toMatch(
      /fix: Install Android SDK platform android-35 and JDK 17/u,
    );
  });

  it("uses JAVA_HOME, not THREENATIVE_JAVA_HOME, for the Android JDK probe", () => {
    const buildJavaHome = "/build-jdk";
    const doctorOnlyJavaHome = "/doctor-only-jdk";
    const buildJava = path.join(
      buildJavaHome,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    );
    spawnSyncMock.mockImplementation((command: string) => ({
      stderr: `openjdk version "${command === buildJava ? "17.0.1" : "21.0.1"}"`,
      stdout: "",
      status: 0,
    }));

    const probe = probeAndroidToolchain({
      JAVA_HOME: buildJavaHome,
      THREENATIVE_JAVA_HOME: doctorOnlyJavaHome,
    });

    expect(probe).toMatchObject({ jdkMajor: 17, jdkVersion: "17.0.1" });
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe(buildJava);
  });

  it("prefers the standard Android SDK variable over the custom doctor-only variable", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-conflicting-sdk-");
    const packagerSdk = path.join(root, "packager-sdk");
    const doctorOnlySdk = path.join(root, "doctor-only-sdk");
    for (const [sdk, revision] of [
      [packagerSdk, "35.0.0"],
      [doctorOnlySdk, "34.0.0"],
    ] as const) {
      const platform = path.join(sdk, "platforms", "android-35");
      await mkdir(platform, { recursive: true });
      await writeFile(path.join(platform, "source.properties"), `Pkg.Revision = ${revision}\n`);
    }

    const probe = probeAndroidToolchain({
      ANDROID_HOME: packagerSdk,
      THREENATIVE_ANDROID_SDK: doctorOnlySdk,
    });

    expect(probe.sdkVersion).toBe("35.0.0");
  });

  it("groups craft, test, and ship checks in the human-readable report", () => {
    const output = formatDoctorReport(diagnoseProject(HEALTHY));
    expect(output).toMatch(/Craft/);
    expect(output).toMatch(/Test/);
    expect(output).toMatch(/Ship/);
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

  it("reports the last APK attribution total when its evidence is present", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-apk-size-");
    const recordPath = "docs/verification/apk-size-2026-08-25.md";
    const artifactPath =
      "packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk";
    const buildDirectory = "packages/runtime-native/android/app/build";
    await mkdir(path.join(root, path.dirname(recordPath)), { recursive: true });
    await mkdir(path.join(root, path.dirname(artifactPath)), { recursive: true });
    await writeFile(path.join(root, artifactPath), Buffer.alloc(123));
    await writeFile(
      path.join(root, recordPath),
      [
        "# APK size attribution",
        "",
        "- Rebuilt APK bytes: **123**",
        `- APK artifact: \`${artifactPath}\``,
        `- Build directory: \`${buildDirectory}\``,
        `- APK SHA-256: \`${APK_SHA256}\``,
        "",
      ].join("\n"),
    );
    const report = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, recordPath]),
        projectRoot: root,
        readText: (relative) =>
          relative === recordPath
            ? "# APK size attribution\n\n- Rebuilt APK bytes: **123**\n- APK artifact: `packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk`\n- Build directory: `packages/runtime-native/android/app/build`\n- APK SHA-256: `409a7f83ac6b31dc8c77e3ec18038f209bd2f545e0f4177c2e2381aa4e067b49`\n"
            : relative === "src/game.ts"
              ? "export default defineGame({})"
              : "",
      }),
    );

    expect(check(report, "APK size")).toMatchObject({ status: "ok" });
    expect(check(report, "APK size").detail).toContain("123 bytes");
  });

  it("warns when a replaced APK keeps the recorded byte count but has a different hash", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-apk-size-replaced-");
    const recordPath = "docs/verification/apk-size-2026-08-25.md";
    const artifactPath =
      "packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk";
    const buildDirectory = "packages/runtime-native/android/app/build";
    await mkdir(path.join(root, path.dirname(recordPath)), { recursive: true });
    await mkdir(path.join(root, path.dirname(artifactPath)), { recursive: true });
    await writeFile(path.join(root, artifactPath), Buffer.alloc(123, 1));
    await writeFile(
      path.join(root, recordPath),
      [
        "# APK size attribution",
        "",
        "- Rebuilt APK bytes: **123**",
        `- APK artifact: \`${artifactPath}\``,
        `- Build directory: \`${buildDirectory}\``,
        `- APK SHA-256: \`${APK_SHA256}\``,
        "",
      ].join("\n"),
    );
    const report = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, recordPath]),
        projectRoot: root,
        readText: (relative) =>
          relative === recordPath
            ? `# APK size attribution\n\n- Rebuilt APK bytes: **123**\n- APK artifact: \`${artifactPath}\`\n- Build directory: \`${buildDirectory}\`\n- APK SHA-256: \`${APK_SHA256}\`\n`
            : relative === "src/game.ts"
              ? "export default defineGame({})"
              : "",
      }),
    );

    expect(check(report, "APK size")).toMatchObject({ status: "warn" });
    expect(check(report, "APK size").detail).toMatch(/SHA-256|hash/u);
    expect(check(report, "APK size").detail).not.toContain("123 bytes");
  });

  it("names missing APK evidence without presenting the recorded total as current", () => {
    const recordPath = "docs/verification/apk-size-2026-08-25.md";
    const report = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, recordPath]),
        projectRoot: "/tmp/tn-doctor-apk-size-missing",
        readText: (relative) =>
          relative === recordPath
            ? "# APK size attribution\n\n- Rebuilt APK bytes: **123**\n- APK artifact: `packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk`\n- Build directory: `packages/runtime-native/android/app/build`\n- APK SHA-256: `409a7f83ac6b31dc8c77e3ec18038f209bd2f545e0f4177c2e2381aa4e067b49`\n"
            : relative === "src/game.ts"
              ? "export default defineGame({})"
              : "",
      }),
    );

    expect(check(report, "APK size")).toMatchObject({ status: "warn" });
    expect(check(report, "APK size").detail).toMatch(/missing evidence|build directory/u);
    expect(check(report, "APK size").detail).not.toContain("123 bytes");
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

  it("keeps the TypeScript config authoritative over conflicting legacy surfaces", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-config-precedence-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default {};");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "doctor-config-precedence",
        type: "module",
        threenative: { nativeEntry: "src/package-game.ts" },
      }),
    );
    await writeFile(
      path.join(root, "threenative.config.json"),
      JSON.stringify({ nativeEntry: "src/legacy-game.ts", ui: { renderer: "native" } }),
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      'export default { ui: { renderer: "web" } };\n',
    );

    const snapshot = await readProject(root);

    expect(snapshot.config).toMatchObject({
      nativeEntry: "src/package-game.ts",
      ui: { renderer: "web" },
    });
  });

  it("does not fall back to legacy config when the TypeScript config is invalid", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-config-invalid-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default {};");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "doctor-config-invalid",
        type: "module",
        threenative: { nativeEntry: "src/package-game.ts" },
      }),
    );
    await writeFile(
      path.join(root, "threenative.config.json"),
      JSON.stringify({ nativeEntry: "src/legacy-game.ts", ui: { renderer: "native" } }),
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      "export default { app: { name: 42 } };\n",
    );

    const snapshot = await readProject(root);

    expect(snapshot.config).toBeUndefined();
  });

  it("does not report a threenative.config.json surface that builds ignore", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-config-json-only-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default {};");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "doctor-config-json-only", type: "module" }),
    );
    await writeFile(
      path.join(root, "threenative.config.json"),
      JSON.stringify({ nativeEntry: "src/legacy-game.ts", ui: { renderer: "native" } }),
    );

    const snapshot = await readProject(root);

    expect(snapshot.config).toBeUndefined();
  });

  it("keeps the sanctioned package.json nativeEntry fallback when no TypeScript config exists", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-config-package-entry-");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default {};");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "doctor-config-package-entry",
        type: "module",
        threenative: { nativeEntry: "src/package-game.ts" },
      }),
    );

    const snapshot = await readProject(root);

    expect(snapshot.config).toEqual({ nativeEntry: "src/package-game.ts" });
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

describe("threenative doctor edge coverage", () => {
  it("reports every compositor probe outcome, including a missing display and xprop", () => {
    expect([undefined, false, true]).toContain(detectX11Compositor());

    execFileSyncMock.mockReturnValueOnce("_NET_WM_CM_S0: window id # 0x123");
    expect(detectX11Compositor({ DISPLAY: ":99" })).toBe(true);
    execFileSyncMock.mockReturnValueOnce("_NET_WM_CM_S0: absent");
    expect(detectX11Compositor({ DISPLAY: ":99" })).toBe(false);
    execFileSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("xprop missing"), { code: "ENOENT" });
    });
    expect(detectX11Compositor({ DISPLAY: ":99" })).toBeUndefined();
    execFileSyncMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("xprop failed"), { code: "EPIPE" });
    });
    expect(detectX11Compositor({ DISPLAY: ":99" })).toBe(false);
  });

  it("distinguishes an unprobed, healthy, and unknown desktop overlay", () => {
    expect(probeDesktopOverlay({})).toMatchObject({ status: "warn" });
    expect(probeDesktopOverlay({ DISPLAY: ":99" }, () => true)).toMatchObject({ status: "ok" });
    expect(probeDesktopOverlay({ DISPLAY: ":99" }, () => undefined)).toMatchObject({
      status: "warn",
    });
    expect(probeDesktopOverlay({ XDG_SESSION_TYPE: "wayland" }, () => true)).toMatchObject({
      status: "fail",
    });
  });

  it("handles empty manifests and configured target arrays and strings", () => {
    const report = diagnoseProject(
      snapshot({
        config: {
          nativeEntry: "src/game.ts",
          nativeTargets: "ios",
          targets: ["android", "desktop", 7],
        },
        files: new Set(["package.json", "src/game.ts"]),
        installedVersions: new Map(),
        packageJson: {
          scripts: {
            android: "threenative build --target android",
            invalid: 7,
            web: "threenative build --target=web",
          },
          dependencies: { three: "0.185.1" },
        },
        readRuntimeText: undefined,
        runtimeRoot: undefined,
      }),
    );

    expect(check(report, "dependencies")).toMatchObject({
      detail: "no @threenative packages declared",
      status: "ok",
    });
    expect(check(report, "versions")).toMatchObject({ detail: "nothing installed to compare" });
    expect(check(report, "asset pipeline").detail).toMatch(/android.*ios|ios.*android/u);
  });

  it("rejects unreadable, malformed, and hand-edited MCP configuration", () => {
    const unreadable = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, ".mcp.json"]),
        readText: () => undefined,
      }),
    );
    expect(check(unreadable, "capability search")).toMatchObject({ status: "fail" });

    const wrongRoot = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, ".mcp.json"]),
        readText: () => JSON.stringify({ mcpServers: [] }),
      }),
    );
    expect(check(wrongRoot, "capability search").detail).toMatch(/mcpServers/u);

    const missingServer = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, ".mcp.json"]),
        readText: () => JSON.stringify({ mcpServers: {} }),
      }),
    );
    expect(check(missingServer, "capability search").status).toBe("fail");

    const edited = diagnoseProject(
      snapshot({
        files: new Set([...HEALTHY.files, ".mcp.json"]),
        readText: () =>
          JSON.stringify({
            mcpServers: {
              "threenative-assets": {
                args: ["./node_modules/@threenative/core/mcp/assets.mjs"],
                command: "node",
              },
            },
          }),
      }),
    );
    expect(edited.checks.find(({ name }) => name.includes("threenative-asset-mcp"))).toMatchObject({
      status: "fail",
    });
  });

  it("pins every MCP server at the version @threenative/core actually installs", async () => {
    const core = JSON.parse(await readFile(path.resolve("packages/core/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      version: string;
    };
    for (const spec of MCP_SERVER_SPECS) {
      const installed =
        spec.packageName === "@threenative/core"
          ? core.version
          : core.dependencies?.[spec.packageName];
      expect(installed, spec.packageName).toBeDefined();
      expect(spec.version, spec.packageName).toBe(installed);
    }
  });

  it("checks resolved MCP package versions, including missing metadata and mismatches", async () => {
    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const root = await makeTempDir("tn-doctor-mcp-versions-");
    const packageNames = [
      // Must equal MCP_SERVER_SPECS' pin, which must equal what @threenative/core installs.
      ["threenative-asset-mcp", "0.7.0"],
      ["threenative-sculpt-mcp", "0.1.1"],
      ["@threenative/core", "0.3.0"],
    ] as const;
    for (const [name, version] of packageNames) {
      const directory = path.join(root, "node_modules", name);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), JSON.stringify({ version }));
    }
    const resolver = (name: string) => path.join(root, "node_modules", name);
    const resolved = diagnoseProject(
      snapshot({
        projectRoot: undefined,
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
        resolvePackageDirectory: resolver,
      }),
    );
    expect(check(resolved, "capability search")).toMatchObject({ status: "ok" });

    await writeFile(
      path.join(root, "node_modules", "@threenative/core", "package.json"),
      JSON.stringify({}),
    );
    const noVersion = diagnoseProject(
      snapshot({
        projectRoot: undefined,
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
        resolvePackageDirectory: resolver,
      }),
    );
    expect(noVersion.checks.find(({ name }) => name.includes("@threenative/core"))).toMatchObject({
      status: "fail",
    });

    await writeFile(
      path.join(root, "node_modules", "@threenative/core", "package.json"),
      JSON.stringify({ version: "9.9.9" }),
    );
    const mismatch = diagnoseProject(
      snapshot({
        projectRoot: undefined,
        readText: (relative) => (relative === ".mcp.json" ? MCP_CONFIG : "export default {}"),
        resolvePackageDirectory: resolver,
      }),
    );
    expect(mismatch.checks.find(({ name }) => name.includes("@threenative/core"))).toMatchObject({
      status: "warn",
    });
  });

  it("covers writable asset directories and a readable mobile toolchain", () => {
    const report = diagnoseProject(
      snapshot({
        config: {
          assets: { models: "none", textures: "none" },
          nativeEntry: "src/game.ts",
          targets: ["android"],
        },
        directoryWritable: () => true,
        packageJson: { scripts: {} },
      }),
    );
    expect(check(report, "asset pipeline")).toMatchObject({ status: "ok" });

    const toolchain = diagnoseProject(
      snapshot({
        androidToolchain: { jdkMajor: 17, jdkVersion: "17.0.1", sdkVersion: "35.0.0" },
        config: { nativeEntry: "src/game.ts", targets: ["android"] },
      }),
    );
    expect(check(toolchain, "target android")).toMatchObject({ status: "ok" });
    expect(check(toolchain, "target android").fix).toBeUndefined();
  });

  it("fails closed for every native runtime status boundary", () => {
    const noInstall = nativeRuntimeCheck(
      snapshot({
        runtimeRoot: undefined,
        readRuntimeText: undefined,
        installedVersions: new Map(),
      }),
    );
    expect(noInstall).toMatchObject({ status: "warn" });

    const unresolved = nativeRuntimeCheck(
      snapshot({
        runtimeRoot: undefined,
        readRuntimeText: undefined,
        installedVersions: new Map([["@threenative/runtime-native", "0.4.0"]]),
      }),
    );
    expect(unresolved).toMatchObject({ status: "fail" });

    const status = (value: unknown, overrides: Partial<IProjectSnapshot> = {}) =>
      nativeRuntimeCheck(
        snapshot({
          readRuntimeText: () => JSON.stringify(value),
          runtimeFileExists: () => true,
          ...overrides,
        }),
      );
    expect(status("not an object")).toMatchObject({ status: "fail" });
    expect(status(["not", "an", "object"])).toMatchObject({ status: "fail" });
    expect(status({ ok: false })).toMatchObject({ status: "fail" });
    expect(status({ ok: true })).toMatchObject({ status: "fail" });
    expect(
      status({
        key: "other-platform",
        ok: true,
        url: HEALTHY.runtimeManifestUrl,
        version: "0.4.0",
      }),
    ).toMatchObject({ status: "fail" });
    expect(
      status(
        {
          key: `${process.platform}-${process.arch}`,
          ok: true,
          url: HEALTHY.runtimeManifestUrl,
          version: "0.4.0",
        },
        { runtimeManifestUrl: undefined },
      ),
    ).toMatchObject({ status: "fail" });

    const win32 = withPlatform("win32", () =>
      status(
        {
          key: `win32-${process.arch}`,
          ok: true,
          url: HEALTHY.runtimeManifestUrl,
          version: "0.4.0",
        },
        { runtimeFileExists: (relative) => relative.endsWith(".exe") },
      ),
    );
    expect(win32).toMatchObject({ status: "ok" });
  });

  it("handles Java probe failures and legacy JDK output", async () => {
    spawnSyncMock.mockReturnValueOnce({ stderr: 'java version "1.8.0_392"', stdout: "" });
    expect(probeAndroidToolchain({ JAVA_HOME: "  " })).toMatchObject({
      jdkMajor: 8,
      jdkVersion: "1.8.0_392",
    });

    spawnSyncMock.mockReturnValueOnce({ stderr: "not a java version", stdout: "" });
    expect(probeAndroidToolchain({}).jdkMajor).toBeUndefined();

    spawnSyncMock.mockImplementationOnce(() => {
      throw new Error("java unavailable");
    });
    expect(probeAndroidToolchain({}).jdkMajor).toBeUndefined();

    const { makeTempDir } = await import("../../../test-support/temp-dir.js");
    const sdk = await makeTempDir("tn-doctor-sdk-");
    await mkdir(path.join(sdk, "platforms", "android-35"), { recursive: true });
    await writeFile(path.join(sdk, "platforms", "android-35", "source.properties"), "Pkg.Name=x\n");
    spawnSyncMock.mockReturnValueOnce({ stderr: "not a java version", stdout: "" });
    expect(
      probeAndroidToolchain({ ANDROID_HOME: sdk, HOME: path.join(sdk, "no-home") }).sdkVersion,
    ).toBeUndefined();
  });
});
