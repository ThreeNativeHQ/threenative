import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function collectJsVisibleRegistrations(source) {
  return new Set([
    ...[...source.matchAll(/(?:installBinding|installGlobalBinding)\([\s\S]*?"WebGPU",\s*"([^"]+)"/gu)].map(
      (match) => match[1],
    ),
    ...[...source.matchAll(/\{"GPUCanvasContext",\s*"([^"]+)"/gu)].map((match) => match[1]),
    ...[...source.matchAll(/newFunction\(\s*"([^"]+)"/gu)].map((match) => match[1]),
  ]);
}

test("JS-visible binding names and thrown-error trace stay stable", () => {
  const trace = JSON.parse(read("tests/fixtures/webgpu-bindings-trace.json"));
  const source = [
    read("src/webgpu/bindings.cpp"),
    read("src/webgpu/registration_table.cpp"),
    read("src/webgpu/wrapper_factories.cpp"),
  ].join("\n");
  const registrations = [...collectJsVisibleRegistrations(source)].sort();

  assert.deepEqual(registrations, trace.registrations);
  for (const error of trace.errors) {
    assert.ok(source.includes(error), `missing JS-visible error trace: ${error}`);
  }
  assert.equal(trace.errors.length, 43);
});
