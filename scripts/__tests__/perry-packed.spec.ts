import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createPlacements } from "../../examples/engine-load-test/src/workload.js";
import { buildPerryRuntime, promotePerryScratch } from "../engine-load-test/perry-build.js";
import { importPerryMemory, packedPerryLoader } from "../engine-load-test/perry-packed.js";
import { buildWebBench, webBenchOptions } from "../engine-load-test/web.js";

// These tests build or load the real Wasm engine and Perry toolchain (emcc, the wasm-browser
// build). CI runs them in test-native, which builds both; a shard without them would only time out.
const builtWasm = process.env.TN_WEB_ENGINE_SPECS === "1";

describe("packed Perry game", () => {
  it("rejects scratch promotion when a host can observe it", () => {
    expect(() =>
      promotePerryScratch("\n (func $11 (param i64)\n (loop $label (call $fimport$209)))"),
    ).toThrow("TN_WEB_BENCH_PERRY_SCRATCH_ESCAPE");
    expect(() => promotePerryScratch("(module)")).toThrow("TN_WEB_BENCH_PERRY_SCRATCH_LAYOUT");
  });
  it.runIf(builtWasm)("keeps numeric truth/equality in Wasm and delegates strings", async () => {
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
      tn_array_size(handle: bigint): number;
      tn_runtime_name(id: number, operation: number): void;
      mem_call_i32(name: number, count: number, base: number): number;
      mem_call(name: number, count: number, base: number): number;
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
    const array = native.tn_array_create(2);
    const arrayArgsBase = native.tn_array_data(native.tn_array_create(3));
    const arrayArgs = new BigUint64Array(native.memory.buffer, arrayArgsBase, 3);
    native.tn_runtime_name(3, 6);
    native.tn_runtime_name(4, 7);
    arrayArgs.set([array, numberBits(0), numberBits(42)]);
    native.mem_call(4, 3, arrayArgsBase);
    arrayArgs.set([array, numberBits(0)]);
    native.mem_call(3, 2, arrayArgsBase);
    expect(arrayArgs[0]).toBe(numberBits(42));
    for (const index of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, 2]) {
      arrayArgs.set([array, numberBits(index)]);
      native.mem_call(3, 2, arrayArgsBase);
      expect(arrayArgs[0]).toBe(0x7ffc000000000001n);
    }
    arrayArgs.set([array, numberBits(0.5), numberBits(99)]);
    expect(() => native.mem_call(4, 3, arrayArgsBase)).toThrow(WebAssembly.RuntimeError);
    arrayArgs.set([array, numberBits(20), numberBits(99)]);
    native.mem_call(4, 3, arrayArgsBase);
    expect(native.tn_array_size(array)).toBe(21);
  });
  // Node 20 can build the browser artifact but cannot execute its two memories.
  it.runIf(builtWasm)(
    "matches 4096 objects across 720 frames",
    async ({ skip }) => {
      if (!WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 5, 2, 0, 1, 0, 1])))
        skip("requires Wasm multi-memory (Node 22+)");
      const out = "/tmp/tn-perry-packed-unit";
      const build = await buildWebBench(process.cwd(), out, webBenchOptions({ objects: "4096" }));
      expect(build.perryUnavailable).toBeNull();
      const wat = await readFile(`${out}/perry-linked.wat`, "utf8");
      const updateStart = wat.indexOf("\n (func $11 ");
      const loopStart = wat.indexOf("(loop $", updateStart);
      let end = loopStart;
      let depth = 0;
      do {
        const c = wat[end++];
        if (c === "(") depth++;
        if (c === ")") depth--;
      } while (depth && end < wat.length);
      const hot = wat.slice(loopStart, end);
      expect(hot).toContain("f64.add");
      expect(hot).toMatch(/(?:f64|i64)\.load/);
      expect(hot).toMatch(/(?:f64|i64)\.store/);
      expect(hot).not.toMatch(/\(call \$(?:fimport|tn_op)/);
      // libm may use its own C stack during range reduction; the game's scratch stack is gone.
      expect(hot).not.toContain("tn_scratch");
      const inputs = createPlacements(4096).flatMap((p) => [p.x, p.y, p.z]);
      let expected: number[] = [];
      let actual = new Float64Array();
      let updateJs: (frame: number) => void = () => {
        throw new Error("JS not registered");
      };
      runInNewContext(await readFile(`${out}/game.js`, "utf8"), {
        tn_inputs: () => inputs,
        tn_values: () => new Array(6 + (inputs.length / 3) * 5).fill(0),
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
        const factory = createRequire(import.meta.url)(
          "../../packages/runtime-native/build/wasm-browser/tn-native-engine-wasm-browser.js",
        );
        const engine = await factory();
        const byteOffset = engine._malloc(20486 * 8);
        let submitted: Float64Array | undefined;
        const update = await packedPerryLoader(source)(
          fused,
          inputs,
          (values) => {
            expect(values.buffer).toBe(engine.wasmMemory.buffer);
            expect(values.byteOffset).toBe(byteOffset);
            if (submitted?.buffer === values.buffer) expect(values).toBe(submitted);
            submitted = values;
            actual = values.slice();
          },
          { memory: engine.wasmMemory, byteOffset },
        );
        const allocations = update.allocations();
        for (let frame = 0; frame < 720; frame++) {
          if (frame === 317) engine.wasmMemory.grow(1);
          scope.__perryColdCalls = 0;
          updateJs(frame);
          update(frame);
          expect(actual.length).toBe(20486);
          let maxError = 0;
          for (let i = 0; i < actual.length; i++)
            maxError = Math.max(
              maxError,
              Math.abs((actual[i] as number) - (expected[i] as number)),
            );
          expect(maxError).toBeLessThan(1e-12);
          expect(update.allocations()).toBe(allocations);
          expect(scope.__perryColdCalls).toBeGreaterThan(0);
          expect(scope.__perryColdCalls).toBeLessThan(32);
        }
        engine._free(byteOffset);
        expect(() => importPerryMemory(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).toThrow(
          "TN_WEB_BENCH_PERRY_MEMORY_MISSING",
        );
      } finally {
        scope.document = previousDocument;
        (scope as unknown as Record<string, unknown>).__perryColdCalls = undefined;
      }
    },
    120_000,
  );
});
