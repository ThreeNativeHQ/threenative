// Capture the running game. Headless Chromium renders WebGPU black on this
// machine, so this drives a headed browser under xvfb.
import { chromium } from "playwright";

const out = process.argv[2] ?? "shots/frame.png";
const seconds = Number(process.argv[3] ?? 6);
const script = process.argv[4] ?? "";

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
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(2500);

// script format: "hold:KeyA:1200,tap:KeyR,wait:2000"
for (const step of script.split(",").filter(Boolean)) {
  const [kind, a, b] = step.split(":");
  if (kind === "press") {
    await page.keyboard.down(a);
    await page.waitForTimeout(Number(b ?? 0));
  } else if (kind === "hold") {
    await page.keyboard.down(a);
    await page.waitForTimeout(Number(b));
    await page.keyboard.up(a);
  } else if (kind === "tap") {
    await page.keyboard.press(a);
  } else if (kind === "wait") {
    await page.waitForTimeout(Number(a));
  }
}
await page.waitForTimeout(seconds * 1000);
await page.screenshot({ path: out });
const state = await page.evaluate(() => {
  try {
    const game = globalThis.__GAME__;
    return game?.state?.getState?.() ?? null;
  } catch (error) {
    return String(error);
  }
});
console.log(JSON.stringify({ out, state }, null, 2));
console.log(logs.slice(-40).join("\n"));
await browser.close();
