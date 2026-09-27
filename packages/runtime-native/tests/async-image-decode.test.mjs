import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Also runnable without workspace dependencies: node --test tests/async-image-decode.test.mjs.
const testApi = await import(process.env.VITEST ? "vitest" : "node:test");
const { test } = testApi;
const afterAll = testApi.afterAll ?? testApi.after;
const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = process.env.CXX || "c++";
const probe = spawnSync(compiler, ["--version"], { encoding: "utf8" });
const nativeTest = probe.error?.code === "ENOENT" ? test.skip : test;
let buildDirectory;
let executable;

afterAll(() => {
  if (buildDirectory) rmSync(buildDirectory, { recursive: true, force: true });
});

function contractBinary() {
  if (executable) return executable;
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr);
  buildDirectory = mkdtempSync(join(tmpdir(), "tn-image-decode-"));
  const output = join(buildDirectory, process.platform === "win32" ? "contract.exe" : "contract");
  const fixture = join(root, "tests/fixtures/async-image-decode");
  const built = spawnSync(
    compiler,
    [
      "-std=c++17",
      "-pthread",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-I",
      fixture,
      "-I",
      join(root, "include"),
      join(root, "src/webgpu/async_image_decode.cpp"),
      join(fixture, "contract.cpp"),
      "-o",
      output,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(built.status, 0, built.error?.message ?? `${built.stdout}\n${built.stderr}`);
  executable = output;
  return executable;
}

for (const [mode, description] of [
  ["yield", "completion delivery yields between polling turns"],
  ["backpressure", "a stalled consumer cannot accumulate every decoded texture"],
  ["shutdown", "shutdown never reenters a possibly destroyed JS engine"],
  ["shutdown-full", "shutdown wakes workers blocked by completed-image backpressure"],
  ["saturation", "queue saturation rejects asynchronously instead of decoding on the frame thread"],
  ["owner-lifetime", "a queued completion cannot use a destroyed owner after recreation"],
  ["shutdown-owner", "shutdown destroys in-flight callback captures on the owning thread"],
  ["allocation-failure", "RGBA allocation failure rejects, frees codec pixels, and preserves the worker"],
  ["missing-error", "codec failure without a diagnostic rejects safely"],
]) {
  nativeTest(description, () => {
    const result = spawnSync(contractBinary(), [mode], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`async image decode ${mode} passed`, "u"));
  });
}


test("bindings invalidate image-decode ownership before engine teardown", () => {
  const stateSource = readFileSync(join(root, "src/webgpu/bindings_state.h"), "utf8");
  const bindingsSource = readFileSync(join(root, "src/webgpu/bindings.cpp"), "utf8");
  assert.match(stateSource, /std::shared_ptr<AsyncImageDecodeOwner> imageDecodeOwner/u);
  const destroy = bindingsSource.indexOf("void destroyBindingsState");
  const invalidate = bindingsSource.indexOf("imageDecodeOwner->alive.store(false", destroy);
  const engineNull = bindingsSource.indexOf("state->engine = nullptr", destroy);
  assert.ok(destroy >= 0 && invalidate > destroy && engineNull > invalidate);
  const callback = bindingsSource.indexOf("[owner, callback](DecodedImage image)");
  const gate = bindingsSource.indexOf("if (!owner->alive.load", callback);
  const engineUse = bindingsSource.indexOf("auto* engine = owner->engine", callback);
  assert.ok(callback >= 0 && gate > callback && engineUse > gate);
  assert.equal(bindingsSource.indexOf("[state, callback](DecodedImage image)"), -1);
});
