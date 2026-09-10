import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { staleHostConfigs } from "../../../scripts/sync-mcp-configs.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
// @ts-expect-error — the installer is plain JavaScript so a postinstall can run it unbuilt.
import { MCP_HOSTS } from "../../core/mcp/install.mjs";
import { MCP_SERVERS } from "../../core/mcp/servers.mjs";
import { createProject, discoverTemplateNames } from "../src/index.js";

// Read off disk, so a kit added tomorrow has its MCP wiring gated the day it ships.
const templates = discoverTemplateNames();
const engineMcp = "threenative-engine-mcp";
const enginePackageRoot = path.resolve("packages/engine-mcp");
const blenderMcp = "threenative-blender-mcp";
const blenderPackageRoot = path.resolve("packages/blender-mcp");
const corePackageRoot = path.resolve("packages/core");
const physicsPackageRoot = path.resolve("packages/physics");
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilitySearchResponse(value: unknown): {
  guidance: string;
  results: readonly Record<string, unknown>[];
  verdict: "matched" | "none";
} {
  if (
    !isRecord(value) ||
    (value.verdict !== "matched" && value.verdict !== "none") ||
    typeof value.guidance !== "string" ||
    !Array.isArray(value.results) ||
    !value.results.every(isRecord)
  ) {
    throw new Error("engine search response was malformed");
  }
  return {
    guidance: value.guidance,
    results: value.results,
    verdict: value.verdict,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function linkEngineMcp(target: string): Promise<void> {
  const destination = path.join(target, "node_modules", engineMcp);
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(enginePackageRoot, destination, "dir");
}

// The scaffold launches every MCP server through a shim inside `@threenative/core`, so the probe
// only proves anything with core present — the shim is the code that finds and starts the server.
async function linkCore(target: string): Promise<void> {
  const destination = path.join(target, "node_modules", "@threenative", "core");
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(corePackageRoot, destination, "dir");
}

async function linkBlenderMcp(target: string): Promise<void> {
  const destination = path.join(target, "node_modules", blenderMcp);
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(blenderPackageRoot, destination, "dir");
}

async function linkPhysics(target: string): Promise<void> {
  const destination = path.join(target, "node_modules", "@threenative", "physics");
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(physicsPackageRoot, destination, "dir");
}

async function linkRegistryAssetMcp(target: string): Promise<void> {
  const consumer = path.join(target, "asset-mcp-consumer");
  await mkdir(consumer, { recursive: true });
  await execFileAsync(
    "pnpm",
    [
      "--dir",
      consumer,
      "add",
      "--ignore-workspace",
      "--lockfile=false",
      "threenative-asset-mcp@0.8.0",
    ],
    { cwd: path.resolve(".") },
  );
  const installed = path.join(consumer, "node_modules", "threenative-asset-mcp");
  const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  expect(manifest.name).toBe("threenative-asset-mcp");
  expect(manifest.version).toBe("0.8.0");
  const destination = path.join(target, "node_modules", "threenative-asset-mcp");
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(installed, destination, "dir");
}

function toolText(result: Record<string, unknown>): Record<string, unknown> {
  const content = result.content;
  if (!Array.isArray(content) || typeof content[0] !== "object" || content[0] === null) {
    throw new Error("MCP tool response has no text content");
  }
  const text = (content[0] as Record<string, unknown>).text;
  if (typeof text !== "string") throw new Error("MCP tool response text is missing");
  return JSON.parse(text) as Record<string, unknown>;
}

async function request(
  child: ChildProcessWithoutNullStreams,
  nextId: { value: number },
  lines: ReturnType<typeof createInterface>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const id = nextId.value++;
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 2_000);
    const onLine = (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;
      if (record.id !== id) return;
      clearTimeout(timer);
      lines.off("line", onLine);
      if (record.error !== undefined) reject(new Error(JSON.stringify(record.error)));
      else resolve((record.result ?? {}) as Record<string, unknown>);
    };
    lines.on("line", onLine);
  });
  child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`);
  return response;
}

async function probeEngineServer(target: string): Promise<void> {
  const config = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf8")) as {
    mcpServers: Record<string, { args: string[]; command: string }>;
  };
  const server = config.mcpServers["threenative-engine"];
  if (server === undefined) throw new Error("scaffold has no threenative-engine server");
  const child = spawn(server.command, server.args, { cwd: target, stdio: "pipe" });
  const lines = createInterface({ input: child.stdout });
  const nextId = { value: 1 };
  try {
    await request(child, nextId, lines, "initialize", {
      capabilities: {},
      clientInfo: { name: "scaffold-mcp-test", version: "0" },
      protocolVersion: "2025-06-18",
    });
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const listed = await request(child, nextId, lines, "tools/list");
    const tools = listed.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual([
      "engine_search_capabilities",
      "engine_capability_detail",
    ]);
    const called = await request(child, nextId, lines, "tools/call", {
      arguments: { situation: "enemy walks around a wall" },
      name: "engine_search_capabilities",
    });
    const content = called.content as Array<{ text: string }>;
    const parsed = capabilitySearchResponse(JSON.parse(content[0]?.text ?? "null") as unknown);
    expect(parsed.verdict).toBe("matched");
    expect(parsed.guidance).toBe("");
    const results = parsed.results as Array<{
      example: string;
      importPath: string;
      symbol: string;
    }>;
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("NavigationAgent3D");
    const navigation = results.find((result) => result.symbol === "NavigationAgent3D");
    expect(navigation?.importPath).toBe("@threenative/physics/navigation");
    expect(navigation?.example).toContain('from "@threenative/physics/navigation"');

    const broad = await request(child, nextId, lines, "tools/call", {
      arguments: {
        scope: "request",
        situation:
          "sailing ship on ocean waves with buoyancy, cloth sails in wind, cannonball physics and smoke particles, crew navigating a deck with swords, islands and coastlines, and positional sound",
      },
      name: "engine_search_capabilities",
    });
    const broadContent = broad.content as Array<{ text: string }>;
    const broadResponse = capabilitySearchResponse(
      JSON.parse(broadContent[0]?.text ?? "null") as unknown,
    );
    expect(broadResponse.verdict).toBe("matched");
    expect(broadResponse.guidance).toBe("");
    const broadResults = broadResponse.results as Array<{
      matchedSituation: string;
      symbol: string;
    }>;
    expect(broadResults.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["FluidField2D", "GPUReadback", "SoftBody3D", "SpectralOcean"]),
    );
    expect(broadResults.every((result) => result.matchedSituation.length > 0)).toBe(true);

    const networking = await request(child, nextId, lines, "tools/call", {
      arguments: {
        scope: "request",
        situation: "exchange authenticated multiplayer messages over WebTransport",
      },
      name: "engine_search_capabilities",
    });
    const networkingContent = networking.content as Array<{ text: string }>;
    const networkingResponse = capabilitySearchResponse(
      JSON.parse(networkingContent[0]?.text ?? "null") as unknown,
    );
    expect(networkingResponse.verdict).toBe("matched");
    const transport = networkingResponse.results.find((result) => result.symbol === "connect");
    expect(transport?.importPath).toBe("@threenative/core/net");

    const detailCall = await request(child, nextId, lines, "tools/call", {
      arguments: { symbol: "connect" },
      name: "engine_capability_detail",
    });
    const detailContent = detailCall.content as Array<{ text: string }>;
    const detail = JSON.parse(detailContent[0]?.text ?? "null") as {
      constraints: string[];
      importPath: string;
      overrides: string[];
      symbol: string;
    };
    expect(detail.symbol).toBe("connect");
    expect(detail.importPath).toBe("@threenative/core/net");
    expect(detail.constraints.join(" ")).toContain("HTTPS");
    expect(detail.constraints.join(" ")).toContain("queues");
    expect(detail.overrides).toEqual(
      expect.arrayContaining([
        "connectTimeoutMs, maxReliableMessageBytes, maxQueuedReliableBytes, and maxQueuedDatagrams are named per-connection limits",
      ]),
    );
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

describe("scaffolded engine MCP", () => {
  it("starts and discovers networking metadata from every template", async () => {
    for (const template of templates) {
      const root = await makeTempDir(`threenative-scaffold-mcp-${template}-`);
      temporaryRoots.push(root);
      const { target } = await createProject({ install: false, target: "game", template }, root);
      await linkEngineMcp(target);
      await linkCore(target);
      await linkPhysics(target);

      const project = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as {
        devDependencies?: Record<string, string>;
      };
      expect(project.devDependencies?.[engineMcp], template).toBeUndefined();
      const manifest = JSON.parse(
        await readFile(path.join(target, "capabilities.json"), "utf8"),
      ) as {
        entries?: unknown[];
      };
      expect(manifest.entries?.length, template).toBeGreaterThan(0);
      await expect(
        readFile(path.join(target, "node_modules/@threenative/physics/package.json"), "utf8"),
      ).resolves.toContain('"name": "@threenative/physics"');
      await probeEngineServer(target);
    }
  }, 30_000);
});

describe("scaffolded asset MCP", () => {
  it("runs the published anyCreature loop through the generated assets shim", async () => {
    const root = await makeTempDir("threenative-scaffold-asset-");
    temporaryRoots.push(root);
    const { target } = await createProject(
      { install: false, target: "game", template: "minimal" },
      root,
    );
    await mkdir(path.join(target, ".threenative", "creatures"), { recursive: true });
    await mkdir(path.join(target, "assets", "creatures"), { recursive: true });
    await writeFile(
      path.join(target, ".threenative", "creatures", "compact.json"),
      `${JSON.stringify({
        height: 0.6,
        palette: { body: { color: "#888888", rough: 0.8 } },
        joints: { Root: [0, 0.4, 0], Top: { from: "Root", up: 0.6 } },
        chains: { body: ["Root", "Top"] },
        volumes: [
          {
            chain: "body",
            material: "body",
            sides: 8,
            smooth_angle: 20,
            profile: [
              [0, 0.2, 0.2],
              [0.5, 0.25, 0.2],
              [1, 0.1, 0.1],
            ],
          },
        ],
        animations: {
          idle: {
            duration: 1,
            loop: true,
            tracks: {
              Root: {
                ry: [
                  [0, -2],
                  [0.5, 2],
                  [1, -2],
                ],
              },
            },
          },
        },
      })}\n`,
    );
    await linkCore(target);
    await linkRegistryAssetMcp(target);

    const config = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[]; command: string }>;
    };
    const server = config.mcpServers["threenative-assets"];
    if (server === undefined) throw new Error("scaffold has no threenative-assets server");
    expect(server.args[0]).toBe("./node_modules/@threenative/core/mcp/assets.mjs");

    const child = spawn(server.command, server.args, { cwd: target, stdio: "pipe" });
    const lines = createInterface({ input: child.stdout });
    const nextId = { value: 1 };
    try {
      const initialized = await request(child, nextId, lines, "initialize", {
        capabilities: {},
        clientInfo: { name: "scaffold-asset-test", version: "0" },
        protocolVersion: "2025-06-18",
      });
      expect(initialized.serverInfo).toEqual({ name: "threenative-asset-mcp", version: "0.8.0" });
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

      const listed = await request(child, nextId, lines, "tools/list");
      const toolNames = (listed.tools as Array<{ name: string }>).map((tool) => tool.name);
      expect(toolNames).toHaveLength(40);
      expect(toolNames.slice(-3)).toEqual([
        "creature_compile",
        "creature_preview",
        "creature_check",
      ]);
      expect(toolNames).toEqual(
        expect.arrayContaining(["creature_status", "creature_guide", "creature_compile"]),
      );

      const status = toolText(
        await request(child, nextId, lines, "tools/call", {
          arguments: {},
          name: "creature_status",
        }),
      );
      const statusTooling = status.tooling;
      const statusOperations = status.operations;
      expect(isRecord(statusTooling) && isRecord(statusTooling.compiler)).toBe(true);
      expect((statusTooling as Record<string, unknown>).compiler).toMatchObject({
        available: true,
      });
      expect(isRecord(statusOperations) && isRecord(statusOperations.creature_compile)).toBe(true);
      expect((statusOperations as Record<string, unknown>).creature_compile).toMatchObject({
        available: true,
      });

      const guide = toolText(
        await request(child, nextId, lines, "tools/call", {
          arguments: { section: "syntax" },
          name: "creature_guide",
        }),
      );
      expect(guide.section).toBe("syntax");
      expect(guide.guide).toEqual(expect.stringContaining('"palette"'));

      const compile = toolText(
        await request(child, nextId, lines, "tools/call", {
          arguments: {
            outputPath: "assets/creatures/compact.glb",
            specPath: ".threenative/creatures/compact.json",
          },
          name: "creature_compile",
        }),
      );
      expect(compile).toMatchObject({
        operation: "creature_compile",
        outputPath: "assets/creatures/compact.glb",
        specPath: ".threenative/creatures/compact.json",
      });
      expect(compile.outputSha256).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/u));
      expect(compile.receiptPath).toEqual(
        expect.stringMatching(/^\.threenative\/creatures\/receipts\/.+\.json$/u),
      );
      const measurements = compile.measurements;
      expect(isRecord(measurements)).toBe(true);
      expect((measurements as Record<string, unknown>).vertices).toEqual(expect.any(Number));
      expect((measurements as Record<string, unknown>).faces).toEqual(expect.any(Number));
      expect((measurements as Record<string, unknown>).joints).toBe(2);

      const output = await readFile(path.join(target, "assets/creatures/compact.glb"));
      expect(output.subarray(0, 4).toString("ascii")).toBe("glTF");
      const receiptPath = compile.receiptPath as string;
      const receipt = JSON.parse(await readFile(path.join(target, receiptPath), "utf8")) as Record<
        string,
        unknown
      >;
      expect(receipt).toMatchObject({
        operation: "creature_compile",
        outputPath: "assets/creatures/compact.glb",
        outputSha256: compile.outputSha256,
      });
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
    }
  }, 120_000);
});

// A host whose config the scaffold does not write is a host whose agent silently has no asset,
// sculpt or capability tools — the failure looks like "the framework has no such feature", not
// like a missing file. Every host in `MCP_HOSTS` is checked, so adding one to that table fails
// here until the templates carry it.
describe("scaffolded host MCP configs", () => {
  it("wires every project-scoped agent host from every template", async () => {
    for (const template of templates) {
      const root = await makeTempDir(`threenative-scaffold-hosts-${template}-`);
      temporaryRoots.push(root);
      const { target } = await createProject({ install: false, target: "game", template }, root);

      for (const host of MCP_HOSTS) {
        const source = await readFile(path.join(target, host.file), "utf8").catch(() => undefined);
        expect(source, `${template} is missing ${host.file} for ${host.label}`).toBeDefined();
        for (const name of Object.keys(MCP_SERVERS)) {
          expect(source, `${template} ${host.file} omits ${name}`).toContain(name);
        }
      }

      const cursor = JSON.parse(await readFile(path.join(target, ".cursor/mcp.json"), "utf8")) as {
        mcpServers: Record<string, { args: string[] }>;
      };
      expect(cursor.mcpServers["threenative-assets"]?.args[0], template).toBe(
        "./node_modules/@threenative/core/mcp/assets.mjs",
      );
      const code = JSON.parse(await readFile(path.join(target, ".vscode/mcp.json"), "utf8")) as {
        servers: Record<string, { type: string }>;
      };
      expect(code.servers["threenative-engine"]?.type, template).toBe("stdio");
    }
  }, 60_000);
});

// `pnpm sync:mcp` writes these files and `pnpm budgets` runs its `--check`. That gate lives at the
// end of a chain that takes minutes; this one runs in the unit suite, so a hand-edited template
// config is caught by a plain `pnpm test` too. It calls the generator's own comparison rather than
// re-deriving the expectation: a second derivation would be a second generator, green against its
// own copy of the rule.

// The hard case, not the easy one: a server that only works where Blender happens to be installed
// is exactly the failure this gate exists to prevent. The shim is launched over real stdio with
// `PATH` scrubbed and no `THREENATIVE_BLENDER_PATH`, and the assertions read a real `tools/list`
// and a real `tools/call` — never `MCP_SERVERS` asserting about `MCP_SERVERS`.
describe("scaffolded blender MCP", () => {
  it("should list blender tools with no Blender installed", async () => {
    const root = await makeTempDir("threenative-scaffold-blender-");
    temporaryRoots.push(root);
    const { target } = await createProject(
      { install: false, target: "game", template: "minimal" },
      root,
    );
    await linkCore(target);
    await linkBlenderMcp(target);

    // The server to probe is looked up in core's table, not spelled here: removing the entry from
    // `MCP_SERVERS` must stop this gate probing it, which is the revert check for the wiring. A
    // hardcoded name would have kept probing the committed template bytes and passed.
    const servers = MCP_SERVERS as Record<string, { args: readonly string[] }>;
    const blenderServerName = Object.keys(servers).find((name) =>
      (servers[name]?.args[0] ?? "").endsWith("/blender.mjs"),
    );
    expect(blenderServerName, "MCP_SERVERS declares no blender server").toBeDefined();
    const config = JSON.parse(await readFile(path.join(target, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { args: string[]; command: string }>;
    };
    const server = config.mcpServers[blenderServerName ?? ""];
    expect(server?.args[0]).toBe("./node_modules/@threenative/core/mcp/blender.mjs");

    // A PATH with one empty directory: `blender` cannot be found, and neither can anything else,
    // so nothing on this machine can accidentally satisfy the probe.
    const emptyBin = path.join(root, "empty-bin");
    const emptyHome = path.join(root, "empty-home");
    await mkdir(emptyBin, { recursive: true });
    await mkdir(emptyHome, { recursive: true });
    // `process.execPath`, not "node": PATH is scrubbed to a single empty directory so nothing
    // on this machine can satisfy the Blender probe, and that leaves no node on PATH either.
    const child = spawn(process.execPath, [server?.args[0] ?? ""], {
      cwd: target,
      env: {
        ...process.env,
        // An empty HOME as well as an empty PATH: detection also looks in `~/.local/bin`, and a
        // developer machine with Blender installed there would otherwise pass this gate for the
        // opposite reason to the one it is written for.
        HOME: emptyHome,
        PATH: emptyBin,
        THREENATIVE_BLENDER_PATH: "",
        USERPROFILE: emptyHome,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const nextId = { value: 1 };
    try {
      await request(child, nextId, lines, "initialize", {
        capabilities: {},
        clientInfo: { name: "scaffold-blender-test", version: "0" },
        protocolVersion: "2025-06-18",
      });
      child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');

      const listed = await request(child, nextId, lines, "tools/list");
      const tools = listed.tools as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toContain("blender_status");

      const called = await request(child, nextId, lines, "tools/call", {
        arguments: {},
        name: "blender_status",
      });
      const content = called.content as Array<{ text: string }>;
      const status = JSON.parse(content[0]?.text ?? "null") as {
        available: boolean;
        cause?: string;
        install: Record<string, string>;
        installCommand: string;
      };
      // The whole point: absent Blender is a result an agent can act on, not a dead server.
      expect(status.available).toBe(false);
      expect(status.cause).toBe("blender-missing");
      expect(Object.keys(status.install).sort()).toEqual(["linux", "macos", "windows"]);
      expect(status.installCommand.length).toBeGreaterThan(0);
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
    }
  }, 30_000);
});

describe("committed template MCP host configs", () => {
  it("should keep every template host config equal to the generator output", () => {
    expect(staleHostConfigs()).toEqual([]);
  });
});
