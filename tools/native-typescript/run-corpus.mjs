#!/usr/bin/env node
// Run the native-TypeScript language corpus twice and compare.
//
//   --reference               run each case with tsx, compare stdout and exit to <case>.expected
//   --native --target <triple> compile each case with the pinned compiler to an
//                              executable and compare stdout and exit to <case>.expected
//   --build-only              link every case and run none of them
//   --out <dir>               where a cross target's artifacts land (default
//                              artifacts/native-typescript, ignored by git)
//   --case <name>             run only one case
//   --without-patches         run the native side against the toolchain exactly as upstream ships
//                              it (patches.json applied to none of it), then require the red case
//                              set to equal the set patches.json declares, and exit 1 naming the
//                              difference when it does not
//   --expect-compile-error    the selected cases must be compile-error cases (their
//                              .expected holds `# compile-error <text>`; nothing runs)
//
// A cross target is a file in targets/ whose `triple` names it (PRD-507): `--target
// aarch64-linux-android` reads targets/android-arm64.json for the ABI, the API level, the page size
// and the pinned GC, and links with the NDK's own driver, because the pinned compiler's link step
// drives ld.lld with the host's search paths and finds no Android crt objects, libc++ or
// compiler-rt builtins. Such a run leaves one <case>.so per linked case under <out>/<abi-ish>/.
//
// Each `<case>.expected` holds the reference stdout, optionally followed by a
// `# exit <n>` line naming the reference exit code (absent means 0).
// A native compile or link failure is a named failure (TN_NATIVE_TS_COMPILE
// <case>: <first error line>) and is never skipped. A `.ts` entry with no
// `.expected` is a named failure, not a skip. alloc-loop additionally fails
// when its peak resident set exceeds 512 MB.
//
// A case that imports "three" is game code against the engine (PRD-506): the reference
// build resolves "three" to the workspace's pinned three@<catalog>, the native build to
// three/three.ts linked with three/tn_three_shim.c and the engine's static libraries from
// TN_NATIVE_ENGINE_BUILD (default packages/runtime-native/build/tn-linux). The case's own
// source is never edited.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ENGINE_LIBS, buildStrict } from "../../packages/runtime-native/scripts/package-strict.mjs";
import { androidLinker, ensureAndroidGc, findTarget, resolveNdk } from "./android.mjs";
import { compareRedToDeclared, loadLedger } from "./patches.mjs";
import { provision } from "./provision.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "corpus");
const REPO = path.resolve(HERE, "..", "..");
const DEFAULT_OUT = path.join(REPO, "artifacts", "native-typescript");
const RSS_LIMIT_BYTES = 512 * 1024 * 1024;
const IMPORT_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
const THREE_IMPORT_RE = /\bfrom\s*["']three["']/g;

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

/**
 * Names a case imports from "three" or a "three/..." subpath that the catalog does not mark
 * supported: each fails the build as TN_NATIVE_TS_UNSUPPORTED_EXPORT <specifier>#<name>, with the
 * catalog's own diagnostic when it records one, before anything compiles.
 */
export function unsupportedThreeImports(source, catalog) {
  const entries = new Map(catalog.entries.map((entry) => [entry.name, entry]));
  const refused = [];
  for (const match of source.matchAll(
    /\bimport\s*\{([^}]*)\}\s*from\s*["'](three(?:\/[\w-]+)?)["']/g,
  )) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (!name) continue;
      const entry = entries.get(name);
      if (entry?.status?.kind === "supported") continue;
      const diagnostic = entry?.status?.diagnostic
        ? ` (${entry.status.diagnostic})`
        : entry
          ? ""
          : " (not in the catalog)";
      refused.push(`TN_NATIVE_TS_UNSUPPORTED_EXPORT ${match[2]}#${name}${diagnostic}`);
    }
  }
  return refused;
}

function importsThree(file) {
  return /\bfrom\s*["']three["']/.test(fs.readFileSync(file, "utf8"));
}

/**
 * A case that imports "three" is built the way a strict game is (package-strict.mjs): the facade
 * staged as its "three" module, the TypeScript compiled to objects and linked with the shim, the
 * hooks and the engine's archives through the host C++ driver (tslang's own link step takes no
 * C++ archives). The corpus checks behaviour, so it writes no identity manifest.
 */
function linkWithEngine({ name, entry, modules, tmp, triple, compileErrors, info }) {
  const { errors } = buildStrict({
    name,
    entry,
    modules: modules.slice(1),
    outDir: tmp,
    engineBuild: process.env.TN_NATIVE_ENGINE_BUILD,
    compiler: {
      binaryPath: info.binaryPath,
      identity: `tslang ${info.lock.tag} ${info.artifact.sha256}`,
    },
    triple,
    manifest: false,
  });
  compileErrors.push(...errors.map((error) => error.replace(path.join(CORPUS, ""), "")));
}

/** The workspace's pinned three, resolved the way the fixture reference runner resolves it. */
function pinnedThreeModuleUrl() {
  const pinned = /^\s*three:\s*([^\s#]+)/m.exec(
    fs.readFileSync(path.join(REPO, "pnpm-workspace.yaml"), "utf8"),
  )?.[1];
  const entry = createRequire(path.join(REPO, "packages", "core", "package.json")).resolve("three");
  const build = path.dirname(entry);
  const version = JSON.parse(
    fs.readFileSync(path.join(build, "..", "package.json"), "utf8"),
  ).version;
  if (version !== pinned)
    throw named(
      "TN_NATIVE_TS_THREE_MISMATCH",
      `packages/core links three ${version}, the catalog pins ${pinned}`,
    );
  return pathToFileURL(path.join(build, "three.module.js")).href;
}

/** Splits a `.expected` file into its stdout bytes and its stored reference exit code. */
export function parseExpected(buffer) {
  const text = buffer.toString("utf8");
  // A native-only case: the build must fail naming this text, and nothing runs.
  const compileError = /^# compile-error (.+)$/m.exec(text)?.[1];
  if (compileError !== undefined) return { compileError, exit: 0, stdout: Buffer.alloc(0) };
  // A case that uses the native-only "three-aot" hooks: compared on the native build alone.
  if (/^# native-only\r?\n/.test(text)) {
    const rest = Buffer.from(text.replace(/^# native-only\r?\n/, ""), "utf8");
    return { ...parseExpected(rest), nativeOnly: true };
  }
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
  let file = path.join(CORPUS, `${name}.ts`);
  const expected = parseExpected(fs.readFileSync(expectedPath(name)));
  if (expected.compileError !== undefined || expected.nativeOnly)
    return { ok: true, notApplicable: true };
  if (importsThree(file)) {
    const staged = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tn-ref-three-")), `${name}.ts`);
    fs.writeFileSync(
      staged,
      fs.readFileSync(file, "utf8").replace(THREE_IMPORT_RE, `from "${pinnedThreeModuleUrl()}"`),
    );
    file = staged;
  }
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

/**
 * The compiled form of one case. The host target compiles the entry straight to an executable and
 * hands the module objects to it with `--obj`; a cross target emits every object and leaves the
 * link to the toolchain that owns the target's sysroot, the way the strict game build does. A
 * cross-built case that imports "three" gets the facade staged beside its entry, as buildStrict
 * stages it, because the corpus resolves "three" from beside the case itself.
 */
function emitCase({ entry, exe, modules, name, objects, tmp, triple, cross, compile }) {
  let sources = modules.slice(1);
  let entrySource = entry;
  if (cross && importsThree(entry)) {
    const staged = path.join(tmp, "src");
    const facade = [
      "three.ts",
      ...(/\bfrom\s*["']three-aot["']/u.test(fs.readFileSync(entry, "utf8"))
        ? ["three-aot.ts"]
        : []),
    ];
    fs.mkdirSync(staged, { recursive: true });
    for (const file of facade)
      fs.copyFileSync(path.join(HERE, "three", file), path.join(staged, file));
    entrySource = path.join(staged, path.basename(entry));
    fs.copyFileSync(entry, entrySource);
    sources = [...facade.map((file) => path.join(staged, file)), ...modules.slice(1)];
  }
  for (const source of sources) {
    const object = path.join(tmp, `${path.basename(source, ".ts")}.o`);
    compile(source, ["--emit=obj", source, "-relocation-model=pic", ...triple, `-o=${object}`]);
    objects.push(object);
  }
  if (!cross) {
    compile(entry, [
      "--emit=exe",
      entry,
      "-relocation-model=pic",
      ...triple,
      `-o=${exe}`,
      ...objects.map((object) => `--obj=${object}`),
    ]);
    return;
  }
  const main = path.join(tmp, `${name}.main.o`);
  compile(entrySource, [
    "--emit=obj",
    "--entry-point",
    entrySource,
    "-relocation-model=pic",
    ...triple,
    `-o=${main}`,
  ]);
  objects.push(main);
}

async function runNative(name, info, target, plan = {}) {
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

  const exe = path.join(tmp, name);
  const objects = [];
  const refusedImports = unsupportedThreeImports(
    fs.readFileSync(entry, "utf8"),
    JSON.parse(
      fs.readFileSync(path.join(REPO, "packages", "three-native", "api", "catalog.json"), "utf8"),
    ),
  );
  if (refusedImports.length > 0) {
    compileErrors.push(...refusedImports);
  } else if (importsThree(entry) && plan.link === undefined) {
    linkWithEngine({ name, entry, modules, tmp, triple, compileErrors, info });
  } else {
    emitCase({
      entry,
      exe,
      modules,
      name,
      objects,
      tmp,
      triple,
      cross: plan.link !== undefined,
      compile,
    });
  }

  const expectedCompile = parseExpected(fs.readFileSync(expectedPath(name))).compileError;
  if (expectedCompile !== undefined) {
    return compileErrors.some((error) => error.includes(expectedCompile))
      ? { ok: true, note: `refused at compile time: ${expectedCompile}` }
      : {
          ok: false,
          note: `expected the build to fail with ${expectedCompile}; got ${compileErrors[0] ?? "a successful build"}`,
        };
  }
  if (compileErrors.length > 0) {
    return { ok: false, note: `TN_NATIVE_TS_COMPILE ${name}: ${compileErrors[0]}` };
  }
  if (plan.link !== undefined) {
    if (plan.blockedThreeImport !== undefined && importsThree(entry))
      return { ok: false, note: `TN_NATIVE_TS_TARGET_BLOCKED ${name}: ${plan.blockedThreeImport}` };
    const out = path.join(plan.outDir, plan.target.output.replace("{case}", name));
    const error = plan.link(objects, out);
    return error === undefined
      ? { ok: true, note: `linked ${path.relative(REPO, out)}` }
      : { ok: false, note: `TN_NATIVE_TS_LINK ${name}: ${error}` };
  }
  if (plan.buildOnly) return { ok: true, note: "linked, not run (--build-only)" };

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

/**
 * What a cross target links with: the NDK its target file pins, the GC runtime cross-built for it,
 * and one output directory. A case that imports "three" is refused here, naming what is missing —
 * the engine archives exist for no Android build tree, and the three-import link step
 * (package-strict.mjs) compiles the shim and the hooks with the host driver.
 */
async function crossPlan(target, outDir) {
  const ndk = resolveNdk(target);
  const gc = await ensureAndroidGc(target, {
    ndk,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  const dir = path.join(outDir, target.outDir);
  await fsp.mkdir(dir, { recursive: true });
  const engineBuild = path.join(
    REPO,
    "packages",
    "runtime-native",
    "build",
    `android-core-${target.abi}`,
  );
  const missing = ENGINE_LIBS.filter(
    (lib) => !fs.existsSync(path.join(engineBuild, `lib${lib}.a`)),
  ).map((lib) => `lib${lib}.a`);
  return {
    target,
    outDir: dir,
    link: androidLinker(target, { ndk, gc }),
    blockedThreeImport:
      missing.length === 0
        ? undefined
        : `its TypeScript objects cross-compiled, but ${missing.join(", ")} exist for no ${target.abi} engine build and the three-import link step uses the host driver`,
    summary: (rows) => {
      const ok = rows.filter((row) => row.native === "PASS").length;
      const libraries = fs.readdirSync(dir).filter((file) => file.endsWith(".so")).length;
      return `${target.triple}: NDK ${ndk.version}, ${target.gc.name} ${target.gc.version} cross-built, ${target.maxPageSize}-byte pages — ${ok}/${rows.length} cases ok, ${libraries} libraries in ${path.relative(REPO, dir)}`;
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const wantReference = args.includes("--reference");
  const wantNative = args.includes("--native");
  const buildOnly = args.includes("--build-only");
  const withoutPatches = args.includes("--without-patches");
  let target;
  let filter;
  let outDir = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target") target = args[++i];
    else if (args[i] === "--case") filter = args[++i];
    else if (args[i] === "--out") outDir = path.resolve(args[++i]);
  }
  if (!wantReference && !wantNative) {
    throw named(
      "TN_NATIVE_TS_USAGE",
      "pass --reference and/or --native [--target <triple>] [--build-only] [--without-patches] [--case <name>]",
    );
  }
  if (withoutPatches && !wantNative) {
    throw named(
      "TN_NATIVE_TS_USAGE",
      "--without-patches compares the native red set against the ledger, so it needs --native",
    );
  }
  const cross = wantNative && target !== undefined && findTarget(target) !== undefined;
  if (wantNative && target && !target.startsWith("x86_64-linux") && !cross) {
    throw named(
      "TN_NATIVE_TS_TARGET",
      `unsupported target ${target}: pin it in tools/native-typescript/targets/<name>.json or use x86_64-linux-gnu`,
    );
  }

  const names = discoverCases(filter);
  if (names.length === 0) throw named("TN_NATIVE_TS_CASE", `no corpus case matches '${filter}'`);
  // --expect-compile-error states the selected cases are compile-error cases; a case that is not
  // one would pass for the wrong reason, so it stops the run.
  if (args.includes("--expect-compile-error")) {
    for (const name of names) {
      const note = missingExpectationNote(name);
      if (
        note === undefined &&
        parseExpected(fs.readFileSync(expectedPath(name))).compileError === undefined
      )
        throw named("TN_NATIVE_TS_USAGE", `${name} has no '# compile-error' expectation`);
    }
  }

  // The ledger is read for every native run: a malformed one fails closed rather than reading as
  // "no patches", and an ordinary native run is the patched one it declares.
  const ledger = wantNative ? loadLedger() : undefined;
  const info = wantNative
    ? await provision({ patches: withoutPatches ? [] : ledger.patches, log: () => {} })
    : undefined;
  const plan = cross ? await crossPlan(findTarget(target).target, outDir) : { buildOnly };
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
      // A native compile-error case has no reference run to compare.
      row.reference = result.notApplicable ? "n/a" : result.ok ? "PASS" : "FAIL";
      if (!result.ok) {
        failed = true;
        row.note = result.note;
      }
    }
    if (wantNative) {
      let result;
      try {
        result = await runNative(name, info, target, plan);
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
  if (cross) console.log(plan.summary(rows));
  if (withoutPatches) {
    reportRedSet(rows, ledger, info);
  } else if (failed) {
    process.exitCode = 1;
  }
}

/**
 * What `--without-patches` exists to answer: with the toolchain exactly as upstream ships it, are
 * the red cases the ones the ledger says each local patch is needed for? A declared case that stayed
 * green and a red case the ledger does not declare are both differences, and a difference exits 1
 * with the case names. So the exit code here is the comparison's, not the run's own.
 */
function reportRedSet(rows, ledger, info) {
  const red = rows
    .filter((row) => row.native === "FAIL")
    .map((row) => row.name)
    .sort();
  const verdict = compareRedToDeclared(ledger.declaredCases, red);
  const list = (names) => (names.length === 0 ? "none" : names.join(", "));
  console.log(`unpatched toolchain: ${info.binaryPath}`);
  console.log(
    `${ledger.patches.length} local patches (${ledger.patches.map((p) => p.id).join(", ") || "none applied"})`,
  );
  console.log(`declared red cases: ${list(ledger.declaredCases)}`);
  console.log(`red cases: ${list(red)}`);
  if (verdict.ok) {
    console.log("red set equals the declared set");
    return;
  }
  if (verdict.missing.length > 0) {
    console.log(`declared but green (the patch proves nothing): ${list(verdict.missing)}`);
  }
  if (verdict.extra.length > 0) {
    console.log(`red but undeclared (no ledger patch owns it): ${list(verdict.extra)}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
