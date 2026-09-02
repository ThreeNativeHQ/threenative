import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const runtime = readFileSync(join(import.meta.dirname, "..", "src", "runtime.cpp"), "utf8");

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf("{", start);
  assert.ok(open > start, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`unterminated body for ${signature}`);
}

function assertHostGapPeriodRecording(source) {
  assert.match(source, /struct\s+Sample\s*\{[\s\S]*uint64_t\s+periodMicros\s*=\s*0;/u);
  assert.doesNotMatch(source, /std::vector\s*<\s*uint64_t\s*>\s+periodMicros_/u);

  const noteRafBegin = functionBody(source, "void noteRafBegin()");
  const closeFrame = functionBody(source, "void closeFrame()");
  const report = functionBody(source, "void report()");
  const positiveGuard = noteRafBegin.search(/period\.count\(\)\s*>\s*0/u);
  const assignment = noteRafBegin.search(
    /current_\.periodMicros\s*=\s*static_cast\s*<\s*uint64_t\s*>\s*\(\s*period\.count\(\s*\)\s*\)/u,
  );

  assert.ok(positiveGuard >= 0, "noteRafBegin must recognize a positive elapsed period");
  assert.ok(assignment >= 0, "noteRafBegin must assign the positive period to current_.periodMicros");
  assert.ok(assignment > positiveGuard, "the period assignment must stay behind the positive guard");
  assert.match(closeFrame, /current_\.periodMicros\s*==\s*0/u);
  assert.match(
    closeFrame,
    /const\s+bool\s+hitched\s*=\s*current_\.periodMicros\s*>\s*kHitchPeriodMicros;/u,
  );
  assert.match(closeFrame, /samples_\.push_back\s*\(\s*current_\s*\)/u);
  assert.match(
    report,
    /for\s*\(\s*const\s+Sample&\s+sample\s*:\s*samples_\s*\)\s*\{[\s\S]*if\s*\(\s*sample\.periodMicros\s*>\s*0\s*\)/u,
  );
}

test("host-gap period samples stay attached to the frame sample they describe", () => {
  assertHostGapPeriodRecording(runtime);

  const withoutAssignment = runtime.replace(
    /current_\.periodMicros\s*=\s*static_cast\s*<\s*uint64_t\s*>\s*\(\s*period\.count\(\s*\)\s*\)\s*;/u,
    "/* removed by the period-recording negative control */",
  );
  assert.notEqual(withoutAssignment, runtime, "negative control must remove the period assignment");
  assert.throws(
    () => assertHostGapPeriodRecording(withoutAssignment),
    /noteRafBegin must assign the positive period/u,
    "the contract must fail when noteRafBegin stops recording the period",
  );
});
