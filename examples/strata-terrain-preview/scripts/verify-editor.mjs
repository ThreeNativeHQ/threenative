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
  runStandalonePlaytest,
  withBrowserCapture,
} from "../../../packages/playtest/dist/runner/index.js";

const root = resolve(".");
const temporary = mkdtempSync(join(tmpdir(), "strata-editor-proof-"));
const path = join(temporary, "world.json");
writeFileSync(path, readFileSync("terrain/world.json"));
const plugin = terrainEditor({ documentPath: path });
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5197 },
  plugins: [plugin],
  optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
  resolve: { dedupe: ["three"] },
});
try {
  await server.listen();
  const activation = await plugin.activate();
  const controller = new TerrainEditorController(activation.editorUrl);
  assert.deepEqual(await controller.activate(), activation);
  const config = parseStandalonePlaytestArgs([
    "--scenario",
    "playtests/editor.playtest.json",
    "--url",
    activation.editorUrl,
    "--browser-recipe",
    "webgpu",
    "--headed",
    "--artifacts",
    "artifacts/playtest/editor",
  ]);
  await withBrowserCapture(config, async (session) => {
    const errors = [];
    session.page.on("pageerror", (error) => errors.push(error.message));
    session.page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await session.page.waitForFunction(
      () => window.strata?.state && !window.strata.busy,
      {},
      { timeout: 10000 },
    );
    await advanceFixedStep(session.page, session.bridge, 2);
    await session.screenshot("editor-initial");
    const observed = [];
    for (const amplitude of [30, 80, 50]) {
      const before = await controller.snapshot();
      const accepted = await controller.commit({
        baseRevision: before.revision,
        commands: [{ op: "update", id: "eroded-hill", patch: { params: { amplitude } } }],
      });
      const start = performance.now();
      await session.page.waitForFunction(
        (revision) => window.strata?.renderedRevision === revision,
        accepted.revision,
        { timeout: 2000 },
      );
      await advanceFixedStep(session.page, session.bridge, 2);
      const actual = await session.page.evaluate(() => window.strata.view.inspect());
      assert.equal(actual.renderedRevision, accepted.revision);
      assert(actual.vertexCount === 16641);
      const latencyMs = performance.now() - start;
      assert(latencyMs < 2000);
      observed.push({
        amplitude,
        revision: accepted.revision,
        heightSum: actual.heightSum,
        latencyMs,
      });
      await session.screenshot(`editor-hill-${amplitude}`);
    }
    assert.equal(
      new Set(observed.map((item) => item.heightSum)).size,
      3,
      "Three accepted revisions must change rendered geometry",
    );
    assert.equal(new Set(observed.map((item) => item.revision)).size, 3);
    await session.page.locator("#selected-name").fill("Human-polished hill");
    await session.page.locator("#selected-name").press("Tab");
    await session.page.waitForFunction(() => !document.body.dataset.saving, {}, { timeout: 2000 });
    const saved = await controller.snapshot();
    assert(saved.document.recipe.layers.some((layer) => layer.name === "Human-polished hill"));
    await session.screenshot("editor-gui-edit");
    const prior = await session.page.evaluate(() => window.strata.view.inspect());
    const current = await controller.snapshot();
    await controller.commit({
      baseRevision: current.revision,
      commands: [
        {
          op: "upsert",
          layer: {
            id: "long-erosion",
            type: "erode",
            params: { method: "hydraulic", droplets: 200000, maxSteps: 100 },
          },
        },
      ],
    });
    await session.page.waitForFunction(() => window.strata.workerBusy, {}, { timeout: 2000 });
    await session.page.locator("#cancel-build").click();
    await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 2000 });
    assert.equal(
      (await session.page.evaluate(() => window.strata.view.inspect())).heightSum,
      prior.heightSum,
      "Cancellation must retain the last valid geometry",
    );
    await session.screenshot("editor-cancelled");
    const canceled = await controller.snapshot();
    const recovered = await controller.commit({
      baseRevision: canceled.revision,
      commands: [{ op: "remove", id: "long-erosion" }],
    });
    await session.page.waitForFunction(
      (revision) => window.strata.renderedRevision === revision,
      recovered.revision,
      { timeout: 2000 },
    );
    await advanceFixedStep(session.page, session.bridge, 2);
    assert.equal(
      (await session.page.evaluate(() => window.strata.view.inspect())).renderedRevision,
      recovered.revision,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        editorUrl: activation.editorUrl,
        projectId: activation.projectId,
        observed,
        provenance: session.provenance,
      }),
    );
  });
  const report = await runStandalonePlaytest(config);
  assert(report.assertionResults?.length > 0, "Scenario assertions were not observed");
  assert(
    report.assertionResults.every((result) => result.pass),
    JSON.stringify(report.assertionResults),
  );
  assert(
    !report.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    JSON.stringify(report.diagnostics),
  );
} finally {
  await server.close();
  rmSync(temporary, { recursive: true, force: true });
}
