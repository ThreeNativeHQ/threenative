#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchMcpServer } from "./launch.mjs";
import { MCP_PACKAGES } from "./servers.mjs";

// The capability server reads a committed manifest from the project root. A scaffolded game has
// one; a project that added ThreeNative to an existing tree does not, so fall back to the copy this
// package ships rather than letting the server refuse to start.
const bundled = path.resolve(fileURLToPath(import.meta.url), "..", "..", "capabilities.json");
const env =
  existsSync(path.join(process.cwd(), "capabilities.json")) || !existsSync(bundled)
    ? {}
    : Object.fromEntries([["THREENATIVE_CAPABILITIES_MANIFEST", bundled]]);

await launchMcpServer({ ...MCP_PACKAGES.engine, env });
