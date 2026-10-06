// GPU: sh scripts/xvfb.sh node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts
// CPU: node --import tsx packages/runtime-native/tests/native-engine/wasm/assets-reference.ts --cpu
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { NativeEntryKind, writeNativePackage } from "../../../../assets/src/native-package.js";
import {
  CAPTURE_TIMEOUT_MS,
  SOFTWARE_ADAPTER,
  WEBGPU_BROWSER_ARGS,
} from "../../../../three-native/tests/compatibility/render-reference.js";
import type { BrowserModule, IWasmAssetsOutcome, IWasmAssetsState } from "./assets-page.js";

const { values } = parseArgs({
  options: {
    cpu: { type: "boolean" },
    build: { type: "string" },
    out: { type: "string" },
  },
});
const build = path.resolve(
  values.build ?? path.join(import.meta.dirname, "../../../build/wasm-browser"),
);
const out = path.resolve(values.out ?? path.join(build, "cooked-assets.png"));
const modulePath = path.join(build, "tn-native-engine-wasm-browser.js");

async function cpu() {
  const abi = await (createRequire(import.meta.url)(modulePath) as () => Promise<BrowserModule>)();
  const check = (bytes: Uint8Array, expected: number, error?: RegExp) => {
    const pointer = abi._malloc(bytes.length || 1);
    assert.notEqual(pointer, 0);
    try {
      abi.HEAPU8.set(bytes, pointer);
      assert.equal(abi._tnw_verify_package(pointer, bytes.length), expected);
      if (error) assert.match(globalThis.__tnWasmAssets.error ?? "", error);
    } finally {
      abi._free(pointer);
    }
  };
  const bytes = new Uint8Array(readFileSync(path.join(build, "assets.tnpk")));
  check(bytes, 0);
  // Exercise the real page/catalog ABI with simulated frame reports. This proves sequencing,
  // not GPU rendering: renderer.info includes the output pass (one draw and one triangle).
  const fetch = globalThis.fetch;
  let fetched = false;
  let loaded = false;
  globalThis.createTnBrowser = async () => ({
    ...abi,
    _tnw_init() {
      globalThis.__tnWasmAssets = { initialized: true, rendered: 0, packageLoaded: false };
      return 0;
    },
    _tnw_render() {
      Object.assign(globalThis.__tnWasmAssets, {
        rendered: globalThis.__tnWasmAssets.rendered + 1,
        draws: 2,
        triangles: loaded ? 2 : 13,
        covered: 0.135,
      });
      return 0;
    },
    _tnw_load_package(pointer, size) {
      assert(fetched, "load must follow fetch");
      const result = abi._tnw_verify_package(pointer, size);
      if (result === 0) {
        loaded = true;
        Object.assign(globalThis.__tnWasmAssets, { packageLoaded: true, uploadedBytes: 36 });
      }
      return result;
    },
  });
  globalThis.fetch = async (url) => {
    assert.equal(url, "assets.tnpk");
    fetched = true;
    return new Response(bytes.slice());
  };
  try {
    await import("./assets-page.js");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__tnWasmAssetsDone?.error, undefined);
    assert(globalThis.__tnWasmAssetsDone?.cooked?.packageLoaded, "page never loaded package");
    assert(fetched && loaded, "page must reach fetch and native package verification");
    console.log(
      "TN_WASM_ASSETS_PAGE_CPU_OK: boot -> fetch -> native verify -> cooked frame (GPU simulated)",
    );
  } finally {
    globalThis.fetch = fetch;
  }
  const damaged = bytes.slice();
  damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 1;
  check(damaged, 1, /TN_PACKAGE_HASH/);
  check(bytes.subarray(0, 12), 1, /TN_PACKAGE_TRUNCATED/);
  const invalid = writeNativePackage([
    {
      name: "geometry/positions",
      kind: NativeEntryKind.Buffer,
      data: new Uint8Array(new Float32Array([Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
    },
  ]);
  check(invalid, 1, /positions must be finite/);
  console.log("TN_WASM_ASSETS_CPU_OK: valid TNPK; hash, truncation and nonfinite refusals");
}

function assertFrame(state: IWasmAssetsState | undefined, triangles: number) {
  assert(
    state?.initialized && state.adapter && Object.values(state.adapter).some(Boolean),
    "adapter missing",
  );
  assert(
    !SOFTWARE_ADAPTER.test(JSON.stringify(state.adapter)),
    `software adapter: ${JSON.stringify(state.adapter)}`,
  );
  assert.equal(state.error, undefined);
  assert.equal(state.draws, 2);
  assert.equal(state.triangles, triangles);
  assert(
    typeof state.covered === "number" && state.covered > 0.01 && state.covered < 0.8,
    "blank/unbounded native frame",
  );
}

async function gpu() {
  if (process.platform === "linux" && process.env.DISPLAY === undefined)
    throw new Error("TN_WASM_ASSETS_NO_DISPLAY: run under sh scripts/xvfb.sh");
  const { chromium } = await import("@playwright/test");
  const files = new Map<string, [string, Buffer]>();
  for (const [name, type] of [
    ["native-core-assets.html", "text/html"],
    ["assets-page.js", "text/javascript"],
    ["tn-native-engine-wasm-browser.js", "text/javascript"],
    ["tn-native-engine-wasm-browser.wasm", "application/wasm"],
    ["assets.tnpk", "application/octet-stream"],
  ] as const)
    files.set(`/${name}`, [type, readFileSync(path.join(build, name))]);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = files.get(pathname);
    response.writeHead(file ? 200 : 404, { "content-type": file?.[0] ?? "text/plain" });
    response.end(file?.[1] ?? "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const browser = await chromium.launch({
      headless: false,
      timeout: 30_000,
      args: [...WEBGPU_BROWSER_ARGS],
    });
    try {
      const tab = await browser.newPage({ viewport: { width: 320, height: 240 } });
      const errors: string[] = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      tab.on("console", (message) => {
        if (message.type() === "error") {
          errors.push(message.text());
          console.error(message.text());
        }
      });
      tab.on("requestfailed", (request) =>
        errors.push(`${request.url()}: ${request.failure()?.errorText}`),
      );
      tab.on("response", (response) => {
        if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
      });
      await tab.goto(`http://127.0.0.1:${address.port}/native-core-assets.html`, {
        waitUntil: "domcontentloaded",
      });
      await tab.waitForFunction(
        () => globalThis.__tnWasmAssetsDone !== undefined,
        {},
        { timeout: CAPTURE_TIMEOUT_MS },
      );
      const outcome = (await tab.evaluate(
        () => globalThis.__tnWasmAssetsDone,
      )) as IWasmAssetsOutcome;
      assert.equal(outcome.error, undefined, outcome.error);
      assertFrame(outcome.boot, 13);
      assertFrame(outcome.cooked, 2);
      assert.equal(outcome.cooked?.packageLoaded, true);
      assert.equal(outcome.cooked?.uploadedBytes, 36);
      const png = await tab.locator("#c").screenshot({ timeout: CAPTURE_TIMEOUT_MS });
      const image = PNG.sync.read(png);
      assert.equal(image.width, 320);
      assert.equal(image.height, 240);
      let green = 0;
      for (let i = 0; i < image.data.length; i += 4)
        if ((image.data[i + 1] ?? 0) > (image.data[i] ?? 0) + 30) green++;
      assert(green > 320 * 240 * 0.01, "canvas PNG lacks the cooked green triangle");
      assert.deepEqual(errors, []);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, png);
      console.log(`TN_WASM_ASSETS_GPU_OK: ${JSON.stringify(outcome)}; PNG -> ${out}`);
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

if (values.cpu) await cpu();
else await gpu();
