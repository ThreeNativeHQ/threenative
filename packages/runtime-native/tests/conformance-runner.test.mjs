import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = join(root, 'conformance/run-conformance.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
}

test('the workspace test lane stays runtime-free and runs the native contract suite', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const testScript = manifest.scripts?.test ?? '';

  assert.match(testScript, /vitest/, 'package test must run the imported contract suite');
  assert.doesNotMatch(
    testScript,
    /cmake|gradle|xcodebuild|native:build/,
    'default package tests must not require a native toolchain',
  );
});

test('dry run validates and bundles implemented rows without a browser or native runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threenative-conformance-'));
  try {
    const out = join(dir, 'dry-report.json');
    const proc = run(['--dry-run', '--out', out], {
      FIREFOX_BIN: join(dir, 'missing-firefox'),
      TN_RUNTIME: join(dir, 'missing-runtime'),
      MYSTRAL_BIN: '',
    });

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const implemented = JSON.parse(readFileSync(join(root, 'conformance/registry.json'), 'utf8'))
      .tests.filter((entry) => entry.status === 'implemented').length;
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.summary.validated, implemented);
    assert.equal(report.summary.pass, 0, 'dry run must not claim runtime conformance passes');
    assert.equal(report.host.browser, null);
    assert.equal(report.host.runtime, null);
    assert.ok(report.results.filter((result) => result.status === 'validated').every((result) => result.browserBundle && result.nativeBundle));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('report validation rejects a pass with null metrics or incomplete browser execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threenative-conformance-'));
  try {
    const registry = JSON.parse(readFileSync(join(root, 'conformance/registry.json'), 'utf8'));
    const results = registry.tests.map((entry) => ({
      id: entry.id,
      status: entry.status === 'implemented' ? 'pass' : 'planned',
      browser: entry.status === 'implemented' ? { completed: false, screenshot: null } : null,
      native: entry.status === 'implemented' ? { completed: true, screenshot: 'native.png' } : null,
      metrics: { pixelMismatchRatio: null, perceptualDeltaE: null },
      gpuValidationErrors: [],
    }));
    const report = {
      schemaVersion: '0.2.0',
      registrySchemaVersion: registry.schemaVersion,
      threeVersion: registry.threeVersion,
      mode: 'execution',
      summary: {
        pass: results.filter((entry) => entry.status === 'pass').length,
        fail: 0,
        blocked: 0,
        planned: results.filter((entry) => entry.status === 'planned').length,
        validated: 0,
      },
      results,
    };
    const reportPath = join(dir, 'invalid-report.json');
    writeFileSync(reportPath, JSON.stringify(report));

    const proc = run(['--validate-report', reportPath]);
    assert.notEqual(proc.status, 0);
    assert.match(proc.stderr, /completed browser execution|finite pixelMismatchRatio|finite perceptualDeltaE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
