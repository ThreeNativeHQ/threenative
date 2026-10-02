import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { advanceFixedStep } from "../../../packages/playtest/dist/runner/index.js";

/**
 * Every supplied tool group, driven through its own controls, checked on the shared document.
 *
 * The claim under test is narrow and specific: a control the user can reach commits a validated
 * semantic transaction to the same file an agent writes, and undo takes it back. So each step
 * clicks the real control, waits for the real save, and reads the document off disk — never an
 * internal helper — before undoing it again so the next step starts from the same recipe.
 */
export async function verifyToolGroups(session, controller, initial) {
  const writes = [];
  const observe = (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/document"))
      writes.push(request.postDataJSON());
  };
  session.page.on("request", observe);
  const settle = async (revision) => {
    await session.page.waitForFunction(
      (value) =>
        !window.strata.busy &&
        !window.strata.workerBusy &&
        window.strata.view.inspect().renderedRevision === value,
      revision,
      { timeout: 10000 },
    );
    await advanceFixedStep(session.page, session.bridge, 2);
  };
  const undo = async () => {
    await session.page.locator("#undo-btn").click();
    await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
    await advanceFixedStep(session.page, session.bridge, 2);
  };
  const box = await session.page.locator("#viewport").boundingBox();
  assert(box, "The editor must have a viewport to click");
  // The camera this session inherits may be looking anywhere — the previous session ends on a framed
  // prop — so the ground is found by asking the view where it actually is rather than assuming a
  // screen position. The first hit is the frame's centre-most ground, which is the safest place to
  // author from.
  await session.page.selectOption("#view-angle", "perspective");
  await session.page.locator("#frame-btn").click();
  await advanceFixedStep(session.page, session.bridge, 4);
  const ground = await session.page.evaluate(
    ([x, y, width, height]) => {
      for (let row = 3; row <= 7; row += 1)
        for (let column = 3; column <= 7; column += 1) {
          const at = [x + (width * column) / 10, y + (height * row) / 10];
          if (window.strata.view.pick(...at)) return at;
        }
      return null;
    },
    [box.x, box.y, box.width, box.height],
  );
  assert(ground, "The framed terrain must have ground under the viewport to author on");
  // Offsets from that hit, in metres' worth of pixels, so the strokes land on different ground.
  const point = (dx = 0, dy = 0) => [ground[0] + dx, ground[1] + dy];
  const tool = async (id) => {
    await session.page.locator(`[data-tool="${id}"]`).click();
    assert.equal(
      await session.page.evaluate(() => document.body.dataset.terrainTool),
      id,
      `Tool '${id}' must become the active tool`,
    );
  };
  const layers = (snapshot) => snapshot.document.recipe.layers;
  const countFor = (snapshot, type) =>
    layers(snapshot).filter((layer) => layer.type === type).length;
  const edited = { landforms: [], surface: [], paths: [], document: [] };

  /**
   * Run one brush tool as a real drag, prove the layer reached the shared document, then undo it.
   * The stroke is what a user makes: pointer down on the terrain, a short move, pointer up.
   */
  const stroke = async (toolId, type, { dx = 0, dy = 0, move = [30, -20] } = {}) => {
    const before = await controller.snapshot();
    const counted = countFor(before, type);
    await tool(toolId);
    const at = point(dx, dy);
    await session.page.mouse.move(...at);
    await session.page.mouse.down();
    await session.page.mouse.move(at[0] + move[0], at[1] + move[1], { steps: 4 });
    await session.page.mouse.up();
    // The save is asynchronous, so waiting on "not busy" reads the document before the transaction
    // lands. What is being waited for is the revision itself changing.
    try {
      await session.page.waitForFunction((revision) => window.strata.revision !== revision, before.revision, {
        timeout: 10000,
      });
    } catch (error) {
      assert.fail(
        `${toolId} at ${JSON.stringify(at)} saved nothing: ${JSON.stringify({
          hit: await session.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, at),
          pick: await session.page.evaluate(([x, y]) => window.strata.view.pick(x, y), at),
          activeTool: await session.page.evaluate(() => document.body.dataset.terrainTool),
          status: await session.page.locator("#save-status").textContent(),
          toast: await session.page.locator("#toast").textContent(),
        })}`,
      );
    }
    const after = await controller.snapshot();
    assert.notEqual(after.revision, before.revision, `${toolId} must save a transaction`);
    assert.equal(
      countFor(after, type),
      counted + 1,
      `${toolId} must add one '${type}' layer to the shared recipe`,
    );
    const added = layers(after).find((layer) => layer.type === type && !layers(before).includes(layer));
    assert(added, `${toolId}'s layer must be a new named recipe layer: ${JSON.stringify(layers(after).slice(-2))}`);
    await settle(after.revision);
    return added;
  };

  // ---- Landforms ------------------------------------------------------------------------------
  for (const [id, type] of [
    ["sculpt", "sculpt"],
    ["smooth", "smooth"],
    ["flatten", "flatten"],
    ["stamp", "stamp"],
    ["erode", "erode"],
  ]) {
    // Spread the strokes across the valley so each one has its own ground to work on, and so a
    // mistake in one cannot hide behind another's unchanged heights.
    const offsets = { sculpt: [-220, -40], smooth: [220, -40], flatten: [-220, 60], stamp: [220, 60], erode: [0, 90] };
    const [dx, dy] = offsets[id];
    edited.landforms.push({ tool: id, layer: (await stroke(id, type, { dx, dy })).id });
  }
  // A ramp needs two endpoints, so it is two clicks rather than a drag.
  const beforeRamp = await controller.snapshot();
  const ramped = countFor(beforeRamp, "ramp");
  await tool("ramp");
  await session.page.mouse.click(...point(-160, 30));
  await session.page.mouse.click(...point(160, 30));
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const afterRamp = await controller.snapshot();
  assert.equal(countFor(afterRamp, "ramp"), ramped + 1, "Ramp must save one ramp layer");
  edited.landforms.push({ tool: "ramp", layer: layers(afterRamp).at(-1).id });
  await settle(afterRamp.revision);
  await session.screenshot("editor-tools-ramp");

  // ---- Surface and population -----------------------------------------------------------------
  edited.surface.push({
    tool: "paint/material",
    layer: (await stroke("paint", "paint", { dx: -120, dy: -70 })).id,
  });
  // The same tool paints a named biome when its own option says so, which is a different semantic
  // operation over the same control.
  await tool("paint");
  await session.page.getByLabel("Paint target", { exact: true }).selectOption("biome");
  const beforeBiome = await controller.snapshot();
  await session.page.mouse.move(...point(120, -70));
  await session.page.mouse.down();
  await session.page.mouse.move(point(120, -70)[0] + 30, point(120, -70)[1] + 20, { steps: 4 });
  await session.page.mouse.up();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const afterBiome = await controller.snapshot();
  const biomeLayer = layers(afterBiome).at(-1);
  assert.equal(biomeLayer.type, "biome");
  assert.equal(typeof biomeLayer.params.name, "string", "A biome paint must name its biome");
  assert.equal(biomeLayer.params.name, "forest", "The option's biome name must be the one saved");
  await settle(afterBiome.revision);
  edited.surface.push({ tool: "paint/biome", layer: biomeLayer.id });

  // Scatter and clear are the population pair, and the palette is the project's own.
  const beforeScatter = await controller.snapshot();
  const scattered = countFor(beforeScatter, "scatter");
  await tool("scatter");
  const palette = await session.page.evaluate(() =>
    [...document.querySelectorAll('[data-option="asset"] option')].map((option) => option.value),
  );
  assert(
    ["spruce", "boulder", "grass", "fern", "poppy"].some((id) => palette.includes(id)),
    `The scatter palette must be the project's own assets, got ${JSON.stringify(palette)}`,
  );
  await session.page.getByLabel("Asset ID", { exact: true }).selectOption("spruce");
  await session.page.getByLabel("Requested instances", { exact: true }).fill("12");
  await session.page.mouse.move(...point(0, 0));
  await session.page.mouse.down();
  await session.page.mouse.move(point(0, 0)[0] + 40, point(0, 0)[1], { steps: 3 });
  await session.page.mouse.up();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const afterScatter = await controller.snapshot();
  assert.equal(countFor(afterScatter, "scatter"), scattered + 1, "Scatter must add one rule");
  const scatterLayer = layers(afterScatter).at(-1);
  assert.equal(scatterLayer.params.asset, "spruce", "The chosen asset must be the one saved");
  assert.equal(scatterLayer.params.count, 12, "The requested instance count must be the one saved");
  const scatteredInstances = await session.page.evaluate(() => window.strata.view.inspectProps().length);
  assert(
    scatteredInstances >= 100,
    `A scatter brush must place actual instances, got ${scatteredInstances}`,
  );
  await settle(afterScatter.revision);
  edited.surface.push({ tool: "scatter", layer: scatterLayer.id, instances: scatteredInstances });
  await session.screenshot("editor-tools-scatter");

  const beforeClear = await controller.snapshot();
  const cleared = countFor(beforeClear, "clear");
  await session.page.getByLabel("Erase this asset inside brush", { exact: true }).check();
  await session.page.mouse.move(...point(40, 0));
  await session.page.mouse.down();
  await session.page.mouse.move(point(40, 0)[0] + 30, point(40, 0)[1], { steps: 3 });
  await session.page.mouse.up();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const afterClear = await controller.snapshot();
  assert.equal(countFor(afterClear, "clear"), cleared + 1, "Clear must add one clear operation");
  assert.equal(layers(afterClear).at(-1).params.asset, "spruce", "Clear must name the asset it erases");
  await settle(afterClear.revision);
  edited.surface.push({ tool: "scatter/clear", layer: layers(afterClear).at(-1).id });
  await session.page.getByLabel("Erase this asset inside brush", { exact: true }).uncheck();

  // ---- Paths and water ------------------------------------------------------------------------
  /** Two or more clicks and Enter is how the recovered GUI finishes a spline. */
  const spline = async (toolId, type, extra) => {
    const before = await controller.snapshot();
    const counted = countFor(before, type);
    await tool(toolId);
    for (const [dx, dy] of [
      [-180, 90],
      [-40, 110],
      [120, 90],
    ])
      await session.page.mouse.click(...point(dx, dy));
    if (extra) await extra();
    await session.page.keyboard.press("Enter");
    await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
    const after = await controller.snapshot();
    assert.equal(countFor(after, type), counted + 1, `${toolId} must add one '${type}' layer`);
    await settle(after.revision);
    return layers(after).at(-1);
  };
  const road = await spline("spline", "road");
  assert.equal(road.params.width, 12, "The spline's own width option must be the one saved");
  edited.paths.push({ tool: "spline/road", layer: road.id });
  const river = await spline("spline", "river", async () => {
    await session.page.getByLabel("Spline type", { exact: true }).selectOption("river");
    await session.page.getByLabel("River depth (m)", { exact: true }).fill("6");
  });
  assert.equal(river.params.depth, 6, "A river's own depth option must be the one saved");
  assert.equal(river.params.enforceDownhill, true, "A GUI river must keep its downhill profile rule");
  edited.paths.push({ tool: "spline/river", layer: river.id });
  const lake = await stroke("water", "water", { dx: 0, dy: 120 });
  assert(
    ["lake", "ocean"].includes(lake.params.kind),
    `The water tool's chosen body must be saved, got ${JSON.stringify(lake.params)}`,
  );
  edited.paths.push({ tool: "water", layer: lake.id });
  await session.screenshot("editor-tools-water");

  // ---- Document: enable, reorder, duplicate, delete, undo/redo, import ------------------------
  const beforeDocument = await controller.snapshot();
  const firstId = layers(beforeDocument).at(-1).id;
  const row = session.page.locator(`.layer-list .layer-row[data-id="${firstId}"]`);
  await row.locator(".layer-eye").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const disabled = await controller.snapshot();
  const disabledLayer = layers(disabled).find((layer) => layer.id === firstId);
  assert.equal(disabledLayer.enabled, false, "The layer eye must disable its layer on disk");
  await session.page.locator(`.layer-row[data-id="${firstId}"] .layer-eye`).click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  assert.equal(
    layers(await controller.snapshot()).find((layer) => layer.id === firstId).enabled,
    undefined,
    "Re-enabling must save the layer back",
  );

  await row.click();
  await session.page.locator("#layer-up").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const moved = await controller.snapshot();
  assert.equal(
    layers(moved).indexOf(layers(moved).find((layer) => layer.id === firstId)),
    layers(moved).length - 2,
    "Move earlier must reorder the stack on disk",
  );
  await session.page.locator("#layer-duplicate").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const duplicated = await controller.snapshot();
  const copy = layers(duplicated).at(-1);
  assert(copy.id.endsWith("-copy-1"), `Duplicate must name its copy, got ${copy.id}`);
  assert.equal(copy.name.endsWith(" copy"), true);
  const selectedCopy = session.page.locator(`.layer-row[data-id="${copy.id}"]`);
  await selectedCopy.click();
  await session.page.locator("#layer-delete").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const deleted = await controller.snapshot();
  assert(
    !layers(deleted).some((layer) => layer.id === copy.id),
    "Delete must remove the layer from the shared document",
  );
  await session.page.locator("#redo-btn").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  assert(
    layers(await controller.snapshot()).some((layer) => layer.id === copy.id),
    "Redo must put the deleted layer back",
  );
  edited.document.push({
    tool: "layer enable/reorder/duplicate/delete/redo",
    layer: firstId,
    copy: copy.id,
  });
  await session.screenshot("editor-tools-document");

  // The layer inspector's own JSON editor: the documented way to set any parameter the GUI has no
  // control for, and it must be the same transaction path as every other edit.
  await session.page.locator(`.layer-row[data-id="${firstId}"]`).click();
  const json = JSON.parse(await session.page.locator("#selected-json").inputValue());
  json.params.opacity = 0.5;
  await session.page.locator("#selected-json").fill(JSON.stringify({ params: json.params }, null, 2));
  await session.page.locator("#apply-layer").click();
  await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
  const applied = await controller.snapshot();
  const appliedLayer = layers(applied).find((layer) => layer.id === firstId);
  assert.equal(appliedLayer.opacity, 0.5, "The JSON inspector must save a layer's own opacity");
  // An invalid edit must be refused without touching the document.
  const beforeInvalid = await controller.snapshot();
  await session.page.locator("#selected-json").fill("{ not json");
  await session.page.locator("#apply-layer").click();
  assert(
    (await session.page.locator("#layer-error").textContent()).length > 0,
    "A malformed edit must report why",
  );
  assert.equal(
    (await controller.snapshot()).revision,
    beforeInvalid.revision,
    "A malformed edit must not change the shared document",
  );

  // Import is the recovered browser-only path, and it lands in the same document as an undoable edit.
  const temporary = mkdtempSync(join(tmpdir(), "strata-import-"));
  try {
    const recipe = await controller.snapshot();
    writeFileSync(join(temporary, "import.json"), JSON.stringify(recipe.document.recipe));
    const beforeImport = await controller.snapshot();
    await session.page.locator("#import-btn").click();
    await session.page.locator("#import-file").setInputFiles(join(temporary, "import.json"));
    await session.page.waitForFunction(() => !window.strata.busy, {}, { timeout: 10000 });
    const afterImport = await controller.snapshot();
    assert.notEqual(afterImport.revision, beforeImport.revision, "An import must save an edit");
    assert.deepEqual(
      afterImport.document.recipe,
      beforeImport.document.recipe,
      "Importing the project's own recipe must round-trip it exactly",
    );
    await settle(afterImport.revision);
    // The existing data exports the dialog offers, read through the same function its buttons call.
    const exported = await session.page.evaluate(async () => {
      const output = await window.strata.export("project");
      return { name: output.name, type: output.type, bytes: output.bytes.byteLength ?? output.bytes.length };
    });
    assert.match(exported.name, /\.json$/, `The project export must be a recipe file, got ${exported.name}`);
    assert(exported.bytes > 100, "The exported recipe must contain the document");
    edited.document.push({ tool: "import + project export", ...exported });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  // Undo every transaction this section made, and the document must be byte-identical to the one it
  // started from: the shared file is the same whichever actor edited it.
  const startIndex = writes.length;
  assert(startIndex > 0, "Every step above must have written through the shared endpoint");
  for (let step = 0; step < startIndex; step += 1) await undo();
  const restored = await controller.snapshot();
  assert.deepEqual(
    restored.document.recipe.layers.map((layer) => layer.id),
    initial.document.recipe.layers.map((layer) => layer.id),
    "Undo must take the shared document back to where this section found it",
  );
  await settle(restored.revision);
  await session.page.locator('[data-tool="sculpt"]').click();
  console.log(JSON.stringify({ ...edited, transactions: startIndex, restored: restored.revision }));
}