#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
// Installing ThreeNative wires its MCP servers into the project. An agent authoring a game here
// should not have to be told the asset, sculpt and capability tools exist, or run a setup command
// to get them. `.mcp.json` serves compatible hosts; Codex reads project-scoped `.codex/config.toml`.
// Set THREENATIVE_SKIP_MCP_SETUP=1 to opt out.
import { ensureCodexMcpConfig, ensureMcpConfig, installTarget } from "../mcp/install.mjs";

export function runMcpSetup(environment = process.env, cwd = process.cwd()) {
  const skip = environment.THREENATIVE_SKIP_MCP_SETUP;
  if (skip === "1" || skip === "true") return;
  // Never fail an install over this. A game that cannot write .mcp.json still runs.
  try {
    const target = installTarget(environment, cwd);
    if (target === undefined) return;
    const outcome = ensureMcpConfig(target);
    const codexOutcome = ensureCodexMcpConfig(target);
    if (outcome === "created" || outcome === "updated") {
      process.stdout.write(`threenative: ${outcome} .mcp.json with the ThreeNative MCP servers\n`);
    } else if (outcome === "unreadable") {
      process.stdout.write("threenative: .mcp.json is not valid JSON; left it alone\n");
    }
    if (codexOutcome === "created" || codexOutcome === "updated") {
      process.stdout.write(
        `threenative: ${codexOutcome} .codex/config.toml with the ThreeNative MCP servers\n`,
      );
    }
  } catch (error) {
    process.stdout.write(`threenative: could not wire .mcp.json (${error})\n`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url)
  runMcpSetup();
