import test from 'node:test';
import assert from 'node:assert/strict';

import { DirectionalClipmap } from '../src/core/DirectionalClipmap.js';
import { ReceiverDemandPass } from '../src/core/ReceiverDemandPass.js';

function createFakeCamera(points, position = { x: 0, y: 8, z: 0 }) {
  return {
    position,
    sampleGroundPoints(columns, rows, planeY) {
      assert.ok(columns > 0);
      assert.ok(rows > 0);
      assert.equal(planeY, 0);
      return points;
    },
  };
}

test('deduplicates receiver samples and prioritizes fine pages near the camera', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [8, 16, 32],
    pagesPerAxis: 4,
  });
  clipmap.updateCenter({ x: 0, y: 0, z: 0 });
  const pass = new ReceiverDemandPass({ columns: 3, rows: 2, guardBand: 0 });

  const requests = pass.collect({
    camera: createFakeCamera([
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 10, y: 0, z: 0 },
    ]),
    receiverPlaneY: 0,
    visibleBounds: [],
    clipmap,
  });

  const nonPinned = requests.filter((request) => !request.pinned);
  assert.equal(new Set(requests.map((request) => request.key)).size, requests.length);
  assert.ok(nonPinned.some((request) => request.level === 0));
  assert.ok(nonPinned.some((request) => request.level === 1));
  assert.equal(nonPinned[0].level, 0);
});

test('pins every page in the coarsest current clip window', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [8, 16],
    pagesPerAxis: 4,
  });
  clipmap.updateCenter({ x: 0, y: 0, z: 0 });
  const pass = new ReceiverDemandPass({ guardBand: 0 });

  const requests = pass.collect({
    camera: createFakeCamera([]),
    receiverPlaneY: 0,
    visibleBounds: [],
    clipmap,
  });
  const pinned = requests.filter((request) => request.pinned);

  assert.equal(pinned.length, 16);
  assert.ok(pinned.every((request) => request.level === 1));
  assert.deepEqual(
    new Set(pinned.map(({ x }) => x)),
    new Set([-2, -1, 0, 1]),
  );
});

test('adds a one-page guard band without requesting outside the active window', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [8, 16],
    pagesPerAxis: 4,
  });
  clipmap.updateCenter({ x: 0, y: 0, z: 0 });
  const pass = new ReceiverDemandPass({ guardBand: 1 });

  const requests = pass.collect({
    camera: createFakeCamera([{ x: 0.1, y: 0, z: -0.1 }]),
    receiverPlaneY: 0,
    visibleBounds: [],
    clipmap,
  });
  const fine = requests.filter((request) => request.level === 0 && !request.pinned);
  const window = clipmap.getWindow(0);

  assert.equal(fine.length, 9);
  assert.ok(fine.every(({ x, y }) => (
    x >= window.minX && x < window.maxX && y >= window.minY && y < window.maxY
  )));
});

test('visible bounds contribute page requests even when no ground ray hits them', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [8, 16, 32],
    pagesPerAxis: 4,
  });
  clipmap.updateCenter({ x: 0, y: 0, z: 0 });
  const pass = new ReceiverDemandPass({ guardBand: 0 });

  const requests = pass.collect({
    camera: createFakeCamera([]),
    receiverPlaneY: 0,
    visibleBounds: [{
      min: { x: 8, y: 3, z: -1 },
      max: { x: 10, y: 8, z: 1 },
    }],
    clipmap,
  });

  assert.ok(requests.some((request) => !request.pinned && request.level === 1));
});
