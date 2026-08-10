import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  assertHudReadoutChanged,
  assertScreenSpaceTextProof,
  layoutHudText,
  SCREEN_SPACE_TEXT,
} from "../conformance/scenes/shared/hud-geometry.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("row 30 proves the exact SCORE 1200 geometry floor and bounds", () => {
  const proof = layoutHudText(SCREEN_SPACE_TEXT);
  assert.doesNotThrow(() => assertScreenSpaceTextProof(proof));
  assert.equal(proof.brightGlyphs, 161);
  assert.deepEqual(proof.bounds, [0, 0, 58, 6]);
  assert.throws(() => assertScreenSpaceTextProof(layoutHudText("SCORE 1201")), /exactly SCORE 1200/u);
  assert.throws(() => layoutHudText("score 1200"), /Missing HUD glyph/u);
  assert.throws(() => layoutHudText("   "), /no bright glyph geometry/u);
});

test("row 31 fails closed unless text, count, and instance matrices all change", () => {
  const before = { count: 161, matrices: [1, 2, 3], text: "SCORE 1200" };
  const after = { count: 178, matrices: [1, 4, 3], text: "SCORE 8888" };
  assert.doesNotThrow(() => assertHudReadoutChanged(before, after));
  assert.throws(
    () => assertHudReadoutChanged(before, { ...after, count: before.count }),
    /instance count did not change/u,
  );
  assert.throws(
    () => assertHudReadoutChanged(before, { ...after, matrices: before.matrices }),
    /instance matrices did not change/u,
  );
  assert.throws(
    () => assertHudReadoutChanged(before, { ...after, text: before.text }),
    /state value did not change/u,
  );
});

test("rows 30 and 31 use one geometry source without CanvasTexture or target branches", () => {
  const files = ["hud-geometry.js", "screen-space-text.js", "hud-readout-updates.js"];
  const source = files
    .map((file) => readFileSync(join(root, "conformance/scenes/shared", file), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /CanvasTexture|document\.|window\.|navigator\.|process\.|android|desktop/u);
  assert.match(source, /new THREE\.InstancedMesh/u);
  assert.match(source, /assertHudReadoutChanged\(before, after\)/u);
});
