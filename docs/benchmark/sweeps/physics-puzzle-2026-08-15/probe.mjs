import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu","--disable-gpu-sandbox","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(6000);
const result = await page.evaluate(async () => {
  const probe = globalThis.__PROBE__;
  const moved = probe.nudge(0, 2.0);
  await new Promise((r) => setTimeout(r, 600));
  return { moved, settledAt: probe.crates()[0] };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
