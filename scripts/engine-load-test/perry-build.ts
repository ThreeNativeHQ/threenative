import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PERRY_NUMERIC_OPERATIONS, importPerryMemory } from "./perry-packed.js";

export async function buildPerryRuntime(out: string, defines?: string) {
  await mkdir(out, { recursive: true });
  const exports = [
    "tn_array_create",
    "tn_array_data",
    "tn_array_size",
    "tn_array_allocations",
    "tn_runtime_name",
    "tn_numeric_arrays",
    "mem_call",
    "mem_call_i32",
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12].map((op) => `tn_op_${op}`),
  ];
  const result = spawnSync(
    "emcc",
    [
      path.join(import.meta.dirname, "perry-runtime.c"),
      "-O3",
      ...(defines ? ["-include", defines] : []),
      ...(defines ? ["-DTN_PERRY_EXTERNAL_MEMORY=1", "-Wl,--export=tn_array_external"] : []),
      "--no-entry",
      "-sSTANDALONE_WASM=1",
      "-sALLOW_MEMORY_GROWTH=1",
      "-sINITIAL_MEMORY=8388608",
      "-sSTACK_SIZE=65536",
      "-Wl,--global-base=131072,--no-stack-first",
      ...exports.map((name) => `-Wl,--export=${name}`),
      "-o",
      path.join(out, "perry-runtime.wasm"),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.status !== 0)
    throw new Error(
      `TN_WEB_BENCH_PERRY_RUNTIME_BUILD: ${result.stderr}; ${result.error?.message ?? result.status}`,
    );
}

export async function linkPerryGame(out: string) {
  const tool = (command: string) =>
    process.env.EMSDK
      ? path.join(
          process.env.EMSDK,
          "upstream",
          "bin",
          command + (process.platform === "win32" ? ".exe" : ""),
        )
      : command;
  const watFile = path.join(out, "perry-game.wat");
  const disassemble = spawnSync(
    tool("wasm-dis"),
    [path.join(out, "perry-game.wasm"), "-o", watFile],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (disassemble.status !== 0)
    throw new Error(`TN_WEB_BENCH_PERRY_DISASSEMBLE: ${disassemble.stderr}`);
  let wat = await readFile(watFile, "utf8");
  // The pinned compiler registers its literal names in order. Make that verified ABI table
  // constant before whole-module inlining, so per-element dispatch folds to numeric operations.
  const data = /\(data \$0 \(i32.const 0\) "([^"\\]*)"\)/.exec(wat)?.[1];
  if (!data || !wat.includes('(import "rt" "string_new" (func $fimport$0'))
    throw new Error("TN_WEB_BENCH_PERRY_NAMES_LAYOUT");
  if (
    !wat.includes('(import "rt" "mem_call" (func $fimport$209') ||
    !wat.includes('(import "rt" "mem_call_i32" (func $fimport$210')
  )
    throw new Error("TN_WEB_BENCH_PERRY_CALLS_LAYOUT");
  const names = [
    ...wat.matchAll(/\(call \$fimport\$0\s+\(i32.const (\d+)\)\s+\(i32.const (\d+)\)\s+\)/g),
  ].map((match) => data.slice(Number(match[1]), Number(match[1]) + Number(match[2])));
  if (!names.length || names.length > 512) throw new Error("TN_WEB_BENCH_PERRY_NAMES_COUNT");
  const operations = names
    .map((name, id) =>
      PERRY_NUMERIC_OPERATIONS[name] ? `((name)==${id})?${PERRY_NUMERIC_OPERATIONS[name]}:` : "",
    )
    .join("");
  const defines = path.join(out, "perry-names.h");
  await writeFile(defines, `#define TN_PERRY_OPERATIONS(name) (${operations}0)\n`);
  await buildPerryRuntime(out, defines);
  const specialized = new Map<number, string>();
  wat = wat.replace(
    /\(call \$fimport\$(209|210)(\s+\(f64.const (\d+)\))/g,
    (call, importId: string, argument: string, name: string) => {
      const op = PERRY_NUMERIC_OPERATIONS[names[Number(name)] ?? ""];
      if (!op || op === 10 || (Number(importId) === 210) !== op >= 11) return call;
      specialized.set(op, op >= 11 ? "i32" : "f64");
      return `(call $tn_op_${op}${argument}`;
    },
  );
  if (!specialized.has(6) || !specialized.has(7))
    throw new Error("TN_WEB_BENCH_PERRY_NUMERIC_CALLS");
  wat = wat.replace(
    "(module",
    `(module\n${[...specialized]
      .map(
        ([op, result]) =>
          ` (import "rt" "tn_op_${op}" (func $tn_op_${op} (param f64 f64 i32) (result ${result})))`,
      )
      .join("\n")}`,
  );
  const specializedWat = path.join(out, "perry-numeric.wat");
  const specializedWasm = path.join(out, "perry-numeric.wasm");
  await writeFile(specializedWat, wat);
  const assemble = spawnSync(tool("wasm-as"), [specializedWat, "-o", specializedWasm], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (assemble.status !== 0)
    throw new Error(`TN_WEB_BENCH_PERRY_NUMERIC_ASSEMBLE: ${assemble.stderr}`);
  const input = path.join(out, "perry-shared.wasm");
  await writeFile(input, importPerryMemory(new Uint8Array(await readFile(specializedWasm)), "rt"));
  const linked = path.join(out, "perry-linked.wasm");
  // A second memory lets the numeric runtime write the engine's allocation directly.
  // Linking these primitives makes each packed access a Wasm load/store, not a JS call.
  const packedWat = path.join(out, "perry-output.wat");
  const packedWasm = path.join(out, "perry-output.wasm");
  await writeFile(
    packedWat,
    `(module
    (import "engine" "memory" (memory 1))
    (func (export "load") (param i32) (result i64) (i64.load (local.get 0)))
    (func (export "store") (param i32 i64) (i64.store (local.get 0) (local.get 1))))\n`,
  );
  const features = [
    "--enable-bulk-memory",
    "--enable-reference-types",
    "--enable-multivalue",
    "--enable-sign-ext",
    "--enable-nontrapping-float-to-int",
    "--enable-mutable-globals",
    "--enable-multimemory",
  ];
  for (const [command, args] of [
    ["wasm-as", [packedWat, "-o", packedWasm]],
    [
      "wasm-merge",
      [
        input,
        "game",
        path.join(out, "perry-runtime.wasm"),
        "rt",
        packedWasm,
        "packed",
        ...features,
        "--rename-export-conflicts",
        "-o",
        linked,
      ],
    ],
    [
      "wasm-opt",
      [
        linked,
        "-O3",
        ...features,
        "--inlining-optimizing",
        "--always-inline-max-function-size=200",
        "-o",
        linked,
      ],
    ],
    ["wasm-dis", [linked, "-o", path.join(out, "perry-linked.wat")]],
  ] as const) {
    const result = spawnSync(tool(command), args, { encoding: "utf8", timeout: 120_000 });
    if (result.status !== 0)
      throw new Error(
        `TN_WEB_BENCH_PERRY_LINK: ${command}: ${result.stderr}; ${result.error?.message ?? result.status}`,
      );
  }
  // The build driver can be Node 20, whose V8 lacks multi-memory even when the
  // browser supports it. Binaryen validates the artifact; inspect its actual imports.
  const linkedWat = await readFile(path.join(out, "perry-linked.wat"), "utf8");
  if (/\(import "(?:rt|packed)" "(?:mem_call(?:_i32)?|tn_op_\d+|load|store)"/.test(linkedWat))
    throw new Error("TN_WEB_BENCH_PERRY_LINK_UNRESOLVED");
}
