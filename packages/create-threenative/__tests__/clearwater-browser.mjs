import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { createServer } from "vite";

// Repository-only smoke. Hosted software WebGPU is useful for WGSL correctness, not FPS claims.
const root = fileURLToPath(new URL("../template-assets/clearwater/", import.meta.url));
const output = path.resolve("artifacts/clearwater-browser");
const errors = [];
const args = ["--enable-unsafe-webgpu", "--disable-gpu-sandbox", "--ignore-gpu-blocklist"];
const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head>
<body style="margin:0"><script type="module">
import { Scene, defineGame } from '@threenative/core';
import { createClearwater } from '/src/clearwater.ts';
import { setupClearwaterDemo } from '/src/render/clearwaterDemo.ts';
const observation = window.clearwaterTest = { frames: 0, errors: [], ready: false };
class WaterScene extends Scene {
  static initialState = {};

  enter(ctx) {
    observation.frames = 0;
    this.release = setupClearwaterDemo(ctx.scene, ctx.camera);
    this.water = createClearwater(ctx, { resolution: 32, segments: 64,
      causticsResolution: 256, causticsSegments: 64, rippleResolution: 32 });
    observation.water = this.water;
    const raw = ctx.renderer.raw;
    if (!raw.backend.device) throw new Error('No initialized WebGPU device.');
    raw.backend.device.addEventListener('uncapturederror', event => {
      observation.errors.push(event.error.message);
    });
    this.unhook = ctx.beforeRender(() => { observation.frames++; });
  }
  exit() { this.unhook(); this.water.dispose(); this.release(); }
}
const game = defineGame({ render: { preferWebGPU: true, resolutionScale: 1 },
  scenes: { water: WaterScene }, start: 'water' });
observation.game = game;
try {
  await game.start();
  if (game.ctx.renderer.kind !== 'webgpu') throw new Error('WebGPU was not selected.');
  document.body.append(game.ctx.renderer.domElement);
  const info = (await navigator.gpu.requestAdapter()).info;
  observation.adapter = Object.fromEntries(['vendor','architecture','device','description']
    .map(key => [key, info[key]]));
  observation.ready = true;
} catch (error) { observation.errors.push(String(error)); }
</script></body></html>`;
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
  resolve: { dedupe: ["three"] },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "clearwater-fixture",
      configureServer(instance) {
        instance.middlewares.use(async (request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html");
          response.end(await instance.transformIndexHtml("/", html));
        });
      },
    },
  ],
});
let browser;
let page;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(
    () => {
      const test = window.clearwaterTest;
      return test?.errors.length || (test?.ready && test.frames >= 8);
    },
    undefined,
    { timeout: 120000 },
  );
  const state = await page.evaluate(() => {
    const test = window.clearwaterTest;
    test.game.pause();
    return { adapter: test.adapter, errors: test.errors, frames: test.frames };
  });
  assert.deepEqual(state.errors, []);
  assert.deepEqual(errors, []);
  const wet = await page.locator("canvas").screenshot({ path: path.join(output, "water.png") });
  await page.evaluate(async () => {
    const test = window.clearwaterTest;
    test.water.mesh.visible = false;
    const ctx = test.game.ctx;
    ctx.renderer.raw.render(ctx.scene, ctx.camera);
    await ctx.renderer.raw.backend.device.queue.onSubmittedWorkDone();
  });
  const dry = await page.locator("canvas").screenshot({ path: path.join(output, "receiver.png") });
  const a = PNG.sync.read(wet);
  const b = PNG.sync.read(dry);
  assert.equal(a.data.length, b.data.length);
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const difference =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (difference > 30) changed++;
  }
  assert.ok(changed > a.width * a.height * 0.01, "The water must change actual receiver pixels.");
  const lifecycle = await page.evaluate(async () => {
    const test = window.clearwaterTest;
    const water = test.water;
    const accepted = water.disturb(0, 0, 0.25, -0.04);
    water.setLevel(0.2);
    water.setSunDirection([0.3, 0.9, 0.2]);
    water.mesh.removeFromParent();
    const disposed = water.disposed;
    water.dispose();
    await test.game.goto("water");
    test.game.resume();
    return { accepted, disposed, recreated: test.water !== water && !test.water.disposed };
  });
  assert.deepEqual(lifecycle, { accepted: true, disposed: true, recreated: true });
  await page.waitForFunction(() => window.clearwaterTest.frames >= 4, undefined, {
    timeout: 60000,
  });
  assert.deepEqual(await page.evaluate(() => window.clearwaterTest.errors), []);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        target: "browser-webgpu",
        hardwarePerformanceQualified: false,
        ...state,
        changedPixels: changed,
        lifecycle,
        browserArgs: args,
      },
      null,
      2,
    ),
  );
  console.log("Clearwater browser WebGPU: compiled, rendered, disturbed, disposed and re-entered.");
} finally {
  await writeFile(path.join(output, "console-errors.json"), JSON.stringify(errors, null, 2));
  await page?.screenshot({ path: path.join(output, "last-frame.png") }).catch(() => {});
  await browser?.close();
  await server.close();
}
