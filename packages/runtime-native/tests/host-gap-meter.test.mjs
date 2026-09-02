import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const runtime = readFileSync(join(import.meta.dirname, "..", "src", "runtime.cpp"), "utf8");

test("host-gap period samples stay attached to the frame sample they describe", () => {
  assert.match(runtime, /struct Sample\s*\{[\s\S]*uint64_t periodMicros = 0;/u);
  assert.doesNotMatch(runtime, /std::vector<uint64_t> periodMicros_/u);
  assert.match(
    runtime,
    /const bool hitched =\s*current_\.periodMicros > kHitchPeriodMicros;/u,
  );
  assert.match(
    runtime,
    /for \(const Sample& sample : samples_\) \{[\s\S]*if \(sample\.periodMicros > 0\)/u,
  );
});
