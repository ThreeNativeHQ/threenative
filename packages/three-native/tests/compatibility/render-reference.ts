/**
 * The render half of the reference: one captured frame per render fixture, from a real adapter.
 *
 * This is the browser-reference capture path, not a second harness. One private Xvfb, one headed
 * Chromium, the same Vulkan flags the conformance lane and `--browser-recipe webgpu` use, and the
 * same element screenshot of `#c`. Headless Chromium cannot capture WebGPU here, so on Linux the
 * run belongs under `sh scripts/xvfb.sh`:
 *
 *   sh scripts/xvfb.sh pnpm --filter @threenative/three-native test:reference
 *
 * `three/webgpu` is served from its own build directory rather than bundled: the build is two
 * files with one relative import, so the page loads it as an ordinary ES module over 127.0.0.1
 * (a secure context, which a `file://` page is not).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import type { Browser } from "@playwright/test";

import {
  type IAdapterInfo,
  type IFixture,
  REPO_ROOT,
  TONE_MAPPING_CONSTANTS,
} from "../../src/fixture-format.js";

/**
 * The flags `--browser-recipe webgpu` passes, named in `packages/playtest/src/runner/browser.ts`.
 *
 * Without the Vulkan feature Chromium never reaches the driver on Linux and serves WebGPU from
 * SwiftShader: the adapter answers, nothing errors, and the golden is a CPU rasteriser's frame.
 */
const WEBGPU_BROWSER_ARGS = [
  "--ozone-platform=x11",
  "--enable-unsafe-webgpu",
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
  "--enable-features=Vulkan",
];

/** Every field is searched: which one carries the giveaway depends on the platform. */
const SOFTWARE_ADAPTER =
  /swiftshader|llvmpipe|lavapipe|softwarerasterizer|software adapter|basic render/i;

const PAGE_FILE = path.join(import.meta.dirname, "render", "render-fixture-page.js");
const OUTPUT_COLOR_SPACE_CONSTANTS = { srgb: "SRGBColorSpace", linear: "LinearSRGBColorSpace" };
const CAPTURE_TIMEOUT_MS = 90_000;

export interface IRenderCapture {
  /** The PNG bytes exactly as the browser encoded them. */
  readonly png: Buffer;
  readonly pngSha256: string;
  readonly width: number;
  readonly height: number;
  readonly adapter: IAdapterInfo;
}

interface IPageOutcome {
  readonly adapter?: IAdapterInfo;
  readonly error?: string;
}

export interface IRenderCaptureOptions {
  /** Record a software adapter's frame instead of refusing it. Off by default: it is not a GPU. */
  readonly allowSoftware: boolean;
}

/** The `three/webgpu` build directory, resolved from the package that links the catalog copy. */
function threeBuildDir(): string {
  const require = createRequire(path.join(REPO_ROOT, "packages", "runtime-native", "package.json"));
  return path.dirname(require.resolve("three/webgpu"));
}

/** Everything the page needs, and nothing it could use to change the fixture it is given. */
function requestOf(fixture: IFixture): Record<string, unknown> {
  const render = fixture.render;
  if (render === undefined) throw new Error(`TN_FIXTURE_RENDER_MISSING: ${fixture.name}`);
  return {
    fixture: { ops: fixture.ops },
    scene: render.scene,
    camera: render.camera,
    width: render.width,
    height: render.height,
    toneMappingConstant: TONE_MAPPING_CONSTANTS[render.toneMapping],
    toneMappingExposure: render.toneMappingExposure ?? 1,
    shadowMap: render.shadowMap === true,
    outputColorSpaceConstant:
      OUTPUT_COLOR_SPACE_CONSTANTS[render.outputColorSpace ?? "srgb"] ??
      OUTPUT_COLOR_SPACE_CONSTANTS.srgb,
  };
}

function page(request: Record<string, unknown>): string {
  const width = request.width;
  const height = request.height;
  return [
    '<!doctype html><meta charset="utf-8">',
    "<style>html,body{margin:0;background:#000}canvas{display:block}</style>",
    `<canvas id="c" width="${String(width)}" height="${String(height)}"></canvas>`,
    '<script type="module">',
    'import { reportOutcome } from "/render-fixture-page.js";',
    `reportOutcome(${JSON.stringify(request)});`,
    "</script>",
  ].join("");
}

/** Serves the page, the in-page module and the two `three/webgpu` build files from one origin. */
async function withServer(
  fixtures: ReadonlyMap<string, IFixture>,
  fn: (origin: string) => Promise<void>,
): Promise<void> {
  const build = threeBuildDir();
  const served = new Map<string, [string, string]>([
    ["/render-fixture-page.js", ["text/javascript", readFileSync(PAGE_FILE, "utf8")]],
  ]);
  for (const name of ["three.webgpu.js", "three.core.js"])
    served.set(`/build/${name}`, ["text/javascript", readFileSync(path.join(build, name), "utf8")]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const fixture = fixtures.get(url.searchParams.get("fixture") ?? "");
    const file =
      url.pathname === "/"
        ? fixture === undefined
          ? undefined
          : (["text/html", page(requestOf(fixture))] as [string, string])
        : served.get(url.pathname);
    if (file === undefined) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": file[0] });
    response.end(file[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("TN_FIXTURE_RENDER_NO_PORT: the capture server bound no TCP port");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Waits for the page's own report, or fails closed: a frame nobody reported is not a frame. */
function reported(pageOutcome: Promise<IPageOutcome>, fixture: string): Promise<IPageOutcome> {
  return Promise.race([
    pageOutcome,
    new Promise<IPageOutcome>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `TN_FIXTURE_RENDER_TIMEOUT: ${fixture} drew no frame within ${String(CAPTURE_TIMEOUT_MS / 1000)}s`,
            ),
          ),
        CAPTURE_TIMEOUT_MS,
      ).unref();
    }),
  ]);
}

/** One fixture's frame: open its page, wait for its own report, screenshot the canvas it drew. */
async function captureOne(
  browser: Browser,
  origin: string,
  fixture: IFixture,
  options: IRenderCaptureOptions,
): Promise<IRenderCapture> {
  const request = requestOf(fixture);
  const width = request.width as number;
  const height = request.height as number;
  const tab = await browser.newPage({ viewport: { width, height } });
  const pageErrors: string[] = [];
  tab.on("pageerror", (error) => pageErrors.push(error.message));
  let settle: ((outcome: IPageOutcome) => void) | null = null;
  // The page can finish before `goto` returns, so the report has a home before it opens.
  const pageOutcome = new Promise<IPageOutcome>((resolve) => {
    settle = resolve;
  });
  await tab.exposeFunction("__tnRenderDone", (outcome: IPageOutcome) => settle?.(outcome));
  try {
    await tab.goto(`${origin}/?fixture=${encodeURIComponent(fixture.name)}`, {
      waitUntil: "domcontentloaded",
    });
    const outcome = await reported(pageOutcome, fixture.name);
    if (outcome.error !== undefined)
      throw new Error(`TN_FIXTURE_RENDER_FAILED: ${fixture.name}\n${outcome.error}`);
    if (pageErrors.length > 0)
      throw new Error(`TN_FIXTURE_RENDER_FAILED: ${fixture.name} raised ${pageErrors.join("; ")}`);
    const adapter = outcome.adapter;
    if (adapter === undefined)
      throw new Error(`TN_FIXTURE_RENDER_NO_ADAPTER: ${fixture.name} reported no adapter`);
    const named = JSON.stringify(adapter);
    if (!options.allowSoftware && SOFTWARE_ADAPTER.test(named))
      throw new Error(
        `TN_FIXTURE_RENDER_SOFTWARE_ADAPTER: ${fixture.name} was drawn by ${named}, a software adapter; pass --allow-software to record it anyway`,
      );
    const png = await tab.locator("#c").screenshot({ timeout: CAPTURE_TIMEOUT_MS });
    return {
      png,
      pngSha256: createHash("sha256").update(png).digest("hex"),
      width,
      height,
      adapter,
    };
  } finally {
    await tab.close();
  }
}

/**
 * Every render fixture's frame, keyed by fixture name. One browser and one server serve them all.
 *
 * A fixture that cannot be drawn throws, so a run either records every frame it claims or fails:
 * there is no path here that records a golden nobody looked at.
 */
export async function captureRenderFixtures(
  fixtures: readonly IFixture[],
  options: IRenderCaptureOptions,
): Promise<ReadonlyMap<string, IRenderCapture>> {
  const captures = new Map<string, IRenderCapture>();
  if (fixtures.length === 0) return captures;
  if (process.platform === "linux" && process.env.DISPLAY === undefined)
    throw new Error(
      "TN_FIXTURE_RENDER_NO_DISPLAY: a render golden needs a WebGPU adapter; run `sh scripts/xvfb.sh pnpm --filter @threenative/three-native test:reference` on Linux",
    );
  let chromium: typeof import("@playwright/test")["chromium"];
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    throw new Error(
      `TN_FIXTURE_RENDER_NO_PLAYWRIGHT: install @playwright/test and its Chromium (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const requested = new Map(fixtures.map((fixture) => [fixture.name, fixture]));
  await withServer(requested, async (origin) => {
    const browser = await chromium.launch({
      headless: false,
      timeout: 30_000,
      args: [...WEBGPU_BROWSER_ARGS],
    });
    try {
      for (const fixture of fixtures)
        captures.set(fixture.name, await captureOne(browser, origin, fixture, options));
    } finally {
      await browser.close();
    }
  });
  return captures;
}
