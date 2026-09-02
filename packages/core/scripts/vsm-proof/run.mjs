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
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const requireProof = (condition, message) => {
  if (!condition) throw new Error(`TN_VSM_PROOF_ASSERTION_FAILED: ${message}`);
};
const assertRealAdapter = (adapter, label) => {
  requireProof(typeof adapter === "string" && adapter.includes("|"), `${label} adapter missing`);
  requireProof(
    adapter.split("|").every((part) => part.trim().length > 0 && part.trim() !== "?"),
    `${label} adapter is incomplete: ${adapter}`,
  );
  requireProof(
    !/swiftshader|llvmpipe|software/iu.test(adapter),
    `${label} used a software adapter`,
  );
};
const assertStats = (stats, label) => {
  requireProof(isRecord(stats), `${label} stats missing`);
  for (const field of [
    "cached",
    "frame",
    "invalidated",
    "levels",
    "moved",
    "moverRenders",
    "movers",
    "rendered",
    "reuseRatio",
  ]) {
    requireProof(
      typeof stats[field] === "number" && Number.isFinite(stats[field]),
      `${label}.${field}`,
    );
  }
  requireProof(
    Number.isInteger(stats.levels) && stats.levels > 0,
    `${label}.levels must be positive`,
  );
  requireProof(
    Number.isInteger(stats.frame) && stats.frame >= 0,
    `${label}.frame must be an integer`,
  );
  for (const field of ["cached", "invalidated", "moved", "moverRenders", "movers", "rendered"]) {
    requireProof(
      Number.isInteger(stats[field]) && stats[field] >= 0,
      `${label}.${field} must be a count`,
    );
  }
  requireProof(stats.reuseRatio >= 0 && stats.reuseRatio <= 1, `${label}.reuseRatio out of range`);
};
const assertVirtualProof = (virtual, changedPixelRatio) => {
  requireProof(isRecord(virtual), "virtual result missing");
  assertRealAdapter(virtual.adapter, "virtual");
  requireProof(virtual.mode === "virtual", "virtual proof mode missing");
  requireProof(virtual.visibleShadow === true, "virtual shadow is not visible");
  requireProof(
    Number.isFinite(changedPixelRatio) && changedPixelRatio > 0,
    "stock/virtual pixels did not change",
  );
  assertStats(virtual.stats, "virtual.stats");
  const stats = virtual.stats;
  requireProof(stats.movers > 0, "virtual proof tracked no movers");
  requireProof(
    stats.moverRenders === stats.levels,
    "virtual proof did not render one mover map per level",
  );
  requireProof(
    stats.rendered === 0 && stats.cached === stats.levels,
    "virtual proof did not reuse cached levels",
  );
  requireProof(
    Math.abs(stats.reuseRatio - 11 / 12) < 0.001,
    "virtual proof cache reuse ratio is unexpected",
  );

  requireProof(
    Array.isArray(virtual.history) && virtual.history.length === 12,
    "virtual history must contain 12 frames",
  );
  virtual.history.forEach((frame, index) => {
    requireProof(isRecord(frame), `virtual.history[${index}] missing`);
    requireProof(frame.frame === index + 1, `virtual.history[${index}].frame is unexpected`);
    requireProof(frame.movers > 0, `virtual.history[${index}] tracked no movers`);
    requireProof(
      frame.moverRenders === stats.levels,
      `virtual.history[${index}] mover levels are incomplete`,
    );
    if (index === 0) {
      requireProof(
        frame.rendered === stats.levels && frame.cached === 0,
        "first virtual frame did not populate levels",
      );
    } else {
      requireProof(
        frame.rendered === 0 && frame.cached === stats.levels,
        `virtual.history[${index}] did not reuse levels`,
      );
    }
  });

  requireProof(
    Array.isArray(virtual.levels) && virtual.levels.length === stats.levels,
    "virtual levels shape is unexpected",
  );
  virtual.levels.forEach((level, index) => {
    requireProof(
      isRecord(level) && level.mapAssigned === true,
      `virtual.levels[${index}] has no assigned shadow map`,
    );
    requireProof(
      Array.isArray(level.position) && level.position.length === 3,
      `virtual.levels[${index}].position`,
    );
    requireProof(
      Array.isArray(level.target) && level.target.length === 3,
      `virtual.levels[${index}].target`,
    );
    requireProof(
      Array.isArray(level.matrix) && level.matrix.length === 4,
      `virtual.levels[${index}].matrix`,
    );
  });

  requireProof(isRecord(virtual.counts), "virtual counts missing");
  for (const field of ["inner", "innerRender", "outer"]) {
    requireProof(
      typeof virtual.counts[field] === "number" && Number.isFinite(virtual.counts[field]),
      `virtual.counts.${field}`,
    );
  }
  requireProof(
    virtual.counts.outer === virtual.history.length,
    "virtual outer update count is unexpected",
  );
  requireProof(typeof virtual.marker === "string", "virtual marker missing");
  let markerStats;
  try {
    markerStats = JSON.parse(virtual.marker.slice("TN_VIRTUAL_SHADOW:".length));
  } catch {
    throw new Error("TN_VSM_PROOF_ASSERTION_FAILED: virtual marker is not JSON");
  }
  assertStats(markerStats, "virtual.marker");
  requireProof(
    markerStats.movers > 0 && markerStats.moverRenders === stats.levels,
    "virtual marker has no mover evidence",
  );
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
      mode: proof.mode,
      history: proof.history,
      levels: proof.levels,
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
  for (const mode of ["stock", "virtual", "one"]) {
    const result = results[mode];
    requireProof(isRecord(result), `${mode} result missing`);
    assertRealAdapter(result.adapter, mode);
  }
  assertVirtualProof(results.virtual, results.changedPixelRatio);
} finally {
  server.kill("SIGTERM");
}
