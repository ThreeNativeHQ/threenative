import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.env.SHOT_URL ?? "http://127.0.0.1:5276/";
const out = process.argv[2] ?? "shots/shot.png";
const script = process.argv[3] ?? "";

mkdirSync(new URL(".", new URL(out, `file://${process.cwd()}/`)).pathname, { recursive: true });

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
const logs = [];
page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(2500);

const adapter = await page.evaluate(async () => {
  const gpu = navigator.gpu;
  if (!gpu) return "no navigator.gpu";
  const a = await gpu.requestAdapter();
  if (!a) return "no adapter";
  return `${a.info.vendor} / ${a.info.architecture} / ${a.info.device} / ${a.info.description}`;
});

// scripted input: comma-separated "hold:Key:ms" / "tap:Key" / "wait:ms"
for (const stepText of script.split(",").filter(Boolean)) {
  const [kind, a, b] = stepText.split(":");
  if (kind === "hold") {
    await page.keyboard.down(a);
    await page.waitForTimeout(Number(b));
    await page.keyboard.up(a);
  } else if (kind === "down") {
    await page.keyboard.down(a);
  } else if (kind === "up") {
    await page.keyboard.up(a);
  } else if (kind === "tap") {
    await page.keyboard.press(a);
  } else if (kind === "wait") {
    await page.waitForTimeout(Number(a));
  } else if (kind === "auto") {
    // hold right and press Space when the player nears a gap edge
    await page.keyboard.down("ArrowRight");
    const deadline = Date.now() + Number(a);
    while (Date.now() < deadline) {
      const done = await page.evaluate(() => {
        const s = window.game?.state;
        if (!s) return true;
        const x = s.playerX;
        const nearEdge = (x > 12.9 && x < 14.2) || (x > 16.6 && x < 17.8);
        if (nearEdge) {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        }
        return s.goalReached === true;
      });
      if (done) break;
      await page.waitForTimeout(30);
    }
    await page.keyboard.up("ArrowRight");
  }
}

const state = await page.evaluate(() => JSON.parse(JSON.stringify(window.game?.state ?? null)));
await page.screenshot({ path: out });
console.log("adapter:", adapter);
console.log("state:", JSON.stringify(state));
console.log("logs:", logs.slice(0, 20).join("\n"));
await browser.close();
