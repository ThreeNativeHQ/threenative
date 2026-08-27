import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(root, "src/cli/main.cpp"), "utf8");
const steps = [
  "setupHeadlessEnvironment",
  "createConfiguredRuntime",
  "attachUiOverlayIfConfigured",
  "wirePlaytestMailboxBridge",
  "driveMainLoop",
];

function functionSource(name) {
  const signature = new RegExp(`\\b${name}\\s*\\([^;]*?\\)\\s*\\{`, "su");
  const match = signature.exec(source);
  assert.ok(match, `${name} must be defined`);
  const end = source.indexOf("\n}\n", match.index);
  assert.notEqual(end, -1, `${name} has no closing brace`);
  return source.slice(match.index, end + 2);
}

function lineCount(body) {
  return body.split("\n").length;
}

test("runScript keeps native startup and loop phases in their load-bearing order", () => {
  const body = functionSource("runScript");
  const calls = [
    ...body.matchAll(
      /\b(setupHeadlessEnvironment|createConfiguredRuntime|attachUiOverlayIfConfigured|wirePlaytestMailboxBridge|driveMainLoop)\s*\(/gu,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(calls, steps);
  assert.ok(
    body.indexOf("runtime->loadScript") < body.indexOf("driveMainLoop("),
    "the game script must load before mode dispatch starts",
  );
  assert.ok(lineCount(body) < 150, `runScript is ${lineCount(body)} lines`);
});

test("each extracted runScript phase stays bounded", () => {
  for (const step of steps) {
    const body = functionSource(step);
    assert.ok(lineCount(body) < 200, `${step} is ${lineCount(body)} lines`);
  }
});
