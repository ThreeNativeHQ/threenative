import { chromium } from "playwright";

const url = process.env.SHOT_URL ?? "http://localhost:5276/";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2000);

const report = await page.evaluate(async () => {
  const key = Object.keys(window).find((name) => name.toLowerCase().includes("playtest"));
  const bridge = key ? window[key] : undefined;
  if (!bridge) return { key, methods: null };
  const methods = Object.keys(bridge).concat(
    Object.getOwnPropertyNames(Object.getPrototypeOf(bridge) ?? {}),
  );
  return { key, methods };
});
console.log("bridge:", JSON.stringify(report));

// Drive the bridge the way a tick-based scenario would.
const driven = await page.evaluate(async (globalKey) => {
  const bridge = window[globalKey];
  const out = {};
  try {
    out.describe = await bridge.describe?.();
  } catch (error) {
    out.describeError = String(error);
  }
  try {
    out.setup = await bridge.setup?.({ protocolVersion: 1 });
  } catch (error) {
    out.setupError = String(error);
  }
  try {
    const before = await bridge.sample?.({ label: "before", resources: ["state"] });
    await bridge.step?.(90);
    await bridge.advance?.(90);
    const after = await bridge.sample?.({ label: "after", resources: ["state"] });
    out.beforeState = before?.resources ?? before?.resourceValues ?? null;
    out.afterState = after?.resources ?? after?.resourceValues ?? null;
  } catch (error) {
    out.sampleError = String(error);
  }
  return out;
}, report.key);
console.log("driven:", JSON.stringify(driven).slice(0, 3000));
await browser.close();
