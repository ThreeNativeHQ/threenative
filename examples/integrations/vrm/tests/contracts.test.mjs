import assert from "node:assert/strict";
import test from "node:test";
import { inspectAvatarDocument } from "../src/document.ts";
const vrmExtension = "VRMC_vrm";
const legacyExtension = "VRM";
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const vrm = () => ({
  asset: { version: "2.0" },
  extensions: {
    [vrmExtension]: {
      specVersion: "1.0",
      meta: { name: "fixture", authors: ["ThreeNative"] },
      humanoid: { humanBones: {} },
    },
  },
});
function glb(json) {
  const source = encode(json);
  const length = Math.ceil(source.length / 4) * 4;
  const bytes = new Uint8Array(20 + length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20);
  bytes.set(source, 20);
  return bytes;
}
test("recognizes VRM 1 independent of filename", () =>
  assert.equal(inspectAvatarDocument(encode(vrm())).kind, "vrm1"));
test("preserves ordinary glTF without manufacturing an avatar", () =>
  assert.deepEqual(inspectAvatarDocument(encode({ asset: { version: "2.0" } })).json, {
    asset: { version: "2.0" },
  }));
test("reads a padded binary GLB and embedded extension metadata", () =>
  assert.equal(inspectAvatarDocument(glb(vrm())).json.extensions.VRMC_vrm.meta.name, "fixture"));
test("respects nonzero Uint8Array byteOffset", () => {
  const b = glb(vrm());
  const outer = new Uint8Array(b.length + 8);
  outer.set(b, 4);
  assert.equal(inspectAvatarDocument(outer.subarray(4, 4 + b.length)).kind, "vrm1");
});
test("rejects truncated and falsely declared binary lengths", () => {
  const b = glb(vrm());
  assert.throws(() => inspectAvatarDocument(b.subarray(0, b.length - 1)));
  new DataView(b.buffer).setUint32(8, b.length + 4, true);
  assert.throws(() => inspectAvatarDocument(b));
});
test("rejects non-JSON first chunks and out-of-bounds chunks", () => {
  const b = glb(vrm());
  new DataView(b.buffer).setUint32(16, 0x004e4942, true);
  assert.throws(() => inspectAvatarDocument(b));
  new DataView(b.buffer).setUint32(16, 0x4e4f534a, true);
  new DataView(b.buffer).setUint32(12, b.length, true);
  assert.throws(() => inspectAvatarDocument(b));
});
test("rejects legacy VRM and unsupported VRM versions", () => {
  const legacy = { asset: { version: "2.0" }, extensions: { [legacyExtension]: {} } };
  assert.throws(() => inspectAvatarDocument(encode(legacy)), /VRM/);
  const data = vrm();
  data.extensions.VRMC_vrm.specVersion = "9.0";
  assert.throws(() => inspectAvatarDocument(encode(data)), /version/);
});
test("rejects malformed UTF8, JSON and glTF headers", () => {
  for (const b of [
    new Uint8Array([255]),
    encode([]),
    encode({ asset: { version: "1.0" } }),
    new TextEncoder().encode("{"),
  ])
    assert.throws(() => inspectAvatarDocument(b));
});
test("requires VRM metadata and humanoid structures", () => {
  const data = vrm();
  Reflect.deleteProperty(data.extensions.VRMC_vrm, "humanoid");
  assert.throws(() => inspectAvatarDocument(encode(data)), /humanoid/);
});
test("inspection never rewrites or aliases input bytes", () => {
  const bytes = glb(vrm());
  const before = bytes.slice();
  const result = inspectAvatarDocument(bytes);
  result.json.extensions.VRMC_vrm.meta.name = "changed";
  assert.deepEqual(bytes, before);
  assert.equal(inspectAvatarDocument(bytes).json.extensions.VRMC_vrm.meta.name, "fixture");
});
