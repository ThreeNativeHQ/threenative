import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createProject } from "../src/index.js";

const templates = [
  "action-rpg",
  "defense",
  "minimal",
  "platformer",
  "racing",
  "shooter",
  "starter",
] as const;
const engineMcp = "threenative-engine-mcp";
const enginePackageRoot = path.resolve("packages/engine-mcp");
const corePackageRoot = path.resolve("packages/core");
const physicsPackageRoot = path.resolve("packages/physics");
const temporaryRoots: string[] = [];

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

async function linkPhysics(target: string): Promise<void> {
  const destination = path.join(target, "node_modules", "@threenative", "physics");
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(physicsPackageRoot, destination, "dir");
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
    const results = JSON.parse(content[0]?.text ?? "null") as Array<{
      example: string;
      importPath: string;
      symbol: string;
    }>;
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("NavigationAgent3D");
    const navigation = results.find((result) => result.symbol === "NavigationAgent3D");
    expect(navigation?.importPath).toBe("@threenative/physics/navigation");
    expect(navigation?.example).toContain('from "@threenative/physics/navigation"');
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
}

describe("scaffolded engine MCP", () => {
  it("starts and searches offline from every template", async () => {
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
      expect(project.devDependencies?.[engineMcp], template).toBe("0.2.0");
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
