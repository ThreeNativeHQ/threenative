import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'vitest';

import {
  DEFAULT_WGPU_VERSION,
  inspectWgpuInstallation,
  normalizeWgpuVersion,
  wgpuOverrideRoot,
} from '../scripts/download-deps.mjs';
import {
  ROW_ID,
  assertMatrixDiscrimination,
  parseArgs,
  verifyLinkedWgpuEvidence,
} from '../scripts/verify-wgpu-version-matrix.mjs';

const temporary = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

function fixture(version = DEFAULT_WGPU_VERSION) {
  const root = makeTempDirSync('tn-wgpu-version-');
  temporary.push(root);
  const tag = join(root, 'wgpu-native-meta', 'wgpu-native-git-tag');
  const library = join(root, 'lib', process.platform === 'win32' ? 'wgpu_native.lib' : 'libwgpu_native.a');
  mkdirSync(dirname(tag), { recursive: true });
  mkdirSync(dirname(library), { recursive: true });
  writeFileSync(tag, `${version}\n`);
  writeFileSync(library, `wgpu-native fixture ${version}`);
  return { root, tag, library };
}

function linkedFixture(version = DEFAULT_WGPU_VERSION) {
  const files = fixture(version);
  const manifest = inspectWgpuInstallation('wgpu', files.root, version);
  const binary = join(files.root, 'mystral');
  writeFileSync(binary, `runtime linked to ${version}`);
  const cache = [
    'MYSTRAL_USE_WGPU:BOOL=ON',
    'MYSTRAL_USE_DAWN:BOOL=OFF',
    `THREENATIVE_WGPU_ROOT:PATH=${files.root}`,
  ].join('\n');
  return { ...files, manifest, binary, cache, buildInputs: `${files.library}\n` };
}

test('wgpu override accepts only the two regression releases and stays outside third_party', () => {
  assert.equal(normalizeWgpuVersion('v24.0.3.1'), 'v24.0.3.1');
  assert.equal(normalizeWgpuVersion(DEFAULT_WGPU_VERSION), DEFAULT_WGPU_VERSION);
  assert.throws(() => normalizeWgpuVersion('../../third_party/wgpu'), /Unsupported --wgpu-version/);
  const root = wgpuOverrideRoot('v24.0.3.1', 'wgpu-android');
  assert.match(root, /\.runtime\/wgpu-version-matrix\/v24\.0\.3\.1\/wgpu-android$/);
  assert.doesNotMatch(root, /third_party/);
});

test('installed release metadata and library digest are recorded fail closed', () => {
  const files = fixture('v24.0.3.1');
  const manifest = inspectWgpuInstallation('wgpu', files.root, 'v24.0.3.1');
  assert.equal(manifest.version, 'v24.0.3.1');
  assert.equal(manifest.tags[0]?.value, 'v24.0.3.1');
  assert.equal(
    manifest.libraries[0]?.sha256,
    createHash('sha256').update('wgpu-native fixture v24.0.3.1').digest('hex'),
  );
  assert.throws(
    () => inspectWgpuInstallation('wgpu', files.root, DEFAULT_WGPU_VERSION),
    /version mismatch/,
  );
  const incomplete = makeTempDirSync('tn-wgpu-incomplete-');
  temporary.push(incomplete);
  mkdirSync(join(incomplete, 'lib'), { recursive: true });
  writeFileSync(join(incomplete, 'lib', 'libwgpu_native.a'), 'untagged');
  assert.throws(
    () => inspectWgpuInstallation('wgpu', incomplete, DEFAULT_WGPU_VERSION),
    /must contain 1 wgpu-native-git-tag/,
  );
});

test('linked evidence proves CMake and Ninja selected the manifest library', () => {
  const evidence = linkedFixture();
  const linked = verifyLinkedWgpuEvidence(evidence);
  assert.equal(linked.configuredRoot, resolve(evidence.root));
  assert.equal(linked.linkedLibrary, resolve(evidence.library));

  assert.throws(
    () => verifyLinkedWgpuEvidence({ ...evidence, buildInputs: '/tmp/not-wgpu.a\n' }),
    /Ninja inputs do not contain/,
  );
  assert.throws(
    () => verifyLinkedWgpuEvidence({
      ...evidence,
      cache: evidence.cache.replace(evidence.root, `${evidence.root}-wrong`),
    }),
    /CMake linked root mismatch/,
  );
});

function matrixResult(version, status, nativeEvidence = true) {
  const root = `/matrix/${version}/wgpu`;
  return {
    version,
    manifest: { root },
    linked: { configuredRoot: root },
    row: {
      id: ROW_ID,
      status,
      native: nativeEvidence ? { completed: false, stderr: 'Device validation error from naga' } : null,
      gpuValidationErrors: nativeEvidence ? ['Validation Error'] : [],
    },
  };
}

test('matrix requires the v24 native regression and the v25 pass', () => {
  const correct = [matrixResult('v24.0.3.1', 'fail'), matrixResult(DEFAULT_WGPU_VERSION, 'pass')];
  assert.equal(assertMatrixDiscrimination(correct), true);
  assert.throws(
    () => assertMatrixDiscrimination([matrixResult('v24.0.3.1', 'pass'), correct[1]]),
    /must fail/,
  );
  assert.throws(
    () => assertMatrixDiscrimination([matrixResult('v24.0.3.1', 'fail', false), correct[1]]),
    /lacks native WebGPU regression evidence/,
  );
  assert.throws(
    () => assertMatrixDiscrimination([correct[0], matrixResult(DEFAULT_WGPU_VERSION, 'fail')]),
    /must pass/,
  );
});

test('matrix CLI rejects ambiguous or unsupported runs', () => {
  assert.equal(parseArgs(['--only-version', 'v24.0.3.1']).onlyVersion, 'v24.0.3.1');
  assert.throws(() => parseArgs(['--only-version', 'v23.0.0']), /must be one of/);
  assert.throws(() => parseArgs(['--out']), /requires a value/);
  assert.throws(() => parseArgs(['--target', 'android']), /Unknown option/);
});
