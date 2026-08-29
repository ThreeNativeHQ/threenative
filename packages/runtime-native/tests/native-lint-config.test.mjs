import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { runQuality } from "../../../scripts/check-quality.ts";

const runtimeRoot = new URL("..", import.meta.url).pathname;
const repoRoot = join(runtimeRoot, "..", "..");

test("should report no lint-coverage-hole for the native src tree", async () => {
  const tidy = readFileSync(join(runtimeRoot, ".clang-tidy"), "utf8");
  const format = readFileSync(join(runtimeRoot, ".clang-format"), "utf8");
  const cmake = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");

  assert.match(tidy, /bugprone-\*/u);
  assert.match(tidy, /cppcoreguidelines-pro-type-member-init/u);
  assert.match(tidy, /performance-\*/u);
  assert.match(tidy, /readability-identifier-naming/u);
  assert.match(tidy, /readability-identifier-naming\.ClassCase:\s*CamelCase/u);
  assert.match(
    tidy,
    /WarningsAsErrors:\s*'bugprone-use-after-move,readability-identifier-naming'/u,
  );
  assert.match(format, /BasedOnStyle/u);
  assert.match(cmake, /option\(TN_ENABLE_CLANG_TIDY/u);
  assert.match(cmake, /CMAKE_CXX_CLANG_TIDY/u);

  const findings = await runQuality(repoRoot);
  assert.equal(
    findings.some(
      ({ file, signal }) =>
        file === "packages/runtime-native/src" && signal === "lint-coverage-hole",
    ),
    false,
  );
});
