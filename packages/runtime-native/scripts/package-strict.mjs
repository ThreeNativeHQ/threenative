// The strict native build (PRD-530): a TypeScript game compiled ahead of time by the pinned tslang
// and linked against the engine's prebuilt static archives, with the identity manifest beside the
// executable. The compiler and the engine are inputs, never rebuilt here: a missing engine archive
// is refused, not built.
//
// Each step records the sha256 of its inputs in `<outDir>/.strict-cache/<step>.sha256` and is
// skipped when they match the last build, so a game-source-only edit recompiles the TypeScript
// objects and relinks, and nothing else runs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const THREE_DIR = path.join(REPO, "tools", "native-typescript", "three");
const NATIVE = path.join(REPO, "packages", "runtime-native");
export const ENGINE_LIBS = ["tn_engine_abi", "tn_engine_bindings", "tn_engine_scene", "tn_engine_foundation"];

/** The first error line of a tool run, or undefined when it succeeded. */
function defaultExec(tool, args, env) {
  const run = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const firstError = output.split("\n").find((line) => line.includes("error:"));
  if (run.status === 0 && !firstError) return undefined;
  return firstError ?? `${path.basename(tool)} exited ${run.status}: ${output.split("\n")[0]}`;
}

function digest(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(typeof part === "string" ? part : Buffer.from(part)).update("\0");
  return hash.digest("hex");
}

/**
 * Builds `<outDir>/<name>` from `entry` (and the relative modules it imports, `modules`), linked
 * with the three facade, its shim and hooks, and the engine archives in `engineBuild`.
 * `compiler` is the provisioned tslang: `{ binaryPath, identity }`, `identity` naming its version
 * and checksum. Returns the executable, the steps that ran, and the first errors (empty on success).
 */
export function buildStrict({
  name,
  entry,
  modules = [],
  outDir,
  engineBuild,
  compiler,
  triple = [],
  manifest = true,
  exec = defaultExec,
}) {
  const ran = [];
  const errors = [];
  const exe = path.join(outDir, name);
  engineBuild ??= path.join(NATIVE, "build", "tn-linux");
  const archives = ENGINE_LIBS.map((lib) => path.join(engineBuild, `lib${lib}.a`));
  const identityTool = path.join(engineBuild, "tn-native-engine-identity");
  for (const required of manifest ? [...archives, identityTool] : archives) {
    if (!fs.existsSync(required)) {
      errors.push(`TN_STRICT_ENGINE_MISSING: ${required}; build or install the engine first`);
      return { exe, ran, errors };
    }
  }
  const cache = path.join(outDir, ".strict-cache");
  fs.mkdirSync(cache, { recursive: true });
  const root = path.dirname(compiler.binaryPath);
  const env = { ...process.env, GC_LIB_PATH: root, TSLANG_LIB_PATH: root, DEFAULT_LIB_PATH: root };
  const engineDigest = digest(archives.map((archive) => fs.readFileSync(archive)));

  // Runs `work` unless the inputs digest matches the last successful run and every output exists.
  const step = (stepName, inputs, outputs, work) => {
    const keyFile = path.join(cache, `${stepName}.sha256`);
    const key = digest(inputs);
    if (outputs.every((output) => fs.existsSync(output)) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, "utf8") === key)
      return;
    ran.push(stepName);
    const before = errors.length;
    work();
    if (errors.length === before) fs.writeFileSync(keyFile, key);
    else fs.rmSync(keyFile, { force: true });
  };
  const run = (tool, args) => {
    const error = exec(tool, args, env);
    if (error !== undefined) errors.push(error);
  };

  // The TypeScript objects: one step, since each module's object depends on its imports' types.
  const facade = [path.join(THREE_DIR, "three.ts")];
  if (/\bfrom\s*["']three-aot["']/.test(fs.readFileSync(entry, "utf8"))) facade.push(path.join(THREE_DIR, "three-aot.ts"));
  const staged = path.join(outDir, "src");
  fs.mkdirSync(staged, { recursive: true });
  const sources = [...facade, ...modules, entry];
  const tsObjects = sources.map((file) =>
    path.join(outDir, file === entry ? `${name}.main.o` : `${path.basename(file, ".ts")}.o`),
  );
  step("typescript", [compiler.identity, ...triple, ...sources.map((file) => fs.readFileSync(file))], tsObjects, () => {
    // The facade stands beside the game as its "three" module; the game's own files stay where they are.
    for (const file of facade) fs.copyFileSync(file, path.join(staged, path.basename(file)));
    const stagedEntry = path.join(staged, path.basename(entry));
    fs.copyFileSync(entry, stagedEntry);
    sources.forEach((file, i) => {
      const source = facade.includes(file) ? path.join(staged, path.basename(file)) : file === entry ? stagedEntry : file;
      const entryPoint = file === entry ? ["--entry-point"] : [];
      run(compiler.binaryPath, ["--emit=obj", ...entryPoint, source, "-relocation-model=pic", ...triple, `-o=${tsObjects[i]}`]);
    });
  });

  const include = path.join(NATIVE, "include");
  const shim = path.join(outDir, "tn_three_shim.o");
  const shimSource = path.join(THREE_DIR, "tn_three_shim.c");
  step("shim", [fs.readFileSync(shimSource), fs.readFileSync(path.join(include, "threenative", "abi", "tn_abi.h"))], [shim], () =>
    run("cc", ["-c", "-fPIC", `-I${include}`, shimSource, "-o", shim]),
  );
  // The hooks include engine headers, so an engine change (new archives) rebuilds them.
  const hooks = path.join(outDir, "tn_three_hooks.o");
  const hooksSource = path.join(THREE_DIR, "tn_three_hooks.cpp");
  step("hooks", [fs.readFileSync(hooksSource), engineDigest], [hooks], () =>
    run("c++", ["-c", "-fPIC", "-std=c++20", `-I${include}`, `-I${path.join(NATIVE, "src")}`, hooksSource, "-o", hooks]),
  );
  if (errors.length > 0) return { exe, ran, errors };

  const objects = [...tsObjects, shim, hooks];
  step("link", [compiler.identity, engineDigest, ...objects.map((object) => fs.readFileSync(object))], [exe], () =>
    run("c++", [
      "-o",
      exe,
      ...objects,
      ...archives,
      `-L${path.join(root, "defaultlib", "lib", "release", "gc")}`,
      "-lTypeScriptDefaultLib",
      "-lTypeScriptDefaultLibCore",
      path.join(root, "libTypeScriptAsyncRuntime.a"),
      path.join(root, "libgc.a"),
      "-lpthread",
      "-ldl",
      "-lm",
    ]),
  );
  if (manifest && errors.length === 0) {
    const identity = `${exe}.identity`;
    step("identity", [compiler.identity, fs.readFileSync(identityTool)], [identity], () =>
      run(identityTool, ["--write", identity, "--compiler", compiler.identity, "--backend", "dawn"]),
    );
  }
  return { exe, ran, errors };
}
