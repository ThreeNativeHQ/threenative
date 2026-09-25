import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactTriangles } from '../src/active-geometry.ts';
const geometry = (extra = {}) => ({
  attributes: { position: { array: new Float32Array([0,0,0, 1,0,0, 0,1,0, 9,9,9]), itemSize: 3 }, uv: { array: new Float32Array([0,0, 1,0, 0,1, 1,1]), itemSize: 2 } },
  indices: new Uint32Array([3,3,3,0,1,2]), range: { start:3, count:3 },
  groups: [{ start:0,count:3,materialIndex:7 },{ start:3,count:3,materialIndex:2 }], ...extra,
});
test('remaps active indices, attributes and groups without unused triangles', () => {
  const r = compactTriangles(geometry());
  assert.deepEqual([...r.indices], [0,1,2]);
  assert.equal(r.attributes.position.array.length, 9);
  assert.deepEqual(r.groups, [{start:0,count:3,materialIndex:2}]);
  assert.deepEqual([...r.attributes.uv.array], [0,0,1,0,0,1]);
});
test('does not alias source arrays', () => {
  const g=geometry(); const r=compactTriangles(g); r.attributes.position.array[0]=42;
  assert.equal(g.attributes.position.array[0],0);
});
test('supports non-indexed geometry and normalized integer attributes', () => {
  const g=geometry({indices:null,range:{start:0,count:3},groups:[]});
  g.attributes.color={array:new Uint8Array([255,0,0, 0,255,0, 0,0,255, 9,9,9]),itemSize:3,normalized:true};
  const r=compactTriangles(g);
  assert.ok(r.attributes.color.array instanceof Uint8Array); assert.equal(r.attributes.color.normalized,true);
  assert.equal(r.indices.length,3);
});
test('handles an explicitly empty result', () => {
  const r=compactTriangles(geometry({range:{start:3,count:0}}));
  assert.equal(r.indices.length,0); assert.equal(r.attributes.position.array.length,0);
});
test('rejects non-triangle-aligned active ranges', () => {
  assert.throws(()=>compactTriangles(geometry({range:{start:1,count:3}})), /range/i);
});
test('rejects out of bounds indices before reading attributes', () => {
  assert.throws(()=>compactTriangles(geometry({indices:new Uint32Array([0,1,99]),range:{start:0,count:3},groups:[]})),/index/i);
});
test('rejects NaN and mismatched attribute counts', () => {
  const g=geometry(); g.attributes.position.array[0]=NaN;
  assert.throws(()=>compactTriangles(g), /finite/i);
  g.attributes.position.array[0]=0; g.attributes.uv.array=new Float32Array(2);
  assert.throws(()=>compactTriangles(g),/count/i);
});
test('rejects overlapping groups and uncovered active triangles', () => {
  assert.throws(()=>compactTriangles(geometry({groups:[{start:0,count:6,materialIndex:0},{start:3,count:3,materialIndex:1}]})),/overlap/i);
  assert.throws(()=>compactTriangles(geometry({groups:[{start:0,count:3,materialIndex:0}]})),/cover/i);
});
test('uses uint32 when compacted indices exceed uint16', () => {
  const n=65538; const p=new Float32Array(n*3);
  const r=compactTriangles({attributes:{position:{array:p,itemSize:3}}, indices:null, range:{start:0,count:n},groups:[]});
  assert.ok(r.indices instanceof Uint32Array); assert.equal(r.indices[n-1],n-1);
});
test('Infinity means the remaining backing range, not extra triangles', () => {
  assert.equal(compactTriangles(geometry({range:{start:3,count:Infinity}})).indices.length,3);
});
