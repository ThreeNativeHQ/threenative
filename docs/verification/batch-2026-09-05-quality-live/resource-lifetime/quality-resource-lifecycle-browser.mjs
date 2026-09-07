import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { WEBGPU_BROWSER_ARGS } from "../../../../packages/playtest/src/runner/browser.ts";

const marker = "TN_QUALITY_RESOURCE_LIFECYCLE:";
const bundle = await readFile(
  new URL(
    "../../../../artifacts/batch-2026-09-05/quality-resource-lifecycle-probe.js",
    import.meta.url,
  ),
);
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/probe.js" ? "text/javascript" : "text/html");
  response.end(
    request.url === "/probe.js" ? bundle : '<script type="module" src="/probe.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: false, args: [...WEBGPU_BROWSER_ARGS] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  const observed = page.waitForEvent("console", {
    predicate: (message) => message.text().startsWith(marker),
    timeout: 120_000,
  });
  let message;
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    message = (await observed).text();
  } catch (error) {
    throw new Error(
      `browser resource lifecycle marker failed: ${String(error)}; errors=${JSON.stringify(errors)}`,
    );
  }
  await page.waitForTimeout(0);
  if (errors.length > 0) throw new Error(`browser probe errors: ${JSON.stringify(errors)}`);
  const result = JSON.parse(message.slice(marker.length));
  const globalResult = await page.evaluate(() => globalThis.__TN_QUALITY_RESOURCE_LIFECYCLE__);
  const adapter = await page.evaluate(async () => {
    const selected = await navigator.gpu?.requestAdapter();
    return selected === null || selected === undefined
      ? undefined
      : {
          vendor: selected.info.vendor,
          architecture: selected.info.architecture,
          description: selected.info.description,
        };
  });
  console.log(JSON.stringify({ result, globalResult, adapter }));
  if (!result.pass) throw new Error("resource lifecycle probe failed");
} finally {
  await browser.close();
  server.close();
}
