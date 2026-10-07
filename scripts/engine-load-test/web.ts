// PRD-533 box 47. CPU time excludes rAF wait and capture; renderer submission can still stall
// on GPU/driver backpressure. Three interleaved repetitions expose host-load noise.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { type Page, chromium } from "@playwright/test";
import { PNG } from "pngjs";
import {
  PERFORMANCE_BROWSER_ARGS,
  WEBGPU_BROWSER_ARGS,
  softwareAdapterName,
} from "../../packages/playtest/src/runner/browser.js";
import {
  type IBrowserCpuProfile,
  startBrowserCpuProfile,
} from "../../packages/playtest/src/runner/cpuProfile.js";
import {
  compareCaptures,
  inspectCapture,
} from "../../packages/runtime-native/conformance/metrics.mjs";
import { benchBrowserPath, serveDirectory } from "./browser.js";
import { linkPerryGame } from "./perry-build.js";
import { percentile } from "./report.js";

const ARMS = ["current", "wasm-js", "wasm-perry"] as const;
const toolchainModule = "../../tools/native-typescript/provision.mjs";
const { loadLock, provision } = await import(toolchainModule);
const { build } = createRequire(
  new URL("../../packages/runtime-native/package.json", import.meta.url),
)("esbuild") as typeof import("../../packages/runtime-native/node_modules/esbuild/lib/main.js");
export interface IWebOptions {
  objects: number;
  frames: number;
  warmup: number;
  width: number;
  height: number;
}
export interface IWebRun {
  arm: string;
  repeat: number;
  cpuMs: number[];
  adapter: Record<string, string>;
  breakdown?: Record<string, number[]>;
  boundary?: Record<string, number[]>;
}
export function webBenchOptions(flags: Record<string, string | undefined>): IWebOptions {
  if ((flags.workload ?? "heterogeneous") !== "heterogeneous")
    throw new Error("web benchmark requires heterogeneous");
  const arms = (flags.arms ?? ARMS.join(",")).split(",");
  if (arms.length !== 3 || !ARMS.every((arm) => arms.includes(arm)))
    throw new Error(`web arms must be ${ARMS.join(",")}`);
  if ((flags.repeats ?? "3") !== "3") throw new Error("web repeats must be 3");
  const defaults = { objects: 4096, frames: 600, warmup: 120, width: 1280, height: 720 };
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof IWebOptions)[]) {
    const value = Number(flags[key] ?? defaults[key]);
    const limit = key === "objects" ? 65536 : key === "width" || key === "height" ? 4096 : 100000;
    if (!Number.isSafeInteger(value) || value < (key === "warmup" ? 0 : 1) || value > limit)
      throw new Error(`invalid web ${key}`);
    result[key] = value;
  }
  return result;
}

export function perryLoader(html: string) {
  const runtime = /<script>\s*([\s\S]*?)<\/script>/.exec(html)?.[1];
  const base64 = /window\.__perryWasmB64 = "([A-Za-z0-9+/=]+)"/.exec(html)?.[1];
  if (!runtime || !base64 || !runtime.includes("function bootPerryWasm"))
    throw new Error("Perry output lacks its Wasm runtime");
  const bytes = Buffer.from(base64, "base64");
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((item) => `${item.module}:${item.name}`);
  for (const name of ["tn_inputs", "tn_values", "tn_ready", "tn_submit"])
    if (!imports.includes(`ffi:${name}`)) throw new Error(`Perry output omitted ${name}`);
  return {
    imports,
    bytes,
    source: `${runtime}\nexport async function loadPerry(inputs, submit) {
      let callback;
      const values = new Array(6 + inputs.length / 3 * 5).fill(0);
      await bootPerryWasm(${JSON.stringify(base64)}, {
        tn_inputs: () => inputs,
        tn_values: () => values,
        tn_submit: submit,
        tn_ready: (value) => { callback = value; },
      });
      if (!callback || callback.funcIdx === undefined) throw new Error('TN_WEB_BENCH_PERRY_CLOSURE');
      const table = wasmInstance.exports.__indirect_function_table;
      if (!table || typeof table.get(callback.funcIdx | 0) !== 'function') throw new Error('TN_WEB_BENCH_PERRY_TABLE');
      return frame => callWasmClosure(callback, frame);
    }\n`,
  };
}

export async function wasmBuildInfo(wasmDir: string) {
  const cache = await readFile(path.join(wasmDir, "CMakeCache.txt"), "utf8");
  const ninja = await readFile(path.join(wasmDir, "build.ninja"), "utf8");
  const flags = [
    ...new Set(
      [...ninja.matchAll(/^ {2}(?:FLAGS|LINK_FLAGS) = (.*)$/gm)].map((m) => m[1] as string),
    ),
  ];
  if (
    !/^CMAKE_BUILD_TYPE:STRING=Release$/m.test(cache) ||
    flags.some((flag) =>
      /(?:^| )-O[01](?: |$)|(?:^| )-g(?: |$)|-s(?:ASSERTIONS|SAFE_HEAP)=[1-9]|-fsanitize/.test(
        flag,
      ),
    ) ||
    !flags.some((flag) => /(?:^| )-O3(?: |$)/.test(flag))
  )
    throw new Error(
      "TN_WEB_BENCH_RELEASE_REQUIRED: configure and build preset wasm-browser (Release)",
    );
  return {
    preset: "wasm-browser",
    buildType: "Release",
    flags,
    assertions: 0,
    safeHeap: 0,
    exceptions: "native Wasm exceptions (-fwasm-exceptions)",
    memoryGrowth: true,
  };
}

export async function collectWebBenchPage(
  page: Page,
  url: string,
  arm: string,
  options: IWebOptions,
) {
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  const fail = (message: string) => rejectFailure(new Error(message));
  page.on("pageerror", (error) =>
    fail(`TN_WEB_BENCH_PAGE_ERROR: ${arm}: ${error.stack ?? error.message}`),
  );
  page.on("console", (message) => {
    const text = `TN_WEB_BENCH_CONSOLE: ${arm}: ${message.type()}: ${message.text()}`;
    console.error(text);
    if (message.type() === "error") fail(text);
  });
  page.on("requestfailed", (request) =>
    fail(`TN_WEB_BENCH_REQUEST_FAILED: ${arm}: ${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      fail(`TN_WEB_BENCH_HTTP_ERROR: ${arm}: ${response.status()}: ${response.url()}`);
  });
  return Promise.race([
    failure,
    (async () => {
      await page.goto(url, { waitUntil: "load" });
      // A slow but advancing arm must not be mistaken for a hung module at 180 s.
      let frame = -1;
      for (;;) {
        try {
          await page.waitForFunction(
            (previous) => {
              const g = globalThis as unknown as Record<string, unknown>;
              const progress = g.__ENGINE_LOAD_TEST_PROGRESS__ as { frame: number } | undefined;
              return (
                g.__ENGINE_LOAD_TEST__ ||
                g.__ENGINE_LOAD_TEST_ERROR__ ||
                (progress && progress.frame >= previous + 60)
              );
            },
            frame,
            { timeout: 90_000 },
          );
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
          const progress = await page.evaluate(
            () => (globalThis as unknown as Record<string, unknown>).__ENGINE_LOAD_TEST_PROGRESS__,
          );
          throw new Error(
            `TN_WEB_BENCH_STALLED: ${arm}: no 60-frame progress in 90 s: ${JSON.stringify(progress)}; requested ${options.warmup + options.frames} frames`,
          );
        }
        const state = await page.evaluate(() => {
          const g = globalThis as unknown as Record<string, unknown>;
          return {
            error: g.__ENGINE_LOAD_TEST_ERROR__,
            report: g.__ENGINE_LOAD_TEST__,
            progress: g.__ENGINE_LOAD_TEST_PROGRESS__ as { frame: number },
          };
        });
        if (state.error) throw new Error(`TN_WEB_BENCH_ARM_FAILED: ${arm}: ${state.error}`);
        if (state.report) return state.report as IWebRun;
        frame = state.progress.frame;
      }
    })(),
  ]);
}

export async function buildWebBench(repoRoot: string, out: string, options: IWebOptions) {
  await mkdir(out, { recursive: true });
  const wasmDir = path.join(repoRoot, "packages/runtime-native/build/wasm-browser");
  const engineBuild = await wasmBuildInfo(wasmDir);
  const engineFiles = ["tn-native-engine-wasm-browser.js", "tn-native-engine-wasm-browser.wasm"];
  for (const name of engineFiles) {
    if (!existsSync(path.join(wasmDir, name)))
      throw new Error(`Wasm build missing ${name}; build preset wasm-browser first`);
    await copyFile(path.join(wasmDir, name), path.join(out, name));
  }
  const game = await build({
    entryPoints: [path.join(import.meta.dirname, "web-game.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const gameSource = game.outputFiles[0]?.text;
  if (!gameSource) throw new Error("game bundle missing");
  await writeFile(path.join(out, "game.js"), gameSource);
  const declarations = (await readFile(path.join(import.meta.dirname, "web-game.ts"), "utf8"))
    .match(/^declare function[^;]*;/gm)
    ?.join("\n");
  if (!declarations) throw new Error("game FFI declarations missing");
  await writeFile(path.join(out, "game.ts"), `${declarations}\n${gameSource}`); // Same compiler input for B and C.
  for (const current of [true, false]) {
    const result = await build({
      entryPoints: [path.join(repoRoot, "examples/engine-load-test/src/web-bench.ts")],
      nodePaths: [path.join(repoRoot, "packages/runtime-native/node_modules")],
      bundle: true,
      format: "esm",
      platform: "browser",
      outfile: path.join(out, current ? "current.js" : "wasm.js"),
      metafile: true,
      define: { TN_CURRENT: String(current) },
      external: ["./game.js", "./perry-game.js"],
    });
    if (
      !current &&
      Object.values(result.metafile.outputs).some((output) =>
        Object.entries(output.inputs).some(
          ([name, input]) => /node_modules\/(?:.*\/)?three\//.test(name) && input.bytesInOutput > 0,
        ),
      )
    )
      throw new Error("three.js leaked into Wasm arm");
  }
  let perryUnavailable: string | null = null;
  let perryWasmImports: string[] = [];
  try {
    // Use only the checksum-pinned cached compiler. No downloads or compiler substitutions.
    const info = await provision({ checkOnly: true, log: () => {} });
    const logPath = path.join(out, "perry-build.log");
    const log = openSync(logPath, "w");
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync(
        info.binaryPath,
        [
          "compile",
          path.join(out, "game.ts"),
          "--target",
          "wasm",
          "--no-codegen",
          "--no-cache",
          "-o",
          path.join(out, "perry-game.html"),
        ],
        {
          cwd: out,
          stdio: ["ignore", log, log],
          timeout: 120000,
          env: { ...process.env, PERRY_CACHE_DIR: path.join(out, ".perry") },
        },
      );
    } finally {
      closeSync(log);
    }
    if (result.status !== 0)
      throw new Error(
        `Perry --target wasm exit ${result.status}: ${readFileSync(logPath, "utf8").trim()}; ${result.error?.message ?? ""}`,
      );
    const loader = perryLoader(await readFile(path.join(out, "perry-game.html"), "utf8"));
    perryWasmImports = loader.imports;
    await writeFile(path.join(out, "perry-game.js"), loader.source);
    await writeFile(path.join(out, "perry-game.wasm"), loader.bytes);
    await linkPerryGame(out);
  } catch (error) {
    perryUnavailable = `Perry: ${error instanceof Error ? error.message : String(error)}`;
  }
  for (const arm of ARMS)
    await writeFile(
      path.join(out, `${arm}.html`),
      `<!doctype html><html><head><link rel="icon" href="data:,"/><style>html,body{margin:0}canvas{display:block}</style></head><body><canvas id="c" width="${options.width}" height="${options.height}"></canvas>${arm === "current" ? "" : '<script src="tn-native-engine-wasm-browser.js"></script>'}<script type="module" src="${arm === "current" ? "current" : "wasm"}.js"></script></body></html>`,
    );
  const size = async (names: string[]) =>
    (await Promise.all(names.map(async (name) => (await stat(path.join(out, name))).size))).reduce(
      (a, b) => a + b,
      0,
    );
  const packedPerryFiles = existsSync(path.join(out, "perry-linked.wasm"))
    ? ["perry-linked.wasm"]
    : [];
  const bundleBytes = {
    current: await size(["current.html", "current.js", "game.js"]),
    "wasm-js": await size(["wasm-js.html", "wasm.js", "game.js", ...engineFiles]),
    // The packed loader fetches the raw game and numeric runtime as well as its JS source.
    "wasm-perry": perryUnavailable
      ? null
      : await size([
          "wasm-perry.html",
          "wasm.js",
          "perry-game.js",
          ...packedPerryFiles,
          ...engineFiles,
        ]),
  };
  return {
    bundleBytes,
    engineBuild,
    perryUnavailable,
    perryWasmImports,
    compiler: loadLock(),
    gameSha256: createHash("sha256").update(gameSource).digest("hex"),
    engineWasmSha256: createHash("sha256")
      .update(await readFile(path.join(out, engineFiles[1] as string)))
      .digest("hex"),
  };
}

export function summarizeWebBench(runs: IWebRun[], unavailable: string | null, repeats = 3) {
  if (repeats !== 1 && repeats !== 3) throw new Error("web repeats must be 1 (profile) or 3");
  const summaries = ARMS.flatMap((arm) => {
    if (arm === "wasm-perry" && unavailable) return [];
    const selected = runs.filter((run) => run.arm === arm);
    if (selected.length !== repeats || new Set(selected.map((run) => run.repeat)).size !== repeats)
      throw new Error(`missing repeats: ${arm}`);
    for (const run of selected)
      if (!run.cpuMs.length || run.cpuMs.some((value) => !Number.isFinite(value) || value < 0))
        throw new Error(`invalid CPU samples: ${arm}`);
    const p50s = selected.map((run) => percentile(run.cpuMs, 0.5));
    const p95s = selected.map((run) => percentile(run.cpuMs, 0.95));
    const samples = selected.flatMap((run) => run.cpuMs);
    const mean = p50s.reduce((a, b) => a + b, 0) / repeats;
    return [
      {
        arm,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        repeatP50: p50s,
        repeatP95: p95s,
        noise: {
          minP50: Math.min(...p50s),
          maxP50: Math.max(...p50s),
          spreadPercent: mean === 0 ? null : ((Math.max(...p50s) - Math.min(...p50s)) / mean) * 100,
        },
      },
    ];
  });
  const js = summaries.find((arm) => arm.arm === "wasm-js");
  const perry = summaries.find((arm) => arm.arm === "wasm-perry");
  const faster =
    js &&
    perry &&
    Math.max(...perry.repeatP50) < Math.min(...js.repeatP50) * 0.95 &&
    Math.max(...perry.repeatP95) < Math.min(...js.repeatP95);
  return {
    summaries,
    verdict: unavailable
      ? "unavailable"
      : repeats === 1
        ? "profile only"
        : faster
          ? "Perry faster"
          : "not faster",
  };
}

export async function runWebBench(
  repoRoot: string,
  artifactRoot: string,
  options: IWebOptions,
  buildOnly = false,
  profile = false,
) {
  const out = path.join(artifactRoot, "web");
  const built = await buildWebBench(repoRoot, out, options);
  if (buildOnly) {
    console.log(
      `WEB_BENCH_BUILD_OK: ${JSON.stringify(built.bundleBytes)}; Perry ${built.perryUnavailable ?? "Wasm emitted"}`,
    );
    return;
  }
  if (process.platform === "linux" && !process.env.DISPLAY)
    throw new Error("Run headed under sh scripts/xvfb.sh");
  const server = await serveDirectory(out, 0);
  const runs: IWebRun[] = [];
  const comparisons: unknown[] = [];
  const frameHashes: Record<string, string> = {};
  let reference: Buffer | undefined;
  let failure: string | null = null;
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address missing");
    const browser = await chromium.launch({
      headless: false,
      executablePath: benchBrowserPath(),
      args: [...WEBGPU_BROWSER_ARGS, ...PERFORMANCE_BROWSER_ARGS],
    });
    try {
      for (let repeat = 0; repeat < (profile ? 1 : 3); repeat++)
        for (let offset = 0; offset < 3; offset++) {
          const arm = ARMS[(offset + repeat) % 3] as (typeof ARMS)[number];
          if (arm === "wasm-perry" && built.perryUnavailable) continue;
          const page = await browser.newPage({
            viewport: { width: options.width, height: options.height },
            deviceScaleFactor: 1,
          });
          try {
            let profiler: IBrowserCpuProfile | undefined;
            if (profile) {
              await page.exposeBinding("__ENGINE_LOAD_TEST_PROFILE__", async () => {
                profiler = await startBrowserCpuProfile(
                  page,
                  path.join(out, `${arm}.cpuprofile`),
                  100,
                );
              });
            }
            const query = new URLSearchParams({
              arm,
              ...Object.fromEntries(
                Object.entries(options).map(([key, value]) => [key, String(value)]),
              ),
            });
            const run = await collectWebBenchPage(
              page,
              `http://127.0.0.1:${address.port}/${arm}.html?${query}`,
              arm,
              options,
            );
            if (profile) {
              if (!profiler) throw new Error(`CPU profiler did not start: ${arm}`);
              await profiler.stop();
            }
            if (run.arm !== arm || run.cpuMs.length !== options.frames)
              throw new Error("arm/sample count mismatch");
            for (const [name, series] of Object.entries({
              breakdown: run.breakdown,
              boundary: run.boundary,
            })) {
              if (!series || Object.keys(series).length === 0)
                throw new Error(`TN_WEB_BENCH_MISSING_${name.toUpperCase()}: ${arm}`);
              for (const [key, samples] of Object.entries(series))
                if (
                  samples.length !== options.frames ||
                  samples.some((value) => !Number.isFinite(value))
                )
                  throw new Error(`TN_WEB_BENCH_INVALID_SAMPLES: ${arm}: ${name}.${key}`);
            }
            if (
              !run.adapter ||
              !Object.values(run.adapter).some(Boolean) ||
              softwareAdapterName(run.adapter)
            )
              throw new Error(`hardware adapter required: ${JSON.stringify(run.adapter)}`);
            runs.push({ ...run, repeat });
            const adapterKey = (info: Record<string, string>) =>
              JSON.stringify([info.vendor ?? "", info.architecture ?? "", info.description ?? ""]);
            if (runs.some((previous) => adapterKey(previous.adapter) !== adapterKey(run.adapter)))
              throw new Error("TN_WEB_BENCH_ADAPTER_MISMATCH");
            const png = await page.locator("#c").screenshot();
            const inspected = inspectCapture(png);
            if (inspected.width !== options.width || inspected.height !== options.height)
              throw new Error("capture size mismatch");
            await writeFile(path.join(out, `${arm}-${repeat}.png`), png);
            frameHashes[`${arm}-${repeat}`] = createHash("sha256")
              .update(PNG.sync.read(png).data)
              .digest("hex");
            reference ??= png; // First arm is current, every repeat is compared to its frozen frame.
            const metrics = compareCaptures(reference, png, 2);
            comparisons.push({ arm, repeat, ...metrics });
            if (metrics.pixelMismatchRatio > 0.01 || metrics.perceptualDeltaE > 3)
              throw new Error(`TN_WEB_BENCH_FRAME_MISMATCH: ${arm} ${JSON.stringify(metrics)}`);
          } finally {
            await page.close();
          }
        }
    } finally {
      await browser.close();
    }
  } catch (error) {
    failure = String(error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const summary = failure
    ? { summaries: [], verdict: "unverified" }
    : summarizeWebBench(runs, built.perryUnavailable, profile ? 1 : 3);
  const report = {
    schemaVersion: 2,
    workload: "heterogeneous",
    ...options,
    repeats: profile ? 1 : 3,
    diagnosticProfile: profile,
    ...built,
    runs,
    ...summary,
    frameHashes,
    comparisons,
    comparisonRule: { channelTolerance: 2, pixelMismatchRatio: 0.01, perceptualDeltaE: 3 },
    failure,
    meter:
      "performance.now: game update + engine render submission; excludes rAF/present wait and capture, driver backpressure remains possible",
    breakdownRule:
      "per-frame ms: game excludes submit callback; boundary includes validation, camera ABI and packing; engineUpdate includes bulk transforms and render database prepare; encodeSubmit includes renderer planning, encoding, submission, polling and canvas blit; remainder includes meter overhead. These are CPU wall spans, not GPU time.",
    boundaryRule:
      "actual JS-to-engine exports, allocations, copies and heap growth; webgpuCalls counts browser WebGPU methods on device/queue/resources/encoders/canvas, writeBuffers counts queue uploads, directDraws counts pass draw calls, bundleDraws counts bundle recording calls, executeBundles counts replay calls. draws counts executed scene/output draws (excludes canvas blit).",
    renderStrategy:
      "Wasm batches compatible geometry/material uniforms with per-instance colour, uploads packed transforms/colours once to frame storage, and replays main-pass render bundles while draw identities remain valid; GPU frame parity and performance require this run",
    bundleSizeRule:
      "uncompressed bytes actually served; includes packed Perry game/runtime Wasm when present, in addition to the downloaded JS source",
    verdictRule:
      "Perry p50 at least 5% below JS across all repeated runs, non-overlapping p50 and p95 ranges",
    decision12: {
      optionAQualified: false,
      reason:
        "Perry game and numeric runtime are linked and optimized together; cold object/closure operations still import the JavaScript runtime, so native-semantic option A remains unqualified",
    },
  };
  const file = path.join(out, "web-report.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  if (failure) throw new Error(`${failure}; partial report: ${file}`);
  const numbers = summary.summaries
    .map(
      (arm) =>
        `${arm.arm} ${arm.p50.toFixed(3)}/${arm.p95.toFixed(3)} ms noise ${arm.noise.spreadPercent?.toFixed(1)}%`,
    )
    .join("; ");
  console.log(
    `${report.verdict}: ${numbers}${built.perryUnavailable ? `; unavailable: ${built.perryUnavailable}` : ""}; option A unqualified (separate Perry module/JS runtime); ${file}`,
  );
}
