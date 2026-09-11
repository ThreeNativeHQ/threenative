import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { nativeCoverageEvidenceDigest } from "../scripts/native-coverage-evidence.mjs";

/**
 * What the source digest is allowed to notice.
 *
 * It exists so a change that could move measured native coverage forces a re-measure. Coverage
 * comes from ctest running compiled binaries and llvm-cov reading their profiles, so the C++ under
 * `tests/` counts and so do the fixtures those binaries read. The Node tests vitest collects do
 * not: `scripts/measure-native-coverage.mjs` never reads them.
 *
 * Hashing them anyway cost a restamp on every pull request that touched a `.test.mjs`, and because
 * the digest lives on one generated line those restamps then conflicted against each other. Seven
 * pull requests hit that in one evening.
 */
const runtimeRoot = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");

function withTempFile(relative, contents, run) {
  const target = join(runtimeRoot, relative);
  writeFileSync(target, contents);
  try {
    return run();
  } finally {
    rmSync(target, { force: true });
  }
}

test("a vitest-collected test under tests/ does not move the digest", () => {
  const before = nativeCoverageEvidenceDigest(runtimeRoot);
  const after = withTempFile(
    "tests/zz-digest-scope-probe.test.mjs",
    "import { test } from 'vitest';\ntest('probe', () => {});\n",
    () => nativeCoverageEvidenceDigest(runtimeRoot),
  );
  assert.equal(after, before, "a Node test cannot change measured native coverage");
});

test("a C++ test source under tests/ does move the digest", () => {
  const before = nativeCoverageEvidenceDigest(runtimeRoot);
  const after = withTempFile("tests/zz_digest_scope_probe.cpp", "int main() { return 0; }\n", () =>
    nativeCoverageEvidenceDigest(runtimeRoot),
  );
  assert.notEqual(after, before, "C++ under tests/ compiles into the binaries ctest measures");
});

test("a fixture a compiled test can read does move the digest", () => {
  const before = nativeCoverageEvidenceDigest(runtimeRoot);
  const after = withTempFile("tests/fixtures/zz-digest-scope-probe.json", "{}\n", () =>
    nativeCoverageEvidenceDigest(runtimeRoot),
  );
  assert.notEqual(after, before, "fixtures steer which branches the measured binaries execute");
});
