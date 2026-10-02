import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TerrainEditorController } from "@threenative/terrain/editor";
import { terrainEditor } from "@threenative/terrain/editor/server";
import { createServer } from "vite";
import {
  advanceFixedStep,
  parseStandalonePlaytestArgs,
  withBrowserCapture,
} from "../../../packages/playtest/dist/runner/index.js";

const root = resolve(".");
const temporary = mkdtempSync(join(tmpdir(), "strata-probe-"));
const path = join(temporary, "world.json");
writeFileSync(path, readFileSync("terrain/world.json"));
const plugin = terrainEditor({ documentPath: path });
const server = await createServer({
  root,
  configFile: false,
  publicDir: resolve("../../packages/terrain/starter-assets"),
  server: { host: "127.0.0.1", port: 5198 },
  plugins: [plugin],
  optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
  resolve: { dedupe: ["three"] },
});
try {
  await server.listen();
  const activation = await plugin.activate();
  const controller = new TerrainEditorController(activation.editorUrl);
  const config = parseStandalonePlaytestArgs([
    "--scenario",
    "playtests/editor.playtest.json",
    "--url",
    activation.editorUrl,
    "--browser-recipe",
    "webgpu",
    "--headed",
    "--timeout",
    "120000",
    "--artifacts",
    "/tmp/opencode/probe",
  ]);
  await withBrowserCapture(config, async (session) => {
    await session.page.waitForFunction(() => window.strata?.state && !window.strata.busy);
    await advanceFixedStep(session.page, session.bridge, 2);
    const box = await session.page.locator("#viewport").boundingBox();
    console.log("box", box);
    const at = [box.x + box.width / 2, box.y + box.height * 0.42];
    console.log(
      "elementAtPoint",
      await session.page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.className,
        at,
      ),
    );
    console.log(
      "pick",
      await session.page.evaluate(([x, y]) => window.strata.view.pick(x, y), at),
    );
    console.log(
      "layers",
      (await controller.snapshot()).document.recipe.layers.map((l) => l.id),
    );
    await session.page.locator('[data-tool="sculpt"]').click();
    await session.page.mouse.move(...at);
    await session.page.mouse.down();
    await session.page.mouse.move(at[0] + 30, at[1] - 20, { steps: 4 });
    await session.page.mouse.up();
    await session.page.waitForTimeout(1500);
    console.log("after stroke", (await controller.snapshot()).document.recipe.layers.map((l) => `${l.id}:${l.type}`));
    console.log("toast", await session.page.locator("#toast").textContent());
    console.log("status", await session.page.locator("#save-status").textContent());
    assert.ok(true);
  });
} finally {
  await server.close();
  rmSync(temporary, { recursive: true, force: true });
}