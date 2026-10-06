// CPU-only differential: call the real pinned TRAANode's camera-jitter methods, no renderer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../../core/package.json", import.meta.url));
const { default: TRAANode } = await import(pathToFileURL(require.resolve("three/addons/tsl/display/TRAANode.js")));
const offsets = [];
const camera = {
  updateProjectionMatrix() {},
  projectionMatrix: {},
  setViewOffset(_w, _h, x, y) { offsets.push([x, y]); },
  clearViewOffset() {},
};
const effect = new TRAANode(null, null, null, camera);
effect._originalProjectionMatrix.copy = () => {};
effect._velocityNode = { setProjectionMatrix() {} };
for (let i = 0; i < 96; ++i) {
  effect.setViewOffset(320, 240);
  effect.clearViewOffset();
}
const native = JSON.parse(readFileSync(0, "utf8").split("\n")[0]);
assert.deepEqual(native, offsets);
assert.deepEqual(native[31], native[0]);
effect.dispose();
console.log("TRAA jitter equals pinned three across 96 frames (including three's 31-frame wrap)");
