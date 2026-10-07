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
    "tn_runtime_name",
    "tn_numeric_arrays",
    "mem_call",
    "mem_call_i32",
  ];
  const result = spawnSync(
    "emcc",
    [
      path.join(import.meta.dirname, "perry-runtime.c"),
      "-O3",
      ...(defines ? ["-include", defines] : []),
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
  const wat = await readFile(watFile, "utf8");
  // The pinned compiler registers its literal names in order. Make that verified ABI table
  // constant before whole-module inlining, so per-element dispatch folds to numeric operations.
  const data = /\(data \$0 \(i32.const 0\) "([^"\\]*)"\)/.exec(wat)?.[1];
  if (!data || !wat.includes('(import "rt" "string_new" (func $fimport$0'))
    throw new Error("TN_WEB_BENCH_PERRY_NAMES_LAYOUT");
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
  const input = path.join(out, "perry-shared.wasm");
  await writeFile(
    input,
    importPerryMemory(new Uint8Array(await readFile(path.join(out, "perry-game.wasm"))), "rt"),
  );
  const linked = path.join(out, "perry-linked.wasm");
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
    [
      "wasm-merge",
      [
        input,
        "game",
        path.join(out, "perry-runtime.wasm"),
        "rt",
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
        "--always-inline-max-function-size=2000",
        "--inline-functions-with-loops",
        "-o",
        linked,
      ],
    ],
  ] as const) {
    const result = spawnSync(tool(command), args, { encoding: "utf8", timeout: 120_000 });
    if (result.status !== 0)
      throw new Error(
        `TN_WEB_BENCH_PERRY_LINK: ${command}: ${result.stderr}; ${result.error?.message ?? result.status}`,
      );
  }
  const module = new WebAssembly.Module(await readFile(linked));
  if (
    WebAssembly.Module.imports(module).some(
      ({ module, name }) => module === "rt" && (name === "mem_call" || name === "mem_call_i32"),
    )
  )
    throw new Error("TN_WEB_BENCH_PERRY_LINK_UNRESOLVED");
}
