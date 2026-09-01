import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  MCP_HOSTS,
  ensureCodexMcpConfig,
  ensureHostMcpConfigs,
  ensureMcpConfig,
  installTarget,
  // @ts-expect-error — the installer is plain JavaScript so a postinstall can run it unbuilt.
} from "../mcp/install.mjs";
// @ts-expect-error — same module graph as the shims themselves.
import { MCP_SERVERS, mergeMcpServers } from "../mcp/servers.mjs";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

function project(name = "game"): string {
  const directory = makeTempDirSync("tn-mcp-");
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name }));
  return directory;
}

describe("mergeMcpServers", () => {
  it("declares every ThreeNative server when the project has no config", () => {
    const { changed, config } = mergeMcpServers(undefined);

    expect(changed).toBe(true);
    expect(Object.keys(config.mcpServers)).toEqual([
      "threenative-assets",
      "threenative-sculpt",
      "threenative-engine",
    ]);
  });

  it("keeps servers it did not write", () => {
    const mine = { command: "node", args: ["./mine.mjs"] };

    const { config } = mergeMcpServers({ mcpServers: { mine } });

    expect(config.mcpServers.mine).toEqual(mine);
    expect(config.mcpServers["threenative-assets"]).toBeDefined();
  });

  it("reports no change once the servers are already declared", () => {
    const first = mergeMcpServers(undefined);

    expect(mergeMcpServers(first.config).changed).toBe(false);
  });

  it("refuses a config whose root is not an object", () => {
    expect(() => mergeMcpServers([])).toThrow(/must be an object/u);
  });
});

describe("MCP_SERVERS", () => {
  it("installs every server transitively with core", () => {
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toMatchObject({
      "threenative-asset-mcp": "0.6.0",
      "threenative-sculpt-mcp": "0.1.1",
    });
  });

  // A renamed or moved shim would leave `.mcp.json` pointing at nothing, and the host reports that
  // as a server that failed to start rather than as a packaging mistake.
  it("names a shim this package actually ships", () => {
    for (const server of Object.values(MCP_SERVERS) as { args: string[] }[]) {
      const entry = server.args[0] ?? "";
      const shim = entry.replace("./node_modules/@threenative/core/", "");
      expect(shim).not.toBe("");
      expect(existsSync(path.join(packageRoot, shim))).toBe(true);
    }
  });
});

describe("installTarget", () => {
  it("uses the directory the install was run from", () => {
    const directory = project();

    expect(installTarget({ INIT_CWD: directory })).toBe(directory);
  });

  it("skips an install nested under node_modules", () => {
    const directory = project();
    const nested = path.join(directory, "node_modules", "other");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "other" }));

    expect(installTarget({ INIT_CWD: nested })).toBeUndefined();
  });

  it("skips core's own workspace install", () => {
    expect(installTarget({ INIT_CWD: project("@threenative/core") })).toBeUndefined();
  });

  it("skips a directory that is not a project", () => {
    expect(installTarget({ INIT_CWD: makeTempDirSync("tn-bare-") })).toBeUndefined();
  });
});

describe("ensureMcpConfig", () => {
  it("creates the config, then leaves a matching one alone", () => {
    const directory = project();

    expect(ensureMcpConfig(directory)).toBe("created");
    const written = JSON.parse(readFileSync(path.join(directory, ".mcp.json"), "utf8"));
    expect(written.mcpServers["threenative-assets"].env.ASSET_DOWNLOAD_DIR).toBe("./public/assets");
    expect(ensureMcpConfig(directory)).toBe("unchanged");
  });

  it("never overwrites a config it cannot parse", () => {
    const directory = project();
    const configPath = path.join(directory, ".mcp.json");
    writeFileSync(configPath, "{ not json");

    expect(ensureMcpConfig(directory)).toBe("unreadable");
    expect(readFileSync(configPath, "utf8")).toBe("{ not json");
  });
});

describe("ensureCodexMcpConfig", () => {
  it("creates Codex project config with all servers, then leaves it alone", () => {
    const directory = project();

    expect(ensureCodexMcpConfig(directory)).toBe("created");
    const configPath = path.join(directory, ".codex", "config.toml");
    const written = readFileSync(configPath, "utf8");
    expect(written).toContain("[mcp_servers.threenative-assets]");
    expect(written).toContain("[mcp_servers.threenative-sculpt]");
    expect(written).toContain("[mcp_servers.threenative-engine]");
    expect(written).toContain("./node_modules/@threenative/core/mcp/engine.mjs");
    expect(ensureCodexMcpConfig(directory)).toBe("unchanged");
    expect(readFileSync(configPath, "utf8")).toBe(written);
  });

  it("preserves user settings and an existing server while appending missing servers", () => {
    const directory = project();
    const codexDirectory = path.join(directory, ".codex");
    mkdirSync(codexDirectory);
    const configPath = path.join(codexDirectory, "config.toml");
    const existing =
      'model = "user-choice"\n\n[mcp_servers.threenative-engine]\ncommand = "custom"\n';
    writeFileSync(configPath, existing);

    expect(ensureCodexMcpConfig(directory)).toBe("updated");
    const written = readFileSync(configPath, "utf8");
    expect(written.startsWith(existing)).toBe(true);
    expect(written.match(/\[mcp_servers\.threenative-engine\]/gu)).toHaveLength(1);
    expect(written).toContain("[mcp_servers.threenative-assets]");
    expect(written).toContain("[mcp_servers.threenative-sculpt]");
  });
});

describe("ensureHostMcpConfigs", () => {
  it("wires every host this project can auto-configure", () => {
    const directory = project();

    const outcomes = ensureHostMcpConfigs(directory);

    expect([...outcomes.keys()].sort()).toEqual(
      ["claude-code", "codex", "cursor", "gemini-cli", "opencode", "vscode", "zed"].sort(),
    );
    for (const [host, outcome] of outcomes) expect(outcome, host).toBe("created");
    for (const host of MCP_HOSTS as { file: string; id: string }[]) {
      expect(existsSync(path.join(directory, host.file)), host.id).toBe(true);
    }
    expect(ensureHostMcpConfigs(directory).get("cursor")).toBe("unchanged");
  });

  it("writes each host the shape that host actually reads", () => {
    const directory = project();
    ensureHostMcpConfigs(directory);
    const read = (file: string): unknown =>
      JSON.parse(readFileSync(path.join(directory, file), "utf8")) as unknown;

    const cursor = read(".cursor/mcp.json") as { mcpServers: Record<string, { args: string[] }> };
    expect(cursor.mcpServers["threenative-assets"]?.args[0]).toBe(
      "./node_modules/@threenative/core/mcp/assets.mjs",
    );

    const code = read(".vscode/mcp.json") as {
      servers: Record<string, { args: string[]; type: string }>;
    };
    expect(code.servers["threenative-engine"]?.type).toBe("stdio");
    expect(code.servers["threenative-engine"]?.args[0]).toBe(
      "./node_modules/@threenative/core/mcp/engine.mjs",
    );

    const gemini = read(".gemini/settings.json") as { mcpServers: Record<string, unknown> };
    expect(Object.keys(gemini.mcpServers)).toHaveLength(3);

    const opencode = read("opencode.json") as {
      mcp: Record<
        string,
        { command: string[]; enabled: boolean; environment?: object; type: string }
      >;
    };
    expect(opencode.mcp["threenative-assets"]?.type).toBe("local");
    expect(opencode.mcp["threenative-assets"]?.command).toEqual([
      "node",
      "./node_modules/@threenative/core/mcp/assets.mjs",
    ]);
    expect(opencode.mcp["threenative-assets"]?.environment).toMatchObject({
      ASSET_DOWNLOAD_DIR: "./public/assets",
    });

    const zed = read(".zed/settings.json") as {
      context_servers: Record<string, { command: string; source: string }>;
    };
    expect(zed.context_servers["threenative-sculpt"]?.source).toBe("custom");
    expect(zed.context_servers["threenative-sculpt"]?.command).toBe("node");
  });

  it("keeps unrelated settings a host config already holds", () => {
    const directory = project();
    mkdirSync(path.join(directory, ".gemini"), { recursive: true });
    writeFileSync(
      path.join(directory, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { mine: { command: "node" } }, theme: "Dracula" }),
    );

    expect(ensureHostMcpConfigs(directory).get("gemini-cli")).toBe("updated");
    const written = JSON.parse(
      readFileSync(path.join(directory, ".gemini", "settings.json"), "utf8"),
    ) as { mcpServers: Record<string, unknown>; theme: string };
    expect(written.theme).toBe("Dracula");
    expect(written.mcpServers.mine).toEqual({ command: "node" });
    expect(written.mcpServers["threenative-engine"]).toBeDefined();
  });

  it("never overwrites a host config it cannot parse", () => {
    const directory = project();
    mkdirSync(path.join(directory, ".cursor"), { recursive: true });
    const configPath = path.join(directory, ".cursor", "mcp.json");
    writeFileSync(configPath, "{ not json");

    expect(ensureHostMcpConfigs(directory).get("cursor")).toBe("unreadable");
    expect(readFileSync(configPath, "utf8")).toBe("{ not json");
  });

  // The Codex block was three hand-written TOML strings beside the same three servers declared in
  // `MCP_SERVERS`. Two lists of the same thing drift, and the drift is silent.
  it("derives the Codex block from the same server table as the JSON hosts", () => {
    const directory = project();

    ensureHostMcpConfigs(directory);

    const codex = readFileSync(path.join(directory, ".codex", "config.toml"), "utf8");
    for (const [name, server] of Object.entries(MCP_SERVERS) as [string, { args: string[] }][]) {
      expect(codex).toContain(`[mcp_servers.${name}]`);
      expect(codex).toContain(`args = ["${server.args[0]}"]`);
    }
  });
});
