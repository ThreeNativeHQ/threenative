import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { TerrainEditorController } from "@threenative/terrain/editor";
import { terrainEditor } from "@threenative/terrain/editor/server";
import { Matrix4, Quaternion, Vector3 } from "three";
import { createServer } from "vite";
import {
  advanceFixedStep,
  parseStandalonePlaytestArgs,
  withBrowserCapture,
} from "../../../packages/playtest/dist/runner/index.js";

const root = resolve(".");
const temporary = mkdtempSync(join(tmpdir(), "strata-world-export-"));
try {
  const project = join(temporary, "producer.json");
  writeFileSync(project, readFileSync("terrain/world.json"));
  const plugin = terrainEditor({ documentPath: project });
  const producer = await createServer({
    root,
    configFile: false,
    server: { host: "127.0.0.1", port: 5197 },
    plugins: [plugin],
    optimizeDeps: { exclude: ["@threenative/terrain/editor"] },
    resolve: { dedupe: ["three"] },
  });
  const isolated = join(temporary, "consumer");
  mkdirSync(join(isolated, "public"), { recursive: true });
  writeFileSync(
    join(isolated, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies: {} }),
  );
  writeFileSync(
    join(isolated, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><title>Portable terrain GLB · vanilla Three.js</title><style>body{margin:0;background:#a6c5d3}canvas{display:block}</style></head><body><script type="module" src="/world.mjs"></script></body></html>',
  );
  copyFileSync("scripts/fixtures/vanilla-world.mjs", join(isolated, "world.mjs"));
  const require = createRequire(import.meta.url);
  const threeRoot = resolve(dirname(require.resolve("three")), "..");
  const packedThree = execFileSync(
    "npm",
    ["pack", threeRoot, "--pack-destination", temporary, "--ignore-scripts", "--silent"],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--offline",
      join(temporary, packedThree),
    ],
    { cwd: isolated, stdio: "pipe" },
  );
  const consumer = await createServer({
    root: isolated,
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { include: ["three", "three/addons/loaders/GLTFLoader.js"] },
  });
  try {
    await producer.listen();
    await consumer.listen();
    const consumerUrl = consumer.resolvedUrls.local[0];
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
      "artifacts/playtest/world-export",
    ]);
    await withBrowserCapture(config, async (session) => {
      const errors = [];
      session.page.on("pageerror", (error) => errors.push(error.message));
      session.page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await session.page.waitForFunction(() => window.strata?.state && !window.strata.busy);
      await advanceFixedStep(session.page, session.bridge, 2);
      const first = (await session.page.evaluate(() => window.strata.view.inspectProps()))[0];
      assert(first);
      const before = await controller.snapshot();
      const pose = {
        position: [12, 100, -4],
        quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        scale: [2, 0.5, 1.5],
        grounding: false,
      };
      const accepted = await controller.commit({
        baseRevision: before.revision,
        document: { ...before.document, placementOverrides: { [first.id]: pose } },
      });
      await session.page.waitForFunction(
        (revision) => window.strata.view.inspect().renderedRevision === revision,
        accepted.revision,
      );
      // An unresolved river may never silently disappear from a purported full-world export.
      const missingWater = await session.page.evaluate(async () => {
        const { exportFixtureWorld } = await import("/scripts/fixtures/export-world.mjs");
        try {
          await exportFixtureWorld();
          return null;
        } catch (error) {
          return error.message;
        }
      });
      assert.match(missingWater, /Water 'river'.*baked snapshot/);
      assert.equal((await controller.snapshot()).revision, accepted.revision);
      const dry = await controller.commit({
        baseRevision: accepted.revision,
        commands: [{ op: "remove", id: "river" }],
      });
      await session.page.waitForFunction(
        (revision) =>
          window.strata.view.inspect().renderedRevision === revision && !window.strata.busy,
        dry.revision,
      );
      await advanceFixedStep(session.page, session.bridge, 2);
      const expected = await session.page.evaluate(() => window.strata.view.inspectProps());
      const result = await session.page.evaluate(async () =>
        (await import("/scripts/fixtures/export-world.mjs")).exportFixtureWorld(),
      );
      assert.equal(result.report.revision, dry.revision);
      assert.equal(result.report.resolution, 129);
      assert.equal(result.report.placementIds.length, 100);
      const base64 = await session.page.evaluate(
        async () =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(new Blob([window.exportedWorld.bytes]));
          }),
      );
      const bytes = Buffer.from(base64, "base64");
      const length = bytes.readUInt32LE(12);
      const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
      assert((json.images?.length ?? 0) >= 4);
      assert(json.images.every((image) => image.bufferView !== undefined && !image.uri));
      assert(json.buffers.every((buffer) => !buffer.uri));
      assert(!json.extensionsRequired?.includes("EXT_mesh_gpu_instancing"));
      assert(!json.cameras && !json.animations);
      assert.equal(json.nodes.filter((node) => node.extras?.placementId).length, 100);
      const modelMeshes = new Set();
      for (const placement of json.nodes.filter((node) => node.extras?.placementId)) {
        const descendants = [...(placement.children ?? [])];
        for (const index of descendants) {
          const node = json.nodes[index];
          if (node.mesh !== undefined) modelMeshes.add(node.mesh);
          descendants.push(...(node.children ?? []));
        }
      }
      assert.equal(
        modelMeshes.size,
        1,
        "100 ordinary placement nodes must share their one model's mesh data",
      );
      writeFileSync(join(isolated, "public/world.glb"), bytes);
      const artifact = resolve(config.artifactDirectory, "world.glb");
      writeFileSync(artifact, bytes);
      const requests = [];
      const rejectedRequests = [];
      await session.page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.startsWith("blob:") || url.startsWith("data:") || url.startsWith(consumerUrl)) {
          requests.push(url);
          await route.continue();
        } else {
          rejectedRequests.push(url);
          await route.abort();
        }
      });
      await session.page.goto(consumerUrl);
      await session.page.waitForFunction(
        () => window.exportConsumerReady && window.portableWorld.frames >= 5,
      );
      const loaded = await session.page.evaluate(() => window.portableWorld);
      assert.equal(loaded.placements.length, 100);
      assert(loaded.meshes >= 101 && loaded.pbrMaps >= 4);
      assert.equal(loaded.cameras, 0);
      assert.equal(loaded.animations, 0);
      assert.equal(loaded.rootExtras.terrainRevision, dry.revision);
      for (const placement of expected) {
        const node = loaded.placements.find((entry) => entry.id === placement.id);
        assert(node);
        const pose = placement.transform;
        const matrix = new Matrix4().compose(
          new Vector3().fromArray(pose.position),
          new Quaternion().fromArray(pose.quaternion),
          new Vector3().fromArray(pose.scale),
        );
        matrix.elements.forEach((value, index) =>
          assert(Math.abs(node.matrix[index] - value) < 1e-4),
        );
      }
      const manual = loaded.placements.find((entry) => entry.id === first.id);
      pose.position.forEach((value, axis) => assert.equal(manual.matrix[12 + axis], value));
      assert.deepEqual(rejectedRequests, []);
      assert.deepEqual(errors, []);
      await session.screenshot("portable-world-vanilla");
      console.log(
        JSON.stringify({
          export: {
            bytes: result.bytes,
            exportMs: result.exportMs,
            report: {
              ...result.report,
              placementIds: { count: result.report.placementIds.length },
            },
          },
          vanilla: { ...loaded, placements: { count: loaded.placements.length, manual } },
          requests,
          artifact,
        }),
      );
    });
  } finally {
    await producer.close();
    await consumer.close();
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
