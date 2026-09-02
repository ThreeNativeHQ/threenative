import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { checkSourceList } from "../scripts/check-source-list.mjs";

const root = join(import.meta.dirname, "..");
const cmake = readFileSync(join(root, "CMakeLists.txt"), "utf8");
const sourceListScript = readFileSync(join(root, "scripts/check-source-list.mjs"), "utf8");

test("every native C++ source is listed or explicitly excluded", () => {
  const report = checkSourceList({
    cmakeSource: cmake,
    sourceRoot: join(root, "src"),
  });
  assert.deepEqual(report.unlisted, []);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.excluded, ["src/gltf/gltf_loader.cpp", "src/utils/cgltf_impl.cpp"]);
  assert.match(cmake, /check-source-list\.mjs/u);
  assert.match(sourceListScript, /src\/gltf\/gltf_loader\.cpp/u);
  assert.match(sourceListScript, /src\/utils\/cgltf_impl\.cpp/u);
});

test("the source-list guard fails closed for a newly added unlisted source", () => {
  const report = checkSourceList({
    cmakeSource: cmake,
    sourcePaths: ["src/runtime.cpp", "src/new-unlisted.cpp"],
  });
  assert.deepEqual(report.unlisted, ["src/new-unlisted.cpp"]);
});
