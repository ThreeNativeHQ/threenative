#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchMcpServer } from "./launch.mjs";
import { MCP_PACKAGES } from "./servers.mjs";

// Core carries the built server beside this shim (`scripts/bundle-blender-mcp.mjs`), so a project
// that installed `@threenative/core` has working Blender tools with no network and no extra
// install. The npx fallback stays for a stripped checkout whose bundle has not been built.
const localServer = path.resolve(fileURLToPath(import.meta.url), "..", "blender-server.mjs");
if (existsSync(localServer)) {
  const { runServer } = await import("./blender-server.mjs");
  runServer();
} else {
  await launchMcpServer(MCP_PACKAGES.blender);
}
