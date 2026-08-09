import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, test } from 'vitest';

import {
  installPrebuilt,
  platformKey,
  readRelease,
  releaseManifestUrl,
  sha256,
  verifyChecksum,
} from '../scripts/install-prebuilt.mjs';
import {
  ANDROID_PREBUILT_ASSETS,
  ensureGradleWrapper,
  prepareAndroidPrebuilts,
} from '../scripts/package-android.mjs';

const roots = [];
const run = promisify(execFile);

async function packRuntime(root) {
  const archives = join(root, 'archives');
  mkdirSync(archives);
  const { stdout } = await run('pnpm', ['pack', '--json', '--pack-destination', archives], {
    cwd: new URL('..', import.meta.url),
  });
  const packed = JSON.parse(stdout);
  return { archive: packed.filename, files: packed.files.map(({ path }) => path) };
}

afterEach(() => {
  delete process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT;
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('unsupported platforms fail closed with the platform-arch string', () => {
  assert.throws(() => platformKey('aix', 'ppc64'), /aix-ppc64/);
  assert.throws(() => platformKey('darwin', 'x64'), /darwin-x64/);
  assert.throws(() => platformKey('linux', 'arm64'), /linux-arm64/);
});

test('a missing release lock and a missing platform asset both fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-prebuilt-'));
  roots.push(root);
  assert.throws(() => readRelease(join(root, 'missing.json'), 'linux-x64'), /linux-x64.*OPEN/);
  const manifest = join(root, 'lock.json');
  writeFileSync(manifest, '{"artifacts":{}}\n');
  assert.throws(() => readRelease(manifest, 'linux-x64'), /linux-x64/);
});

test('the default checksum lock URL is tied to the installed package version', () => {
  assert.equal(
    releaseManifestUrl(),
    'https://github.com/jonit-dev/threenative/releases/download/runtime-native-v0.1.12/prebuilt-lock.json',
  );
});

test('the installer can bootstrap a remote checksum lock before fetching the runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-prebuilt-bootstrap-'));
  roots.push(root);
  const runtime = Buffer.from('#!/bin/sh\nexit 0\n');
  let runtimeUrl = '';
  const server = createServer((request, response) => {
    if (request.url === '/prebuilt-lock.json') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        artifacts: { 'linux-x64': { sha256: sha256(runtime), url: runtimeUrl } },
      }));
      return;
    }
    response.end(runtime);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    runtimeUrl = `http://127.0.0.1:${address.port}/runtime`;
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    const output = join(root, 'runtime');
    await installPrebuilt({
      arch: 'x64',
      manifestUrl: `http://127.0.0.1:${address.port}/prebuilt-lock.json`,
      output,
      platform: 'linux',
    });
    assert.deepEqual(readFileSync(output), runtime);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('Android prebuilts verify every runtime, SDL, and Java payload before writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-android-prebuilt-'));
  roots.push(root);
  const contents = Object.fromEntries(
    Object.keys(ANDROID_PREBUILT_ASSETS).map((key) => [key, Buffer.from(`payload:${key}`)]),
  );
  const server = createServer((request, response) => {
    const key = decodeURIComponent(request.url.slice(1));
    response.end(contents[key]);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const artifacts = Object.fromEntries(Object.entries(contents).map(([key, payload]) => [
      key,
      { sha256: sha256(payload), url: `http://127.0.0.1:${address.port}/${encodeURIComponent(key)}` },
    ]));
    const manifest = join(root, 'prebuilt-lock.json');
    writeFileSync(manifest, `${JSON.stringify({ artifacts })}\n`);
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    const outputRoot = join(root, 'android');
    await prepareAndroidPrebuilts({ manifestPath: manifest, outputRoot });
    for (const [key, path] of Object.entries(ANDROID_PREBUILT_ASSETS)) {
      assert.deepEqual(readFileSync(join(outputRoot, path)), contents[key]);
    }

    artifacts['android-x86_64-runtime'].sha256 = sha256(Buffer.from('wrong'));
    writeFileSync(manifest, `${JSON.stringify({ artifacts })}\n`);
    const rejectedRoot = join(root, 'rejected');
    await assert.rejects(
      prepareAndroidPrebuilts({ manifestPath: manifest, outputRoot: rejectedRoot }),
      /Checksum verification failed.*android-x86_64-runtime/u,
    );
    assert.equal(existsSync(rejectedRoot), false);

    delete artifacts['android-x86_64-runtime'];
    writeFileSync(manifest, `${JSON.stringify({ artifacts })}\n`);
    await assert.rejects(
      prepareAndroidPrebuilts({ manifestPath: manifest, outputRoot: rejectedRoot }),
      /No prebuilt release asset.*android-x86_64-runtime/u,
    );
    assert.equal(existsSync(rejectedRoot), false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('a packed Android build reconstructs only a checksum-verified Gradle wrapper', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-gradle-wrapper-'));
  roots.push(root);
  const wrapper = Buffer.from('verified Gradle wrapper');
  const server = createServer((_request, response) => response.end(wrapper));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/gradle-wrapper.jar`;
    const output = join(root, 'gradle-wrapper.jar');
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    await ensureGradleWrapper({ output, sha256: sha256(wrapper), url });
    assert.deepEqual(readFileSync(output), wrapper);
    await assert.rejects(
      ensureGradleWrapper({
        output: join(root, 'rejected.jar'),
        sha256: sha256(Buffer.from('wrong')),
        url,
      }),
      /Checksum verification failed.*gradle-wrapper/u,
    );
    assert.equal(existsSync(join(root, 'rejected.jar')), false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
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
    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    const packed = await packRuntime(root);
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({
        name: 'native-consumer-proof',
        private: true,
        optionalDependencies: {
          '@threenative/runtime-native': `file:${packed.archive}`,
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

test('a corrupted download fails the packed consumer install lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-consumer-corrupt-'));
  roots.push(root);
  const expected = Buffer.from('verified runtime');
  const server = createServer((_request, response) => response.end('corrupted runtime'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const manifest = join(root, 'prebuilt-lock.json');
    writeFileSync(
      manifest,
      `${JSON.stringify({ artifacts: { 'linux-x64': { sha256: sha256(expected), url: `http://127.0.0.1:${address.port}/runtime` } } })}\n`,
    );
    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    const packed = await packRuntime(root);
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@threenative/runtime-native': `file:${packed.archive}` },
        name: 'native-consumer-corrupt-proof',
        pnpm: { onlyBuiltDependencies: ['@threenative/runtime-native'] },
        private: true,
      })}\n`,
    );
    await assert.rejects(
      run('pnpm', ['install', '--config.side-effects-cache=false'], {
        cwd: consumer,
        env: {
          ...process.env,
          THREENATIVE_ALLOW_INSECURE_PREBUILT: '1',
          THREENATIVE_PREBUILT_MANIFEST: manifest,
        },
      }),
      (error) => /Checksum verification failed.*linux-x64/u.test(`${error.stdout}\n${error.stderr}`),
    );
    assert.equal(
      existsSync(join(consumer, 'node_modules/@threenative/runtime-native/prebuilt')),
      false,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('the actual packed archive excludes C++ runtime source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-pack-'));
  roots.push(root);
  const packed = await packRuntime(root);
  const files = packed.files.join('\n');
  assert.doesNotMatch(files, /^(?:src|include|cmake|native|third_party|build)\//mu);
  assert.doesNotMatch(files, /\.(?:c|cc|cpp|cxx|h|hh|hpp|m|mm)$/mu);

  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.scripts.install, 'node scripts/install-prebuilt.mjs');
});
