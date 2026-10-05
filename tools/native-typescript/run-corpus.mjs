#!/usr/bin/env node
// Run the native-TypeScript language corpus twice and compare.
//
//   --reference               run each case with tsx, compare stdout to <case>.expected
//   --native --target <triple> compile each case with the pinned compiler to an
//                              executable and compare stdout and exit code
//   --case <name>             run only one case
//
// A native compile or link failure is a named failure (TN_NATIVE_TS_COMPILE
// <case>: <first error line>) and is never skipped. alloc-loop additionally
// fails when its peak resident set exceeds 512 MB.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provision } from "./provision.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "corpus");
const REPO = path.resolve(HERE, "..", "..");
const RSS_LIMIT_BYTES = 512 * 1024 * 1024;
const IMPORT_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

// Environment variable names are SCREAMING_SNAKE and must keep that spelling.
function mergeEnv(base, entries) {
  const env = { ...base };
  for (const [key, value] of entries) env[key] = value;
  return env;
}

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function discoverCases(filter) {
  const names = fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith(".expected"))
    .map((f) => f.slice(0, -".expected".length))
    .sort();
  return filter ? names.filter((n) => n === filter) : names;
}

function resolveModule(fromFile, spec) {
  if (!spec.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw named("TN_NATIVE_TS_IMPORT", `${fromFile}: cannot resolve import '${spec}'`);
}

function collectModules(entry) {
  const seen = new Set();
  const ordered = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    ordered.push(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveModule(file, match[1] ?? match[2]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return ordered;
}

function runReference(name) {
  const file = path.join(CORPUS, `${name}.ts`);
  const expected = fs.readFileSync(path.join(CORPUS, `${name}.expected`));
  const run = spawnSync("pnpm", ["exec", "tsx", path.relative(REPO, file)], {
    cwd: REPO,
    env: mergeEnv(process.env, [
      ["NO_COLOR", "1"],
      ["FORCE_COLOR", "0"],
    ]),
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const actual = run.stdout ?? Buffer.alloc(0);
  const ok = actual.equals(expected);
  return {
    ok,
    note: ok
      ? ""
      : `stdout mismatch (exit ${run.status}): expected ${expected.length}B, got ${actual.length}B`,
    exit: run.status ?? -1,
  };
}

async function runNative(name, info) {
  const entry = path.join(CORPUS, `${name}.ts`);
  const modules = collectModules(entry);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tn-native-ts-"));
  const root = path.dirname(info.binaryPath);
  const env = mergeEnv(process.env, [
    ["GC_LIB_PATH", root],
    ["TSLANG_LIB_PATH", root],
    ["DEFAULT_LIB_PATH", root],
  ]);
  const compileErrors = [];
  const compile = (file, args) => {
    const run = spawnSync(info.binaryPath, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env,
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    const firstError = output.split("\n").find((line) => line.includes("error:"));
    if (run.status !== 0 || firstError) {
      compileErrors.push(
        (firstError ?? `compiler exited ${run.status}`).replace(path.join(CORPUS, ""), ""),
      );
    }
  };

  const objects = [];
  for (const module of modules.slice(1)) {
    const object = path.join(tmp, `${path.basename(module, ".ts")}.o`);
    compile(module, ["--emit=obj", module, "-relocation-model=pic", `-o=${object}`]);
    objects.push(object);
  }
  const exe = path.join(tmp, name);
  compile(entry, [
    "--emit=exe",
    entry,
    "-relocation-model=pic",
    `-o=${exe}`,
    ...objects.map((object) => `--obj=${object}`),
  ]);

  if (compileErrors.length > 0) {
    return { ok: false, note: `TN_NATIVE_TS_COMPILE ${name}: ${compileErrors[0]}` };
  }

  const measured = await runExecutable(
    exe,
    mergeEnv(env, [["LD_LIBRARY_PATH", root]]),
    name === "alloc-loop",
  );
  const expected = fs.readFileSync(path.join(CORPUS, `${name}.expected`));

  if (!measured.stdout.equals(expected)) {
    return {
      ok: false,
      note: `stdout mismatch (exit ${measured.status}): expected ${expected.length}B, got ${measured.stdout.length}B`,
    };
  }
  const reference = runReference(name);
  if (measured.status !== reference.exit) {
    return {
      ok: false,
      note: `exit mismatch: reference ${reference.exit}, native ${measured.status}`,
    };
  }
  if (name === "alloc-loop" && measured.peakRssBytes > RSS_LIMIT_BYTES) {
    return {
      ok: false,
      note: `peak RSS ${(measured.peakRssBytes / (1024 * 1024)).toFixed(1)} MB over 512 MB`,
    };
  }
  return {
    ok: true,
    note:
      name === "alloc-loop"
        ? `peak RSS ${(measured.peakRssBytes / (1024 * 1024)).toFixed(1)} MB`
        : "",
  };
}

function runExecutable(exe, env, measureRss) {
  return new Promise((resolve) => {
    const child = spawn(exe, [], { env });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    let peakRssBytes = 0;
    let timer;
    if (measureRss) {
      timer = setInterval(() => {
        try {
          const status = fs.readFileSync(`/proc/${child.pid}/status`, "utf8");
          const match = /VmHWM:\s+(\d+) kB/.exec(status);
          if (match) peakRssBytes = Math.max(peakRssBytes, Number(match[1]) * 1024);
        } catch {
          // process already gone
        }
      }, 5);
    }
    child.on("close", (status) => {
      if (timer) clearInterval(timer);
      resolve({ stdout: Buffer.concat(stdout), stderr, status: status ?? -1, peakRssBytes });
    });
  });
}

function printTable(rows) {
  const widths = { case: 4, reference: 9, native: 6, note: 4 };
  for (const row of rows) {
    widths.case = Math.max(widths.case, row.name.length);
    widths.reference = Math.max(widths.reference, (row.reference ?? "-").length);
    widths.native = Math.max(widths.native, (row.native ?? "-").length);
    widths.note = Math.max(widths.note, row.note.length);
  }
  const line = (name, reference, native, note) =>
    `${name.padEnd(widths.case)}  ${reference.padEnd(widths.reference)}  ${native.padEnd(widths.native)}  ${note}`;
  console.log(line("case", "reference", "native", "note"));
  console.log(
    `${"-".repeat(widths.case)}  ${"-".repeat(widths.reference)}  ${"-".repeat(widths.native)}  ${"-".repeat(widths.note)}`,
  );
  for (const row of rows) {
    console.log(line(row.name, row.reference ?? "-", row.native ?? "-", row.note));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantReference = args.includes("--reference");
  const wantNative = args.includes("--native");
  let target;
  let filter;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target") target = args[++i];
    else if (args[i] === "--case") filter = args[++i];
  }
  if (!wantReference && !wantNative) {
    throw named(
      "TN_NATIVE_TS_USAGE",
      "pass --reference and/or --native [--target <triple>] [--case <name>]",
    );
  }
  if (wantNative && target && !target.startsWith("x86_64-linux")) {
    throw named(
      "TN_NATIVE_TS_TARGET",
      `unsupported target ${target} (only x86_64-linux is pinned)`,
    );
  }

  const names = discoverCases(filter);
  if (names.length === 0) throw named("TN_NATIVE_TS_CASE", `no corpus case matches '${filter}'`);

  const info = wantNative ? await provision({ log: () => {} }) : undefined;
  const rows = [];
  let failed = false;
  for (const name of names) {
    const row = {
      name,
      reference: wantReference ? "PASS" : undefined,
      native: undefined,
      note: "",
    };
    if (wantReference) {
      const result = runReference(name);
      row.reference = result.ok ? "PASS" : "FAIL";
      if (!result.ok) {
        failed = true;
        row.note = result.note;
      }
    }
    if (wantNative) {
      const result = await runNative(name, info);
      row.native = result.ok ? "PASS" : "FAIL";
      if (!result.ok) {
        failed = true;
        row.note = row.note ? `${row.note}; ${result.note}` : result.note;
      } else if (result.note) {
        row.note = result.note;
      }
    }
    rows.push(row);
  }
  printTable(rows);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
