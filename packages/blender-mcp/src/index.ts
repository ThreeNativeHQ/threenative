import { realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { type IBlenderStatus, installCommandFor, resolveBlender } from "./detect.js";

/**
 * `threenative-blender-mcp` — a stdio MCP server that drives an installed Blender headlessly.
 *
 * It contains no Blender and installs none. Every tool routes a machine without Blender through
 * one structured result naming the platform's install command, because a host that shows a dead
 * server reads to a user as "the framework cannot do this", which is the opposite of true.
 *
 * The JSON-RPC framing is hand-written, matching `packages/engine-mcp`. Correction to PRD-346's
 * key-decision line: that package does not use `@modelcontextprotocol/sdk` either, and following
 * it exactly leaves this package with no runtime dependencies at all — which is what lets
 * `@threenative/assets` import the conversion bridge without inheriting an MCP transport.
 */

const SERVER_NAME = "threenative-blender-mcp";
const SERVER_VERSION = "0.1.0";

const AUTHORING_INSTRUCTIONS =
  "Call blender_status before anything else: it answers whether this machine can convert models at all, and when it cannot it names the install command rather than failing. Blender is never installed for the user — ask first, then let them run the command. An .fbx, .blend, .obj or .dae placed in a game's assets directory is converted by the build itself; these tools are for inspecting a source before committing it and for operations the build does not perform.";

interface IBlenderTool {
  readonly annotations: {
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
    readonly readOnlyHint: boolean;
  };
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly name: string;
}

export const TOOL_DEFINITIONS: readonly IBlenderTool[] = [
  {
    annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
    name: "blender_status",
    description:
      "Report whether this machine has a supported Blender, where it is and what version. Never fails: when Blender is absent it returns available:false with the install command for each platform.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ id, jsonrpc: "2.0", error: { code, message } });
}

function jsonRpcResult(id: unknown, result: unknown): string {
  return JSON.stringify({ id, jsonrpc: "2.0", result });
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

function toolText(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ text: JSON.stringify(value, null, 2), type: "text" }] };
}

/** What `blender_status` answers, and the shape every other tool's missing-Blender path reuses. */
export function blenderStatusResult(
  status: IBlenderStatus = resolveBlender(),
): Record<string, unknown> {
  return {
    available: status.available,
    ...(status.cause === undefined ? {} : { cause: status.cause }),
    detail: status.detail,
    install: status.install,
    installCommand: installCommandFor(),
    minimumVersion: status.minimumVersion,
    ...(status.path === undefined ? {} : { path: status.path }),
    ...(status.version === undefined ? {} : { version: status.version }),
  };
}

export function handleToolCall(params: Record<string, unknown>): {
  content: [{ type: "text"; text: string }];
} {
  const name = params.name;
  if (name === "blender_status") return toolText(blenderStatusResult());
  throw new Error(`Unknown blender MCP tool '${String(name)}'.`);
}

/**
 * One raw stdin line to the JSON-RPC response to write, or `undefined` when the line is consumed
 * silently. Extracted so the stdio contract is testable without a live `process.stdin`.
 */
export function handleLine(line: string): string | undefined {
  if (line.trim().length === 0) return undefined;
  let request: unknown;
  try {
    request = JSON.parse(line) as unknown;
  } catch (error) {
    return jsonRpcError(null, -32700, `Invalid JSON: ${String(error)}`);
  }
  if (!isRecord(request) || request.id === undefined || typeof request.method !== "string")
    return undefined;
  try {
    if (request.method === "initialize") {
      return jsonRpcResult(request.id, {
        capabilities: { tools: { listChanged: false } },
        instructions: AUTHORING_INSTRUCTIONS,
        protocolVersion: "2025-06-18",
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    if (request.method === "tools/list") {
      return jsonRpcResult(request.id, { tools: TOOL_DEFINITIONS });
    }
    if (request.method === "tools/call") {
      if (!isRecord(request.params)) throw new Error("tools/call requires an object params value.");
      return jsonRpcResult(request.id, handleToolCall(request.params));
    }
    return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Starts the server. Detection is deliberately not run here: a fourth server that probed the
 * filesystem at startup would slow every host launch for a project that never converts a model.
 */
export function runServer(): void {
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const response = handleLine(line);
    if (response !== undefined) writeLine(response);
  });
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  realpathSync(path.resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))
) {
  runServer();
}
