import { readFileSync, readdirSync, statSync } from "node:fs";
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

const SNAPSHOT_DIR = "packages/create-threenative";
const DOC_DIRECTORIES = [
  "docs/guides",
  "packages/create-threenative/agent-docs/references",
  "packages/create-threenative/templates",
] as const;

interface RecordedSurface {
  readonly tools: readonly string[];
  readonly inputSchemas?: Readonly<Record<string, unknown>>;
  readonly descriptions?: Readonly<Record<string, string>>;
}

describe("recorded MCP tool schemas", () => {
  for (const surface of SURFACES) {
    it(`${path.basename(surface.file)} records what each served tool takes`, () => {
      const recorded = JSON.parse(readFileSync(surface.file, "utf8")) as RecordedSurface;
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
    expect(blender.inputSchemas.blender_convert?.required).toContain("source");
    expect(blender.inputSchemas.blender_status?.required).toBeUndefined();
  });

  it("records an argument list for the published asset server too", () => {
    const asset = JSON.parse(
      readFileSync(path.join(SNAPSHOT_DIR, "asset-mcp-tools.json"), "utf8"),
    ) as RecordedSurface;
    for (const tool of asset.tools) {
      expect(asset.inputSchemas?.[tool], `${tool} has no recorded schema`).toBeDefined();
      expect(asset.descriptions?.[tool], `${tool} has no recorded description`).not.toBe("");
    }
    // `acceptLicense` is the acknowledgement the docs tell an agent to pass, so a snapshot without
    // it could not answer the question the recipe asks.
    expect(
      (asset.inputSchemas?.asset_download_file as { required?: readonly string[] }).required,
    ).toContain("acceptLicense");
  });

  it("names only tools a recorded surface actually serves", () => {
    const served = new Set<string>();
    for (const name of readdirSync(SNAPSHOT_DIR)) {
      if (!name.endsWith("-mcp-tools.json")) continue;
      const snapshot = JSON.parse(readFileSync(path.join(SNAPSHOT_DIR, name), "utf8")) as {
        tools: readonly string[];
      };
      for (const tool of snapshot.tools) served.add(tool);
    }
    // A tool call reads `<server>_<action>_<noun>`, and every `<server>` prefix is one the recorded
    // surfaces serve. Anchoring on that prefix keeps config keys such as `tn_lod_distance` and file
    // names such as `dutch_ship_medium` out of the check, so an invented `polyhaven_import_model`
    // fails it and nothing else does.
    const prefixes = new Set([...served].map((tool) => tool.split("_")[0] ?? ""));
    const invented: string[] = [];
    for (const directory of DOC_DIRECTORIES) {
      for (const entry of readdirSync(directory, { encoding: "utf8", recursive: true })) {
        const file = path.join(directory, entry);
        if (!/\.(?:md|json|ts|mjs)$/u.test(entry) || !statSync(file).isFile()) continue;
        for (const match of readFileSync(file, "utf8").matchAll(
          /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/gu,
        )) {
          const name = match[1] ?? "";
          const parts = name.split("_");
          if (parts.length >= 3 && prefixes.has(parts[0] ?? "") && !served.has(name)) {
            invented.push(`${file}: ${name}`);
          }
        }
      }
    }
    expect(invented).toEqual([]);
  });
});
