import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type CommandRunner,
  type McpRunner,
  assertNoLocalSpecifiers,
  assertSupportedNodeVersion,
  assertSupportedPackageManager,
  checkLockfile,
  cleanRoomEnvironment,
  mcpRequests,
  registryEnvironment,
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
    if ((command === "npm" || command === "pnpm") && args.includes("create")) {
      const project = path.join(cwd, "my-game");
      fs.mkdirSync(path.join(project, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(project, "package.json"),
        JSON.stringify({
          name: "my-game",
          scripts: { "build:desktop": "threenative build --target desktop" },
        }),
      );
      fs.writeFileSync(path.join(project, "src", "game.ts"), "export default {};\n");
      fs.mkdirSync(path.join(project, "playtests"), { recursive: true });
      fs.writeFileSync(
        path.join(project, "playtests", "production-readiness.playtest.json"),
        JSON.stringify({ assert: { movement: { entity: "player" } }, name: "pr", steps: [] }),
      );
      fs.writeFileSync(
        path.join(project, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "threenative-assets": { command: "node", args: ["assets.mjs"] },
            "threenative-blender": { command: "node", args: ["blender.mjs"] },
            "threenative-engine": { command: "node", args: ["engine.mjs"] },
            "threenative-sculpt": { command: "node", args: ["sculpt.mjs"] },
          },
        }),
      );
      return "created";
    }
    if ((command === "npm" || command === "pnpm") && args[0] === "install") {
      fs.writeFileSync(
        path.join(cwd, command === "npm" ? "package-lock.json" : "pnpm-lock.yaml"),
        command === "npm"
          ? JSON.stringify({
              packages: {
                "node_modules/@threenative/core": {
                  resolved: "https://registry.npmjs.org/@threenative/core/-/core-0.2.0.tgz",
                },
              },
            })
          : "lockfileVersion: '9.0'\npackages: {}\n",
      );
      return "installed";
    }
    if (
      (command === "npm" || command === "pnpm") &&
      args[0] === "run" &&
      args[1] === "build:desktop"
    ) {
      fs.mkdirSync(path.join(cwd, "dist-native"), { recursive: true });
      const output = path.join(cwd, "dist-native", "my-game");
      fs.writeFileSync(output, "#!/bin/sh\n");
      fs.chmodSync(output, 0o755);
      return "desktop built";
    }
    if ((command === "npm" || command === "pnpm") && args[0] === "run" && args[1] === "build") {
      // The built bundle carries the source, so the game-only edit applied before the build is
      // observable in the artifact the playtest then exercises.
      fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, "dist", "index.js"),
        fs.readFileSync(path.join(cwd, "src", "game.ts"), "utf8"),
      );
      return "built";
    }
    if (
      (command === "npm" || command === "pnpm") &&
      args[0] === "exec" &&
      args.includes("threenative-playtest")
    ) {
      return "playtest passed: 5 assertions";
    }
    if (
      (command === "npm" || command === "pnpm") &&
      ((command === "npm" && args[0] === "run" && args[1] === "test") ||
        (command === "pnpm" && args[0] === "test"))
    ) {
      return "tested";
    }
    if (
      (command === "npx" && args.includes("doctor")) ||
      (command === "pnpm" && args[0] === "exec" && args.includes("doctor"))
    ) {
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

function mcpMessage(id: number, result: Record<string, unknown>): string {
  return JSON.stringify({ id, jsonrpc: "2.0", result });
}

function happyMcpRunner(): McpRunner {
  return (serverName, _command, _args, cwd, _env, requests) => {
    const parsed = (requests ?? mcpRequests(serverName))
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown> },
      );
    const operation = parsed.find((request) => request.method === "tools/call");
    const toolName = (operation?.params?.name as string | undefined) ?? "";
    const tools: Record<string, string[]> = {
      "threenative-assets": ["asset_search_sources"],
      "threenative-blender": ["blender_status", "blender_convert"],
      "threenative-engine": ["engine_search_capabilities", "engine_capability_detail"],
      "threenative-sculpt": ["sculpt_grimoire"],
    };
    const result =
      toolName === "asset_search_sources"
        ? { content: [{ text: JSON.stringify({ sources: [{ id: "kenney" }], total: 1 }) }] }
        : toolName === "sculpt_grimoire"
          ? {
              content: [
                {
                  text: JSON.stringify({
                    text: "Use silhouette and readable geometry.",
                    topic: "build/geometry_patterns",
                  }),
                },
              ],
            }
          : toolName === "engine_search_capabilities"
            ? {
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
              }
            : toolName === "engine_capability_detail"
              ? {
                  content: [
                    {
                      text: JSON.stringify({
                        importPath: "@threenative/physics/navigation",
                        symbol: "NavigationAgent3D",
                      }),
                    },
                  ],
                }
              : toolName === "blender_status"
                ? {
                    content: [
                      {
                        text: JSON.stringify({
                          available: true,
                          detail: "Blender 4.2",
                          installCommand: "install Blender",
                        }),
                      },
                    ],
                  }
                : {
                    content: [{ text: JSON.stringify({ ok: true }) }],
                  };
    const output = [
      mcpMessage(1, { serverInfo: { name: serverName } }),
      mcpMessage(2, { tools: (tools[serverName] ?? []).map((name) => ({ name })) }),
      mcpMessage(3, result),
    ];
    if (toolName === "blender_convert") {
      const argumentsValue = operation?.params?.arguments as Record<string, unknown> | undefined;
      if (typeof argumentsValue?.out === "string") {
        fs.mkdirSync(path.dirname(argumentsValue.out), { recursive: true });
        fs.writeFileSync(argumentsValue.out, "glb");
      }
    }
    return output.join("\n");
  };
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
    expect(report.steps.map((step) => step.name)).toEqual(
      ["npm", "pnpm"].flatMap((manager) =>
        [
          "scaffold",
          "install",
          "lockfile",
          "edit",
          "build",
          "test",
          "gameplay",
          "doctor",
          "native",
          "mcp",
        ].map((step) => `${manager}:${step}`),
      ),
    );
  });

  it("runs each consumer test command through its selected package manager", async () => {
    const testCommands: string[][] = [];
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (args[0] === "test" || (args[0] === "run" && args[1] === "test"))
          testCommands.push([command, ...args]);
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(0);
    expect(testCommands).toEqual([
      ["npm", "run", "test"],
      ["pnpm", "test"],
    ]);
  });

  it("fails, and runs nothing further, when the scaffold 404s", async () => {
    // This is the state of the world today, and the reason the gate exists.
    const report = verifyRegistryInstall({
      parent: await tempRoot(),
      run: (command, args) => {
        if ((command === "npm" || command === "pnpm") && args.includes("create"))
          throw new Error(
            "npm error 404 Not Found - GET https://registry.npmjs.org/create-threenative",
          );
        return "ok";
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps[0]?.detail).toMatch(/404/u);
    expect(report.steps.slice(1).every((step) => !step.ok)).toBe(true);
    expect(
      report.steps
        .filter((step) => !step.name.endsWith(":scaffold"))
        .every((step) => step.detail.includes("Not run")),
    ).toBe(true);
    expect(report.steps.map((step) => step.name)).toContain("npm:mcp");
    expect(report.steps.map((step) => step.name)).toContain("pnpm:mcp");
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
    expect(report.steps.find((step) => step.name === "npm:native")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "npm:native")?.detail).toMatch(/executable/u);
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
    expect(report.steps.find((step) => step.name === "npm:native")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "npm:native")?.detail).toMatch(/300 frames/u);
  });

  it("fails when doctor text omits the target census", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "npx" && args.includes("doctor"))
          return "doctor passed without naming targets";
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:doctor")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "npm:doctor")?.detail).toMatch(/target.*web/u);
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
    expect(report.steps.find((step) => step.name === "npm:mcp")?.detail).toMatch(
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
                result: { tools: [{ name: "engine_search_capabilities" }] },
              }),
              JSON.stringify({
                id: 3,
                jsonrpc: "2.0",
                result: { content: [{ text: JSON.stringify([{}]) }] },
              }),
            ].join("\n")
          : happyMcpRunner()(serverName, "node", [], ""),
      parent: await tempRoot(),
      run: happyRunner(),
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:mcp")).toMatchObject({ ok: false });
    expect(report.steps.find((step) => step.name === "npm:mcp")?.detail).toMatch(
      /threenative-engine.*malformed capability hit/u,
    );
  });

  it("does not report a pass for a step that did not run", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args) => {
        if ((command === "npm" || command === "pnpm") && args.includes("create"))
          throw new Error("scaffold failed");
        return "ok";
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.map((step) => step.name)).toEqual(
      ["npm", "pnpm"].flatMap((manager) =>
        [
          "scaffold",
          "install",
          "lockfile",
          "edit",
          "build",
          "test",
          "gameplay",
          "doctor",
          "native",
          "mcp",
        ].map((step) => `${manager}:${step}`),
      ),
    );
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
    expect(report.steps.find((step) => step.name === "npm:lockfile")?.detail).toMatch(
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

  it("refuses an unsupported Node prerequisite before starting a clean room", () => {
    expect(() => assertSupportedNodeVersion("20.18.1")).toThrow(/20\.19\.0/u);
    expect(() => assertSupportedNodeVersion("19.9.0")).toThrow(/20\.19\.0/u);
    expect(() => assertSupportedNodeVersion("20.19.0")).not.toThrow();
  });

  it("refuses an unrecognized package manager instead of guessing its install policy", () => {
    expect(() => assertSupportedPackageManager("yarn")).toThrow(/use npm or pnpm/u);
  });

  it("keeps install-script policy explicit and does not add a bypass flag", async () => {
    const installs: string[][] = [];
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      packageManagers: ["npm"],
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (args[0] === "install") installs.push([command, ...args]);
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(0);
    expect(installs).toHaveLength(1);
    expect(installs[0]).not.toContain("--ignore-scripts");
    expect(installs[0]).not.toContain("--unsafe-perm");
  });

  it("uses pnpm create's native option forwarding syntax", async () => {
    const scaffolds: string[][] = [];
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      packageManagers: ["pnpm"],
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "pnpm" && args[0] === "create") scaffolds.push([...args]);
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(0);
    expect(scaffolds[0]).toEqual([
      "create",
      "threenative@latest",
      "my-game",
      "--template",
      "starter",
      "--no-install",
    ]);
  });

  it("refuses an empty manager matrix instead of reporting a vacuous pass", () => {
    expect(() => verifyRegistryInstall({ packageManagers: [] })).toThrow(
      /TN_REGISTRY_INSTALL_NO_PACKAGE_MANAGERS/u,
    );
  });

  it("rejects a consumer whose gameplay scenario declares no assertions", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        const output = happyRunner()(command, args, cwd);
        if ((command === "npm" || command === "pnpm") && args.includes("create")) {
          fs.writeFileSync(
            path.join(cwd, "my-game", "playtests", "production-readiness.playtest.json"),
            JSON.stringify({ assert: {}, name: "pr", steps: [] }),
          );
        }
        return output;
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:gameplay")?.detail).toMatch(
      /TN_REGISTRY_INSTALL_GAMEPLAY_NO_ASSERTIONS/u,
    );
  });

  it("rejects a consumer whose production-readiness scenario was removed", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        const output = happyRunner()(command, args, cwd);
        if ((command === "npm" || command === "pnpm") && args.includes("create")) {
          fs.rmSync(path.join(cwd, "my-game", "playtests", "production-readiness.playtest.json"), {
            force: true,
          });
        }
        return output;
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:gameplay")?.detail).toMatch(
      /TN_REGISTRY_INSTALL_GAMEPLAY_SCENARIO_MISSING/u,
    );
  });

  it("rejects a consumer whose real gameplay assertions are false", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (
          (command === "npm" || command === "pnpm") &&
          args[0] === "exec" &&
          args.includes("threenative-playtest")
        ) {
          throw new Error("TN_ASSERTION_FAILED: player displacement was 0");
        }
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:gameplay")?.detail).toMatch(
      /TN_ASSERTION_FAILED/u,
    );
  });

  it("rejects when the game-only edit did not reach the build", async () => {
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if ((command === "npm" || command === "pnpm") && args[0] === "run" && args[1] === "build") {
          return "built without the edit";
        }
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "npm:gameplay")?.detail).toMatch(
      /TN_REGISTRY_INSTALL_GAMEPLAY_EDIT_NOT_BUILT/u,
    );
  });

  it("drives the gameplay scenario with a display, a server and an explicit adapter policy", async () => {
    const playtests: string[][] = [];
    const report = verifyRegistryInstall({
      mcp: happyMcpRunner(),
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (args.includes("threenative-playtest")) playtests.push([command, ...args]);
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(0);
    expect(playtests).toHaveLength(2);
    for (const args of playtests) {
      expect(args).toContain("playtests/production-readiness.playtest.json");
      expect(args).toContain("--server-command");
      expect(args).toContain("--browser-recipe");
      expect(args).toContain("--headed");
      expect(args).toContain("--allow-software");
    }
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

  it("gives pnpm create and install a private store", () => {
    const environment = registryEnvironment(
      { npm_config_store_dir: "/global/store", npm_config_registry: "https://registry.invalid" },
      "pnpm",
      "/private/cache",
      "/private/store",
    );

    expect(environment.npm_config_store_dir).toBe("/private/store");
    expect(environment.NPM_CONFIG_CACHE).toBe("/private/cache");
    expect(environment.npm_config_registry).toBeUndefined();
  });
});
