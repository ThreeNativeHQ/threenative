import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  // --enable-features=Vulkan or Chromium answers from SwiftShader with no error.
  args: [
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:5322", { waitUntil: "load" });
for (const [label, wait] of [["a-0.4s", 400], ["b-0.8s", 400], ["c-1.4s", 600], ["d-3.0s", 1600]]) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/drop-${label}.png` });
}
const report = await page.evaluate(async () => {
  const bridge = globalThis.__THREENATIVE_PLAYTEST_BRIDGE__;
  const snapshot = await bridge.sample({ resources: ["state"] });
  const adapter = await navigator.gpu.requestAdapter();
  return { adapter: adapter?.info?.architecture ?? "unknown", state: snapshot.resources.state };
});
console.log(JSON.stringify({ consoleErrors: errors, ...report }, null, 1));
await browser.close();
