// Shared browser plumbing for the PRD-117 web arms. Both arms park a §5.1 run report on
// `window.__ENGINE_LOAD_TEST__`; this file opens the page, waits, and hands the object back.
import { type ChildProcess, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

// Vsync is disabled on both arms rather than pinned on both: under vsync a frame needing 17 ms of
// work presents at 33 ms, so the knee would report which side of a 16.7 ms boundary an engine
// landed on instead of what it cost. See the deviation note in the verification document.
// `--ozone-platform=x11` is deliberately absent: forcing X11 on this machine drops WebGPU to
// SwiftShader, and a software rasteriser is not what either engine ships to a browser tab.
export const BENCH_BROWSER_ARGS = [
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
  "--disable-gpu-vsync",
  "--disable-frame-rate-limit",
  "--autoplay-policy=no-user-gesture-required",
] as const;

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".wasm": "application/wasm",
};

export interface IDriveOptions {
  onConsole?: (text: string) => void;
  timeoutMs: number;
  url: string;
}

// Playwright's bundled Chromium has no hardware WebGPU here; a system Chromium does. Both arms
// run in whichever binary this resolves to, so neither can be handed a better one than the other.
export function benchBrowserPath(): string | undefined {
  const override = process.env.BENCH_BROWSER_BIN;
  if (override !== undefined && override.length > 0) return override;
  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    `${process.env.HOME ?? ""}/.local/bin/brave`,
    "/usr/bin/brave",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function driveBenchmarkPage(options: IDriveOptions): Promise<unknown> {
  const browser = await chromium.launch({
    args: [...BENCH_BROWSER_ARGS],
    executablePath: benchBrowserPath(),
    headless: false,
  });
  try {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("console", (message) => options.onConsole?.(`${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => options.onConsole?.(`pageerror: ${error.message}`));
    await page.goto(options.url, { timeout: 120_000, waitUntil: "load" });
    const deadline = Date.now() + options.timeoutMs;
    while (Date.now() < deadline) {
      const state = (await page.evaluate(() => {
        const scope = globalThis as unknown as Record<string, unknown>;
        return {
          error: scope.__ENGINE_LOAD_TEST_ERROR__ ?? null,
          report: scope.__ENGINE_LOAD_TEST__ ?? null,
        };
      })) as { error: unknown; report: unknown };
      if (state.error !== null) throw new Error(`TN_BENCH_ARM_FAILED: ${String(state.error)}`);
      if (state.report !== null) return state.report;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`TN_BENCH_TIMEOUT: no report after ${options.timeoutMs} ms at ${options.url}`);
  } finally {
    await browser.close();
  }
}

// Godot's threaded web export refuses to start without cross-origin isolation, so the static
// server always sends the two headers rather than making the export type decide.
export async function serveDirectory(root: string, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? "/").split("?")[0] as string);
    const relative = requested === "/" ? "/index.html" : requested;
    const file = path.join(root, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
    void (async () => {
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("not a file");
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Length": info.size,
          "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cross-Origin-Opener-Policy": "same-origin",
        });
        createReadStream(file).pipe(response);
      } catch {
        response.writeHead(404).end("not found");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

export function startProcess(command: string, args: readonly string[], cwd: string): ChildProcess {
  return spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

export async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`TN_BENCH_SERVER_TIMEOUT: ${url} never became ready`);
}
