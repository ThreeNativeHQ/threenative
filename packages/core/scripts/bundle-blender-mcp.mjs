#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
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
const gplSource = path.resolve(coreRoot, "..", "blender-mcp", "gpl");
const gplTarget = path.join(coreRoot, "gpl");

if (!existsSync(source)) {
  throw new Error(
    `TN_BLENDER_MCP_BUNDLE: build threenative-blender-mcp before core; missing ${source}`,
  );
}
if (!existsSync(path.join(gplSource, "convert.py"))) {
  throw new Error(
    `TN_BLENDER_MCP_BUNDLE: build threenative-blender-mcp before core; missing ${gplSource}/convert.py`,
  );
}
copyFileSync(source, target);

// The bridge spawns these scripts at runtime, so bundling its JavaScript alone leaves a published
// core install with a server that initializes but cannot convert anything. Keep the GPL boundary
// explicit: the source remains packages/blender-mcp/gpl, and this package carries an exact runtime
// copy with its license and recipes.
if (path.basename(gplTarget) !== "gpl" || path.dirname(gplTarget) !== coreRoot) {
  throw new Error(`TN_BLENDER_MCP_BUNDLE: refusing to remove '${gplTarget}'.`);
}
rmSync(gplTarget, { force: true, recursive: true });
cpSync(gplSource, gplTarget, {
  filter: (candidate) => {
    const name = path.basename(candidate);
    return name !== "__pycache__" && !/\.py[co]$/u.test(name);
  },
  recursive: true,
});
if (!existsSync(path.join(gplTarget, "convert.py"))) {
  throw new Error(`TN_BLENDER_MCP_BUNDLE: copy produced no convert.py at ${gplTarget}`);
}
