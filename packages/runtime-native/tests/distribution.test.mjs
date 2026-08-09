import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, test } from 'vitest';

import {
  installPrebuilt,
  platformKey,
  readRelease,
  sha256,
  verifyChecksum,
} from '../scripts/install-prebuilt.mjs';

const roots = [];
const run = promisify(execFile);
afterEach(() => {
  delete process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('unsupported platforms fail closed with the platform-arch string', () => {
  assert.throws(() => platformKey('aix', 'ppc64'), /aix-ppc64/);
});

test('a missing release lock and a missing platform asset both fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-prebuilt-'));
  roots.push(root);
  assert.throws(() => readRelease(join(root, 'missing.json'), 'linux-x64'), /linux-x64.*OPEN/);
  const manifest = join(root, 'lock.json');
  writeFileSync(manifest, '{"artifacts":{}}\n');
  assert.throws(() => readRelease(manifest, 'linux-x64'), /linux-x64/);
});

test('corrupted downloads fail checksum verification and are never installed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-prebuilt-'));
  roots.push(root);
  const expected = Buffer.from('verified runtime');
  const corrupted = Buffer.from('corrupted runtime');
  assert.throws(() => verifyChecksum(corrupted, sha256(expected), 'linux-x64'), /Checksum.*linux-x64/);

  const server = createServer((_request, response) => response.end(corrupted));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const manifest = join(root, 'lock.json');
    writeFileSync(
      manifest,
      `${JSON.stringify({ artifacts: { 'linux-x64': { sha256: sha256(expected), url: `http://127.0.0.1:${address.port}/runtime` } } })}\n`,
    );
    const output = join(root, 'runtime');
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    await assert.rejects(
      installPrebuilt({ arch: 'x64', manifestPath: manifest, output, platform: 'linux' }),
      /Checksum verification failed.*linux-x64/,
    );
    assert.throws(() => readFileSync(output), /ENOENT/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('a packed consumer runs the allowlisted install hook and verifies its download', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-consumer-'));
  roots.push(root);
  const runtime = Buffer.from('#!/bin/sh\nexit 0\n');
  const server = createServer((_request, response) => response.end(runtime));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const manifest = join(root, 'prebuilt-lock.json');
    writeFileSync(
      manifest,
      `${JSON.stringify({ artifacts: { 'linux-x64': { sha256: sha256(runtime), url: `http://127.0.0.1:${address.port}/runtime` } } })}\n`,
    );
    const archives = join(root, 'archives');
    const consumer = join(root, 'consumer');
    mkdirSync(archives);
    mkdirSync(consumer);
    await run('pnpm', ['pack', '--pack-destination', archives], {
      cwd: new URL('..', import.meta.url),
    });
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({
        name: 'native-consumer-proof',
        private: true,
        optionalDependencies: {
          '@threenative/runtime-native': `file:${join(archives, 'threenative-runtime-native-0.1.5.tgz')}`,
        },
        pnpm: { onlyBuiltDependencies: ['@threenative/runtime-native'] },
      })}\n`,
    );
    await run('pnpm', ['install'], {
      cwd: consumer,
      env: {
        ...process.env,
        THREENATIVE_ALLOW_INSECURE_PREBUILT: '1',
        THREENATIVE_PREBUILT_MANIFEST: manifest,
      },
    });
    assert.deepEqual(
      readFileSync(
        join(
          consumer,
          'node_modules/@threenative/runtime-native/prebuilt/linux-x64/threenative-runtime',
        ),
      ),
      runtime,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('the published file allowlist excludes C++ runtime source', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const files = manifest.files.join('\n');
  assert.doesNotMatch(files, /(?:^|\n)(?:src|include|cmake|CMakeLists\.txt)(?:\n|$)/);
  assert.equal(manifest.scripts.install, 'node scripts/install-prebuilt.mjs');
});
