#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The blender server rides inside core the way the engine server does, for the same reason and one
// more. The shared reason: a game must never have to know the server's package name or install it
// separately. The extra one: `@threenative/core` is published, and a published package that
// declares a dependency the registry does not have cannot be installed at all — `pnpm` stops with
// ERR_PNPM_FETCH_404 while resolving core, and every scaffolded project dies before its first
// build. So core devDepends on the server and carries its built output; the npx fallback in
// `launch.mjs` remains for a stripped install.
const coreRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = path.resolve(coreRoot, "..", "blender-mcp", "dist", "index.js");
const target = path.join(coreRoot, "mcp", "blender-server.mjs");

if (!existsSync(source)) {
  throw new Error(
    `TN_BLENDER_MCP_BUNDLE: build threenative-blender-mcp before core; missing ${source}`,
  );
}
copyFileSync(source, target);
