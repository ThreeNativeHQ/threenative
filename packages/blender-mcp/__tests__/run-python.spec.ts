import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBlenderScript } from "../src/bridge.js";
import { resolveBlender } from "../src/detect.js";
import { handleLine } from "../src/index.js";
import { findRecipe, recipePath, runRecipe } from "../src/recipes.js";

/**
 * `blender_run_python` is the escape hatch: an agent that needs an operation no named tool covers
 * performs it here. It is deliberately not a sandbox — the agent already has Bash — so what these
 * tests prove is that it is *honest*: the same script through the same spawn gives the same result,
 * and a failing script surfaces as a failure rather than as silence.
 */

const blender = resolveBlender();
if (!blender.available) {
  process.stderr.write(
    `TN_BLENDER_TESTS_SKIPPED: ${blender.detail} Install Blender to run packages/blender-mcp/__tests__/run-python.spec.ts.\n`,
  );
}
const withBlender = blender.available ? describe : describe.skip;

const character = path.resolve("packages/assets/__tests__/fixtures/blender/character.fbx");

describe("blender_run_python contract", () => {
  it("should throw on a missing script rather than running nothing quietly", async () => {
    await expect(runBlenderScript("", {})).rejects.toThrow(/'script' must be a non-empty path/u);
  });

  it("should say plainly that it is not a sandbox", async () => {
    const response = await handleLine(
      JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
    );
    const parsed = JSON.parse(response ?? "null") as {
      result?: { tools?: { description: string; name: string }[] };
    };
    const tool = parsed.result?.tools?.find((item) => item.name === "blender_run_python");
    expect(tool, "blender_run_python is not served").toBeDefined();
    expect(tool?.description).toMatch(/NOT a sandbox/u);
    expect(tool?.description).toMatch(/not privilege/u);
  });
});

withBlender("blender_run_python against a real Blender", () => {
  it("should run a recipe through blender_run_python identically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-run-python-"));
    try {
      const request = {
        out: path.join(root, "viaRecipe.glb"),
        ratio: 0.5,
        source: character,
      };
      const viaRecipe = await runRecipe("decimate", request);
      const viaHatch = await runBlenderScript(recipePath(findRecipe("decimate")), {
        ...request,
        out: path.join(root, "viaHatch.glb"),
      });
      expect(viaRecipe.ok, JSON.stringify(viaRecipe)).toBe(true);
      expect(viaHatch.ok, JSON.stringify(viaHatch)).toBe(true);
      if (!viaRecipe.ok || !viaHatch.ok) return;
      const named = viaRecipe.summary as unknown as Record<string, unknown>;
      const hatched = viaHatch.summary as unknown as Record<string, unknown>;
      // Present first, then equal. Asserting equality alone passes when the hatch quietly ran a
      // different script and both sides reported `undefined` — which is exactly what happened the
      // first time this control was run against a hatch that ignored its script argument.
      expect(named.recipe).toBe("decimate");
      expect(hatched.recipe).toBe("decimate");
      expect(typeof hatched.trianglesAfter).toBe("number");
      // Same script, same spawn, same numbers. Only the output path differs.
      for (const key of ["achievedRatio", "recipe", "trianglesAfter", "trianglesBefore"]) {
        expect(hatched[key], key).toEqual(named[key]);
      }
      expect(hatched.out).not.toBe(named.out);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 300_000);

  it("should report a failing script rather than reporting success", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-run-python-fail-"));
    try {
      const script = path.join(root, "boom.py");
      await writeFile(
        script,
        "import sys\nsys.stderr.write('deliberate\\n')\nraise SystemExit(4)\n",
      );
      const result = await runBlenderScript(script, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.cause).toBe("convert-failed");
      expect(result.stderr ?? "").toContain("deliberate");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should refuse to report a conversion it cannot describe", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tn-run-python-silent-"));
    try {
      // Exits 0 and prints no result line: the shape a "successful" no-op would take.
      const script = path.join(root, "quiet.py");
      await writeFile(script, "print('nothing to report')\n");
      const result = await runBlenderScript(script, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.cause).toBe("unreadable-result");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("should answer blender_recipes over the JSON-RPC surface, source text included", async () => {
    const listed = await handleLine(
      JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "blender_recipes" },
      }),
    );
    const names = JSON.parse(
      (JSON.parse(listed ?? "null") as { result: { content: { text: string }[] } }).result
        .content[0]?.text ?? "null",
    ) as { recipes: { name: string }[] };
    expect(names.recipes.map((recipe) => recipe.name)).toEqual([
      "decimate",
      "unwrap",
      "bake_ao",
      "retarget",
    ]);

    const read = await handleLine(
      JSON.stringify({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { name: "decimate" }, name: "blender_recipes" },
      }),
    );
    const payload = JSON.parse(
      (JSON.parse(read ?? "null") as { result: { content: { text: string }[] } }).result.content[0]
        ?.text ?? "null",
    ) as { source: string };
    // The whole point of the tool: an agent gets the working text, not a name it must guess from.
    expect(payload.source).toContain("DECIMATE");
    expect(payload.source).toContain("SPDX-License-Identifier: GPL-2.0-or-later");
  });
});
