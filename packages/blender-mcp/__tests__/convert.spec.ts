import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLENDER_SOURCE_EXTENSIONS,
  blenderScriptsDirectory,
  convertModel,
  inspectModel,
  parseBlenderResult,
} from "../src/bridge.js";
import { resolveBlender } from "../src/detect.js";
import { TOOL_DEFINITIONS, handleLine } from "../src/index.js";

/**
 * The bridge against a real Blender. These are the only tests in this repository that spawn one, so
 * they say out loud when they cannot: a skipped gate reported as a pass is the failure mode the
 * whole verification section of PRD-346 exists to prevent.
 */

const blender = resolveBlender();
const available = blender.available;
if (!available) {
  process.stderr.write(
    `TN_BLENDER_TESTS_SKIPPED: ${blender.detail} Install Blender to run packages/blender-mcp/__tests__/convert.spec.ts.\n`,
  );
}
const withBlender = available ? describe : describe.skip;

const character = path.resolve("packages/assets/__tests__/fixtures/blender/character.fbx");
const prop = path.resolve("packages/assets/__tests__/fixtures/blender/flag_A_blue.fbx");

describe("bridge contract", () => {
  it("should ship the Blender script it says it runs", () => {
    const script = path.join(blenderScriptsDirectory(), "convert.py");
    const source = readFileSync(script, "utf8");
    expect(source).toContain("SPDX-License-Identifier: GPL-2.0-or-later");
    expect(source).toContain("TN_BLENDER_RESULT ");
  });

  it("should throw on malformed input rather than returning a failure result", async () => {
    await expect(inspectModel("")).rejects.toThrow(/'source' must be a non-empty path/u);
    await expect(convertModel(character, "")).rejects.toThrow(/'out' must be a non-empty path/u);
  });

  it("should read only a well-formed result line", () => {
    expect(parseBlenderResult('noise\nTN_BLENDER_RESULT {"meshes":2}\n')).toEqual({ meshes: 2 });
    expect(parseBlenderResult("noise only")).toBeUndefined();
    expect(parseBlenderResult("TN_BLENDER_RESULT {not json")).toBeUndefined();
  });

  it("should list the extensions the asset pass classifies as models", () => {
    expect([...BLENDER_SOURCE_EXTENSIONS].sort()).toEqual(["blend", "dae", "fbx", "obj"]);
  });

  it("should serve exactly the tools this package implements", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "blender_status",
      "blender_inspect",
      "blender_convert",
      "blender_recipes",
      "blender_run_python",
    ]);
  });
});

withBlender("blender_convert against a real Blender", () => {
  it("should report the same counts blender_inspect reported", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-blender-convert-"));
    try {
      const inspected = await inspectModel(character);
      const converted = await convertModel(character, path.join(root, "out.glb"));
      expect(inspected.ok, JSON.stringify(inspected)).toBe(true);
      expect(converted.ok, JSON.stringify(converted)).toBe(true);
      if (!inspected.ok || !converted.ok) return;
      // Both readings come from the same source through the same importer, so a difference is the
      // convert path having changed the scene before measuring it.
      for (const key of ["bones", "meshes", "triangles", "vertices"] as const) {
        expect(converted.summary[key], key).toBe(inspected.summary[key]);
      }
      expect(converted.summary.materials).toEqual(inspected.summary.materials);
      expect(converted.summary.clips).toEqual(inspected.summary.clips);
      expect(converted.summary.outBytes).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should refuse a scene with no meshes instead of writing an empty glb", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-blender-empty-"));
    try {
      const empty = path.join(root, "empty.obj");
      await writeFile(empty, "# no geometry\n");
      const result = await convertModel(empty, path.join(root, "out.glb"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.cause).toBe("no-meshes");
      expect(result.stderr ?? "").toContain("produced no meshes");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should answer blender_convert over the JSON-RPC surface an agent speaks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-blender-rpc-"));
    try {
      const out = path.join(root, "prop.glb");
      const response = await handleLine(
        JSON.stringify({
          id: 7,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { out, source: prop }, name: "blender_convert" },
        }),
      );
      const parsed = JSON.parse(response ?? "null") as {
        result?: { content?: { text: string }[] };
      };
      const payload = JSON.parse(parsed.result?.content?.[0]?.text ?? "null") as {
        ok: boolean;
        summary?: { materials: string[]; meshes: number };
      };
      expect(payload.ok).toBe(true);
      expect(payload.summary?.meshes).toBe(1);
      expect(payload.summary?.materials).toEqual(["platformer"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should report a bad argument as a tool error rather than converting nothing", async () => {
    const response = await handleLine(
      JSON.stringify({
        id: 8,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { out: 3, source: prop }, name: "blender_convert" },
      }),
    );
    const parsed = JSON.parse(response ?? "null") as { error?: { message: string } };
    expect(parsed.error?.message).toMatch(/blender_convert requires a non-empty string 'out'/u);
  });
});
