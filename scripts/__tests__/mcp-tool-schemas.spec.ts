import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS as BLENDER_TOOLS } from "../../packages/blender-mcp/src/index.js";
import { toolDefinitions as engineTools } from "../../packages/engine-mcp/src/index.js";

/**
 * The recorded MCP surfaces are what the docs site publishes, so their arguments must be the ones the
 * server actually serves. A snapshot that lists tool names alone cannot answer what a tool takes; a
 * snapshot whose schema has drifted from the server is worse, because it documents arguments that
 * are rejected. These two servers ship their source here, so the snapshot is compared to it. The asset
 * and sculpt servers are published npm packages with no source in this repository: their recorded
 * names are checked against the live `tools/list` by `verify-golden-path.ts` instead.
 */
const SURFACES = [
  { file: "packages/create-threenative/engine-mcp-tools.json", tools: engineTools() },
  { file: "packages/create-threenative/blender-mcp-tools.json", tools: BLENDER_TOOLS },
] as const;

describe("recorded MCP tool schemas", () => {
  for (const surface of SURFACES) {
    it(`${path.basename(surface.file)} records what each served tool takes`, () => {
      const recorded = JSON.parse(readFileSync(surface.file, "utf8")) as {
        tools: readonly string[];
        inputSchemas?: Readonly<Record<string, unknown>>;
        descriptions?: Readonly<Record<string, string>>;
      };
      expect(recorded.tools.slice().sort()).toEqual(surface.tools.map((tool) => tool.name).sort());
      for (const tool of surface.tools) {
        expect(recorded.inputSchemas?.[tool.name], `${tool.name} has no recorded schema`).toEqual(
          tool.inputSchema,
        );
        expect(recorded.descriptions?.[tool.name], `${tool.name} has no recorded description`).toBe(
          tool.description,
        );
      }
    });
  }

  it("records the arguments an agent has to get right", () => {
    const blender = JSON.parse(
      readFileSync("packages/create-threenative/blender-mcp-tools.json", "utf8"),
    ) as { inputSchemas: Readonly<Record<string, { required?: readonly string[] }>> };
    // `blender_convert` without a `source` is the mistake the docs exist to prevent.
    expect(blender.inputSchemas["blender_convert"]?.required).toContain("source");
    expect(blender.inputSchemas["blender_status"]?.required).toBeUndefined();
  });
});