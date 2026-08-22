#!/usr/bin/env node
// Installing ThreeNative wires its MCP servers into the project. An agent authoring a game here
// should not have to be told the asset, sculpt and capability tools exist, or run a setup command
// to get them: `.mcp.json` is the only place a host reads them from, and only an install hook can
// put one there. Set THREENATIVE_SKIP_MCP_SETUP=1 to opt out.
import { ensureMcpConfig, installTarget } from "../mcp/install.mjs";

const skip = process.env.THREENATIVE_SKIP_MCP_SETUP;
if (skip !== "1" && skip !== "true") {
  // Never fail an install over this. A game that cannot write .mcp.json still runs.
  try {
    const target = installTarget();
    if (target !== undefined) {
      const outcome = ensureMcpConfig(target);
      if (outcome === "created" || outcome === "updated") {
        process.stdout.write(
          `threenative: ${outcome} .mcp.json with the ThreeNative MCP servers\n`,
        );
      } else if (outcome === "unreadable") {
        process.stdout.write("threenative: .mcp.json is not valid JSON; left it alone\n");
      }
    }
  } catch (error) {
    process.stdout.write(`threenative: could not wire .mcp.json (${error})\n`);
  }
}
