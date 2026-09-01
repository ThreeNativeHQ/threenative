// Capture one demo mode through Playwright's bundled Chromium (headless, SwiftShader WebGL2).
// usage: node scripts/capture.mjs <mode|page.html> <output.png>
// PLAYWRIGHT_PATH may point at an installed playwright package (no install in this directory).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const [modeOrPage = 'comparison', output = `report/${modeOrPage}.png`] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const port = 8765 + Math.floor(Math.random() * 1000);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 700));
const url = modeOrPage.endsWith('.html')
  ? `http://127.0.0.1:${port}/${modeOrPage}`
  : `http://127.0.0.1:${port}/index.html?mode=${modeOrPage}&captureMode=true`;
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    'window.__TN_VSM_READY__ === true || Boolean(window.__TN_VSM_ERROR__)',
    null,
    { timeout: 180000, polling: 100 },
  );
  const runtimeError = await page.evaluate('window.__TN_VSM_ERROR__ || null');
  if (runtimeError) throw new Error(`${runtimeError}\n${errors.join('\n')}`);
  const debug = await page.evaluate('window.__TN_VSM_DEBUG__ || null');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.resolve(root, output) });
  writeFileSync(
    path.resolve(root, output.replace(/\.png$/, '.json')),
    JSON.stringify({ mode: modeOrPage, debug, errors }, null, 2),
  );
  console.log(JSON.stringify({ output, stats: debug?.stats ?? debug, errors }, null, 2));
} finally {
  await browser.close();
  server.kill();
}
