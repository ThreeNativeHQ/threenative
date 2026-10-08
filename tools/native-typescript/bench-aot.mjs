#!/usr/bin/env node
// The native-AOT benchmark driver (PRD-533, arm `native-aot`): compiles
// examples/engine-load-test/native-engine/l4-workload-aot.ts with the pinned Perry against the engine's
// C ABI (the facade in three/), links the render bridge, runs it and leaves the report the session
// writes. `pnpm bench:engines --arms native-cpp,native-aot` calls this, so the C++ driver and the
// compiled game run one workload and their difference is the binding overhead.
//
//   bench-aot.mjs --out <report.json> [--objects N] [--frames N] [--warmup N] [--width N] [--height N]
//
// The compiled binary is cached under <engine build>/three-bridge/bench-aot, keyed by the sources it
// was built from, so a second run of the same code only runs it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLedger } from "./patches.mjs";
import { provision } from "./provision.mjs";
import { compileWithPerry, stageProject } from "./run-corpus.mjs";
import { bridgeFor } from "./three-bridge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ENTRY = path.join(REPO, "examples/engine-load-test/native-engine/l4-workload-aot.ts");
const POSE = path.join(REPO, "examples/engine-load-test/src/l4-pose.ts");

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** Everything the binary is built from: a changed source, facade, adapter or bridge rebuilds it. */
export function sourceKey(files, engineBuild) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(fs.readFileSync(file));
  // The compiled game links the engine's archives: a rebuilt engine must rebuild it, or it would run
  // against the engine it was first linked with.
  if (engineBuild !== undefined)
    for (const name of fs
      .readdirSync(engineBuild)
      .filter((entry) => /^lib.*\.a$/.test(entry))
      .sort())
      hash.update(`${name}:${fs.statSync(path.join(engineBuild, name)).mtimeMs}`);
  return hash.digest("hex").slice(0, 16);
}

export function parseArgs(args) {
  const options = { objects: 4096, frames: 600, warmup: 120, width: 1280, height: 720 };
  let out;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--out") out = path.resolve(value);
    else if (
      flag in { "--objects": 1, "--frames": 1, "--warmup": 1, "--width": 1, "--height": 1 }
    ) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1)
        throw named("TN_BENCH_AOT_USAGE", `${flag} must be a positive integer, got '${value}'`);
      options[flag.slice(2)] = number;
    } else throw named("TN_BENCH_AOT_USAGE", `unknown argument ${flag}`);
    i += 1;
  }
  if (out === undefined) throw named("TN_BENCH_AOT_USAGE", "--out <report.json> is required");
  return { ...options, out };
}

async function build(exe) {
  const info = await provision({ patches: loadLedger().patches, log: () => {} });
  const bridge = await bridgeFor({ render: true, engineBuild: process.env.TN_NATIVE_ENGINE_BUILD });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tn-bench-aot-"));
  try {
    const project = await stageProject({
      entry: ENTRY,
      modules: [ENTRY, POSE],
      tmp,
      three: true,
      bridge,
    });
    const env = {
      ...process.env,
      ...Object.fromEntries([["PERRY_CACHE_DIR", path.join(tmp, ".perry")]]),
    };
    const compiled = compileWithPerry({ perry: info.binaryPath, project, out: exe, env });
    if (!compiled.ok) throw named("TN_BENCH_AOT_COMPILE", compiled.error);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const engineBuild =
    process.env.TN_NATIVE_ENGINE_BUILD ?? path.join(REPO, "packages/runtime-native/build/tn-linux");
  const bridgeDir = path.join(engineBuild, "three-bridge", "bench-aot");
  await fsp.mkdir(bridgeDir, { recursive: true });
  const key = sourceKey(
    [
      ENTRY,
      POSE,
      ...["three.ts", "three-aot.ts", "tn_three_bench.cpp", "tn_three_shim.c"].map((name) =>
        path.join(HERE, "three", name),
      ),
      path.join(HERE, "three", "perry-adapter", "src", "lib.rs"),
      path.join(HERE, "three", "perry-adapter", "package.json"),
    ],
    engineBuild,
  );
  const exe = path.join(bridgeDir, `l4-workload-aot-${key}`);
  if (!fs.existsSync(exe)) await build(exe);
  await fsp.rm(options.out, { force: true });
  const run = spawnSync(exe, [], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ...Object.fromEntries([
        ["TN_BENCH_OBJECTS", String(options.objects)],
        ["TN_BENCH_FRAMES", String(options.frames - options.warmup)],
        ["TN_BENCH_WARMUP", String(options.warmup)],
        ["TN_BENCH_WIDTH", String(options.width)],
        ["TN_BENCH_HEIGHT", String(options.height)],
        ["TN_BENCH_REPORT", options.out],
      ]),
    },
  });
  if (run.status !== 0 || !fs.existsSync(options.out))
    throw named(
      "TN_BENCH_AOT_RUN",
      `the compiled game exited ${run.status}: ${(run.stderr || run.stdout).split("\n").slice(-4).join(" | ")}`,
    );
  process.stdout.write(`${options.out}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
