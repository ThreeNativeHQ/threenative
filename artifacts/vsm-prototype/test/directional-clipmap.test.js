import test from 'node:test';
import assert from 'node:assert/strict';

import { DirectionalClipmap } from '../src/core/DirectionalClipmap.js';

const close = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v) => Math.sqrt(dot(v, v));

test('builds an orthonormal light-space basis', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0.55, y: 1, z: 0.35 },
    clipExtents: [16, 32],
    pagesPerAxis: 8,
  });

  close(length(clipmap.basisU), 1);
  close(length(clipmap.basisV), 1);
  close(length(clipmap.basisW), 1);
  close(dot(clipmap.basisU, clipmap.basisV), 0);
  close(dot(clipmap.basisU, clipmap.basisW), 0);
  close(dot(clipmap.basisV, clipmap.basisW), 0);
});

test('light-space basis is right-handed so a page camera with up = V has screen X = +U', () => {
  // A camera placed along +W looking back at the page with up = V renders screen X = V x W.
  // The shader samples atlas x along +U, so V x W must equal +U (equivalently U x V = W).
  // A left-handed basis mirrors every rendered page along u against the lookup.
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0.56, y: 1, z: 0.36 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const screenX = cross(clipmap.basisV, clipmap.basisW);
  close(screenX.x, clipmap.basisU.x);
  close(screenX.y, clipmap.basisU.y);
  close(screenX.z, clipmap.basisU.z);
  const uCrossV = cross(clipmap.basisU, clipmap.basisV);
  close(dot(uCrossV, clipmap.basisW), 1);
});

test('snaps clip windows to whole page increments', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });

  clipmap.updateCenter({ x: 0.2, y: 2, z: -0.2 });
  const first = clipmap.getWindow(0);
  clipmap.updateCenter({ x: 3.9, y: 2, z: -3.9 });
  const subPageMove = clipmap.getWindow(0);
  clipmap.updateCenter({ x: 4.1, y: 2, z: -4.1 });
  const boundaryMove = clipmap.getWindow(0);

  assert.deepEqual(
    { minX: subPageMove.minX, minY: subPageMove.minY },
    { minX: first.minX, minY: first.minY },
  );
  assert.equal(boundaryMove.minX, first.minX + 1);
  assert.equal(boundaryMove.minY, first.minY + 1);
  assert.equal(first.pageWorldSize, 4);
});

test('uses floor addressing for negative virtual page coordinates', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });

  assert.deepEqual(clipmap.worldToPage({ x: -0.01, y: 0, z: 0.01 }, 0), {
    level: 0,
    x: -1,
    y: -1,
    key: '0:-1:-1',
  });
});

test('projects axis-aligned world bounds into exact light-space page ranges', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });

  const keys = clipmap.boundsToPageKeys({
    min: { x: 3, y: 0, z: -2 },
    max: { x: 9, y: 5, z: 2 },
  }, 0);

  assert.deepEqual(keys, [
    '0:0:-1', '0:0:0',
    '0:1:-1', '0:1:0',
    '0:2:-1', '0:2:0',
  ]);
});

test('selects the finest clip whose guarded extent contains the point', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [8, 16, 32],
    pagesPerAxis: 8,
    selectionGuard: 0.9,
  });
  clipmap.updateCenter({ x: 0, y: 0, z: 0 });

  assert.equal(clipmap.selectLevel({ x: 3, y: 0, z: 0 }), 0);
  assert.equal(clipmap.selectLevel({ x: 10, y: 0, z: 0 }), 1);
  assert.equal(clipmap.selectLevel({ x: 25, y: 0, z: 0 }), 2);
});
