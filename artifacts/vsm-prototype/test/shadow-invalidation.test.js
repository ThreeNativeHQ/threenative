import test from 'node:test';
import assert from 'node:assert/strict';

import { DirectionalClipmap } from '../src/core/DirectionalClipmap.js';
import { ShadowInvalidationTracker } from '../src/core/ShadowInvalidationTracker.js';

const bounds = (minX, maxX) => ({
  min: { x: minX, y: 0, z: -0.8 },
  max: { x: maxX, y: 2, z: -0.2 },
});

test('new casters invalidate their covered pages', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16, 32],
    pagesPerAxis: 8,
  });
  const tracker = new ShadowInvalidationTracker(clipmap);

  tracker.update('crate', bounds(0.2, 0.8));
  const keys = tracker.consumeInvalidatedKeys();

  assert.deepEqual([...keys].sort(), ['0:0:0', '1:0:0']);
});

test('unchanged caster bounds do not invalidate pages again', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16, 32],
    pagesPerAxis: 8,
  });
  const tracker = new ShadowInvalidationTracker(clipmap);
  const first = bounds(0.2, 0.8);

  tracker.update('crate', first);
  tracker.consumeInvalidatedKeys();
  tracker.update('crate', structuredClone(first));

  assert.equal(tracker.consumeInvalidatedKeys().size, 0);
});

test('moving a caster invalidates only the union of old and new coverage', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16, 32],
    pagesPerAxis: 8,
  });
  const tracker = new ShadowInvalidationTracker(clipmap);

  tracker.update('crate', bounds(0.2, 0.8));
  tracker.consumeInvalidatedKeys();
  tracker.update('crate', bounds(4.2, 4.8));
  const keys = tracker.consumeInvalidatedKeys();

  assert.deepEqual([...keys].sort(), ['0:0:0', '0:1:0', '1:0:0']);
});

test('removing a caster invalidates its previous coverage', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });
  const tracker = new ShadowInvalidationTracker(clipmap);

  tracker.update('crate', bounds(0.2, 0.8));
  tracker.consumeInvalidatedKeys();
  assert.equal(tracker.remove('crate'), true);

  assert.deepEqual([...tracker.consumeInvalidatedKeys()], ['0:0:0']);
});

test('invalidateAll marks the current coverage of every tracked caster', () => {
  const clipmap = new DirectionalClipmap({
    lightDirection: { x: 0, y: 1, z: 0 },
    clipExtents: [16],
    pagesPerAxis: 8,
  });
  const tracker = new ShadowInvalidationTracker(clipmap);
  tracker.update('a', bounds(0.2, 0.8));
  tracker.update('b', bounds(8.2, 8.8));
  tracker.consumeInvalidatedKeys();

  tracker.invalidateAll();

  assert.deepEqual([...tracker.consumeInvalidatedKeys()].sort(), ['0:0:0', '0:2:0']);
});
