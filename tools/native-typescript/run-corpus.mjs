#!/usr/bin/env node
// Run the native-TypeScript language corpus twice and compare.
//
//   --reference               run each case with tsx, compare stdout and exit to <case>.expected
//   --native --target <triple> compile each case with the pinned compiler to an
//                              executable and compare stdout and exit to <case>.expected
//   --case <name>             run only one case
//
// Each `<case>.expected` holds the reference stdout, optionally followed by a
// `# exit <n>` line naming the reference exit code (absent means 0).
// A native compile or link failure is a named failure (TN_NATIVE_TS_COMPILE
// <case>: <first error line>) and is never skipped. A `.ts` entry with no
// `.expected` is a named failure, not a skip. alloc-loop additionally fails
// when its peak resident set exceeds 512 MB.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

/** Splits a `.expected` file into its stdout bytes and its stored reference exit code. */
export function parseExpected(buffer) {
  const text = buffer.toString("utf8");
  const match = /(^|\n)# exit (\d+)\r?\n?$/.exec(text);
  if (match === null) return { exit: 0, stdout: buffer };
  const exit = Number(match[2]);
  const stripAt = match.index + match[1].length;
  return { exit, stdout: Buffer.from(text.slice(0, stripAt), "utf8") };
}

function expectedPath(name, corpusDir = CORPUS) {
  return path.join(corpusDir, `${name}.expected`);
}

/** A `.ts` case with no `.expected` beside it is a failure, never a silent skip. */
export function missingExpectationNote(name, corpusDir = CORPUS) {
  return fs.existsSync(expectedPath(name, corpusDir))
    ? undefined
    : `TN_NATIVE_TS_EXPECTED_MISSING ${name}: no ${name}.expected beside the case`;
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

/**
 * Corpus cases are the top-level `.ts` files no other case imports; a helper module
 * (`imports-cycle-inner.ts`) is imported and is not itself a case. A stray top-level `.ts`
 * therefore becomes a case, and a case with no `.expected` fails the run.
 */
function corpusCaseNames(corpusDir = CORPUS) {
  const files = fs
    .readdirSync(corpusDir)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const imported = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(corpusDir, file), "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveModule(path.join(corpusDir, file), match[1] ?? match[2]);
      if (resolved) imported.add(resolved);
    }
  }
  return files
    .filter((file) => !imported.has(path.join(corpusDir, file)))
    .map((file) => file.slice(0, -".ts".length));
}

export function discoverCases(filter, corpusDir = CORPUS) {
  const names = corpusCaseNames(corpusDir);
  return filter ? names.filter((name) => name === filter) : names;
}

function runReference(name) {
  const file = path.join(CORPUS, `${name}.ts`);
  const expected = parseExpected(fs.readFileSync(expectedPath(name)));
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
  const status = run.status ?? -1;
  if (!actual.equals(expected.stdout)) {
    return {
      ok: false,
      note: `stdout mismatch (exit ${status}): expected ${expected.stdout.length}B, got ${actual.length}B`,
      exit: status,
    };
  }
  if (status !== expected.exit) {
    return {
      ok: false,
      note: `exit mismatch: expected ${expected.exit}, reference ${status}`,
      exit: status,
    };
  }
  return { ok: true, note: "", exit: status };
}

async function runNative(name, info, target) {
  const missing = missingExpectationNote(name);
  if (missing !== undefined) return { ok: false, note: missing };

  const entry = path.join(CORPUS, `${name}.ts`);
  const modules = collectModules(entry);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tn-native-ts-"));
  const root = path.dirname(info.binaryPath);
  const env = mergeEnv(process.env, [
    ["GC_LIB_PATH", root],
    ["TSLANG_LIB_PATH", root],
    ["DEFAULT_LIB_PATH", root],
  ]);
  // `--target` reaches the compiler as its own triple flag (`--mtriple=`, per `tslang --help`);
  // without it the compiler emits for the host triple the pinned artifact was built for.
  const triple = target ? [`--mtriple=${target}`] : [];
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
    compile(module, ["--emit=obj", module, "-relocation-model=pic", ...triple, `-o=${object}`]);
    objects.push(object);
  }
  const exe = path.join(tmp, name);
  compile(entry, [
    "--emit=exe",
    entry,
    "-relocation-model=pic",
    ...triple,
    `-o=${exe}`,
    ...objects.map((object) => `--obj=${object}`),
  ]);

  if (compileErrors.length > 0) {
    return { ok: false, note: `TN_NATIVE_TS_COMPILE ${name}: ${compileErrors[0]}` };
  }

  const envWithLibs = mergeEnv(env, [["LD_LIBRARY_PATH", root]]);
  const measured =
    name === "alloc-loop"
      ? await runMeasured(exe, envWithLibs)
      : { ...(await runExecutable(exe, envWithLibs)), peakRssBytes: 0 };
  const expected = parseExpected(fs.readFileSync(expectedPath(name)));

  if (!measured.stdout.equals(expected.stdout)) {
    return {
      ok: false,
      note: `stdout mismatch (exit ${measured.status}): expected ${expected.stdout.length}B, got ${measured.stdout.length}B`,
    };
  }
  if (measured.status !== expected.exit) {
    return {
      ok: false,
      note: `exit mismatch: expected ${expected.exit}, native ${measured.status}`,
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

function runExecutable(exe, env) {
  return new Promise((resolve) => {
    const child = spawn(exe, [], { env });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ stdout: Buffer.concat(stdout), stderr, status: status ?? -1 });
    });
  });
}

/** Finds an executable by absolute path or on `PATH`; undefined when absent. */
function resolveExecutable(candidates) {
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (dir === "") continue;
      const full = path.join(dir, candidate);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        // next PATH entry
      }
    }
  }
  return undefined;
}

/**
 * Peak RSS, exactly, without sampling. `/usr/bin/time -f %M` reads the kernel's own
 * `getrusage`; when it is absent the `resource` module's `RUSAGE_CHILDREN.ru_maxrss` (the
 * largest waited-for child's high-water mark) is used. Polling `/proc/<pid>/status` misses a
 * process that peaks and exits between samples, and Node's `process.resourceUsage()` reports
 * `RUSAGE_SELF`, which never includes the child. When neither tool exists this fails closed.
 */
export async function runMeasured(exe, env, args = []) {
  const rssFile = path.join(os.tmpdir(), `tn-native-ts-rss-${randomUUID()}.txt`);
  try {
    const timeBin = resolveExecutable(["/usr/bin/time"]);
    const pythonBin = resolveExecutable(["/usr/bin/python3", "python3", "python"]);
    let run;
    if (timeBin !== undefined) {
      run = spawnSync(timeBin, ["-f", "%M", "-o", rssFile, exe, ...args], {
        env,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      });
    } else if (pythonBin !== undefined) {
      const script =
        "import resource,subprocess,sys; " +
        "p=subprocess.run(sys.argv[2:]); " +
        "open(sys.argv[1],'w').write(str(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)); " +
        "sys.exit(p.returncode)";
      run = spawnSync(pythonBin, ["-c", script, rssFile, exe, ...args], {
        env,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      });
    } else {
      throw named("TN_NATIVE_TS_RSS", "cannot measure peak RSS: no /usr/bin/time and no python3");
    }
    const peakRssKb = Number(fs.readFileSync(rssFile, "utf8").trim());
    if (!Number.isSafeInteger(peakRssKb) || peakRssKb <= 0) {
      throw named("TN_NATIVE_TS_RSS", `no peak RSS reported for ${exe}`);
    }
    return {
      peakRssBytes: peakRssKb * 1024,
      status: run.status ?? -1,
      stderr: (run.stderr ?? Buffer.alloc(0)).toString(),
      stdout: run.stdout ?? Buffer.alloc(0),
    };
  } finally {
    await fsp.rm(rssFile, { force: true });
  }
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
    const missing = missingExpectationNote(name);
    if (missing !== undefined) {
      failed = true;
      if (wantReference) row.reference = "FAIL";
      if (wantNative) row.native = "FAIL";
      row.note = missing;
      rows.push(row);
      continue;
    }
    if (wantReference) {
      const result = runReference(name);
      row.reference = result.ok ? "PASS" : "FAIL";
      if (!result.ok) {
        failed = true;
        row.note = result.note;
      }
    }
    if (wantNative) {
      let result;
      try {
        result = await runNative(name, info, target);
      } catch (error) {
        result = { ok: false, note: error instanceof Error ? error.message : String(error) };
      }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
