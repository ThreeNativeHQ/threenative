/**
 * `pnpm profile:wasm-page -- --url <url> [--control <url>] [--seconds 5] [--calls] [--gpu-calls] [--gpu-time] [--json]`
 *
 * Profiles a running game page the way a Wasm-engine performance question needs: frame time from
 * requestAnimationFrame, a Chrome CPU profile grouped into engine Wasm, JavaScript and WebGPU calls
 * (with the top inclusive functions), and with `--calls` the JS->Wasm engine calls per frame by name
 * (three-native's opt-in census, `__tnCallCounts`), and with `--gpu-calls` the WebGPU API calls per
 * frame on both pages (render passes, draws, bind groups, buffer writes), and with `--gpu-passes` the GPU
 * time of every render and compute pass on both pages, by target size and format (timestamp-query
 * writes added to passes that carry none), and with `--cpu-work` the main thread's time per frame in
 * requestAnimationFrame callbacks, less the time blocked in `getCurrentTexture` and `submit` (the
 * present and GPU backpressure waits): the CPU cost a faster display would still pay. `--control` runs a second page, the same game on
 * three.js, through the same measurement, so the verdict is a ratio on one lane, never an absolute.
 *
 * It refuses a software WebGPU adapter (`--allow-software` overrides) and needs a display: run it as
 * `sh scripts/xvfb.sh pnpm profile:wasm-page -- ...`. Wasm function names need a module linked with
 * `--profiling-funcs`; without it the Wasm rows are numbered. Diagnose with it; the steady-state
 * counter gates (render_database_test steady_state, wasm-engine-boot's renderer scenario) hold a fix.
 */
import { writeFileSync } from "node:fs";
import { type Page, chromium } from "@playwright/test";
import {
  PERFORMANCE_BROWSER_ARGS,
  WEBGPU_BROWSER_ARGS,
} from "../packages/playtest/src/runner/browser.js";

interface IOptions {
  url: string;
  control?: string;
  seconds: number;
  /** `--save-profile <path>`: the subject's raw CPU profile, which DevTools opens. */
  saveProfile?: string;
  warmupMs: number;
  calls: boolean;
  gpuCalls: boolean;
  gpuTime: boolean;
  gpuPasses: boolean;
  cpuWork: boolean;
  json: boolean;
  allowSoftware: boolean;
}

function options(argv: readonly string[]): IOptions {
  const value = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const url = value("url");
  if (url === undefined)
    throw new Error(
      "usage: profile:wasm-page -- --url <url> [--control <url>] [--seconds 5] [--calls] [--json]",
    );
  const seconds = Number(value("seconds") ?? 5);
  const warmupMs = Number(value("warmup-ms") ?? 12000);
  if (!(seconds > 0) || !(warmupMs >= 0))
    throw new Error("--seconds and --warmup-ms must be positive numbers");
  const control = value("control");
  const saveProfile = value("save-profile");
  return {
    ...(saveProfile === undefined ? {} : { saveProfile }),
    url,
    ...(control === undefined ? {} : { control }),
    seconds,
    warmupMs,
    calls: argv.includes("--calls"),
    gpuCalls: argv.includes("--gpu-calls"),
    gpuTime: argv.includes("--gpu-time"),
    gpuPasses: argv.includes("--gpu-passes"),
    cpuWork: argv.includes("--cpu-work"),
    json: argv.includes("--json"),
    allowSoftware: argv.includes("--allow-software"),
  };
}

const SOFTWARE = /swiftshader|llvmpipe|lavapipe|softwarerasterizer|software adapter|basic render/iu;

async function frames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ p50: number; p95: number; fps: number }>((resolve) => {
        const times: number[] = [];
        const step = (t: number) => {
          times.push(t);
          if (times.length < 241) requestAnimationFrame(step);
          else {
            const d = times
              .slice(1)
              .map((x, i) => x - (times[i] as number))
              .sort((a, b) => a - b);
            const mean = d.reduce((a, b) => a + b, 0) / d.length;
            resolve({ p50: d[120] as number, p95: d[228] as number, fps: 1000 / mean });
          }
        };
        requestAnimationFrame(step);
      }),
  );
}

interface IProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
}

const name = (node: IProfileNode) => node.callFrame.functionName || "(anonymous)";
const label = (node: IProfileNode) =>
  name(node)
    .replace(/std::__2::/gu, "")
    .slice(0, 140);
const group = (node: IProfileNode) =>
  node.callFrame.url.endsWith(".wasm")
    ? "engine wasm"
    : node.callFrame.url
      ? "javascript"
      : name(node);

async function cpu(page: Page, seconds: number, save?: string) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await page.waitForTimeout(seconds * 1000);
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: { nodes: IProfileNode[]; samples: number[] };
  };
  if (save !== undefined) writeFileSync(save, JSON.stringify(profile));
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const counts = new Map<number, number>();
  for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
  const total = profile.samples.length;
  const groups = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const self = new Map<string, number>();
  const add = (into: Map<string, number>, key: string, n: number) =>
    into.set(key, (into.get(key) ?? 0) + n);
  for (const [id, n] of counts) {
    const node = byId.get(id) as IProfileNode;
    add(groups, group(node), n);
    add(self, label(node), n);
    const stack = new Set<string>();
    for (let at: number | undefined = id; at !== undefined; at = parents.get(at))
      stack.add(label(byId.get(at) as IProfileNode));
    for (const key of stack) add(inclusive, key, n);
  }
  const share = (entries: Map<string, number>, limit: number) =>
    [...entries]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, n]) => ({ name: key, percent: Number(((100 * n) / total).toFixed(1)) }));
  return {
    samples: total,
    groups: share(groups, 12),
    inclusive: share(inclusive, 30),
    self: share(self, 30),
  };
}

// The engine's own GPU time per frame (timestamp-query, scene or first shadow pass start to output
// pass end), which three-native's renderer appends to `__tnGpuMs` once a page sets it to an array.
async function gpuTime(page: Page) {
  // Wall time, not frames: a timed frame waits for its readback before the next one is timed, so
  // samples arrive a few per second whatever the frame rate.
  return page.evaluate(
    () =>
      new Promise<{ samples: number; p50: number; p95: number; segments: number[] } | undefined>(
        (resolve) => {
          const g = globalThis as { __tnGpuMs?: number[]; __tnGpuSegments?: number[][] };
          g.__tnGpuMs = [];
          g.__tnGpuSegments = [];
          setTimeout(() => {
            const times = [...(g.__tnGpuMs ?? [])].filter((ms) => ms >= 0).sort((a, b) => a - b);
            g.__tnGpuMs = undefined;
            const rows = g.__tnGpuSegments ?? [];
            g.__tnGpuSegments = undefined;
            const median = (column: number) =>
              rows.map((row) => row[column] ?? 0).sort((a, b) => a - b)[
                Math.floor(rows.length / 2)
              ] ?? 0;
            const at = (q: number) =>
              times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? Number.NaN;
            resolve(
              times.length === 0
                ? undefined
                : {
                    samples: times.length,
                    p50: at(0.5),
                    p95: at(0.95),
                    segments: [0, 1, 2, 3].map(median),
                  },
            );
          }, 4000);
        },
      ),
  );
}

async function calls(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ perFrame: number; top: { name: string; perFrame: number }[] }>(
        (resolve, reject) => {
          const g = globalThis as {
            __tnCallCounts?: Map<string, number>;
            __tnEngineTypes?: Map<number, string>;
          };
          if (g.__tnEngineTypes === undefined) {
            reject(
              new Error(
                "TN_PROFILE_NOT_WASM_ENGINE: the page did not load three-native's Wasm back end",
              ),
            );
            return;
          }
          g.__tnCallCounts = new Map();
          let frames = 0;
          const step = () => {
            if (++frames < 121) {
              requestAnimationFrame(step);
              return;
            }
            const counts = g.__tnCallCounts as Map<string, number>;
            g.__tnCallCounts = undefined;
            const named = [...counts].map(([key, n]) => {
              const [kind, member] = key.split(" ") as [string, string];
              const dot = member.indexOf(".");
              const type =
                g.__tnEngineTypes?.get(Number(member.slice(0, dot))) ?? member.slice(0, dot);
              return { name: `${kind} ${type}.${member.slice(dot + 1)}`, perFrame: n / 120 };
            });
            named.sort((a, b) => b.perFrame - a.perFrame);
            resolve({
              perFrame: named.reduce((sum, row) => sum + row.perFrame, 0),
              top: named.slice(0, 40),
            });
          };
          requestAnimationFrame(step);
        },
      ),
  );
}

// Wraps the WebGPU prototypes' methods so that, while `__tnGpuCounts` is a Map, each call counts as
// "<Interface>.<method>". Installed before the page's scripts; off, a wrapper costs one global read.
const GPU_CENSUS = `(() => {
  for (const name of ["GPUDevice", "GPUQueue", "GPUCommandEncoder", "GPURenderPassEncoder", "GPUComputePassEncoder", "GPURenderBundleEncoder"]) {
    const proto = globalThis[name]?.prototype;
    if (!proto) continue;
    for (const key of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, key);
      if (!d || typeof d.value !== "function" || key === "constructor") continue;
      const original = d.value;
      Object.defineProperty(proto, key, { ...d, value: function (...args) {
        const counts = globalThis.__tnGpuCounts;
        if (counts) counts.set(name + "." + key, (counts.get(name + "." + key) ?? 0) + 1);
        return original.apply(this, args);
      } });
    }
  }
})();`;

// Adds timestamp-query writes to every pass that has none, on any page: the device asks for the
// feature, each submit resolves its passes' timestamps into a pooled readback buffer, and while
// `__tnGpuPasses` is a Map each pass's time adds to "<kind> <target WxH format> <label>". A submit
// with no free readback buffer goes untimed: its passes count, and take the mean of their timed runs.
const GPU_PASSES = `(() => {
  const adapterProto = globalThis.GPUAdapter?.prototype;
  if (!adapterProto) return;
  const devices = new WeakMap(), encoders = new WeakMap(), views = new WeakMap();
  const requestDevice = adapterProto.requestDevice;
  adapterProto.requestDevice = async function (desc = {}) {
    const features = [...(desc.requiredFeatures ?? [])];
    if (this.features.has("timestamp-query") && !features.includes("timestamp-query")) features.push("timestamp-query");
    const device = await requestDevice.call(this, { ...desc, requiredFeatures: features });
    if (device.features.has("timestamp-query")) {
      const capacity = 1024;
      devices.set(device.queue, { device, capacity, cursor: 0, pending: [], free: [],
        querySet: device.createQuerySet({ type: "timestamp", count: capacity }),
        resolve: device.createBuffer({ size: capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) });
    }
    return device;
  };
  const deviceProto = GPUDevice.prototype;
  const createCommandEncoder = deviceProto.createCommandEncoder;
  deviceProto.createCommandEncoder = function (...args) {
    const encoder = createCommandEncoder.apply(this, args);
    const state = devices.get(this.queue);
    if (state) encoders.set(encoder, state);
    return encoder;
  };
  const createView = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (...args) {
    const view = createView.apply(this, args);
    views.set(view, this.width + "x" + this.height + " " + this.format);
    return view;
  };
  const getCurrentTexture = GPUCanvasContext.prototype.getCurrentTexture;
  const timed = (kind, original) => function (desc = {}) {
    const state = encoders.get(this);
    if (!globalThis.__tnGpuPasses || !state || desc.timestampWrites || state.cursor + 2 > state.capacity) return original.call(this, desc);
    const at = state.cursor;
    state.cursor += 2;
    const target = desc.colorAttachments?.[0]?.view ?? desc.depthStencilAttachment?.view;
    state.pending.push(kind + " " + (target ? views.get(target) ?? "canvas" : "-") + (desc.label ? " " + desc.label : ""));
    return original.call(this, { ...desc, timestampWrites: { querySet: state.querySet, beginningOfPassWriteIndex: at, endOfPassWriteIndex: at + 1 } });
  };
  GPUCommandEncoder.prototype.beginRenderPass = timed("render", GPUCommandEncoder.prototype.beginRenderPass);
  GPUCommandEncoder.prototype.beginComputePass = timed("compute", GPUCommandEncoder.prototype.beginComputePass);
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    const state = devices.get(this);
    if (!state || state.pending.length === 0) return submit.call(this, buffers);
    const names = state.pending, count = state.cursor;
    state.pending = [];
    state.cursor = 0;
    let read = state.free.pop();
    if (!read && (state.made ?? 0) < 16) {
      state.made = (state.made ?? 0) + 1;
      read = state.device.createBuffer({ size: state.capacity * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
    if (!read) {
      const totals = globalThis.__tnGpuPasses;
      for (const name of names) {
        const row = totals?.get(name) ?? { ms: 0, n: 0, untimed: 0 };
        row.untimed += 1;
        totals?.set(name, row);
      }
      return submit.call(this, buffers);
    }
    const encoder = createCommandEncoder.call(state.device);
    encoder.resolveQuerySet(state.querySet, 0, count, state.resolve, 0);
    encoder.copyBufferToBuffer(state.resolve, 0, read, 0, count * 8);
    const result = submit.call(this, [...buffers, encoder.finish()]);
    read.mapAsync(GPUMapMode.READ, 0, count * 8).then(() => {
      const ns = new BigUint64Array(read.getMappedRange(0, count * 8));
      const totals = globalThis.__tnGpuPasses;
      for (let i = 0; totals && i < names.length; ++i) {
        const ms = ns[2 * i + 1] > ns[2 * i] ? Number(ns[2 * i + 1] - ns[2 * i]) / 1e6 : 0;
        const row = totals.get(names[i]) ?? { ms: 0, n: 0, untimed: 0 };
        row.ms += ms; row.n += 1;
        totals.set(names[i], row);
      }
      read.unmap();
      state.free.push(read);
    }, () => {});
    return result;
  };
})();`;

// Times every requestAnimationFrame callback and every getCurrentTexture/submit call while
// `__tnCpuWork` is an array: one [callback ms, waits ms] row per animation frame.
const CPU_WORK = `(() => {
  let callbacks = 0, waits = 0, open = false;
  const wrap = (proto, key) => {
    const original = proto?.[key];
    if (!original) return;
    proto[key] = function (...args) {
      const start = performance.now();
      try { return original.apply(this, args); } finally { waits += performance.now() - start; }
    };
  };
  wrap(globalThis.GPUCanvasContext?.prototype, "getCurrentTexture");
  wrap(globalThis.GPUQueue?.prototype, "submit");
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => raf((time) => {
    if (!open) {
      open = true;
      // Registered before this frame's callbacks re-register, so it runs first next frame.
      raf(() => {
        open = false;
        globalThis.__tnCpuWork?.push([callbacks, waits]);
        callbacks = 0;
        waits = 0;
      });
    }
    const start = performance.now();
    try { callback(time); } finally { callbacks += performance.now() - start; }
  });
})();`;

async function cpuWork(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ frames: number; callbackMs: number; waitMs: number; workMs: number }>(
        (resolve) => {
          const g = globalThis as { __tnCpuWork?: [number, number][] };
          g.__tnCpuWork = [];
          setTimeout(() => {
            const rows = (g.__tnCpuWork ?? []).slice(1);
            g.__tnCpuWork = undefined;
            const median = (values: number[]) =>
              values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
            resolve({
              frames: rows.length,
              callbackMs: median(rows.map((row) => row[0])),
              waitMs: median(rows.map((row) => row[1])),
              workMs: median(rows.map((row) => row[0] - row[1])),
            });
          }, 3000);
        },
      ),
  );
}

async function gpuPasses(page: Page) {
  // Over 4 s of drawn frames: each pass's mean timed run, times how often it ran per frame.
  return page.evaluate(
    () =>
      new Promise<{ name: string; ms: number; perFrame: number }[] | undefined>((resolve) => {
        type Row = { ms: number; n: number; untimed: number };
        const g = globalThis as { __tnGpuPasses?: Map<string, Row> };
        g.__tnGpuPasses = new Map();
        let frames = 0;
        const end = performance.now() + 4000;
        const step = () => {
          ++frames;
          if (performance.now() < end) {
            requestAnimationFrame(step);
            return;
          }
          const rows = [...(g.__tnGpuPasses as Map<string, Row>)].filter(([, row]) => row.n > 0);
          g.__tnGpuPasses = undefined;
          const perPass = ([name, row]: [string, Row]) => {
            const perFrame = (row.n + row.untimed) / frames;
            return { name, ms: (row.ms / row.n) * perFrame, perFrame };
          };
          resolve(rows.length === 0 ? undefined : rows.map(perPass).sort((x, y) => y.ms - x.ms));
        };
        requestAnimationFrame(step);
      }),
  );
}

async function gpuCalls(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ name: string; perFrame: number }[]>((resolve) => {
        const g = globalThis as { __tnGpuCounts?: Map<string, number> };
        g.__tnGpuCounts = new Map();
        let frames = 0;
        const step = () => {
          if (++frames < 121) {
            requestAnimationFrame(step);
            return;
          }
          const counts = g.__tnGpuCounts as Map<string, number>;
          g.__tnGpuCounts = undefined;
          resolve(
            [...counts]
              .map(([name, n]) => ({ name, perFrame: n / 120 }))
              .sort((a, b) => b.perFrame - a.perFrame)
              .slice(0, 25),
          );
        };
        requestAnimationFrame(step);
      }),
  );
}

/**
 * The main thread's busy time per frame from the profile: the mean frame period times the share not
 * spent idle or blocked in getCurrentTexture/submit (present and GPU backpressure). Finer than
 * `--cpu-work`, whose clock steps 0.1 ms, and it needs no instrumented page.
 */
function busyMs(fps: number, groups: { name: string; percent: number }[]): number {
  const waiting = groups
    .filter((group) => ["getCurrentTexture", "submit", "(idle)"].includes(group.name))
    .reduce((sum, group) => sum + group.percent, 0);
  return (1000 / fps) * (1 - waiting / 100);
}

/** The opt-in measurements, each present only when its flag asked for it. */
async function optional(page: Page, o: IOptions) {
  const census = o.calls ? await calls(page) : undefined;
  const gpu = o.gpuCalls ? await gpuCalls(page) : undefined;
  const gpuMs = o.gpuTime ? await gpuTime(page) : undefined;
  const passes = o.gpuPasses ? await gpuPasses(page) : undefined;
  const work = o.cpuWork ? await cpuWork(page) : undefined;
  return {
    ...(census ? { calls: census } : {}),
    ...(gpu ? { gpu } : {}),
    ...(o.gpuTime ? { gpuMs: gpuMs ?? null } : {}),
    ...(o.gpuPasses ? { passes: passes ?? null } : {}),
    ...(work ? { work } : {}),
  };
}

async function measure(url: string, o: IOptions) {
  const browser = await chromium.launch({
    headless: false,
    args: [...WEBGPU_BROWSER_ARGS, ...PERFORMANCE_BROWSER_ARGS],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // tsx keeps function names with an `__name` helper that the evaluated page functions call.
    await page.addInitScript("globalThis.__name = (fn) => fn;");
    if (o.gpuCalls) await page.addInitScript(GPU_CENSUS);
    if (o.gpuPasses) await page.addInitScript(GPU_PASSES);
    if (o.cpuWork) await page.addInitScript(CPU_WORK);
    await page.goto(url);
    const adapter = await page.evaluate(async () => {
      const gpu = (
        navigator as {
          gpu?: { requestAdapter(): Promise<{ info: Record<string, string> } | null> };
        }
      ).gpu;
      const found = await gpu?.requestAdapter();
      // GPUAdapterInfo's fields are prototype getters: Object.values would read none of them.
      const info = found?.info ?? {};
      return ["vendor", "architecture", "device", "description"]
        .map((key) => info[key] ?? "")
        .join(" ");
    });
    if (!o.allowSoftware && (adapter.trim() === "" || SOFTWARE.test(adapter)))
      throw new Error(
        `TN_PROFILE_SOFTWARE_ADAPTER: '${adapter}' is not a hardware WebGPU adapter (pass --allow-software to measure it anyway)`,
      );
    await page.waitForTimeout(o.warmupMs);
    const frame = await frames(page);
    const profile = await cpu(page, o.seconds, o.saveProfile);
    const extra = await optional(page, o);
    if (errors.length > 0) throw new Error(`TN_PROFILE_PAGE_ERROR: ${errors[0]}`);
    return { url, adapter, frame, profile, busyMs: busyMs(frame.fps, profile.groups), ...extra };
  } finally {
    await browser.close();
  }
}

function print(label: string, r: Awaited<ReturnType<typeof measure>>) {
  console.log(`\n== ${label}: ${r.url}\nadapter ${r.adapter}`);
  console.log(
    `frame p50 ${r.frame.p50.toFixed(2)} ms, p95 ${r.frame.p95.toFixed(2)} ms, ${r.frame.fps.toFixed(0)} fps`,
  );
  console.log(
    `cpu (${r.profile.samples} samples): ${r.profile.groups.map((g) => `${g.name} ${g.percent}%`).join(", ")}`,
  );
  console.log(
    `cpu busy per frame ${r.busyMs.toFixed(3)} ms (not idle, not in getCurrentTexture/submit)`,
  );
  for (const row of r.profile.inclusive)
    console.log(`  ${String(row.percent).padStart(5)}%  ${row.name}`);
  console.log("self:");
  for (const row of r.profile.self)
    console.log(`  ${String(row.percent).padStart(5)}%  ${row.name}`);
  printGpu(r);
  if (r.calls) {
    console.log(`engine calls per frame: ${r.calls.perFrame.toFixed(1)}`);
    for (const row of r.calls.top)
      console.log(`  ${row.perFrame.toFixed(1).padStart(8)}  ${row.name}`);
  }
}

function printGpu(r: Awaited<ReturnType<typeof measure>>) {
  if (r.gpuMs !== undefined)
    console.log(
      r.gpuMs === null
        ? "gpu time: not reported (not the Wasm engine, or no timestamp-query)"
        : `gpu time p50 ${r.gpuMs.p50.toFixed(3)} ms, p95 ${r.gpuMs.p95.toFixed(3)} ms (${r.gpuMs.samples} frames); median shadow ${r.gpuMs.segments[0]?.toFixed(3)}, scene ${r.gpuMs.segments[1]?.toFixed(3)}, post ${r.gpuMs.segments[2]?.toFixed(3)}, output ${r.gpuMs.segments[3]?.toFixed(3)} ms`,
    );
  if (r.work)
    console.log(
      `cpu work per frame p50 ${r.work.workMs.toFixed(3)} ms (callbacks ${r.work.callbackMs.toFixed(3)} ms, blocked in getCurrentTexture/submit ${r.work.waitMs.toFixed(3)} ms, ${r.work.frames} frames)`,
    );
  if (r.passes !== undefined)
    if (r.passes === null)
      console.log("gpu passes: not timed (no timestamp-query, or readbacks fell behind)");
    else {
      console.log(
        `gpu passes: ${r.passes.reduce((sum, row) => sum + row.ms, 0).toFixed(3)} ms per frame in ${r.passes.reduce((sum, row) => sum + row.perFrame, 0).toFixed(1)} passes`,
      );
      for (const row of r.passes)
        console.log(
          `  ${row.ms.toFixed(3).padStart(7)} ms  x${row.perFrame.toFixed(1).padStart(4)}  ${row.name}`,
        );
    }
  if (r.gpu) {
    console.log(
      `webgpu calls per frame: ${r.gpu.reduce((sum, row) => sum + row.perFrame, 0).toFixed(1)}`,
    );
    for (const row of r.gpu) console.log(`  ${row.perFrame.toFixed(1).padStart(8)}  ${row.name}`);
  }
}

const o = options(process.argv.slice(2));
const subject = await measure(o.url, o);
const control =
  o.control === undefined
    ? undefined
    : await measure(o.control, {
        ...o,
        calls: false,
        ...(o.saveProfile === undefined ? {} : { saveProfile: `${o.saveProfile}.control` }),
      });
if (o.json) console.log(JSON.stringify({ subject, ...(control ? { control } : {}) }, null, 2));
else {
  print("subject", subject);
  if (control) {
    print("control", control);
    const ratio = subject.frame.p50 / control.frame.p50;
    console.log(
      `\nsubject/control frame p50: ${ratio.toFixed(2)}x (${ratio > 1 ? "subject slower" : "subject faster"})`,
    );
    console.log(`control/subject cpu busy: ${(control.busyMs / subject.busyMs).toFixed(2)}x`);
  }
}
