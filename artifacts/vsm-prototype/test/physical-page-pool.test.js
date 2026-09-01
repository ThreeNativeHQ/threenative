import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PhysicalPagePool,
  makePageKey,
  parsePageKey,
} from '../src/core/PhysicalPagePool.js';

test('page keys preserve signed absolute coordinates', () => {
  const key = makePageKey(3, -17, 42);
  assert.equal(key, '3:-17:42');
  assert.deepEqual(parsePageKey(key), { level: 3, x: -17, y: 42 });
});

test('reuses a resident page without allocating a second slot', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const key = makePageKey(0, 3, -2);

  const first = pool.allocate(key, { frame: 1 });
  const second = pool.allocate(key, { frame: 2 });

  assert.equal(second.reused, true);
  assert.equal(second.entry.slot, first.entry.slot);
  assert.equal(second.entry.lastUsedFrame, 2);
  assert.equal(pool.size, 1);
});

test('evicts the least recently used unpinned unprotected page', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const a = makePageKey(0, 0, 0);
  const b = makePageKey(0, 1, 0);
  const c = makePageKey(0, 2, 0);
  const d = makePageKey(0, 3, 0);
  const e = makePageKey(0, 4, 0);

  pool.allocate(a, { frame: 1, pinned: true });
  pool.allocate(b, { frame: 2 });
  pool.allocate(c, { frame: 3 });
  pool.allocate(d, { frame: 4 });

  const result = pool.allocate(e, {
    frame: 5,
    protectedKeys: new Set([b]),
  });

  assert.equal(result.evictedKey, c);
  assert.equal(result.entry.slot, 2);
  assert.equal(pool.has(a), true);
  assert.equal(pool.has(b), true);
  assert.equal(pool.has(c), false);
  assert.equal(pool.has(e), true);
  assert.equal(pool.evictions, 1);
});

test('uses slot number as a stable tie breaker for equal LRU frames', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const keys = [0, 1, 2, 3].map((x) => makePageKey(0, x, 0));
  for (const key of keys) pool.allocate(key, { frame: 1 });

  const next = pool.allocate(makePageKey(0, 9, 0), { frame: 2 });

  assert.equal(next.evictedKey, keys[0]);
  assert.equal(next.entry.slot, 0);
});

test('reports overflow rather than evicting pinned or protected pages', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 1 });
  const pinned = makePageKey(3, 0, 0);
  pool.allocate(pinned, { frame: 1, pinned: true });

  const result = pool.allocate(makePageKey(0, 1, 1), { frame: 2 });

  assert.equal(result, null);
  assert.equal(pool.overflow, 1);
  assert.equal(pool.has(pinned), true);
});

test('new pages are dirty and can be invalidated individually or globally', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const a = makePageKey(0, 0, 0);
  const b = makePageKey(1, 0, 0);
  pool.allocate(a, { frame: 1 });
  pool.allocate(b, { frame: 1 });

  assert.equal(pool.get(a).dirty, true);
  pool.get(a).dirty = false;
  pool.get(b).dirty = false;
  assert.equal(pool.markDirty(a), true);
  assert.equal(pool.get(a).dirty, true);
  assert.equal(pool.get(b).dirty, false);

  const count = pool.markAllDirty();
  assert.equal(count, 2);
  assert.equal(pool.get(b).dirty, true);
});

test('release returns a slot to the deterministic free list', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const a = makePageKey(0, 0, 0);
  const b = makePageKey(0, 1, 0);
  pool.allocate(a, { frame: 1 });
  pool.allocate(b, { frame: 1 });

  assert.equal(pool.release(a), true);
  const c = pool.allocate(makePageKey(0, 2, 0), { frame: 2 });

  assert.equal(c.entry.slot, 0);
  assert.equal(pool.size, 2);
});
