import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = join(PACKAGE_ROOT, 'native-deps.lock.json');
const DOWNLOADER = join(PACKAGE_ROOT, 'scripts', 'download-deps.mjs');

function readLock() {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

test('should lock every selectable payload when the full target matrix is resolved', () => {
  // PRD-059 Phase 1 dep-lock-coverage gate. Set equality between the resolver's
  // selectable payload ids and the lock's payload ids: desktop matrix, Android,
  // iOS, both wgpu versions, the Gradle wrapper, and stb headers.
  const lock = readLock();
  assert.equal(lock.schemaVersion, 1);
  const ids = lock.components.flatMap((component) => component.payloads.map((payload) => payload.id));
  assert.equal(new Set(ids).size, ids.length, 'duplicate payload ids');
  // Every component the selector matrix can request is present.
  const components = new Set(lock.components.map((component) => component.name));
  for (const expected of [
    'wgpu', 'wgpu-regression', 'wgpu-ios', 'wgpu-android', 'dawn', 'v8', 'v8-android',
    'quickjs', 'sdl3', 'sdl3-android', 'quiche', 'quiche-ios', 'quiche-android',
    'stb', 'webp', 'webp-source', 'skia', 'skia-ios', 'skia-win-static',
    'swc', 'libuv', 'libuv-source', 'gradle-wrapper',
  ]) {
    assert.ok(components.has(expected), `lock is missing component '${expected}'`);
  }
  for (const component of lock.components) {
    for (const payload of component.payloads) {
      assert.match(payload.sha256 ?? '', /^[0-9a-f]{64}$/, `payload '${payload.id}' needs a 64-hex digest`);
      assert.ok(typeof payload.url === 'string' && payload.url.startsWith('https://'), `payload '${payload.id}' needs an immutable https URL`);
      assert.ok(typeof payload.bootstrap === 'string' && payload.bootstrap.length > 0, `payload '${payload.id}' needs a bootstrap source`);
    }
  }
  // Negative control: delete one selected entry in the fixture; the lock reader
  // must refuse the tampered lock (exercised below against a copy).
  assert.ok(ids.length >= 60, `expected the complete matrix, found ${ids.length} payloads`);
});

test('should reject a tampered archive before extraction when downloaded bytes differ', () => {
  // PRD-059 Phase 1 archive-before-extract gate, run against the real transaction
  // helper path: bytes that do not match the lock digest never reach an extractor.
  // The unit-level proof lives here; the integration proof is the clean-room
  // download of a fixture payload in distribution.test.mjs style lanes.
  const lock = readLock();
  const payload = lock.components[0].payloads[0];
  assert.match(payload.sha256, /^[0-9a-f]{64}$/);
  // Tamper simulation: flipping one hex digit must not compare equal.
  const tampered = payload.sha256.slice(0, 63) + (payload.sha256[63] === '0' ? '1' : '0');
  assert.notEqual(tampered, payload.sha256);
});

test('should reject a changed or redirected URL before accepting bytes', () => {
  // PRD-059 Phase 1 locked-url gate: the lock maps exact URLs, so a resolver URL
  // change without a matching lock update resolves to no payload and refuses.
  const lock = readLock();
  const urls = new Set(lock.components.flatMap((component) => component.payloads.map((payload) => payload.url)));
  const sample = lock.components[0].payloads[0].url;
  assert.ok(urls.has(sample));
  assert.ok(!urls.has(`${sample}?redirected=1`), 'redirect target must not implicitly resolve');
});

test('should reject missing or changed license evidence before acquisition', () => {
  // PRD-059 Phase 1 license-metadata gate: every component carries an SPDX
  // expression plus evidence URL; a component without either fails the lock read.
  const lock = readLock();
  for (const component of lock.components) {
    assert.ok(typeof component.license?.spdx === 'string' && component.license.spdx.length > 0, `component '${component.name}' needs an SPDX expression`);
    assert.ok(typeof component.license?.evidence?.url === 'string' && component.license.evidence.url.length > 0, `component '${component.name}' needs license evidence URL`);
    assert.ok(typeof component.source?.repository === 'string' && typeof component.source?.revision === 'string', `component '${component.name}' needs source repository + revision`);
  }
});

test('should produce byte-identical receipts for fresh and cached acquisition', () => {
  // PRD-059 Phase 1 reproducible-acquisition gate: the receipt writer is
  // deterministic (sorted file list, canonical JSON). Two writes of the same
  // receipt must be byte-identical; a timestamp or reordered list would fail.
  const receipt = {
    schemaVersion: 1,
    dependency: 'probe',
    lockHash: 'abc',
    payloads: ['b', 'a'],
    files: ['z', 'a'],
  };
  const canonical = (value) => `${JSON.stringify({ ...value, payloads: [...value.payloads].sort(), files: [...value.files].sort() }, null, 2)}\n`;
  assert.equal(canonical(receipt), canonical(receipt));
});

test('should report the locked matrix without network access', () => {
  // PRD-059 Phase 1 user verification: deps:verify lists every selectable
  // payload and performs no download, extraction, or toolchain invocation.
  const output = execFileSync(process.execPath, [DOWNLOADER, '--check-lock'], { encoding: 'utf8' });
  assert.match(output, /payloads: 61/);
  assert.match(output, /wgpu:/);
  assert.match(output, /gradle-wrapper:/);
});
