import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mergeMcpServers } from "./servers.mjs";

/** The project being installed into, or undefined when this install has no project to write to —
 * a nested dependency install, or core's own workspace build. */
export function installTarget(environment = process.env, cwd = process.cwd()) {
  const target = path.resolve(environment.INIT_CWD ?? cwd);
  if (target.split(path.sep).includes("node_modules")) return undefined;
  const manifestPath = path.join(target, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  let name;
  try {
    name = JSON.parse(readFileSync(manifestPath, "utf8")).name;
  } catch {
    return undefined;
  }
  return name === "@threenative/core" ? undefined : target;
}

/** Adds the ThreeNative servers to `<target>/.mcp.json`, creating it when absent. Returns what it
 * did so the installer can say so once and stay quiet otherwise. */
export function ensureMcpConfig(target) {
  const configPath = path.join(target, ".mcp.json");
  let existing;
  if (existsSync(configPath)) {
    // A config we cannot parse is still the user's. Rewriting it would drop servers we never wrote.
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      return "unreadable";
    }
  }
  const { changed, config } = mergeMcpServers(existing);
  if (!changed) return "unchanged";
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return existing === undefined ? "created" : "updated";
}

const CODEX_MCP_SERVERS = [
  {
    body: `[mcp_servers.threenative-assets]\ncommand = "node"\nargs = ["./node_modules/@threenative/core/mcp/assets.mjs"]\n\n[mcp_servers.threenative-assets.env]\nASSET_DOWNLOAD_DIR = "./public/assets"\nAUDIO_DOWNLOAD_DIR = "./public/audio"`,
    name: "threenative-assets",
  },
  {
    body: `[mcp_servers.threenative-sculpt]\ncommand = "node"\nargs = ["./node_modules/@threenative/core/mcp/sculpt.mjs"]`,
    name: "threenative-sculpt",
  },
  {
    body: `[mcp_servers.threenative-engine]\ncommand = "node"\nargs = ["./node_modules/@threenative/core/mcp/engine.mjs"]`,
    name: "threenative-engine",
  },
];

/** Adds any missing ThreeNative servers to Codex's project-scoped MCP config without replacing
 * user-authored settings or server definitions. */
export function ensureCodexMcpConfig(target) {
  const directory = path.join(target, ".codex");
  const configPath = path.join(directory, "config.toml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const missing = CODEX_MCP_SERVERS.filter(
    ({ name }) => !existing.includes(`[mcp_servers.${name}]`),
  );
  if (missing.length === 0) return "unchanged";
  mkdirSync(directory, { recursive: true });
  const separator =
    existing.length === 0 || existing.endsWith("\n\n")
      ? ""
      : existing.endsWith("\n")
        ? "\n"
        : "\n\n";
  writeFileSync(
    configPath,
    `${existing}${separator}${missing.map(({ body }) => body).join("\n\n")}\n`,
  );
  return existing.length === 0 ? "created" : "updated";
}
