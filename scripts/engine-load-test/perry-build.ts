import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PERRY_NUMERIC_OPERATIONS, importPerryMemory } from "./perry-packed.js";

function promoteNumericScratch(code: string) {
  const global = /\(global.get (\$global\$\d+)\)/.exec(code)?.[1];
  if (!global) throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_GLOBAL");
  const escaped = global.replaceAll("$", "\\$");
  const address = `\\(i32.sub\\s+\\(global.get ${escaped}\\)\\s+\\(i32.const (\\d+)\\)\\s*\\)`;
  const operations = new RegExp(
    `\\(global.set ${escaped}\\s+\\(i32.(add|sub)\\s+\\(global.get ${escaped}\\)\\s+\\(i32.const (\\d+)\\)\\s*\\)\\s*\\)|` +
      `\\(i64.(load|store)\\s+(?:offset=(\\d+)\\s+)?${address}(\\s*\\))?`,
    "g",
  );
  let depth = 0;
  const slots = new Set<string>();
  const promoted = code.replace(
    operations,
    (
      _,
      change: string,
      amount: string,
      op: string,
      offset: string,
      below: string,
      close: string,
    ) => {
      if (change) {
        depth += (change === "add" ? 1 : -1) * Number(amount);
        return "(nop)";
      }
      const byte = depth - Number(below) + Number(offset ?? 0);
      if (byte % 8 || (op === "load") !== Boolean(close))
        throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_ACCESS");
      const name = `$tn_scratch_${byte < 0 ? "m" : "p"}${Math.abs(byte)}`;
      slots.add(name);
      return op === "load" ? `(local.get ${name})` : `(local.set ${name}`;
    },
  );
  if (depth || promoted.includes(`global.get ${global}`) || !slots.size)
    throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_BALANCE");
  return { code: promoted, slots };
}

// Promote the pinned compiler's balanced, numeric-loop scratch stack to Wasm locals.
// Helpers receive values, never scratch pointers; no host call can observe these slots.
export function promotePerryScratch(wat: string) {
  const fn = wat.indexOf("\n (func $11 ");
  const start = wat.indexOf("(loop $label", fn);
  if (fn < 0 || start < fn) throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_LAYOUT");
  let end = start;
  let nesting = 0;
  do {
    const char = wat[end++];
    if (char === "(") nesting++;
    if (char === ")") nesting--;
    if (end > wat.length) throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_END");
  } while (nesting);
  const loop = wat.slice(start, end);
  if (/\(call \$(?:fimport|tn_op)/.test(loop)) throw new Error("TN_WEB_BENCH_PERRY_SCRATCH_ESCAPE");
  const lifted = promoteNumericScratch(loop);
  let promoted = lifted.code;
  const slots = lifted.slots;
  let reads = 0;
  let writes = 0;
  const addressOf = (pointer: string, index: string) =>
    `(i32.add (local.get ${pointer}) (i32.shl (i32.trunc_f64_u (f64.reinterpret_i64 (local.get ${index}))) (i32.const 3)))`;
  promoted = promoted
    .replace(
      /\(call \$tn_num_get\s+\(local.get [^)]+\)\s+\(local.get ([^)]+)\)\s*\)/g,
      (_, index: string) => {
        reads++;
        return `(i64.load ${addressOf("$tn_input_data", index)})`;
      },
    )
    .replace(
      /\(call \$tn_num_set\s+\(local.get [^)]+\)\s+\(local.get ([^)]+)\)\s+\(local.get ([^)]+)\)\s*\)/g,
      (_, index: string, value: string) => {
        writes++;
        return `(block (result i64) (call $tn_write ${addressOf("$tn_output_data", index)} (local.get ${value})) (i64.const 9222246136947933185))`;
      },
    );
  if (reads !== 3 || writes !== 5 || /\(call \$tn_num_(get|set)/.test(promoted))
    throw new Error("TN_WEB_BENCH_PERRY_NUMERIC_REGIONS");
  const pointers =
    "(local.set $tn_input_data (call $tn_num_input_data))\n(local.set $tn_output_data (call $tn_num_output_data))\n";
  const body = wat.slice(0, start) + pointers + promoted + wat.slice(end);
  const insert = body.indexOf("\n", fn + 1);
  return `${body.slice(0, insert)}\n  (local $tn_input_data i32) (local $tn_output_data i32)${[...slots].map((name) => `\n  (local ${name} i64)`).join("")}${body.slice(insert)}`;
}

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
    "tn_num_get",
    "tn_num_set",
    "tn_num_add",
    "tn_num_sin",
    "tn_num_cos",
    "tn_num_truthy",
    "tn_num_regions",
    "tn_num_input_data",
    "tn_num_output_data",
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
  // The pinned compiler's numeric functions are cameraPose, rotations, bob and update.
  // Lower their scratch-memory ABI to typed operands before whole-module inlining.
  const numeric = new Map<number, [string, number, string]>([
    [1, ["tn_num_sin", 1, "i64"]],
    [2, ["tn_num_cos", 1, "i64"]],
    [6, ["tn_num_get", 2, "i64"]],
    [7, ["tn_num_set", 3, "i64"]],
    [9, ["tn_num_add", 2, "i64"]],
    [11, ["tn_num_truthy", 1, "i32"]],
  ]);
  const numericImports = new Set<number>();
  const begin = wat.indexOf(" (func $7 ");
  const end = wat.indexOf(" (func $12 ", begin);
  if (begin < 0 || end < begin || !wat.slice(begin, end).includes("(loop $label"))
    throw new Error("TN_WEB_BENCH_PERRY_NUMERIC_LAYOUT");
  const typed = wat
    .slice(begin, end)
    .replace(
      /\(call \$fimport\$(209|210)\s+\(f64.const (\d+)\)\s+\(f64.const (\d+)\)\s+(\(i32.sub\s+\(global.get \$global\$\d+\)\s+\(i32.const \d+\)\s*\))\s*\)/g,
      (call, importId: string, name: string, count: string, base: string) => {
        const op = PERRY_NUMERIC_OPERATIONS[names[Number(name)] ?? ""];
        const entry = numeric.get(op ?? 0);
        if (!entry || Number(count) !== entry[1] || (importId === "210") !== (entry[2] === "i32"))
          return call;
        numericImports.add(op as number);
        const args = Array.from(
          { length: entry[1] },
          (_, i) => `(i64.load offset=${i * 8} ${base})`,
        ).join(" ");
        const result = `(call $${entry[0]} ${args})`;
        return entry[2] === "i32"
          ? result
          : `(block (result f64) (i64.store ${base} ${result}) (f64.const 0))`;
      },
    );
  if (![6, 7, 9, 11].every((op) => numericImports.has(op)))
    throw new Error("TN_WEB_BENCH_PERRY_TYPED_CALLS");
  wat = wat.slice(0, begin) + typed + wat.slice(end);
  for (const id of [8, 9, 10]) {
    const a = wat.indexOf(`\n (func $${id} `);
    const b = wat.indexOf(`\n (func $${id + 1} `, a);
    if (a < 0 || b < a) throw new Error("TN_WEB_BENCH_PERRY_HELPER_LAYOUT");
    const body = wat.slice(a, b);
    if (/\(call \$(?:fimport|tn_op)/.test(body))
      throw new Error("TN_WEB_BENCH_PERRY_HELPER_ESCAPE");
    const lifted = promoteNumericScratch(body);
    const insert = lifted.code.indexOf("\n", 1);
    wat =
      wat.slice(0, a) +
      lifted.code.slice(0, insert) +
      [...lifted.slots].map((name) => `\n  (local ${name} i64)`).join("") +
      lifted.code.slice(insert) +
      wat.slice(b);
  }
  wat = promotePerryScratch(wat);
  wat = wat.replace(
    /\(call \$fimport\$(209|210)(\s+\(f64.const (\d+)\))/g,
    (call, importId: string, argument: string, name: string) => {
      const op = PERRY_NUMERIC_OPERATIONS[names[Number(name)] ?? ""];
      if (!op || op === 10 || (Number(importId) === 210) !== op >= 11) return call;
      specialized.set(op, op >= 11 ? "i32" : "f64");
      return `(call $tn_op_${op}${argument}`;
    },
  );
  if (![6, 7].every((op) => specialized.has(op) || numericImports.has(op)))
    throw new Error("TN_WEB_BENCH_PERRY_NUMERIC_CALLS");
  wat = wat.replace(
    "(module",
    `(module
 (import "rt" "tn_num_input_data" (func $tn_num_input_data (result i32)))
 (import "rt" "tn_num_output_data" (func $tn_num_output_data (result i32)))
 (import "packed" "store" (func $tn_write (param i32 i64)))
${[...numericImports]
  .map((op) => {
    const [name, count, result] = numeric.get(op) as [string, number, string];
    return ` (import "rt" "${name}" (func $${name} (param ${Array(count).fill("i64").join(" ")}) (result ${result})))`;
  })
  .join("\n")}\n${[...specialized]
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
        "--always-inline-max-function-size=500",
        "--gufa",
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
  if (
    /\(import "(?:rt|packed)" "(?:mem_call(?:_i32)?|tn_op_\d+|tn_num_\w+|load|store)"/.test(
      linkedWat,
    )
  )
    throw new Error("TN_WEB_BENCH_PERRY_LINK_UNRESOLVED");
}
