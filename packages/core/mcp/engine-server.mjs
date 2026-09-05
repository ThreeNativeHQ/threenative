#!/usr/bin/env node
import { realpathSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

var ENGINE_MCP_TOOL_NAMES = [
  "engine_search_capabilities",
  "engine_capability_detail"
];
var DEFAULT_MANIFEST_FILE = "capabilities.json";
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "add",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "because",
  "been",
  "being",
  "both",
  "build",
  "but",
  "by",
  "can",
  "create",
  "do",
  "does",
  "each",
  "either",
  "else",
  "every",
  "for",
  "from",
  "game",
  "get",
  "give",
  "had",
  "has",
  "have",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "let",
  "made",
  "make",
  "may",
  "might",
  "must",
  "no",
  "nor",
  "not",
  "of",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "our",
  "own",
  "put",
  "rather",
  "same",
  "shall",
  "should",
  "since",
  "so",
  "some",
  "such",
  "take",
  "than",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "though",
  "thus",
  "to",
  "too",
  "use",
  "very",
  "was",
  "want",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "whenever",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "whose",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "yet",
  "you",
  "your"
]);
var MAX_COMPLETE_REQUEST_RESULTS = 15;
var MAX_SITUATION_RESULTS = 5;
var RELEVANCE_FLOOR = 0.27;
var AUTHORING_INSTRUCTIONS = `Before authoring, infer concrete gameplay mechanics. Preserve the request's distinctive fantasy: choose the smallest loop that uses its characteristic setting, traversal medium, or simulation instead of a generic character game with themed props, and search those implied mechanics even when the user did not name engine terms. Search the mechanically explicit complete request with scope "request", then each mechanic with scope "mechanic". A genre label alone is not a capability query: clarify or decompose it; do not assume a preset. Inspect capability detail and obey constraints before implementing. Capability detail is authoritative on platform support: never invent a platform limitation it does not state. A response with verdict "none" is an actionable answer: follow its guidance and write game-owned behavior in src/ instead of rephrasing the same request.`;
var GENERIC_GUIDANCE = "No installed engine capability matches this situation. Decompose it into concrete mechanics and write the game-owned behavior in your project's src/; inspect the relevant template AGENTS.md before adding a package.";
function defaultManifestPath(cwd = process.cwd()) {
  const override = process.env.THREENATIVE_CAPABILITIES_MANIFEST;
  if (override !== void 0 && override.trim().length > 0) return path.resolve(cwd, override);
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    const installed = path.join(
      directory,
      "node_modules",
      "@threenative",
      "core",
      "capabilities.json"
    );
    if (existsSync(installed)) return installed;
    const parent = path.dirname(directory);
    if (parent === directory) break;
  }
  for (let directory = path.dirname(fileURLToPath(import.meta.url)); ; directory = path.dirname(directory)) {
    const repository = path.join(directory, "packages", "core", "capabilities.json");
    if (existsSync(repository)) return repository;
    const parent = path.dirname(directory);
    if (parent === directory) break;
  }
  return path.resolve(cwd, DEFAULT_MANIFEST_FILE);
}
function manifestError(file, reason) {
  return new Error(`TN_ENGINE_CAPABILITIES_MANIFEST: ${file}: ${reason}`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateManifest(value, file) {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.entries) || !Array.isArray(value.notOwned)) {
    throw manifestError(
      file,
      "root must contain manifest version 2, entries array, and notOwned array"
    );
  }
  for (const [index, raw] of value.entries.entries()) {
    if (!isRecord(raw) || typeof raw.symbol !== "string" || typeof raw.package !== "string" || typeof raw.importPath !== "string" || typeof raw.kind !== "string" || typeof raw.signature !== "string" || typeof raw.summary !== "string" || typeof raw.example !== "string" || !Array.isArray(raw.situations) || !Array.isArray(raw.aliases) || !Array.isArray(raw.constraints) || !raw.situations.every((situation) => typeof situation === "string") || !raw.aliases.every((alias) => typeof alias === "string") || !raw.constraints.every((constraint) => typeof constraint === "string")) {
      throw manifestError(file, `entry ${index} is malformed`);
    }
  }
  const notOwnedIds = /* @__PURE__ */ new Set();
  for (const [index, raw] of value.notOwned.entries()) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.trim().length === 0 || !Array.isArray(raw.situations) || raw.situations.length === 0 || !raw.situations.every(
      (situation) => typeof situation === "string" && situation.trim().length > 0
    ) || typeof raw.guidance !== "string" || raw.guidance.trim().length === 0) {
      throw manifestError(file, `notOwned ${index} is malformed`);
    }
    if (notOwnedIds.has(raw.id)) {
      throw manifestError(file, `notOwned contains duplicate id '${raw.id}'`);
    }
    notOwnedIds.add(raw.id);
  }
  return value;
}
function loadCapabilityManifest(file = defaultManifestPath()) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    throw manifestError(file, `cannot read committed manifest: ${String(error)}`);
  }
  try {
    return validateManifest(JSON.parse(raw), file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TN_ENGINE_CAPABILITIES_MANIFEST:"))
      throw error;
    throw manifestError(file, `cannot parse JSON: ${String(error)}`);
  }
}
function undouble(stem2) {
  const last = stem2.at(-1);
  return stem2.length > 3 && last !== void 0 && last === stem2.at(-2) && !"aeiou".includes(last) ? stem2.slice(0, -1) : stem2;
}
function stem(token) {
  const stripped = suffixStripped(token);
  return stripped.length > 3 && stripped.endsWith("e") ? stripped.slice(0, -1) : stripped;
}
function suffixStripped(token) {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ing")) return undouble(token.slice(0, -3));
  if (token.length > 4 && token.endsWith("ed")) return undouble(token.slice(0, -2));
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}
function capabilitySituationTokens(value) {
  return value.toLocaleLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 1 && !STOP_WORDS.has(token)).map(stem);
}
var tokens = capabilitySituationTokens;
function tokenWeights(entries) {
  const frequency = /* @__PURE__ */ new Map();
  let situations = 0;
  for (const entry of entries) {
    for (const situation of [...entry.situations, ...entry.aliases]) {
      situations += 1;
      for (const token of new Set(tokens(situation)))
        frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const weights = /* @__PURE__ */ new Map();
  for (const [token, count] of frequency) weights.set(token, Math.log(1 + situations / count));
  return weights;
}
function weightOf(weights, token) {
  return weights.get(token) ?? 0;
}
var DISTINCTIVE_SITUATION_SHARE = 0.02;
var DISTINCTIVE_FLOOR = Math.log(1 + 1 / DISTINCTIVE_SITUATION_SHARE);
var AGREEMENT_WEIGHT = 0.4;
var LONE_WORD_COVERAGE = 0.22;
function agreement(situation, query) {
  const matched = situation.filter((token) => query.has(token)).length;
  return 1 + AGREEMENT_WEIGHT * Math.max(0, matched - 1);
}
function scorePhrase(value, queryTokens, queryText, weights) {
  const phrase = tokens(value);
  const unique = [...new Set(phrase)];
  const total = unique.reduce((sum, token) => sum + weightOf(weights, token), 0);
  const matched = unique.filter((token) => queryTokens.has(token)).reduce((sum, token) => sum + weightOf(weights, token), 0);
  const phraseBonus = phrase.join(" ").includes(queryText) || queryText.includes(phrase.join(" ")) ? 1 : 0;
  if (total === 0 || matched === 0 && phraseBonus === 0) return void 0;
  const coverage = matched / total;
  const agreed = agreement(unique, queryTokens);
  return { agreed, coverage, matched, phraseBonus, score: coverage * agreed + phraseBonus };
}
function isDistinctivePhrase(candidate) {
  if (candidate.phraseBonus > 0) return true;
  if (candidate.matched < DISTINCTIVE_FLOOR) return false;
  return !(candidate.agreed === 1 && candidate.coverage < LONE_WORD_COVERAGE);
}
function scoreReadableSituations(situations, queryTokens, queryText, weights) {
  let best = 0;
  let matchedSituation = "";
  let bestReadableScore = 0;
  let bestReadableSituation = situations[0] ?? "";
  for (const situation of situations) {
    const candidate = scorePhrase(situation, queryTokens, queryText, weights);
    if (candidate === void 0) continue;
    if (candidate.score > bestReadableScore) {
      bestReadableScore = candidate.score;
      bestReadableSituation = situation;
    }
    if (isDistinctivePhrase(candidate) && candidate.score > best) {
      best = candidate.score;
      matchedSituation = situation;
    }
  }
  return { best, bestReadableSituation, matchedSituation };
}
function scoreAliases(aliases, queryTokens, queryText, weights) {
  let best = 0;
  for (const alias of aliases) {
    const candidate = scorePhrase(alias, queryTokens, queryText, weights);
    if (candidate !== void 0) best = Math.max(best, candidate.score);
  }
  return best;
}
function situationScore(query, situations, aliases, weights) {
  if (query.length === 0) return { matchedSituation: "", score: 0 };
  const queryTokens = new Set(query);
  const queryText = query.join(" ");
  const readable = scoreReadableSituations(situations, queryTokens, queryText, weights);
  const best = Math.max(readable.best, scoreAliases(aliases, queryTokens, queryText, weights));
  const matchedSituation = readable.matchedSituation.length > 0 ? readable.matchedSituation : best >= RELEVANCE_FLOOR ? readable.bestReadableSituation : "";
  return matchedSituation.length > 0 ? { matchedSituation, score: best } : { matchedSituation: "", score: 0 };
}
function notOwnedSituationScore(query, situations) {
  if (query.length === 0) return { matchedSituation: "", score: 0 };
  const queryText = query.join(" ");
  let best = 0;
  let matchedSituation = "";
  for (const situation of situations) {
    const phrase = tokens(situation);
    const overlap = new Set(phrase.filter((token) => query.includes(token))).size;
    const score = overlap / Math.max(query.length, phrase.length);
    const phraseBonus = phrase.join(" ").includes(queryText) || queryText.includes(phrase.join(" ")) ? 1 : 0;
    if (overlap < (query.length >= 4 ? 2 : 1) && phraseBonus === 0) continue;
    const candidate = score + phraseBonus;
    if (candidate > best) {
      best = candidate;
      matchedSituation = situation;
    }
  }
  return { matchedSituation, score: best };
}
function notOwnedMatch(manifest, query) {
  return manifest.notOwned.map((entry) => ({ entry, ...notOwnedSituationScore(query, entry.situations) })).filter(
    ({ matchedSituation, score }) => matchedSituation.length > 0 && score >= RELEVANCE_FLOOR
  ).sort(
    (left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id)
  )[0];
}
function isSpecificNotOwnedMatch(query, matchedSituation) {
  const queryText = query.join(" ");
  const phrase = tokens(matchedSituation);
  const phraseText = phrase.join(" ");
  if (queryText === phraseText) return true;
  if (query.length === 1 && phrase.length <= 2 && phrase.includes(query[0] ?? "")) return true;
  if (query.length > phrase.length + 1) return false;
  return new Set(phrase.filter((token) => query.includes(token))).size >= 2;
}
function capabilitySearchKey(entry) {
  return `${entry.importPath}
${entry.summary}
${entry.situations.join("\n")}`;
}
function searchCapabilities(situation, manifestFile = defaultManifestPath(), scope = "mechanic") {
  if (typeof situation !== "string" || situation.trim().length === 0)
    throw new Error("engine_search_capabilities requires a non-empty situation string.");
  const manifest = loadCapabilityManifest(manifestFile);
  const query = tokens(situation);
  const limit = scope === "request" ? MAX_COMPLETE_REQUEST_RESULTS : MAX_SITUATION_RESULTS;
  const weights = tokenWeights(manifest.entries);
  const notOwned = notOwnedMatch(manifest, query);
  if (notOwned !== void 0 && isSpecificNotOwnedMatch(query, notOwned.matchedSituation)) {
    return {
      guidance: notOwned.entry.guidance,
      results: [],
      verdict: "none"
    };
  }
  const results = manifest.entries.map((entry) => ({ entry, ...situationScore(query, entry.situations, entry.aliases, weights) })).filter(
    ({ matchedSituation, score }) => matchedSituation.length > 0 && score >= RELEVANCE_FLOOR
  ).sort(
    (left, right) => right.score - left.score || `${left.entry.importPath}:${left.entry.symbol}`.localeCompare(
      `${right.entry.importPath}:${right.entry.symbol}`
    )
  ).filter(
    (candidate, index, candidates) => candidates.findIndex(
      (other) => capabilitySearchKey(other.entry) === capabilitySearchKey(candidate.entry)
    ) === index
  ).slice(0, limit).map(({ entry, matchedSituation, score }) => ({
    constraints: entry.constraints,
    example: entry.example,
    importPath: entry.importPath,
    matchedSituation,
    score,
    summary: entry.summary,
    symbol: entry.symbol
  }));
  if (results.length > 0) return { guidance: "", results, verdict: "matched" };
  return {
    guidance: notOwned?.entry.guidance ?? GENERIC_GUIDANCE,
    results: [],
    verdict: "none"
  };
}
function capabilityDetail(symbol, manifestFile = defaultManifestPath()) {
  if (typeof symbol !== "string" || symbol.trim().length === 0)
    throw new Error("engine_capability_detail requires a non-empty symbol string.");
  const manifest = loadCapabilityManifest(manifestFile);
  const entry = manifest.entries.find((candidate) => candidate.symbol === symbol);
  if (entry === void 0) throw new Error(`Unknown engine capability '${symbol}'.`);
  return entry;
}
var TOOL_DEFINITIONS = [
  {
    annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
    name: "engine_search_capabilities",
    description: 'Search the installed engine by concrete gameplay mechanic. Decompose genres first. Use scope "request" for the mechanically explicit full request and "mechanic" for each focused search; matchedSituation and score explain every result. The response verdict "none" is an actionable answer with guidance, not a failed search.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        scope: {
          description: "Use request for the complete cross-system game request; use mechanic or omit it for one mechanic.",
          enum: ["request", "mechanic"],
          type: "string"
        },
        situation: { type: "string" }
      },
      required: ["situation"],
      type: "object"
    }
  },
  {
    annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
    name: "engine_capability_detail",
    description: "Inspect one engine capability's import, signature, example, constraints, and overrides.",
    inputSchema: {
      additionalProperties: false,
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
      type: "object"
    }
  }
];
function toolDefinitions() {
  return TOOL_DEFINITIONS;
}
function jsonRpcError(id, code, message) {
  return JSON.stringify({ id, jsonrpc: "2.0", error: { code, message } });
}
function jsonRpcResult(id, result) {
  return JSON.stringify({ id, jsonrpc: "2.0", result });
}
function writeLine(value) {
  process.stdout.write(`${value}
`);
}
function toolText(value) {
  return { content: [{ text: JSON.stringify(value, null, 2), type: "text" }] };
}
function handleToolCall(params, manifestFile) {
  const name = params.name;
  const argumentsValue = isRecord(params.arguments) ? params.arguments : {};
  if (name === "engine_search_capabilities") {
    if (typeof argumentsValue.situation !== "string")
      throw new Error("engine_search_capabilities requires a string 'situation' argument.");
    const scope = argumentsValue.scope ?? "mechanic";
    if (scope !== "request" && scope !== "mechanic")
      throw new Error("engine_search_capabilities scope must be 'request' or 'mechanic'.");
    return toolText(searchCapabilities(argumentsValue.situation, manifestFile, scope));
  }
  if (name === "engine_capability_detail") {
    if (typeof argumentsValue.symbol !== "string")
      throw new Error("engine_capability_detail requires a string 'symbol' argument.");
    return toolText(capabilityDetail(argumentsValue.symbol, manifestFile));
  }
  throw new Error(`Unknown engine MCP tool '${String(name)}'.`);
}
function handleLine(line, manifestFile) {
  if (line.trim().length === 0) return void 0;
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    return jsonRpcError(null, -32700, `Invalid JSON: ${String(error)}`);
  }
  if (!isRecord(request) || request.id === void 0 || typeof request.method !== "string")
    return void 0;
  try {
    if (request.method === "initialize") {
      return jsonRpcResult(request.id, {
        capabilities: { tools: { listChanged: false } },
        instructions: AUTHORING_INSTRUCTIONS,
        protocolVersion: "2025-06-18",
        serverInfo: { name: "threenative-engine-mcp", version: "0.3.0" }
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
    return jsonRpcError(request.id, -32e3, error instanceof Error ? error.message : String(error));
  }
}
function runServer(manifestFile = defaultManifestPath()) {
  loadCapabilityManifest(manifestFile);
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const response = handleLine(line, manifestFile);
    if (response !== void 0) writeLine(response);
  });
}
var entryPath = process.argv[1];
if (entryPath !== void 0 && realpathSync(path.resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    runServer();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  }
}

export { ENGINE_MCP_TOOL_NAMES, RELEVANCE_FLOOR, capabilityDetail, capabilitySituationTokens, defaultManifestPath, handleLine, loadCapabilityManifest, runServer, searchCapabilities, toolDefinitions };
