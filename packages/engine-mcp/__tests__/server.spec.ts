import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleLine } from "../src/index.js";

const manifestFile = path.resolve("packages/create-threenative/capabilities.json");

function frame(id: unknown, method: string, params?: unknown): string {
  return JSON.stringify({ id, jsonrpc: "2.0", method, params });
}

describe("threenative-engine-mcp stdio contract", () => {
  it("answers initialize with the pinned protocol version and server info", () => {
    const response = JSON.parse(handleLine(frame(1, "initialize", {}), manifestFile) ?? "");
    expect(response).toEqual({
      id: 1,
      jsonrpc: "2.0",
      result: {
        capabilities: { tools: { listChanged: false } },
        instructions:
          'Before authoring, infer concrete gameplay mechanics. Preserve the request\'s distinctive fantasy: choose the smallest loop that uses its characteristic setting, traversal medium, or simulation instead of a generic character game with themed props, and search those implied mechanics even when the user did not name engine terms. Search the mechanically explicit complete request with scope "request", then each mechanic with scope "mechanic". A genre label alone is not a capability query: clarify or decompose it; do not assume a preset. Inspect capability detail and obey constraints before implementing. Capability detail is authoritative on platform support: never invent a platform limitation it does not state. A response with verdict "none" is an actionable answer: follow its guidance and write game-owned behavior in src/ instead of rephrasing the same request.',
        protocolVersion: "2025-06-18",
        serverInfo: { name: "threenative-engine-mcp", version: "0.3.0" },
      },
    });
  });

  it("lists the two capability tools in order", () => {
    const response = JSON.parse(handleLine(frame(1, "tools/list"), manifestFile) ?? "");
    expect(response.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "engine_search_capabilities",
      "engine_capability_detail",
    ]);
    expect(response.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
        }),
      ]),
    );
  });

  it("answers tools/call for a search with the results as text content", () => {
    const response = JSON.parse(
      handleLine(
        frame(1, "tools/call", {
          arguments: { situation: "put a weapon in a character's hand" },
          name: "engine_search_capabilities",
        }),
        manifestFile,
      ) ?? "",
    );
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.result.content[0].text)).toMatchObject({
      guidance: "",
      results: expect.arrayContaining([expect.objectContaining({ symbol: "attachToBone" })]),
      verdict: "matched",
    });
  });

  it("answers tools/call for a detail lookup", () => {
    const response = JSON.parse(
      handleLine(
        frame(1, "tools/call", {
          arguments: { symbol: "GroundSnap" },
          name: "engine_capability_detail",
        }),
        manifestFile,
      ) ?? "",
    );
    expect(JSON.parse(response.result.content[0].text).symbol).toBe("GroundSnap");
  });

  it("answers a malformed JSON line with a -32700 parse error addressed to id null", () => {
    const response = JSON.parse(handleLine("not json", manifestFile) ?? "");
    expect(response.id).toBeNull();
    expect(response.error.code).toBe(-32700);
    expect(response.error.message).toContain("Invalid JSON");
  });

  it("answers an unknown method with -32601", () => {
    const response = JSON.parse(handleLine(frame(1, "resources/list"), manifestFile) ?? "");
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toBe("Method not found: resources/list");
  });

  it("answers a non-object tools/call params with -32000", () => {
    const response = JSON.parse(handleLine(frame(1, "tools/call", "nope"), manifestFile) ?? "");
    expect(response.error.code).toBe(-32000);
    expect(response.error.message).toContain("tools/call requires an object params value");
  });

  it("answers an unknown tool name with -32000 naming it", () => {
    const response = JSON.parse(
      handleLine(
        frame(1, "tools/call", { arguments: { situation: "zoom" }, name: "engine_explode" }),
        manifestFile,
      ) ?? "",
    );
    expect(response.error.code).toBe(-32000);
    expect(response.error.message).toBe("Unknown engine MCP tool 'engine_explode'.");
  });

  it("answers a tool call with missing arguments as a -32000 tool error", () => {
    const response = JSON.parse(
      handleLine(
        frame(1, "tools/call", { arguments: {}, name: "engine_search_capabilities" }),
        manifestFile,
      ) ?? "",
    );
    expect(response.error.code).toBe(-32000);
    expect(response.error.message).toContain("situation");
  });

  it("consumes silently: blank lines, notifications without an id, and non-record lines", () => {
    expect(handleLine("", manifestFile)).toBeUndefined();
    expect(handleLine("   \t ", manifestFile)).toBeUndefined();
    expect(
      handleLine(JSON.stringify({ jsonrpc: "2.0", method: "ping" }), manifestFile),
    ).toBeUndefined();
    expect(handleLine(JSON.stringify([]), manifestFile)).toBeUndefined();
  });

  it("answers tools/call whose arguments are missing the required key with -32000", () => {
    const noArguments = JSON.parse(
      handleLine(frame(1, "tools/call", { name: "engine_search_capabilities" }), manifestFile) ??
        "",
    );
    expect(noArguments.error.code).toBe(-32000);
    expect(noArguments.error.message).toContain("requires a string 'situation' argument");
  });

  it("errors a numeric situation argument instead of searching with its string form", () => {
    const response = JSON.parse(
      handleLine(
        frame(1, "tools/call", { arguments: { situation: 0 }, name: "engine_search_capabilities" }),
        manifestFile,
      ) ?? "",
    );
    expect(response.error.code).toBe(-32000);
    expect(response.error.message).toContain("situation");
  });
});
