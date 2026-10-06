// Same corpus TS, pinned upstream modules, and the existing reference capture's GPU recipe.
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repo, "packages/runtime-native/package.json"));
const { transformSync } = require("esbuild");
const { chromium } = createRequire(path.join(repo, "packages/playtest/package.json"))("playwright");

export async function renderReference(file, png) {
  const { tsImport } = await import("tsx/esm/api");
  const { WEBGPU_BROWSER_ARGS, SOFTWARE_ADAPTER, CAPTURE_TIMEOUT_MS, threeBuildDir } =
    await tsImport(
      path.join(repo, "packages/three-native/tests/compatibility/render-reference.ts"),
      import.meta.url,
    );
  const build = threeBuildDir();
  const source = readFileSync(file, "utf8").replace(
    /from "file:[^"]*\/(three\.(?:module|webgpu|tsl)\.js)"/g,
    'from "/build/$1"',
  );
  const code = transformSync(source, {
    loader: "ts",
    format: "esm",
    define: {
      "process.env": JSON.stringify(
        Object.fromEntries([
          ["TN_TSL_LAYERS", process.env.TN_TSL_LAYERS ?? "3"],
          ["TN_TSL_FRAME", ""],
        ]),
      ),
    },
  }).code;
  const files = new Map([["/fixture.js", code]]);
  for (const name of ["three.module.js", "three.webgpu.js", "three.tsl.js", "three.core.js"])
    files.set(`/build/${name}`, readFileSync(path.join(build, name), "utf8"));
  const html = `<!doctype html><style>body{margin:0}canvas{display:block}</style><script type="module">
    import { render } from '/fixture.js';
    try {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        if (kind === 'webgpu') { this.id = 'frame'; document.body.append(this); }
        return original.call(this, kind, ...args);
      };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('TN_REFERENCE_NO_ADAPTER');
      window.adapterInfo = adapter.info;
      await render();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      window.frameDone = true;
    } catch (error) { window.frameError = String(error); }
  </script>`;
  const server = createServer((request, response) => {
    const text = request.url === "/" ? html : files.get(request.url);
    response.writeHead(text === undefined ? 404 : 200, {
      "content-type": request.url === "/" ? "text/html" : "text/javascript",
    });
    response.end(text ?? "not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: WEBGPU_BROWSER_ARGS });
    const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.frameDone || window.frameError, null, {
      timeout: CAPTURE_TIMEOUT_MS,
    });
    const result = await page.evaluate(() => ({
      error: window.frameError,
      info: window.adapterInfo,
    }));
    if (result.error || errors.length) throw Error(result.error ?? errors.join("; "));
    if (!result.info || SOFTWARE_ADAPTER.test(Object.values(result.info).join(" ")))
      throw Error(`TN_REFERENCE_SOFTWARE_OR_MISSING_ADAPTER ${JSON.stringify(result.info)}`);
    mkdirSync(path.dirname(png), { recursive: true });
    await page.locator("#frame").screenshot({ path: png, omitBackground: true });
    console.log(`reference frame: ${png}; adapter=${JSON.stringify(result.info)}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
