import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export interface ICapabilityEntry {
  readonly symbol: string;
  readonly package: string;
  readonly importPath: string;
  readonly kind: string;
  readonly signature: string;
  readonly summary: string;
  readonly situations: readonly string[];
  readonly example: string;
  readonly constraints: readonly string[];
  readonly overrides?: readonly string[];
}

export interface ICapabilityManifest {
  readonly version: number;
  readonly entries: readonly ICapabilityEntry[];
}

export interface ICapabilitySearchResult {
  readonly symbol: string;
  readonly importPath: string;
  readonly summary: string;
  readonly example: string;
  readonly constraints: readonly string[];
}

export interface ICapabilityDetail extends ICapabilityEntry {}

export interface IEngineTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, { readonly type: "string" }>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

export const ENGINE_MCP_TOOL_NAMES = [
  "engine_search_capabilities",
  "engine_capability_detail",
] as const;

const DEFAULT_MANIFEST_FILE = "capabilities.json";
const STOP_WORDS = new Set(["a", "an", "and", "around", "for", "in", "of", "the", "to"]);

export function defaultManifestPath(cwd = process.cwd()): string {
  return path.resolve(cwd, process.env.THREENATIVE_CAPABILITIES_MANIFEST ?? DEFAULT_MANIFEST_FILE);
}

function manifestError(file: string, reason: string): Error {
  return new Error(`TN_ENGINE_CAPABILITIES_MANIFEST: ${file}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateManifest(value: unknown, file: string): ICapabilityManifest {
  if (!isRecord(value) || typeof value.version !== "number" || !Array.isArray(value.entries)) {
    throw manifestError(file, "root must contain a numeric version and entries array");
  }
  for (const [index, raw] of value.entries.entries()) {
    // Every field `ICapabilityEntry` declares is checked, `kind` and `example` included. They were
    // the two that were not, and they are the two an authoring agent is handed most directly: a
    // manifest missing `example` validated cleanly and then answered `engine_search_capabilities`
    // with `example: undefined` typed as a string. A capability tool that reports a usage example
    // it does not have is worse than one that refuses to start.
    if (
      !isRecord(raw) ||
      typeof raw.symbol !== "string" ||
      typeof raw.package !== "string" ||
      typeof raw.importPath !== "string" ||
      typeof raw.kind !== "string" ||
      typeof raw.signature !== "string" ||
      typeof raw.summary !== "string" ||
      typeof raw.example !== "string" ||
      !Array.isArray(raw.situations) ||
      !Array.isArray(raw.constraints) ||
      !raw.situations.every((situation) => typeof situation === "string") ||
      !raw.constraints.every((constraint) => typeof constraint === "string")
    ) {
      throw manifestError(file, `entry ${index} is malformed`);
    }
  }
  return value as unknown as ICapabilityManifest;
}

export function loadCapabilityManifest(file = defaultManifestPath()): ICapabilityManifest {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw manifestError(file, `cannot read committed manifest: ${String(error)}`);
  }
  try {
    return validateManifest(JSON.parse(raw) as unknown, file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TN_ENGINE_CAPABILITIES_MANIFEST:"))
      throw error;
    throw manifestError(file, `cannot parse JSON: ${String(error)}`);
  }
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function situationScore(query: readonly string[], situations: readonly string[]): number {
  if (query.length === 0) return 0;
  const queryText = query.join(" ");
  let best = 0;
  for (const situation of situations) {
    const phrase = tokens(situation);
    const overlap = phrase.filter((token) => query.includes(token)).length;
    const score = overlap / Math.max(query.length, phrase.length);
    const phraseBonus =
      phrase.join(" ").includes(queryText) || queryText.includes(phrase.join(" ")) ? 1 : 0;
    best = Math.max(best, score + phraseBonus);
  }
  return best;
}

export function searchCapabilities(
  situation: string,
  manifestFile = defaultManifestPath(),
): readonly ICapabilitySearchResult[] {
  if (typeof situation !== "string" || situation.trim().length === 0)
    throw new Error("engine_search_capabilities requires a non-empty situation string.");
  const manifest = loadCapabilityManifest(manifestFile);
  const query = tokens(situation);
  return manifest.entries
    .map((entry) => ({
      entry,
      score: situationScore(query, entry.situations),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        `${left.entry.importPath}:${left.entry.symbol}`.localeCompare(
          `${right.entry.importPath}:${right.entry.symbol}`,
        ),
    )
    .slice(0, 3)
    .map(({ entry }) => ({
      constraints: entry.constraints,
      example: entry.example,
      importPath: entry.importPath,
      summary: entry.summary,
      symbol: entry.symbol,
    }));
}

export function capabilityDetail(
  symbol: string,
  manifestFile = defaultManifestPath(),
): ICapabilityDetail {
  if (typeof symbol !== "string" || symbol.trim().length === 0)
    throw new Error("engine_capability_detail requires a non-empty symbol string.");
  const manifest = loadCapabilityManifest(manifestFile);
  const entry = manifest.entries.find((candidate) => candidate.symbol === symbol);
  if (entry === undefined) throw new Error(`Unknown engine capability '${symbol}'.`);
  return entry;
}

const TOOL_DEFINITIONS: readonly IEngineTool[] = [
  {
    name: "engine_search_capabilities",
    description: "Find engine capabilities by describing the authoring situation in plain words.",
    inputSchema: {
      additionalProperties: false,
      properties: { situation: { type: "string" } },
      required: ["situation"],
      type: "object",
    },
  },
  {
    name: "engine_capability_detail",
    description:
      "Inspect one engine capability's import, signature, example, constraints, and overrides.",
    inputSchema: {
      additionalProperties: false,
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
      type: "object",
    },
  },
];

export function toolDefinitions(): readonly IEngineTool[] {
  return TOOL_DEFINITIONS;
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

function handleToolCall(
  params: Record<string, unknown>,
  manifestFile: string,
): { content: [{ type: "text"; text: string }] } {
  const name = params.name;
  const argumentsValue = isRecord(params.arguments) ? params.arguments : {};
  // The raw value goes to the validator, never through String(): a numeric or null argument
  // must come back as a tool error the authoring agent can read, not a vacuous empty search
  // that looks like the engine having no such capability.
  if (name === "engine_search_capabilities") {
    if (typeof argumentsValue.situation !== "string")
      throw new Error("engine_search_capabilities requires a string 'situation' argument.");
    return toolText(searchCapabilities(argumentsValue.situation, manifestFile));
  }
  if (name === "engine_capability_detail") {
    if (typeof argumentsValue.symbol !== "string")
      throw new Error("engine_capability_detail requires a string 'symbol' argument.");
    return toolText(capabilityDetail(argumentsValue.symbol, manifestFile));
  }
  throw new Error(`Unknown engine MCP tool '${String(name)}'.`);
}

/**
 * Handles one raw stdin line and returns the JSON-RPC response to write, or `undefined` when the
 * line must be consumed silently. Extracted so the stdio contract is testable without a live
 * `process.stdin`: this framing is the whole surface an authoring agent's MCP client speaks.
 */
export function handleLine(line: string, manifestFile: string): string | undefined {
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
        protocolVersion: "2025-06-18",
        serverInfo: { name: "threenative-engine-mcp", version: "0.2.0" },
      });
    }
    if (request.method === "tools/list") {
      return jsonRpcResult(request.id, { tools: TOOL_DEFINITIONS });
    }
    if (request.method === "tools/call") {
      if (!isRecord(request.params)) throw new Error("tools/call requires an object params value.");
      return jsonRpcResult(request.id, handleToolCall(request.params, manifestFile));
    }
    return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

export function runServer(manifestFile = defaultManifestPath()): void {
  // Load before accepting requests. A missing manifest is a startup failure, never an empty tool
  // response that an authoring agent could mistake for the engine having no capabilities.
  loadCapabilityManifest(manifestFile);
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const response = handleLine(line, manifestFile);
    if (response !== undefined) writeLine(response);
  });
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  realpathSync(path.resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    runServer();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
