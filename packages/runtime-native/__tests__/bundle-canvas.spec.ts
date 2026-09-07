import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "vitest";

test("native project prelude preserves independent canvases for loading text", () => {
  const bundler = readFileSync(new URL("../scripts/bundle.mjs", import.meta.url), "utf8");
  const prelude = bundler.match(/const nativePrelude = `([\s\S]*?)`;/u)?.[1];
  assert.ok(prelude, "the shipped project prelude must be exercised");
  const surface = { width: 1280, height: 720 };
  const document = {
    getElementById: () => ({}),
    querySelector: () => surface,
    createElement: (_tag: string) => ({ width: 300, height: 150 }),
  };
  runInNewContext(prelude, { document, canvas: surface });
  const text = document.createElement("canvas");
  text.width = 440;
  text.height = 64;
  assert.notEqual(text, surface, "a text canvas must not alias the presentation canvas");
  assert.deepEqual(surface, { width: 1280, height: 720 });
  assert.notEqual(document.createElement("canvas"), text);
});
