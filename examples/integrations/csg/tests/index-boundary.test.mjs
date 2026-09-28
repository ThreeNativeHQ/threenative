import assert from "node:assert/strict";
import { test } from "node:test";
import { compactTriangles } from "../src/active-geometry.ts";

for (const count of [65535, 65536, 65537]) {
  test(`glTF-safe index width for ${count} unique vertices`, () => {
    const indices = new Uint32Array(Math.ceil(count / 3) * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i % count;
    const input = {
      attributes: { position: { array: new Float32Array(count * 3), itemSize: 3 } },
      indices,
      range: { start: 0, count: indices.length },
      groups: [],
    };
    const result = compactTriangles(input);
    // glTF forbids the maximum component value (primitive-restart sentinel).
    assert.ok(result.indices instanceof (count < 65536 ? Uint16Array : Uint32Array));
    assert.equal(result.indices[count - 1], count - 1);
    assert.deepEqual([...result.indices], [...indices]);
    assert.equal(result.attributes.position.array.length, count * 3);
  });
}
