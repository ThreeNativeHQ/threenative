// PRD-226 arm A5 — the same scene in Chrome on this machine, read with the SAME meter as native
// (core's TN_FRAME_BUDGET marker). Headed: headless Chromium cannot drive WebGPU here.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5199/";
const browser = await chromium.launch({
  headless: false,
  args: [
    "--ozone-platform=x11", "--enable-unsafe-webgpu", "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist", "--enable-features=Vulkan",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
  ],
});
try {
  // Match the native arm's surface exactly: 1280x720.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const budgets = [];
  const errors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("TN_FRAME_BUDGET")) budgets.push(t);
    if (m.type() === "error") errors.push(t);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.bringToFront();
  await page.goto(url, { waitUntil: "load", timeout: 60000 });

  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    if (!a) return { error: "no adapter" };
    const info = a.info ?? (await a.requestAdapterInfo?.()) ?? {};
    return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
  });
  console.log("ADAPTER " + JSON.stringify(adapter));

  await page.waitForTimeout(Number(process.argv[3] ?? 45000));
  console.log("ERRORS " + JSON.stringify(errors.slice(0, 5)));
  for (const b of budgets) console.log("BUDGET " + b.slice(b.indexOf("TN_FRAME_BUDGET")));
  console.log(`BUDGET_COUNT ${budgets.length}`);
} finally {
  await browser.close();
}
