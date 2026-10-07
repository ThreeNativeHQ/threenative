import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { createPlacements } from "../../examples/engine-load-test/src/workload.js";
import registry from "../../packages/three-native/api/native-registry.json";
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
  engineRef,
} from "../../packages/three-native/src/browser-backend.js";
import {
  buildWebBench,
  collectWebBenchPage,
  summarizeWebBench,
  webBenchOptions,
} from "../engine-load-test/web.js";

describe("PRD-533 web arms", () => {
  it("validates the one workload and exactly three repeated runs", () => {
    expect(webBenchOptions({}).frames).toBe(600);
    expect(() => webBenchOptions({ repeats: "2" })).toThrow(/repeats/);
    expect(() => webBenchOptions({ frames: "NaN" })).toThrow(/frames/);
    expect(() => webBenchOptions({ workload: "crowd" })).toThrow(/heterogeneous/);
    expect(() => webBenchOptions({ arms: "current,wasm-js" })).toThrow(/arms/);
  });

  it("fails immediately with a named page error instead of awaiting the generic timeout", async () => {
    const page = new EventEmitter() as EventEmitter & {
      goto: () => Promise<void>;
      waitForFunction: () => Promise<void>;
    };
    page.goto = async () => {
      page.emit("pageerror", new Error("Perry runtime import failed"));
    };
    page.waitForFunction = () => new Promise(() => {});
    await expect(
      collectWebBenchPage(
        page as unknown as Page,
        "http://bench/wasm-perry.html",
        "wasm-perry",
        webBenchOptions({}),
      ),
    ).rejects.toThrow(/TN_WEB_BENCH_PAGE_ERROR.*wasm-perry.*Perry runtime import failed/s);
  });

  it("allows advancing frames past the former total deadline and names a stalled stage", async () => {
    const page = new EventEmitter();
    const waitForFunction = vi.fn().mockResolvedValue(undefined).mockResolvedValueOnce(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ progress: { frame: 59 } })
      .mockResolvedValueOnce({ report: { arm: "wasm-perry", cpuMs: [200] } });
    const surface = Object.assign(page, { goto: async () => {}, waitForFunction, evaluate });
    await expect(
      collectWebBenchPage(
        surface as unknown as Page,
        "http://bench",
        "wasm-perry",
        webBenchOptions({}),
      ),
    ).resolves.toMatchObject({ arm: "wasm-perry" });
    expect(waitForFunction.mock.calls.map((call) => call[1])).toEqual([-1, 59]);
    waitForFunction.mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" }),
    );
    evaluate.mockResolvedValue({ stage: "game-import", frame: -1 });
    await expect(
      collectWebBenchPage(
        surface as unknown as Page,
        "http://bench",
        "wasm-perry",
        webBenchOptions({}),
      ),
    ).rejects.toThrow(/TN_WEB_BENCH_STALLED.*game-import/);
  });

  it("reports noise and only calls a gain beyond every repeated run faster", () => {
    const runs = (arm: string, value: number) =>
      [0, 1, 2].map((repeat) => ({
        arm,
        repeat,
        cpuMs: [value, value + 1],
        adapter: { description: "hardware" },
      }));
    expect(
      summarizeWebBench(
        [...runs("current", 20), ...runs("wasm-js", 10), ...runs("wasm-perry", 2)],
        null,
      ).verdict,
    ).toBe("Perry faster");
    expect(
      summarizeWebBench(
        [...runs("current", 20), ...runs("wasm-js", 10), ...runs("wasm-perry", 10)],
        null,
      ).verdict,
    ).toBe("not faster");
    expect(
      summarizeWebBench([...runs("current", 20), ...runs("wasm-js", 10)], "backend missing")
        .verdict,
    ).toBe("unavailable");
    expect(() =>
      summarizeWebBench([...runs("wasm-js", 10), ...runs("wasm-perry", 2)], null),
    ).toThrow(/current/);
    expect(() =>
      summarizeWebBench([{ arm: "wasm-js", repeat: 0, cpuMs: [], adapter: {} }], null),
    ).toThrow();
  });

  it("builds separate arms and genuinely invokes the pinned Perry Wasm backend", async () => {
    const result = await buildWebBench(
      process.cwd(),
      "/tmp/tn-web-bench-unit",
      webBenchOptions({ objects: "4" }),
    );
    expect(result.engineBuild.buildType).toBe("Release");
    expect(result.engineBuild.flags.some((flag) => flag.includes("-O3"))).toBe(true);
    expect(result.bundleBytes.current).toBeGreaterThan(0);
    expect(result.bundleBytes["wasm-js"]).toBeGreaterThan(0);
    if (result.perryUnavailable === null) {
      expect(result.bundleBytes["wasm-perry"]).toBeGreaterThan(result.bundleBytes["wasm-js"]);
      expect(result.perryWasmImports).toContain("ffi:tn_submit");
      const inputs = createPlacements(4).flatMap((p) => [p.x, p.y, p.z]);
      let actual: number[] = [];
      let expected: number[] = [];
      let updateJs: (frame: number) => void = () => {
        throw new Error("JS callback missing");
      };
      runInNewContext(await readFile("/tmp/tn-web-bench-unit/game.js", "utf8"), {
        tn_inputs: () => inputs,
        tn_submit: (values: number[]) => {
          expected = [...values];
        },
        tn_ready: (callback: typeof updateJs) => {
          updateJs = callback;
        },
      });
      const context = {
        WebAssembly,
        TextDecoder,
        TextEncoder,
        atob,
        console,
        setTimeout,
        clearTimeout,
        document: { createElement: () => ({ style: {} }), head: { appendChild: () => {} } },
        loadPerry: undefined as
          | undefined
          | ((input: number[], submit: (values: number[]) => void) => Promise<typeof updateJs>),
      };
      const source = await readFile("/tmp/tn-web-bench-unit/perry-game.js", "utf8");
      const documentBefore = Object.getOwnPropertyDescriptor(globalThis, "document");
      Object.defineProperty(globalThis, "document", {
        value: context.document,
        configurable: true,
      });
      const module = await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
      );
      if (documentBefore) Object.defineProperty(globalThis, "document", documentBefore);
      else Reflect.deleteProperty(globalThis, "document");
      const updatePerry = await module.loadPerry(inputs, (values: number[]) => {
        actual = [...values];
      });
      expect(updatePerry).toBeTypeOf("function");
      for (const frame of [0, 317, 719]) {
        updateJs(frame);
        updatePerry?.(frame);
        expect(actual).toHaveLength(expected.length);
        actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index] as number, 12));
      }
    } else expect(result.perryUnavailable).toMatch(/Perry/);
  });

  it("runs the emitted browser arm CPU-only with measured crossings, stable views and reconciled spans", async () => {
    const factory = createRequire(import.meta.url)(
      "../../packages/runtime-native/build/wasm-browser/tn-native-engine-wasm-browser.js",
    );
    const abi = await factory();
    class QueueFixture {
      writeBuffer() {}
    }
    class PassFixture {
      drawIndexed() {}
      executeBundles() {}
    }
    class BundleFixture {
      drawIndexed() {}
    }
    const queue = new QueueFixture();
    const pass = new PassFixture();
    const bundle = new BundleFixture();
    const stats = abi._tnw_bench_stats();
    let scene = 0;
    let camera = 0;
    const globals = globalThis as unknown as Record<string, unknown>;
    const names = [
      "GPUQueue",
      "GPURenderPassEncoder",
      "GPURenderBundleEncoder",
      "createTnBrowser",
      "document",
      "location",
      "requestAnimationFrame",
      "__tnWasmAssets",
      "__ENGINE_LOAD_TEST__",
      "__ENGINE_LOAD_TEST_ERROR__",
      "__ENGINE_LOAD_TEST_PROGRESS__",
      "tn_inputs",
      "tn_submit",
      "tn_ready",
    ];
    const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    abi._tnw_bench_init = () => {
      globals.__tnWasmAssets = { initialized: true, adapter: { description: "CPU probe" } };
      return 0;
    };
    abi._tnw_render = (s: number, c: number) => {
      scene = s;
      camera = c;
      return 0;
    };
    abi._tnw_bench_step = () => {
      const start = performance.now();
      const status = abi._tnw_bench_prepare(scene, camera);
      queue.writeBuffer();
      pass.drawIndexed();
      bundle.drawIndexed();
      pass.executeBundles();
      abi.HEAPF64[stats / 8] = performance.now() - start;
      abi.HEAPF64[stats / 8 + 1] = abi.HEAPF64[stats / 8 + 2] = abi.HEAPF64[stats / 8 + 3] = 0;
      return status;
    };
    try {
      Object.assign(globals, {
        GPUQueue: QueueFixture,
        GPURenderPassEncoder: PassFixture,
        GPURenderBundleEncoder: BundleFixture,
        createTnBrowser: async () => abi,
        document: { querySelector: () => ({}) },
        location: { search: "?arm=wasm-js&objects=4&width=1280&height=720&warmup=1&frames=3" },
        requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
      });
      const game = `data:text/javascript;base64,${Buffer.from(await readFile("/tmp/tn-web-bench-unit/game.js")).toString("base64")}`;
      const source = (await readFile("/tmp/tn-web-bench-unit/wasm.js", "utf8")).replace(
        '"./game.js"',
        JSON.stringify(game),
      );
      await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
      for (
        let tries = 0;
        tries < 100 && !globals.__ENGINE_LOAD_TEST__ && !globals.__ENGINE_LOAD_TEST_ERROR__;
        tries++
      )
        await new Promise((resolve) => setImmediate(resolve));
      expect(globals.__ENGINE_LOAD_TEST_ERROR__).toBeUndefined();
      const report = globals.__ENGINE_LOAD_TEST__ as {
        cpuMs: number[];
        breakdown: Record<string, number[]>;
        boundary: Record<string, number[]>;
      };
      expect(report.cpuMs).toHaveLength(3);
      expect(report.boundary.webgpuCalls).toEqual([4, 4, 4]);
      for (const field of ["writeBuffers", "directDraws", "bundleDraws", "executeBundles"])
        expect(report.boundary[field]).toEqual([1, 1, 1]);
      expect(report.boundary.recordRebuilds).toEqual([0, 0, 0]);
      expect(report.boundary.instancedBatches).toEqual([1, 1, 1]);
      expect(new Set(report.boundary.calls).size).toBe(1);
      expect(report.boundary.calls?.[0]).toBeGreaterThan(2);
      expect(report.boundary.transformViewCreations).toEqual([0, 0, 0]);
      expect(report.boundary.heapGrowthBytes).toEqual([0, 0, 0]);
      expect(report.boundary.copyBytes).toEqual([160, 160, 160]);
      for (let index = 0; index < 3; index++)
        expect(
          Object.values(report.breakdown).reduce(
            (sum, samples) => sum + (samples[index] as number),
            0,
          ),
        ).toBeCloseTo(report.cpuMs[index] as number, 9);
    } finally {
      names.forEach((name, index) => {
        const descriptor = before[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });

  it("merges compatible colour-only materials and keeps geometry groups distinct", async () => {
    const factory = createRequire(import.meta.url)(
      "../../packages/runtime-native/build/wasm-browser/tn-native-engine-wasm-browser.js",
    );
    const abi = await factory();
    const engine = defineBrowserClasses(registry as IRegistryDump, createWasmRuntime(abi));
    const Scene = engine.classes.Scene;
    const Camera = engine.classes.PerspectiveCamera;
    const Mesh = engine.classes.Mesh;
    const Geometry = engine.classes.BoxGeometry;
    const Material = engine.classes.MeshStandardMaterial;
    if (!Scene || !Camera || !Mesh || !Geometry || !Material) throw new Error("classes missing");
    const scene = new Scene() as { add(mesh: object): void };
    const camera = new Camera();
    const geometry = new Geometry(1, 1, 1);
    const material = new Material();
    for (let index = 0; index < 4; index++) scene.add(new Mesh(geometry, material));
    const handles = abi._malloc(24);
    const view = new DataView(abi.HEAPU8.buffer);
    [scene, camera].forEach((object, index) => {
      const key = engineRef(object)?.key.split(":").map(Number);
      if (!key) throw new Error("handle missing");
      view.setUint16(handles + index * 12, key[0] as number, true);
      view.setUint16(handles + index * 12 + 2, key[1] as number, true);
      view.setUint32(handles + index * 12 + 4, key[2] as number, true);
      view.setUint32(handles + index * 12 + 8, key[3] as number, true);
    });
    const stats = abi._tnw_bench_stats();
    expect(abi._tnw_bench_prepare(handles, handles + 12)).toBe(0);
    expect(abi.HEAPF64[stats / 8 + 3]).toBe(1); // the four shared cubes batch
    scene.add(new Mesh(geometry, new Material()));
    expect(abi._tnw_bench_prepare(handles, handles + 12)).toBe(0);
    expect(abi.HEAPF64[stats / 8 + 3]).toBe(1); // compatible unique materials join the colour batch
    for (let index = 0; index < 3; index++) scene.add(new Mesh(new Geometry(1, 1, 1), material));
    expect(abi._tnw_bench_prepare(handles, handles + 12)).toBe(0);
    expect(abi.HEAPF64[stats / 8 + 3]).toBe(4); // different geometry never joins the shared group
    abi._free(handles);
  });

  it("executes the built Wasm bulk API and refuses nonfinite input before any writes", async () => {
    const factory = createRequire(import.meta.url)(
      "../../packages/runtime-native/build/wasm-browser/tn-native-engine-wasm-browser.js",
    );
    const abi = (await factory()) as TnAbiModule & {
      _tnw_bulk_transforms(handles: number, values: number, count: number): number;
    };
    const engine = defineBrowserClasses(registry as IRegistryDump, createWasmRuntime(abi));
    const Mesh = engine.classes.Mesh;
    if (!Mesh) throw new Error("Mesh not bound");
    const meshes = [new Mesh(), new Mesh()] as unknown as { position: { x: number; y: number } }[];
    const handles = abi._malloc(24);
    const values = abi._malloc(80);
    const view = new DataView(abi.HEAPU8.buffer);
    meshes.forEach((mesh, index) => {
      const key = engineRef(mesh)?.key.split(":").map(Number);
      if (!key) throw new Error("handle missing");
      view.setUint16(handles + index * 12, key[0] as number, true);
      view.setUint16(handles + index * 12 + 2, key[1] as number, true);
      view.setUint32(handles + index * 12 + 4, key[2] as number, true);
      view.setUint32(handles + index * 12 + 8, key[3] as number, true);
    });
    new Float64Array(abi.HEAPU8.buffer, values, 10).set([1, 2, 3, 0.1, 0.2, 4, 5, 6, 0.3, 0.4]);
    expect(abi._tnw_bulk_transforms(handles, values, 2)).toBe(0);
    expect(meshes[0]?.position.x).toBe(1);
    expect(meshes[1]?.position.y).toBe(5);
    new Float64Array(abi.HEAPU8.buffer, values, 10).set([99, 2, 3, 0, 0, 4, Number.NaN, 6, 0, 0]);
    expect(abi._tnw_bulk_transforms(handles, values, 2)).toBe(1);
    expect(meshes[0]?.position.x).toBe(1);
    const buffer = abi.HEAPU8.buffer;
    const growth = abi._malloc(abi.HEAPU8.byteLength + 65536);
    expect(abi.HEAPU8.buffer).not.toBe(buffer);
    if (!meshes[0]) throw new Error("mesh missing");
    meshes[0].position.x = 7;
    expect(meshes[0].position.x).toBe(7); // the cached DataView follows heap growth
    abi._free(growth);
    abi._free(values);
    abi._free(handles);
  });
});
