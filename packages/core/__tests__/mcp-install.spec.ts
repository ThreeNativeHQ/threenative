import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
// @ts-expect-error — the installer is plain JavaScript so a postinstall can run it unbuilt.
import { ensureCodexMcpConfig, ensureMcpConfig, installTarget } from "../mcp/install.mjs";
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
