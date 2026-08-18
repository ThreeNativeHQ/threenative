import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  ANDROID_PREBUILT_V8_ASSETS,
  androidPrebuiltAssets,
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
  const root = makeTempDirSync('threenative-prebuilt-');
  roots.push(root);
  assert.throws(() => readRelease(join(root, 'missing.json'), 'linux-x64'), /linux-x64.*OPEN/);
  const manifest = join(root, 'lock.json');
  writeFileSync(manifest, '{"artifacts":{}}\n');
  assert.throws(() => readRelease(manifest, 'linux-x64'), /linux-x64/);
});

test('the default checksum lock URL is tied to the installed package version', () => {
  // Asserted against the manifest rather than a literal. The literal was 0.1.14 and made every
  // version bump fail a test whose subject is the tie between the two, not the number. The tie
  // is what matters: a consumer installing @threenative/runtime-native@X fetches its prebuilt
  // binaries from the release tagged runtime-native-vX, so a bump without a matching release is
  // an install that 404s.
  const version = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ).version;
  assert.equal(
    releaseManifestUrl(),
    `https://github.com/jonit-dev/threenative/releases/download/runtime-native-v${version}/prebuilt-lock.json`,
  );
  assert.match(releaseManifestUrl(), /\/runtime-native-v\d+\.\d+\.\d+\//u);
});

test('the installer can bootstrap a remote checksum lock before fetching the runtime', async () => {
  const root = makeTempDirSync('threenative-prebuilt-bootstrap-');
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

test('Android QuickJS prebuilts verify every runtime, SDL, and Java payload before writing', async () => {
  const root = makeTempDirSync('threenative-android-prebuilt-');
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
    await prepareAndroidPrebuilts({ engine: 'quickjs', manifestPath: manifest, outputRoot });
    for (const [key, path] of Object.entries(ANDROID_PREBUILT_ASSETS)) {
      assert.deepEqual(readFileSync(join(outputRoot, path)), contents[key]);
    }

    artifacts['android-x86_64-runtime'].sha256 = sha256(Buffer.from('wrong'));
    writeFileSync(manifest, `${JSON.stringify({ artifacts })}\n`);
    const rejectedRoot = join(root, 'rejected');
    await assert.rejects(
      prepareAndroidPrebuilts({ engine: 'quickjs', manifestPath: manifest, outputRoot: rejectedRoot }),
      /Checksum verification failed.*android-x86_64-runtime/u,
    );
    assert.equal(existsSync(rejectedRoot), false);

    delete artifacts['android-x86_64-runtime'];
    writeFileSync(manifest, `${JSON.stringify({ artifacts })}\n`);
    await assert.rejects(
      prepareAndroidPrebuilts({ engine: 'quickjs', manifestPath: manifest, outputRoot: rejectedRoot }),
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
  const root = makeTempDirSync('threenative-gradle-wrapper-');
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
  const root = makeTempDirSync('threenative-prebuilt-');
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
  const root = makeTempDirSync('threenative-consumer-');
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
  const root = makeTempDirSync('threenative-consumer-corrupt-');
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
  const root = makeTempDirSync('threenative-pack-');
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

test('the packed archive reaches the production profile command and evaluator', async () => {
  const root = makeTempDirSync('threenative-profile-pack-');
  roots.push(root);
  const packed = await packRuntime(root);
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.scripts['profile:production'], 'node scripts/profile-production.mjs');
  for (const file of ['scripts/profile-production.mjs', 'scripts/production-evidence.mjs']) {
    assert.ok(packed.files.includes(file), `pnpm pack omitted ${file}`);
  }
  const archive = await run('tar', ['-tf', packed.archive]);
  assert.match(archive.stdout, /package\/scripts\/profile-production\.mjs\n/u);
  assert.match(archive.stdout, /package\/scripts\/production-evidence\.mjs\n/u);
});


test('the V8 prebuilt set carries an engine-qualified runtime, its library, and a snapshot per ABI', async () => {
  // PRD-130 Phase 4. Before this the prebuilt path shipped five files, none of them V8, so a project
  // assembled from a release artifact got QuickJS whatever the engine default said -- a default only
  // operators with an NDK ever received.
  const v8Assets = androidPrebuiltAssets('v8');
  assert.equal(v8Assets, ANDROID_PREBUILT_V8_ASSETS);
  assert.equal(androidPrebuiltAssets('quickjs'), ANDROID_PREBUILT_ASSETS);
  assert.throws(() => androidPrebuiltAssets('jsc'), /Unknown Android JS engine/u);

  for (const abi of ['arm64-v8a', 'x86_64']) {
    // The runtime is engine-qualified because the binaries genuinely differ: QuickJS is compiled
    // into the runtime and V8 is not. Publishing one runtime for both engines would produce a
    // process that reports the wrong engine.
    assert.equal(v8Assets[`android-${abi}-runtime-v8`], `jniLibs/${abi}/libmystral-runtime.so`);
    assert.equal(v8Assets[`android-${abi}-v8`], `jniLibs/${abi}/libv8android.so`);
    assert.equal(v8Assets[`android-${abi}-libcxx`], `jniLibs/${abi}/libc++_shared.so`);
    // Per ABI, because the blobs differ and a slice handed the other ABI's is shipping wrong bytes.
    assert.equal(v8Assets[`android-${abi}-v8-snapshot`], `assets/v8/${abi}/snapshot_blob.bin`);
  }

  // The unqualified runtime keys stay QuickJS, so an older consumer of this map is unaffected.
  assert.equal(ANDROID_PREBUILT_ASSETS['android-arm64-v8a-runtime'], 'jniLibs/arm64-v8a/libmystral-runtime.so');
  assert.ok(!('android-arm64-v8a-v8' in ANDROID_PREBUILT_ASSETS), 'the QuickJS set must not ship V8');
});

test('a QuickJS prebuilt directory cannot satisfy a V8 build', async () => {
  // The negative control PRD-130 Phase 4 asks for: populate android/prebuilt/ from a QuickJS
  // release, request V8, and the build must refuse rather than produce an APK whose logcat says
  // QuickJS. Expressed here as the contract the Gradle completeness check reads.
  const gradle = readFileSync(
    new URL('../android/app/build.gradle.kts', import.meta.url),
    'utf8',
  );
  assert.match(gradle, /prebuiltEngineFiles = if \(nativeJsEngineName == "v8"\)/u,
    'the prebuilt file list must depend on the engine');
  assert.match(gradle, /libv8android\.so/u, 'a V8 prebuilt build must require the V8 library');
  assert.match(gradle, /assets\/v8\/\$abi\/snapshot_blob\.bin/u,
    'a V8 prebuilt build must require a snapshot per ABI');
  assert.match(gradle, /Android prebuilt runtime is incomplete for engine/u,
    'the refusal must name the engine, or the reader hunts a corrupt download instead of a mismatch');

  // Missing files are listed, so the message says which engine the directory was populated for.
  assert.match(gradle, /Missing: \$missing/u, 'the refusal must name the files it wanted');
});
