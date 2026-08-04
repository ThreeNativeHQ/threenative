import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "http://127.0.0.1:5173/?webgl";
const out =
  process.argv[3] ??
  "/tmp/claude-1000/-home-joao-projects-threejs-webgpu/ab4f7baa-23b5-430d-9147-5484b238617c/scratchpad/shot.png";
const wait = Number(process.argv[4] ?? 2500);
const keys = (process.argv[5] ?? "").split(",").filter(Boolean);
const hold = Number(process.argv[6] ?? 1200);
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[error] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(wait);
for (const key of keys) await page.keyboard.down(key);
if (keys.length > 0) await page.waitForTimeout(hold);
await page.screenshot({ path: out });
await browser.close();
