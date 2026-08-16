// Headed Chromium under a virtual display: the only way WebGPU actually
// renders on this machine. Drives the game with real key presses, then writes a
// frame to shots/<name>.png and prints the adapter plus any console errors.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const name = process.argv[2] ?? "frame";
const script = process.argv[3] ?? ""; // e.g. "ArrowRight:120,Space:8"
const url = process.env.GAME_URL ?? "http://127.0.0.1:5273";

mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.startsWith("TN_DIAG")) console.log(text);
  if (message.type() === "error") errors.push(text);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(4000);
// Keyboard events go to the focused element; without this the game never sees a
// key press and the run looks like a movement bug that is not there.
await page.mouse.click(760, 980);
await page.waitForTimeout(200);

const adapter = await page.evaluate(async () => {
  if (navigator.gpu === undefined) return "no-webgpu";
  const found = await navigator.gpu.requestAdapter();
  if (found === null) return "no-adapter";
  const info = found.info ?? {};
  // GPUAdapterInfo fields are prototype getters, so JSON.stringify(info) is
  // "{}" and a SwiftShader run looks identical to a real one.
  return `${info.vendor ?? "?"} / ${info.architecture ?? "?"} / ${info.device ?? "?"}`;
});
console.log("adapter:", adapter);

// down:Key | up:Key | tap:Key:ms | wait:ms — so a jump can happen mid-run.
for (const part of script.split(",").filter(Boolean)) {
  const [verb, a, b] = part.split(":");
  if (verb === "wait") await page.waitForTimeout(Number(a));
  else if (verb === "down") await page.keyboard.down(a);
  else if (verb === "up") await page.keyboard.up(a);
  else if (verb === "tap") {
    await page.keyboard.down(a);
    await page.waitForTimeout(Number(b ?? 90));
    await page.keyboard.up(a);
  }
}
await page.waitForTimeout(400);

const state = await page.evaluate(() => {
  const hook = window.__THREENATIVE__;
  if (hook === undefined) return "no-hook";
  const snapshot = typeof hook.snapshot === "function" ? hook.snapshot() : hook.snapshot;
  return JSON.stringify(snapshot);
});
console.log("state:", state);
await page.screenshot({ path: `shots/${name}.png` });
console.log("errors:", errors.slice(0, 12).join("\n  ") || "none");
await browser.close();
