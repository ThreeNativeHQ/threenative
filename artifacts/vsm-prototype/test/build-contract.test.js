import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('package exposes build, capture and verification commands', () => {
  const packageJson = JSON.parse(read('../package.json'));
  assert.match(packageJson.scripts.build, /build_standalone\.py/);
  assert.match(packageJson.scripts.capture, /capture\.py/);
  assert.match(packageJson.scripts.verify, /verify_runtime\.py/);
});

test('standalone builder embeds Three.js and rewrites the complete module graph', () => {
  const text = read('../scripts/build_standalone.py');

  assert.match(text, /vendor\/three\.module\.js/);
  assert.match(text, /VirtualShadowMap\.js/);
  assert.match(text, /VirtualShadowMaterial\.js/);
  assert.match(text, /createObjectURL/);
  assert.match(text, /new Blob/);
  assert.match(text, /__TN_VSM_CONFIG__/);
  assert.match(text, /standalone\.html/);
});

test('capture script uses Chromium CDP and waits for runtime proof markers', () => {
  const text = read('../scripts/capture.py');

  assert.match(text, /connect_over_cdp/);
  assert.match(text, /xvfb-run/);
  assert.match(text, /swiftshader/);
  assert.match(text, /__TN_VSM_READY__/);
  assert.match(text, /__TN_VSM_ERROR__/);
  assert.match(text, /console_errors/);
  assert.match(text, /page\.screenshot/);
  assert.match(text, /chromium\.log/);
  assert.match(text, /process\.returncode/);
  assert.match(text, /tn-vshadow-proof-/);
  assert.doesNotMatch(text, /prefix="threenative-vsm-chromium-"/);
  assert.match(text, /"captureMode": True/);
  assert.match(text, /wait_for_timeout/);
});

test('runtime verifier checks virtualization, cache reuse and invalidation proof', () => {
  const text = read('../scripts/verify_runtime.py');

  assert.match(text, /boundedPhysicalPool/);
  assert.match(text, /validPageTable/);
  assert.match(text, /cacheReuseObserved/);
  assert.match(text, /invalidationProof/);
  assert.match(text, /runtime-proof\.json/);
  assert.match(text, /console_errors/);
  assert.match(text, /existing_proof/);
  assert.match(text, /existing_proof\.get\("captures"\) == results/);
});
