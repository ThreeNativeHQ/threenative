import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { promisify } from 'node:util';
import { afterEach, test } from 'vitest';
import { PNG } from 'pngjs';

import {
  PREBUILT_KEYS,
  RELEASE_REPOSITORY,
  downloadReleaseArtifact,
  installPrebuilt,
  platformKey,
  readRelease,
  releaseManifestUrl,
  sha256,
  verifyChecksum,
  writeInstallStatus,
} from '../scripts/install-prebuilt.mjs';
import {
  ANDROID_PREBUILT_ASSETS,
  ANDROID_PREBUILT_V8_ASSETS,
  androidPrebuiltAssets,
  ensureGradleWrapper,
  prepareAndroidPrebuilts,
} from '../scripts/package-android.mjs';

/** Serves a set of named payloads over loopback and hands back a fixture `prebuilt-lock.json`. */
async function serveFixtureRelease(root, contents) {
  const server = createServer((request, response) => {
    const key = decodeURIComponent(request.url.slice(1));
    const payload = contents[key];
    if (payload === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const artifacts = Object.fromEntries(
    Object.entries(contents).map(([key, payload]) => [
      key,
      { sha256: sha256(payload), url: `http://127.0.0.1:${address.port}/${encodeURIComponent(key)}` },
    ]),
  );
  const manifest = join(root, 'prebuilt-lock.json');
  writeFileSync(manifest, `${JSON.stringify({ artifacts }, null, 2)}\n`);
  return {
    artifacts,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    manifest,
    rewrite: (mutate) => {
      mutate(artifacts);
      writeFileSync(manifest, `${JSON.stringify({ artifacts }, null, 2)}\n`);
    },
  };
}

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
    `https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v${version}/prebuilt-lock.json`,
  );
  assert.equal(RELEASE_REPOSITORY, 'ThreeNativeHQ/threenative');
  assert.match(releaseManifestUrl(), /\/runtime-native-v\d+\.\d+\.\d+\//u);
});

test('records a failed prebuilt install with its release URL and reason', () => {
  const root = makeTempDirSync('threenative-install-status-');
  roots.push(root);
  const url = releaseManifestUrl();
  const statusPath = join(root, 'prebuilt', 'install-status.json');
  writeInstallStatus(
    {
      key: 'linux-x64',
      ok: false,
      reason: `Prebuilt release manifest fetch failed for 'linux-x64' at ${url}: HTTP 404.`,
      url,
      version: '0.3.0',
    },
    statusPath,
  );
  assert.deepEqual(JSON.parse(readFileSync(statusPath, 'utf8')), {
    key: 'linux-x64',
    ok: false,
    reason: `Prebuilt release manifest fetch failed for 'linux-x64' at ${url}: HTTP 404.`,
    url,
    version: '0.3.0',
  });
});

test('a 404 release manifest is recognised as a missing release, not a generic failure', async () => {
  const server = createServer((request, response) => {
    response.statusCode = 404;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    await assert.rejects(
      downloadReleaseArtifact('linux-x64', {
        manifestUrl: `http://127.0.0.1:${address.port}/prebuilt-lock.json`,
      }),
      (error) => error.code === 'PREBUILT_RELEASE_MISSING',
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('an unpublished release records the gap and finishes the consumer install', async () => {
  const root = makeTempDirSync('threenative-prebuilt-missing-');
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: '@threenative/runtime-native', version: '0.3.0' })}\n`,
  );
  // The shipped script itself, not a reimplementation: the subject is the install lifecycle.
  writeFileSync(
    join(root, 'scripts', 'install-prebuilt.mjs'),
    readFileSync(join(import.meta.dirname, '..', 'scripts', 'install-prebuilt.mjs')),
  );
  const manifestPath = join(root, 'prebuilt-lock.json'); // deliberately absent
  const result = await run(process.execPath, [join(root, 'scripts', 'install-prebuilt.mjs')], {
    cwd: root,
    env: { ...process.env, THREENATIVE_PREBUILT_MANIFEST: manifestPath },
  });
  // `run` rejects on a non-zero exit — the pre-fix install aborts here, which is the red.
  const status = JSON.parse(readFileSync(join(root, 'prebuilt', 'install-status.json'), 'utf8'));
  assert.equal(status.ok, false);
  assert.match(status.reason, /linux-x64/);
  assert.match(result.stderr, /no prebuilt release is published/iu);
});

test('exports the complete prebuilt key table consumed by release packaging', () => {
  assert.ok(PREBUILT_KEYS.includes('linux-x64'));
  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime'));
  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime-v8'));
  assert.ok(PREBUILT_KEYS.includes('ios-simulator-arm64'));
});

test('the native release workflow covers every exported prebuilt key', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'native-release.yml'),
    'utf8',
  );
  assert.match(workflow, /PREBUILT_KEYS/u);
  const namesBlock = workflow.match(/const names = \{([\s\S]*?)\n\s*\};/u)?.[1];
  assert.ok(namesBlock, 'native release workflow has no checksum key table');
  const workflowKeys = [...namesBlock.matchAll(/^\s*"([^"]+)":/gmu)].map((match) => match[1]);
  assert.deepEqual([...workflowKeys].sort(), [...PREBUILT_KEYS].sort());
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

test('a clean-room install builds for Android from a fixture manifest, with no engine checkout', async () => {
  // PRD-212 Phase 2. Every other Android test in this file runs inside the workspace, where
  // CMakeLists.txt and a staged SDL3 AAR are simply present, so `packageAndroid` takes the source
  // path and the prebuilt path is never exercised. A stranger has neither. This installs the packed
  // tarball into a directory with no workspace and no engine checkout, and drives the packager from
  // *there* — which is the only arrangement in which the 404 that killed bug 6 could have been seen.
  const root = makeTempDirSync('threenative-android-cleanroom-');
  roots.push(root);
  const assets = ANDROID_PREBUILT_V8_ASSETS;
  const contents = Object.fromEntries(
    Object.keys(assets).map((key) => [key, Buffer.from(`payload:${key}`)]),
  );
  const release = await serveFixtureRelease(root, contents);
  try {
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    // The hook a stranger actually has. `packageAndroid` builds its own prebuilt call, so an
    // option would test a seam no user can reach; the env variable is the shipped contract.
    process.env.THREENATIVE_PREBUILT_MANIFEST = release.manifest;
    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    const packed = await packRuntime(root);
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@threenative/runtime-native': `file:${packed.archive}` },
        name: 'android-cleanroom-proof',
        private: true,
      })}\n`,
    );
    await run('pnpm', ['install', '--ignore-scripts'], { cwd: consumer, env: { ...process.env } });

    const installed = join(consumer, 'node_modules/@threenative/runtime-native');
    // The detection the packager itself uses. If either of these were true the prebuilt path would
    // be skipped and this test would silently prove the workspace path again.
    assert.equal(existsSync(join(installed, 'CMakeLists.txt')), false);
    assert.equal(existsSync(join(installed, 'third_party/sdl3-android/SDL3-3.2.8.aar')), false);

    const { packageAndroid } = await import(
      new URL(`file://${join(installed, 'scripts/package-android.mjs')}`).href
    );

    const bundle = join(root, 'main.js');
    writeFileSync(bundle, 'export default { start() {} };\n');
    const gradleInvocations = [];
    await packageAndroid(bundle, join(root, 'game.apk'), undefined, undefined, undefined, {
      // cmake and the NDK are masked: the whole point of the prebuilt path is that a stranger
      // compiles no C++. Gradle is masked too — this gate proves the stranger's build reaches it
      // with the right arguments and the right prebuilts staged, offline and on any machine.
      ensureGradleWrapper: async () => join(installed, 'android/gradle/wrapper/gradle-wrapper.jar'),
      runtimeRoot: installed,
      spawnSync: (command, args) => {
        gradleInvocations.push({ args, command });
        mkdirSync(join(installed, 'android/app/build/outputs/apk/debug'), { recursive: true });
        writeFileSync(
          join(installed, 'android/app/build/outputs/apk/debug/app-debug.apk'),
          'clean-room apk',
        );
        return { status: 0, stdout: '' };
      },
    });

    // Every prebuilt the fixture manifest named landed where the Gradle build expects it.
    for (const [key, path] of Object.entries(assets)) {
      assert.deepEqual(
        readFileSync(join(installed, 'android/prebuilt', path)),
        contents[key],
        `${key} was not staged from the fixture manifest`,
      );
    }
    assert.equal(gradleInvocations.length, 1);
    assert.ok(
      gradleInvocations[0].args.includes('assembleDebug'),
      `Gradle was not asked to assemble: ${JSON.stringify(gradleInvocations[0].args)}`,
    );
    assert.equal(existsSync(join(root, 'game.apk')), true);
  } finally {
    delete process.env.THREENATIVE_PREBUILT_MANIFEST;
    await release.close();
  }
}, 300_000);

test('the clean-room Android build fails loudly on a corrupt fixture manifest', async () => {
  // The negative control for the gate above: a masked SDK or a corrupt lock must fail closed, not
  // fall through to a build that quietly used nothing. A gate that passes on a broken manifest
  // proves only that it ran.
  const root = makeTempDirSync('threenative-android-cleanroom-red-');
  roots.push(root);
  const contents = Object.fromEntries(
    Object.keys(ANDROID_PREBUILT_V8_ASSETS).map((key) => [key, Buffer.from(`payload:${key}`)]),
  );
  const release = await serveFixtureRelease(root, contents);
  try {
    process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT = '1';
    const outputRoot = join(root, 'android');

    release.rewrite((artifacts) => {
      artifacts['android-arm64-v8a-runtime-v8'].sha256 = sha256(Buffer.from('tampered'));
    });
    await assert.rejects(
      prepareAndroidPrebuilts({ manifestPath: release.manifest, outputRoot }),
      /Checksum verification failed.*android-arm64-v8a-runtime-v8/u,
      'a tampered artifact must not be staged',
    );
    assert.equal(existsSync(outputRoot), false);

    release.rewrite((artifacts) => {
      delete artifacts['android-sdl3-aar'];
    });
    await assert.rejects(
      prepareAndroidPrebuilts({ manifestPath: release.manifest, outputRoot }),
      /No prebuilt release asset.*android-sdl3-aar/u,
      'a manifest missing an asset must name the asset',
    );
    assert.equal(existsSync(outputRoot), false);

    await assert.rejects(
      prepareAndroidPrebuilts({ manifestPath: join(root, 'absent-lock.json'), outputRoot }),
      /No prebuilt release manifest exists/u,
      'an absent manifest must fail closed rather than fetch the network',
    );
  } finally {
    await release.close();
  }
}, 120_000);

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
    assert.equal(
      JSON.parse(
        readFileSync(
          join(
            consumer,
            'node_modules/@threenative/runtime-native/prebuilt/install-status.json',
          ),
          'utf8',
        ),
      ).ok,
      true,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test.runIf(process.platform === 'linux')('an installed runtime verifier uses packaged Linux display support', async () => {
  const root = makeTempDirSync('threenative-installed-verifier-');
  roots.push(root);
  const consumer = join(root, 'consumer');
  const packed = await packRuntime(root);
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      dependencies: { '@threenative/runtime-native': `file:${packed.archive}` },
      name: 'installed-verifier-proof',
      private: true,
    }),
  );
  await run('pnpm', ['install', '--ignore-scripts', '--node-linker=hoisted'], {
    cwd: consumer,
  });
  const runtimePackage = join(consumer, 'node_modules', '@threenative', 'runtime-native');

  const expectedScreenshot = join(root, 'expected.png');
  const png = new PNG({ height: 16, width: 16 });
  for (let index = 0; index < png.data.length; index += 4) {
    const cyan = index < 128 * 4;
    png.data[index] = cyan ? 20 : 0;
    png.data[index + 1] = cyan ? 220 : 0;
    png.data[index + 2] = cyan ? 240 : 0;
    png.data[index + 3] = 255;
  }
  writeFileSync(expectedScreenshot, PNG.sync.write(png));

  const artifactDirectory = join(consumer, 'dist-native');
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'starter' }));
  const artifact = join(artifactDirectory, 'starter');
  const artifactScript = [
    '#!/bin/sh',
    'set -eu',
    'screenshot=',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --screenshot) screenshot="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    'cp "$TN_TEST_SCREENSHOT" "$screenshot"',
    "printf '%s\\n' 'TN_NATIVE_SMOKE_READY:webgpu' 'TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb' 'TN_NATIVE_SMOKE_300_FRAMES:300' 'Rendered 300 frames in 1ms'",
    '',
  ].join('\n');
  writeFileSync(artifact, artifactScript);
  chmodSync(artifact, 0o755);

  const verifier = join(runtimePackage, 'scripts', 'verify-starter-desktop.mjs');
  const result = await run(process.execPath, [verifier], {
    cwd: consumer,
    env: { ...process.env, TN_TEST_SCREENSHOT: expectedScreenshot },
  });
  assert.match(result.stdout, /starter desktop gate passed: 300 frames/u);
  assert.equal(
    JSON.parse(
      readFileSync(join(consumer, 'artifacts', 'native', 'starter-desktop-report.json'), 'utf8'),
    ).pass,
    true,
  );
  await assert.rejects(
    run('sh', [join(runtimePackage, 'scripts', 'xvfb.sh'), process.execPath, '-e', 'process.exit(7)'], {
      cwd: consumer,
    }),
    (error) => error?.code === 7,
  );
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
      existsSync(
        join(
          consumer,
          'node_modules/@threenative/runtime-native/prebuilt/linux-x64/threenative-runtime',
        ),
      ),
      false,
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          join(
            consumer,
            'node_modules/@threenative/runtime-native/prebuilt/install-status.json',
          ),
          'utf8',
        ),
      ).ok,
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
