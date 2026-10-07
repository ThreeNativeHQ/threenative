import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createPlacements } from "../../examples/engine-load-test/src/workload.js";
import { buildPerryRuntime } from "../engine-load-test/perry-build.js";
import { importPerryMemory, packedPerryLoader } from "../engine-load-test/perry-packed.js";
import { buildWebBench, webBenchOptions } from "../engine-load-test/web.js";

describe("packed Perry game", () => {
  it("keeps numeric truth/equality in Wasm and delegates strings", async () => {
    const out = "/tmp/tn-perry-numeric-unit";
    await buildPerryRuntime(out);
    let fallbacks = 0;
    const { instance } = await WebAssembly.instantiate(
      await readFile(`${out}/perry-runtime.wasm`),
      {
        host: {
          mem_call: () => 0,
          mem_call_i32: () => {
            fallbacks++;
            return 77;
          },
        },
        env: { emscripten_notify_memory_growth: () => {} },
      },
    );
    const native = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      _initialize(): void;
      tn_array_create(length: number): bigint;
      tn_array_data(handle: bigint): number;
      tn_runtime_name(id: number, operation: number): void;
      mem_call_i32(name: number, count: number, base: number): number;
    };
    native._initialize();
    const base = native.tn_array_data(native.tn_array_create(2));
    const args = new BigUint64Array(native.memory.buffer, base, 2);
    const numberBits = (value: number) =>
      new BigUint64Array(new Float64Array([value]).buffer)[0] as bigint;
    native.tn_runtime_name(1, 11);
    native.tn_runtime_name(2, 12);
    for (const [value, expected] of [
      [0, 0],
      [-0, 0],
      [Number.NaN, 0],
      [1, 1],
      [-1, 1],
      [Number.POSITIVE_INFINITY, 1],
    ]) {
      args[0] = numberBits(value as number);
      expect(native.mem_call_i32(1, 1, base)).toBe(expected);
    }
    for (const tag of [1n, 2n, 3n, 4n]) {
      args[0] = 0x7ffc000000000000n | tag;
      expect(native.mem_call_i32(1, 1, base)).toBe(tag === 4n ? 1 : 0);
    }
    args[0] = 0x7ffe000000000005n;
    args[1] = numberBits(5);
    expect(native.mem_call_i32(2, 2, base)).toBe(1);
    args[0] = args[1] = numberBits(Number.NaN);
    expect(native.mem_call_i32(2, 2, base)).toBe(0);
    args[0] = numberBits(-0);
    args[1] = numberBits(0);
    expect(native.mem_call_i32(2, 2, base)).toBe(1);
    expect(fallbacks).toBe(0);
    args[0] = 0x7fff000000000001n;
    expect(native.mem_call_i32(1, 1, base)).toBe(77);
    expect(native.mem_call_i32(2, 2, base)).toBe(77);
    expect(fallbacks).toBe(2);
  });
  it("runs the same 4096-object source with a constant number of JS runtime crossings", async () => {
    const out = "/tmp/tn-perry-packed-unit";
    const build = await buildWebBench(process.cwd(), out, webBenchOptions({ objects: "4096" }));
    expect(build.perryUnavailable).toBeNull();
    const inputs = createPlacements(4096).flatMap((p) => [p.x, p.y, p.z]);
    let expected: number[] = [];
    let actual = new Float64Array();
    let updateJs: (frame: number) => void = () => {
      throw new Error("JS not registered");
    };
    runInNewContext(await readFile(`${out}/game.js`, "utf8"), {
      tn_inputs: () => inputs,
      tn_submit: (values: number[]) => {
        expected = [...values];
      },
      tn_ready: (callback: typeof updateJs) => {
        updateJs = callback;
      },
    });
    const scope = globalThis as unknown as { document: unknown; __perryColdCalls: number };
    const previousDocument = scope.document;
    scope.document = { createElement: () => ({ style: {} }), head: { appendChild() {} } };
    scope.__perryColdCalls = 0;
    try {
      // Count the actual fallback used by the production loader, after native dispatch.
      const source = (await readFile(`${out}/perry-game.js`, "utf8")).replaceAll(
        "const argc = argCount | 0;",
        "globalThis.__perryColdCalls++; const argc = argCount | 0;",
      );
      const bytes = new Uint8Array(await readFile(`${out}/perry-game.wasm`));
      const linked = importPerryMemory(bytes);
      const module = new WebAssembly.Module(linked);
      expect(WebAssembly.Module.imports(module)).toContainEqual({
        module: "env",
        name: "memory",
        kind: "memory",
      });
      const fused = new Uint8Array(await readFile(`${out}/perry-linked.wasm`));
      expect(WebAssembly.Module.imports(new WebAssembly.Module(fused))).not.toContainEqual({
        module: "rt",
        name: "mem_call",
        kind: "function",
      });
      const update = await packedPerryLoader(source)(fused, inputs, (values) => {
        actual = values.slice();
      });
      for (let frame = 0; frame < 720; frame++) {
        scope.__perryColdCalls = 0;
        updateJs(frame);
        update(frame);
        expect(actual.length).toBe(20486);
        let maxError = 0;
        for (let i = 0; i < actual.length; i++)
          maxError = Math.max(maxError, Math.abs((actual[i] as number) - (expected[i] as number)));
        expect(maxError).toBeLessThan(1e-12);
        expect(scope.__perryColdCalls).toBeGreaterThan(0);
        expect(scope.__perryColdCalls).toBeLessThan(32);
      }
      expect(() => importPerryMemory(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).toThrow(
        "TN_WEB_BENCH_PERRY_MEMORY_MISSING",
      );
    } finally {
      scope.document = previousDocument;
      (scope as unknown as Record<string, unknown>).__perryColdCalls = undefined;
    }
  }, 120_000);
});
