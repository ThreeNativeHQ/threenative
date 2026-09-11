import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { build, buildHelp, parseBuildArgs } from "../src/build.js";

const roots: string[] = [];
const savedEnv = new Map([
  ["THREENATIVE_RUNTIME_BINARY", process.env.THREENATIVE_RUNTIME_BINARY],
  ["THREENATIVE_RUNTIME_SOURCE", process.env.THREENATIVE_RUNTIME_SOURCE],
]);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  for (const [key, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

async function gameFixture() {
  const root = await makeTempDir("threenative-consumer-cli-");
  roots.push(root);
  Reflect.deleteProperty(process.env, "THREENATIVE_RUNTIME_BINARY");
  Reflect.deleteProperty(process.env, "THREENATIVE_RUNTIME_SOURCE");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "consumer-game", type: "module" }),
  );
  await writeFile(path.join(root, "src", "game.ts"), "export default { start() {} };\n");
  const runtime = path.join(root, "node_modules", "@threenative", "runtime-native");
  await mkdir(path.join(runtime, "scripts"), { recursive: true });
  await writeFile(
    path.join(runtime, "package.json"),
    JSON.stringify({ name: "@threenative/runtime-native", type: "module" }),
  );
  await writeFile(
    path.join(runtime, "scripts", "bundle.mjs"),
    `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const output = process.argv[process.argv.indexOf('--output') + 1];
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, 'export default { start() {} };');
`,
  );
  // Only the subprocess is a fixture: build(), argument parsing and config resolution are live.
  // The runtime suites separately exercise the real packagers' source/prebuilt decisions.
  for (const target of ["desktop", "android", "ios"]) {
    await writeFile(
      path.join(runtime, "scripts", `package-${target}.mjs`),
      `
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const output = process.argv[process.argv.indexOf('--output') + 1];
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, JSON.stringify(process.argv.slice(2)));
`,
    );
  }
  return root;
}

async function outputArgs(root: string, suffix = "") {
  return JSON.parse(
    await readFile(path.join(root, "dist-native", `consumer-game${suffix}`), "utf8"),
  ) as string[];
}

test("desktop consumer CLI delegates runtime discovery to the packager", async () => {
  const root = await gameFixture();
  await build({ cwd: root, target: "desktop" });
  assert.equal((await outputArgs(root)).includes("--runtime"), false);
});

test("desktop maintainer binary override is still passed explicitly and resolved", async () => {
  const root = await gameFixture();
  process.env.THREENATIVE_RUNTIME_BINARY = "./maintainer-runtime";
  process.env.THREENATIVE_RUNTIME_SOURCE = path.join(root, "checkout");
  await build({ cwd: root, target: "desktop" });
  const args = await outputArgs(root);
  assert.equal(args[args.indexOf("--runtime") + 1], path.resolve("./maintainer-runtime"));
});

test("a source override alone is not converted into an explicit desktop binary", async () => {
  const root = await gameFixture();
  process.env.THREENATIVE_RUNTIME_SOURCE = path.join(root, "checkout");
  await build({ cwd: root, target: "desktop" });
  assert.equal((await outputArgs(root)).includes("--runtime"), false);
});

test("Android public CLI parses and forwards explicit source-build opt-in", async () => {
  const root = await gameFixture();
  const parsed = parseBuildArgs(["build", "--target", "android", "--allow-source-build"]);
  assert.deepEqual(parsed, { target: "android", allowSourceBuild: true, viteArgs: [] });
  await build({ ...parsed, cwd: root });
  assert.equal(
    (await outputArgs(root, ".apk")).filter((arg) => arg === "--allow-source-build").length,
    1,
  );
});

test("Android consumer CLI never opts into source compilation implicitly", async () => {
  const root = await gameFixture();
  process.env.THREENATIVE_RUNTIME_SOURCE = path.join(root, "checkout");
  await build({ cwd: root, target: "android" });
  assert.equal((await outputArgs(root, ".apk")).includes("--allow-source-build"), false);
});

for (const target of ["web", "desktop", "ios"] as const) {
  test(`source-build flag cannot silently change a ${target} build`, async () => {
    assert.throws(
      () => parseBuildArgs(["build", "--target", target, "--allow-source-build"]),
      /--allow-source-build.*android/u,
    );
    await assert.rejects(
      build({ cwd: "/does-not-exist", target, allowSourceBuild: true }),
      /--allow-source-build.*android/u,
    );
  });
}

test("source-build opt-in does not swallow other invalid native flags", async () => {
  const options = parseBuildArgs([
    "build",
    "--target",
    "android",
    "--allow-source-build",
    "--unexpected",
  ]);
  await assert.rejects(build(options), /does not accept --unexpected/u);
});

test("ordinary web argument forwarding and default parse result remain unchanged", () => {
  assert.deepEqual(parseBuildArgs(["build"]), { target: "web", viteArgs: [] });
  assert.deepEqual(parseBuildArgs(["build", "--outDir", "web-dist"]), {
    target: "web",
    viteArgs: ["--outDir", "web-dist"],
  });
});

test("build help documents the explicit Android source-build opt-in", () => {
  assert.match(buildHelp(), /--allow-source-build.*[Aa]ndroid/u);
});
