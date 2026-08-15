import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
const server = spawn(
  "pnpm",
  [
    "--filter",
    "threenative-engine-load-test",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "5199",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
const wait = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5199/")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no server");
};
await wait();
const b = await chromium.launch({
  executablePath: process.env.BENCH_BROWSER_BIN ?? "/home/joao/.local/bin/brave",
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--disable-gpu-vsync",
    "--disable-frame-rate-limit",
  ],
});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto(
  "http://127.0.0.1:5199/?ladder=4096&modes=L1,L2&frames=200&warmup=60&repeats=1&stages=1",
  { waitUntil: "load" },
);
let rep = null;
for (let i = 0; i < 300; i++) {
  const r = await p.evaluate(
    () =>
      window.__ENGINE_LOAD_TEST__ ??
      (window.__ENGINE_LOAD_TEST_ERROR__ ? { err: window.__ENGINE_LOAD_TEST_ERROR__ } : null),
  );
  if (r) {
    rep = r;
    break;
  }
  await p.waitForTimeout(1000);
}
await b.close();
server.kill("SIGTERM");
if (!rep || rep.err) {
  console.log("FAILED", rep?.err);
  process.exit(1);
}
for (const rung of rep.rungs) {
  const s = rung.stageReport;
  const med = (a) => {
    const x = [...a].sort((m, n) => m - n);
    return x[Math.floor(x.length / 2)];
  };
  console.log(
    "\n===",
    rung.mode,
    `N=${rung.objectCount}`,
    "| frame p50",
    `${med(rung.frameMs).toFixed(2)}ms`,
    "| step p50",
    `${med(rung.stepMs).toFixed(2)}ms`,
    "| draws",
    rung.drawCalls,
  );
  if (!s) {
    console.log("  no stage report");
    continue;
  }
  const rows = Object.entries(s.stages).map(([k, v]) => [
    k,
    v.inclusiveMsPerMeasuredFrame ?? v.inclusiveMs / (s.measuredFrameCount || 1),
    v.callsPerMeasuredFrame ?? v.calls / (s.measuredFrameCount || 1),
  ]);
  rows.sort((a, b) => b[1] - a[1]);
  for (const [k, ms, calls] of rows)
    console.log("   ", k.padEnd(30), `${ms.toFixed(3)} ms/frame`, " calls/frame", calls.toFixed(1));
  console.log("    missing:", s.missingStages.join(",") || "none");
}
