import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
