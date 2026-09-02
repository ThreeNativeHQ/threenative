import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
const playtestRequire = createRequire(new URL("../../../playtest/package.json", import.meta.url));
const { chromium } = playtestRequire("playwright");
const { PNG } = playtestRequire("pngjs");
import { WEBGPU_BROWSER_ARGS } from "../../../playtest/src/runner/browser.ts";

const DIR = new URL("./", import.meta.url).pathname;
const PORT = 4179;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: DIR,
  stdio: "ignore",
});
await sleep(800);
const luminance = (png, x0, y0, x1, y1) => {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const i = (y * png.width + x) * 4;
      sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      n += 1;
    }
  return sum / n;
};
const results = {};
const shots = {};
try {
  const browser = await chromium.launch({ headless: false, args: [...WEBGPU_BROWSER_ARGS] });
  for (const [mode, query] of [
    ["stock", "mode=stock"],
    ["virtual", "mode=virtual"],
    ["one", "mode=virtual&clip=60"],
    ["one", "mode=virtual&clip=60"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    const logs = [];
    page.on("console", (m) => logs.push(m.text()));
    page.on("pageerror", (e) => logs.push(`PAGEERROR ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}`);
    try {
      await page.waitForFunction(() => window.__PROOF__ !== undefined, undefined, {
        timeout: 60_000,
      });
    } catch (error) {
      console.log("PAGE LOGS", mode, JSON.stringify(logs.slice(0, 20), null, 1));
      throw error;
    }
    const proof = await page.evaluate(() => window.__PROOF__);
    await mkdir(`${DIR}out`, { recursive: true });
    const shot = await page.screenshot({ type: "png" });
    await writeFile(`${DIR}out/${mode}.png`, shot);
    const png = PNG.sync.read(shot);
    shots[mode] = png;
    // The darkest 32x32 block in the lower half of the STOCK frame is the shadow; the same block
    // is read in the virtual frame, and "beside" is the block at the same row on the far left.
    if (mode === "stock") {
      let best = { x: 0, y: 256, value: Number.POSITIVE_INFINITY };
      for (let y = 256; y < png.height - 32; y += 8)
        for (let x = 0; x < png.width - 32; x += 8) {
          const value = luminance(png, x, y, x + 32, y + 32);
          if (value < best.value) best = { x, y, value };
        }
      results.region = best;
    }
    const region = results.region;
    const under = luminance(png, region.x, region.y, region.x + 32, region.y + 32);
    const beside = luminance(png, 8, region.y, 40, region.y + 32);
    results[mode] = {
      adapter: proof.adapter,
      under: Math.round(under),
      beside: Math.round(beside),
      visibleShadow: under + 10 < beside,
      history: proof.history,
      stats: proof.stats,
      counts: proof.counts,
      marker: logs.filter((l) => l.startsWith("TN_VIRTUAL_SHADOW")).slice(-1)[0],
    };
    await page.close();
  }
  await browser.close();
  let changed = 0;
  const a = shots.stock;
  const b = shots.virtual;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]) >
      60
    )
      changed += 1;
  }
  results.changedPixelRatio = Number((changed / (a.width * a.height)).toFixed(4));
  await writeFile(`${DIR}out/results.json`, JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
} finally {
  server.kill("SIGTERM");
}
