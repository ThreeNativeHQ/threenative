// Drives examples/engine-load-test/skinned-crowd.html in a hardware-WebGPU browser and prints its
// paired stock/projected report. Query parameters pass through: `-- ladder=8,128 frames=300`.
import path from "node:path";
import { driveBenchmarkPage, startProcess, waitForUrl } from "./browser.js";

const port = 5211;
const query = new URLSearchParams(
  process.argv
    .slice(2)
    .filter((arg) => arg.includes("="))
    .map((arg) => arg.split("=") as [string, string]),
);
const url = `http://127.0.0.1:${port}/skinned-crowd.html?${query}`;
const server = startProcess(
  "pnpm",
  ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  path.join(import.meta.dirname, "../../examples/engine-load-test"),
);
try {
  await waitForUrl(`http://127.0.0.1:${port}/skinned-crowd.html`, 60_000);
  const report = await driveBenchmarkPage({
    url,
    timeoutMs: 1_200_000,
    onConsole: (line) => {
      if (/error|warn/i.test(line)) console.error(line);
    },
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill();
}
