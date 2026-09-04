// Capture rig. Headed Chromium under xvfb with WebGPU enabled — headless
// renders the canvas black no matter what the scene contains.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.env.URL ?? "http://127.0.0.1:5180";
const width = Number(process.env.W ?? 1600);
const height = Number(process.env.H ?? 900);
const out = process.env.OUT ?? "shots/frame.png";
// "wait:1500,hold:KeyD:4200,hold:KeyW+KeyD:1600,wait:800"
const script = process.env.SCRIPT ?? "wait:2500";

mkdirSync(out.slice(0, out.lastIndexOf("/")), { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 30000 });

for (const step of script.split(",")) {
  const [kind, a, b] = step.split(":");
  if (kind === "wait") await page.waitForTimeout(Number(a));
  else if (kind === "hold") {
    const keys = a.split("+");
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(Number(b));
    for (const key of keys) await page.keyboard.up(key);
  } else if (kind === "reload") {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas", { timeout: 30000 });
  } else if (kind === "shot") {
    await page.screenshot({ path: a });
  } else if (kind === "press") {
    await page.keyboard.press(a);
    await page.waitForTimeout(Number(b ?? 200));
  }
}

await page.screenshot({ path: out });
console.log(JSON.stringify({ out, width, height, logs: logs.slice(-25) }, null, 2));
await browser.close();
