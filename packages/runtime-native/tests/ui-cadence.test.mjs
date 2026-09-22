import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { analyzeUiCadence, decodeUiSequence } from '../scripts/ui-cadence.mjs';

test.skipIf(process.platform !== 'linux')('failed reruns refuse a prior successful artifact directory before changing its evidence', () => {
  const directory = makeTempDirSync('tn-ui-cadence-');
  const passing = '{"p95Ms":28}';
  try {
    writeFileSync(join(directory, 'result.json'), passing);
    const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../scripts/verify-ui-cadence.ts', import.meta.url)),
      '--artifacts', directory, '--executable', join(directory, 'missing-game')], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TN_UI_CADENCE_ARTIFACTS/u);
    assert.deepEqual(readdirSync(directory), ['result.json']);
    assert.equal(readFileSync(join(directory, 'result.json'), 'utf8'), passing);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function recording({ latency = 28, every = 1 } = {}) {
  const states = [];
  for (let tick = 0; tick < 1800; tick += 1) {
    const at = 100_000 + Math.round(tick * 1000 / 60);
    if ((at - 100_000) % 12_000 >= 10_000) continue;
    states.push({ sequence: states.length + 1, at });
  }
  const captures = [];
  let current = 0;
  for (let tick = 480; tick < 7200; tick += 1) {
    const at = 100_000 + Math.round(tick * 1000 / 240);
    while (current + 1 < states.length && states[current + 1].at <= at - latency) current += 1;
    const index = current - current % every;
    captures.push({ at, sequence: states[index].sequence, valid: true });
  }
  return { states, captures };
}

test('visible cadence matches exact published IDs and measures idle wake-up', () => {
  const report = analyzeUiCadence(recording());
  assert.ok(report.p95Ms >= 28 && report.p95Ms <= 33);
  assert.ok(report.visibleHz >= 59);
  assert.equal(report.idleResumes.length, 2);
  assert.ok(report.idleResumes.every((resume) => resume.delayMs <= 33));
});

test('low latest-state latency cannot hide a sustained 30 Hz presentation cap', () => {
  assert.throws(() => analyzeUiCadence(recording({ latency: 1, every: 2 })), /VISIBLE_RATE/u);
  assert.throws(() => analyzeUiCadence(recording({ latency: 85 })), /LATENCY/u);
});

test('empty, corrupt, stale, unmatched and undersampled captures cannot qualify', () => {
  assert.throws(() => analyzeUiCadence({ states: [], captures: [] }), /OBSERVATION/u);
  for (const change of [
    (data) => { data.captures[800].valid = false; },
    (data) => { data.captures[800].sequence = data.captures[799].sequence - 1; },
    (data) => { data.captures[800].sequence = 65_535; },
    (data) => { data.captures = data.captures.filter((_, index) => index % 4 === 0); },
    (data) => { data.states[800].sequence += 1; },
  ]) {
    const data = recording(); change(data);
    assert.throws(() => analyzeUiCadence(data), /TN_UI_CADENCE_/u);
  }
});

test('pixel IDs require complementary bits and both fixed color markers', () => {
  const frame = Buffer.alloc(160 * 24 * 3);
  const set = (x, y, rgb) => { const offset = (y * 160 + x) * 3; frame.writeUIntBE(rgb, offset, 3); };
  const expected = 43_210;
  for (let bit = 0; bit < 16; bit += 1) {
    const on = (expected & (1 << bit)) !== 0;
    set(bit * 8 + 4, 6, on ? 0xffffff : 0);
    set(bit * 8 + 4, 18, on ? 0 : 0xffffff);
  }
  set(136, 6, 0x00ffff); set(152, 6, 0xff00ff);
  assert.deepEqual(decodeUiSequence(frame), { sequence: expected, valid: true });
  set(136, 6, 0);
  assert.equal(decodeUiSequence(frame).valid, false);
});
