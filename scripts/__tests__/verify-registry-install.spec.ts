import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type CommandRunner,
  type McpRunner,
  assertNoLocalSpecifiers,
  checkLockfile,
  cleanRoomEnvironment,
  verifyRegistryInstall,
} from "../verify-registry-install.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await makeTempDir("threenative-registry-spec-");
  roots.push(root);
  return root;
}

/** A runner that writes a registry-clean lockfile and succeeds at every step. */
function happyRunner(): CommandRunner {
  return (command, args, cwd) => {
    if (command === "npm" && args[0] === "create") {
      const project = path.join(cwd, "my-game");
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({
          name: "my-game",
          scripts: { "build:desktop": "threenative build --target desktop" },
        }),
      );
      fs.writeFileSync(
        path.join(project, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "threenative-assets": { command: "node", args: ["assets.mjs"] },
            "threenative-engine": { command: "node", args: ["engine.mjs"] },
          },
        }),
      );
      return "created";
    }
    if (command === "npm" && args[0] === "install") {
      fs.writeFileSync(
        path.join(cwd, "package-lock.json"),
        JSON.stringify({
          packages: {
            "node_modules/@threenative/core": {
              resolved: "https://registry.npmjs.org/@threenative/core/-/core-0.2.0.tgz",
            },
          },
        }),
      );
      return "installed";
    }
    if (command === "npm" && args[0] === "run" && args[1] === "build:desktop") {
      fs.mkdirSync(path.join(cwd, "dist-native"), { recursive: true });
      const output = path.join(cwd, "dist-native", "my-game");
      fs.writeFileSync(output, "#!/bin/sh\n");
      fs.chmodSync(output, 0o755);
      return "desktop built";
    }
    if (command === "npx" && args[0] === "threenative" && args[1] === "doctor") {
      if (!args.includes("--text")) throw new Error("doctor did not use --text");
      return [
        "✓ target web: available",
        "✓ target desktop: available (linux-x64)",
        "✓ target android: available",
        "! target ios: unavailable — requires darwin-arm64",
      ].join("\n");
    }
    if (command === "node" && args[0]?.endsWith("verify-starter-desktop.mjs")) {
      const artifacts = path.join(cwd, "artifacts", "native");
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(
        path.join(artifacts, "starter-desktop-report.json"),
        JSON.stringify({ frames: 300, pass: true }),
      );
      return "starter desktop gate passed: 300 frames";
    }
    return "ok";
  };
}

function happyMcpRunner(): McpRunner {
  return (serverName) =>
    [
      JSON.stringify({ id: 1, jsonrpc: "2.0", result: { serverInfo: { name: serverName } } }),
      ...(serverName === "threenative-engine"
        ? [
            JSON.stringify({
              id: 2,
              jsonrpc: "2.0",
              result: {
                content: [
                  {
                    text: JSON.stringify([
                      {
                        constraints: ["requires a navigation world"],
                        example: "const agent = new NavigationAgent3D(world);",
                        importPath: "@threenative/physics/navigation",
                        summary: "Move an agent around obstacles.",
                        symbol: "NavigationAgent3D",
                      },
                    ]),
                  },
                ],
              },
            }),
          ]
        : []),
    ].join("\n");
}

describe("pnpm tsx scripts/verify-registry-install.ts", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("passes when every step runs and the lockfile names only the registry", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: happyRunner(),
    });
    expect(report.steps.filter((step) => !step.ok)).toEqual([]);
    expect(report.exitCode).toBe(0);
    expect(report.steps.map((step) => step.name)).toEqual([
      "scaffold",
      "install",
      "lockfile",
      "build",
      "test",
      "doctor",
      "native",
      "mcp",
    ]);
  });

  it("runs the consumer test command through pnpm", async () => {
    const testCommands: string[][] = [];
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (args[0] === "test") testCommands.push([command, ...args]);
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(0);
    expect(testCommands).toEqual([["pnpm", "test"]]);
  });

  it("fails, and runs nothing further, when the scaffold 404s", async () => {
    // This is the state of the world today, and the reason the gate exists.
    const report = verifyRegistryInstall({
      parent: await tempRoot(),
      run: (command, args) => {
        if (command === "npm" && args[0] === "create")
          throw new Error(
            "npm error 404 Not Found - GET https://registry.npmjs.org/create-threenative",
          );
        return "ok";
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps[0]?.detail).toMatch(/404/u);
    expect(report.steps.slice(1).every((step) => !step.ok)).toBe(true);
    expect(report.steps.slice(1).every((step) => step.detail.includes("Not run"))).toBe(true);
    expect(report.steps.map((step) => step.name)).toContain("mcp");
  });

  it("fails when the native build produces no executable", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        const output = happyRunner()(command, args, cwd);
        if (command === "npm" && args[0] === "run" && args[1] === "build:desktop") {
          fs.rmSync(path.join(cwd, "dist-native"), { force: true, recursive: true });
          return "desktop build returned without an artifact";
        }
        return output;
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "native")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "native")?.detail).toMatch(/executable/u);
  });

  it("fails when the native verifier produces no 300-frame proof", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "node" && args[0]?.endsWith("verify-starter-desktop.mjs"))
          return "native verifier exited without a frame report";
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "native")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "native")?.detail).toMatch(/300 frames/u);
  });

  it("fails when doctor text omits the target census", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "npx" && args[0] === "threenative" && args[1] === "doctor")
          return "doctor passed without naming targets";
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "doctor")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "doctor")?.detail).toMatch(/target.*web/u);
  });

  it("fails when an MCP server never answers initialize", async () => {
    const report = verifyRegistryInstall({
      mcp: (serverName) => {
        if (serverName === "threenative-engine") throw new Error("initialize timed out");
        return happyMcpRunner()(serverName, "node", [], "");
      },
      parent: await tempRoot(),
      run: happyRunner(),
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "mcp")?.detail).toMatch(
      /threenative-engine.*initialize/u,
    );
  });

  it("fails when engine MCP returns a malformed capability hit", async () => {
    const report = verifyRegistryInstall({
      mcp: (serverName) =>
        serverName === "threenative-engine"
          ? [
              JSON.stringify({
                id: 1,
                jsonrpc: "2.0",
                result: { serverInfo: { name: serverName } },
              }),
              JSON.stringify({
                id: 2,
                jsonrpc: "2.0",
                result: { content: [{ text: JSON.stringify([{}]) }] },
              }),
            ].join("\n")
          : happyMcpRunner()(serverName, "node", [], ""),
      parent: await tempRoot(),
      run: happyRunner(),
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "mcp")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "mcp")?.detail).toMatch(
      /threenative-engine.*malformed capability hit/u,
    );
  });

  it("does not report a pass for a step that did not run", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args) => {
        if (command === "npm" && args[0] === "create") throw new Error("scaffold failed");
        return "ok";
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.map((step) => step.name)).toEqual([
      "scaffold",
      "install",
      "lockfile",
      "build",
      "test",
      "doctor",
      "native",
      "mcp",
    ]);
    expect(report.steps.slice(1).every((step) => step.ok === false)).toBe(true);
  });

  it("fails when the lockfile resolves a dependency from this machine", async () => {
    const report = verifyRegistryInstall({
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "npm" && args[0] === "install") {
          fs.writeFileSync(
            path.join(cwd, "package-lock.json"),
            JSON.stringify({
              packages: {
                "node_modules/@threenative/core": { resolved: "file:../../packages/core" },
              },
            }),
          );
          return "installed";
        }
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "lockfile")?.detail).toMatch(
      /TN_REGISTRY_INSTALL_LOCAL_SPECIFIER/u,
    );
  });

  it("rejects a link: specifier as well as file:", () => {
    expect(() =>
      assertNoLocalSpecifiers("pnpm-lock.yaml", "  '@threenative/ui': link:../../packages/ui\n"),
    ).toThrow(/TN_REGISTRY_INSTALL_LOCAL_SPECIFIER/u);
  });

  it("refuses a project with no lockfile rather than finding no offenders", async () => {
    // Vacuous green: no lockfile means no matches means "clean", unless the absence is a failure.
    const root = await tempRoot();
    expect(() => checkLockfile(root)).toThrow(/TN_REGISTRY_INSTALL_NO_LOCKFILE/u);
  });

  it("accepts a lockfile that names only registry tarballs", async () => {
    const root = await tempRoot();
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ resolved: "https://registry.npmjs.org/@threenative/core/-/core-0.2.0.tgz" }),
    );
    expect(checkLockfile(root)).toBe("package-lock.json");
  });
});

// pnpm exports its own settings as `npm_config_*`. npm reads them as its own config, warns
// "Unknown env config" about each, and died on `Cannot read properties of null (reading 'matches')`
// — reporting the freshly published packages as uninstallable while a plain `npm install` of the
// same project succeeded. A clean room that inherits the caller's package-manager config is not a
// clean room.
describe("clean room environment", () => {
  it("drops the invoking package manager's config and keeps everything else", () => {
    const cleaned = cleanRoomEnvironment({
      HOME: "/home/dev",
      PATH: "/usr/bin",
      npm_config_catalog: "{}",
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_verify_deps_before_run: "false",
      NPM_CONFIG_CACHE: "/somewhere/else",
      npm_package_name: "threenative",
      npm_lifecycle_event: "release",
      THREENATIVE_SOMETHING: "kept",
    });

    // The machine is still the machine.
    expect(cleaned.HOME).toBe("/home/dev");
    expect(cleaned.PATH).toBe("/usr/bin");
    expect(cleaned.THREENATIVE_SOMETHING).toBe("kept");

    // Nothing the caller's package manager said about itself survives.
    for (const name of Object.keys(cleaned)) {
      expect(name.toLowerCase().startsWith("npm_config_")).toBe(false);
      expect(name.toLowerCase().startsWith("npm_package_")).toBe(false);
      expect(name.toLowerCase().startsWith("npm_lifecycle_")).toBe(false);
    }
  });
});
