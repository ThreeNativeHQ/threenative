#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coreRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const source = path.resolve(coreRoot, "..", "engine-mcp", "dist", "index.js");
const target = path.join(coreRoot, "mcp", "engine-server.mjs");

if (!existsSync(source)) {
  throw new Error(`TN_ENGINE_MCP_BUNDLE: build threenative-engine-mcp before core; missing ${source}`);
}
copyFileSync(source, target);
