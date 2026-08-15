// Headed Chromium under xvfb: headless renders WebGPU as a black canvas here.
// node shot.mjs <out.png> [waitSeconds] [keys...]  e.g. node shot.mjs a.png 6 KeyD:2000
import { chromium } from "playwright";

const [out = "shot.png", waitSeconds = "6", ...keys] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--window-size=1600,900",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
await page.goto("http://127.0.0.1:5173", { waitUntil: "load" });
await page.waitForTimeout(Number(waitSeconds) * 1000);

for (const key of keys) {
  const [name, holdMs = "500"] = key.split(":");
  if (name === "wait") {
    await page.waitForTimeout(Number(holdMs));
    continue;
  }
  await page.keyboard.down(name);
  if (holdMs === "hold") continue;
  await page.waitForTimeout(Number(holdMs));
  await page.keyboard.up(name);
  await page.waitForTimeout(200);
}

await page.screenshot({ path: out });
const state = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
console.log(logs.join("\n"));
console.log("STATE:", JSON.stringify(state));
await browser.close();
