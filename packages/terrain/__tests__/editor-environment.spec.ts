import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Terrain, TerrainEvaluator } from "@threenative/terrain";
import { TerrainEditorController } from "@threenative/terrain/editor";
import { TerrainEditorDocument, terrainEditor } from "@threenative/terrain/editor/server";
import { type ViteDevServer, createServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";

const servers: ViteDevServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  vi.restoreAllMocks();
});

async function api() {
  const root = makeTempDirSync("terrain-environment-");
  const path = join(root, "world.json");
  const recipe = new Terrain({ size: 256, resolution: 65, seed: 73 })
    .noise({ id: "hills", amplitude: 12 })
    .toJSON();
  writeFileSync(path, JSON.stringify({ version: 1, recipe }));
  const editor = terrainEditor({ documentPath: path });
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      editor,
      {
        name: "test-editor-page",
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== "/terrain-editor/") return next();
            res.setHeader("content-type", "text/html");
            res.end("<html data-terrain-editor>Project editor</html>");
          });
        },
      },
    ],
  });
  servers.push(server);
  await server.listen();
  const controller = new TerrainEditorController((await editor.activate()).editorUrl);
  const operate = async (operation: unknown, baseRevision?: string) => {
    const current = baseRevision ?? (await controller.snapshot()).revision;
    const response = await fetch(new URL("environment", controller.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: current, operation }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { path, controller, operate };
}

describe("editor environment operations", () => {
  it("patches, reads, resets and reloads overrides without evaluating the terrain", async () => {
    const { path, controller, operate } = await api();
    const evaluate = vi.spyOn(TerrainEvaluator.prototype, "evaluate");
    const before = await controller.snapshot();
    expect(before.document.environment).toBeUndefined();

    const patched = await operate({
      op: "patch",
      values: {
        sun: { elevation: 22, intensity: 3.5, colour: "#FFCC99" },
        fog: { density: 0.002 },
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.environment).toEqual({
      sun: { elevation: 22, intensity: 3.5, colour: "#ffcc99" },
      fog: { density: 0.002 },
    });
    expect(patched.body.revision).not.toBe(before.revision);
    // A second patch merges into the first; null returns one field to the project's own value.
    const merged = await operate({
      op: "patch",
      values: { sun: { azimuth: 90, intensity: null }, exposure: 1.4 },
    });
    expect(merged.body.environment).toEqual({
      sun: { elevation: 22, colour: "#ffcc99", azimuth: 90 },
      fog: { density: 0.002 },
      exposure: 1.4,
    });
    // A reload from disk reads the same overrides back, and the recipe is byte-identical.
    const reloaded = new TerrainEditorDocument(path).snapshot();
    expect(reloaded.document.environment).toEqual(merged.body.environment);
    expect(reloaded.document.recipe).toEqual(before.document.recipe);
    expect((await operate({ op: "get" })).body.revision).toBe(merged.body.revision);
    expect(evaluate).not.toHaveBeenCalled();

    const reset = await operate({ op: "reset" });
    expect(reset.body.environment).toEqual({});
    expect((await controller.snapshot()).document.environment).toBeUndefined();
  });

  it("refuses invalid, unknown, unsupported and stale writes without changing the document", async () => {
    const { controller, operate } = await api();
    const start = (await controller.snapshot()).revision;
    for (const values of [
      { sun: { intensity: -1 } },
      { sun: { elevation: 120 } },
      { sun: { colour: "red" } },
      { fog: { density: "dense" } },
      { fog: { mode: "height" } },
      { exposure: 0 },
      { sun: { glow: 1 } },
      { moon: {} },
    ]) {
      const result = await operate({ op: "patch", values });
      expect(result.status, JSON.stringify(values)).toBe(400);
    }
    expect(
      (await operate({ op: "patch", values: { fog: { mode: "height" } } })).body.error,
    ).toMatch(/'height' is not supported.*exp2/u);
    expect(
      (await operate({ op: "patch", values: { sun: { intensity: 2 } } }, "stale")).status,
    ).toBe(409);
    expect((await controller.snapshot()).revision).toBe(start);
  });
});
