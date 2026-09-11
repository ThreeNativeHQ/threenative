import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { test } from 'vitest';
import { resolveWgpuCacheToolchain, WGPU_CACHE_NDK_VERSION, WGPU_CACHE_RUST_VERSION } from '../scripts/wgpu-cache-toolchain.mjs';

function fixture() {
  const root = makeTempDirSync('tn-cache-ndk-');
  const llvm = join(root, 'toolchains/llvm/prebuilt/linux-x86_64');
  for (const folder of ['musl/lib', 'bin', 'sysroot']) mkdirSync(join(llvm, folder), { recursive: true });
  for (const name of ['musl/lib/libclang.so', 'bin/aarch64-linux-android21-clang', 'bin/llvm-ar']) writeFileSync(join(llvm, name), 'fixture');
  writeFileSync(join(root, 'source.properties'), `Pkg.Revision = ${WGPU_CACHE_NDK_VERSION}\n`);
  return { root, llvm, env: { ANDROID_NDK_HOME: root } };
}
test('uses the pinned installed NDK rather than a developer home directory', () => {
  const f = fixture();
  try {
    const plan = resolveWgpuCacheToolchain({ target: 'linux-x64', env: f.env, platform: 'linux', arch: 'x64' });
    assert.equal(plan.env.LIBCLANG_PATH, join(f.llvm, 'musl/lib'));
    assert.equal(plan.rustVersion, WGPU_CACHE_RUST_VERSION);
    assert.equal(plan.target, 'linux-x64');
    assert.deepEqual(plan.cargoArgs, [`+${WGPU_CACHE_RUST_VERSION}`, 'build', '--release', '--locked', '-j', '2']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('Android arm64 binds compiler, linker, archiver, target, and 16 KB alignment', () => {
  const f = fixture();
  try {
    const plan = resolveWgpuCacheToolchain({ target: 'android-arm64', env: f.env, platform: 'linux', arch: 'x64' });
    assert.equal(plan.rustTarget, 'aarch64-linux-android');
    assert.equal(plan.env.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER, join(f.llvm, 'bin/aarch64-linux-android21-clang'));
    assert.equal(plan.env.AR_aarch64_linux_android, join(f.llvm, 'bin/llvm-ar'));
    assert.match(plan.env.RUSTFLAGS, /max-page-size=16384/);
    assert.deepEqual(plan.cargoArgs.slice(-2), ['--target', 'aarch64-linux-android']);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('refuses an NDK version change before invoking unsafe source reconstruction', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'source.properties'), 'Pkg.Revision = 99.0.0\n');
    assert.throws(() => resolveWgpuCacheToolchain({ env: f.env, platform: 'linux', arch: 'x64' }), /TN_WGPU_CACHE_NDK_VERSION/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('missing toolchain or unsupported targets are explicit rather than silently host-built', () => {
  assert.throws(() => resolveWgpuCacheToolchain({ env: {}, platform: 'linux', arch: 'x64' }), /TN_WGPU_CACHE_NDK_MISSING/);
  assert.throws(() => resolveWgpuCacheToolchain({ target: 'ios', env: {}, platform: 'linux', arch: 'x64' }), /TN_WGPU_CACHE_TARGET/);
  assert.throws(() => resolveWgpuCacheToolchain({ env: {}, platform: 'darwin', arch: 'arm64' }), /TN_WGPU_CACHE_BUILD_HOST/);
});

// The hosted-runner shape, which is how this failed in CI: the image presets ANDROID_NDK_HOME and
// ANDROID_NDK_ROOT to whichever NDK it ships, `sdkmanager 'ndk;<pin>'` installs the pinned one
// under $ANDROID_HOME/ndk/<pin>, and both are present at once. Reading the env first picked the
// image's NDK and failed with
//   TN_WGPU_CACHE_NDK_VERSION: expected 27.1.12297006, got 27.3.13750724
// even though the pinned toolchain was installed and correct.
test('prefers the pinned SDK install over a preset ANDROID_NDK_HOME from the runner image', () => {
  const sdk = makeTempDirSync('tn-cache-sdk-');
  const preset = makeTempDirSync('tn-cache-image-ndk-');
  try {
    // The image's NDK: a different revision, complete enough to be chosen if it were consulted.
    mkdirSync(join(preset, 'toolchains/llvm/prebuilt/linux-x86_64/musl/lib'), { recursive: true });
    writeFileSync(join(preset, 'toolchains/llvm/prebuilt/linux-x86_64/musl/lib/libclang.so'), 'x');
    writeFileSync(join(preset, 'source.properties'), 'Pkg.Revision = 27.3.13750724\n');

    // The pinned install, where sdkmanager puts it.
    const pinnedRoot = join(sdk, 'ndk', WGPU_CACHE_NDK_VERSION);
    const pinnedLlvm = join(pinnedRoot, 'toolchains/llvm/prebuilt/linux-x86_64');
    for (const folder of ['musl/lib', 'bin', 'sysroot']) {
      mkdirSync(join(pinnedLlvm, folder), { recursive: true });
    }
    for (const name of ['musl/lib/libclang.so', 'bin/aarch64-linux-android21-clang', 'bin/llvm-ar']) {
      writeFileSync(join(pinnedLlvm, name), 'fixture');
    }
    writeFileSync(join(pinnedRoot, 'source.properties'), `Pkg.Revision = ${WGPU_CACHE_NDK_VERSION}\n`);

    const plan = resolveWgpuCacheToolchain({
      target: 'linux-x64',
      env: { ANDROID_HOME: sdk, ANDROID_NDK_HOME: preset, ANDROID_NDK_ROOT: preset },
      platform: 'linux',
      arch: 'x64',
    });
    assert.equal(plan.env.LIBCLANG_PATH, join(pinnedLlvm, 'musl/lib'));
  } finally {
    rmSync(sdk, { recursive: true, force: true });
    rmSync(preset, { recursive: true, force: true });
  }
});

// PRD-221 and PRD-368 have independent backend/host toolchain pins. The host must follow
// Gradle's V8/STL recipe after reconstruction, not inherit bindgen's pinned NDK.
const workflow = readFileSync(new URL('../../../.github/workflows/pipeline-cache.yml', import.meta.url), 'utf8');
for (const version of ['27.1.12297006', '28.2.13676358', 'missing']) {
  test(`Android host provisioning follows the checked-out Gradle NDK (${version})`, () => {
    const step = workflow.split('- name: Select the Android host NDK from Gradle\n')[1]?.split('\n      - ')[0];
    assert.ok(step, 'host provisioning must not inherit the backend bindgen NDK');
    const script = step.split('run: |\n')[1]?.split('\n').map((line) => line.replace(/^ {10}/u, '')).join('\n');
    assert.ok(script, 'missing executable host toolchain selection');
    const root = makeTempDirSync('tn-cache-host-ndk-');
    try {
      mkdirSync(join(root, 'packages/runtime-native/android'), { recursive: true });
      mkdirSync(join(root, 'bin'));
      writeFileSync(join(root, 'packages/runtime-native/android/gradle.properties'), version === 'missing' ? '' : `android.ndkVersion=${version}\n`);
      const manager = join(root, 'bin/sdkmanager');
      writeFileSync(manager, '#!/bin/sh\nprintf "%s\\n" "$@" > "$SDK_REQUESTS"\n');
      chmodSync(manager, 0o755);
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: root, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ANDROID_HOME: join(root, 'sdk'),
          ANDROID_NDK_HOME: '/image/preset-ndk', SDK_REQUESTS: join(root, 'requests'), GITHUB_ENV: join(root, 'env') },
      });
      assert.ifError(result.error);
      if (version === 'missing') { assert.notEqual(result.status, 0, 'missing Gradle recipe must fail closed'); return; }
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(join(root, 'requests'), 'utf8').trim(), `ndk;${version}`);
      assert.equal(readFileSync(join(root, 'env'), 'utf8'),
        `ANDROID_NDK_HOME=${root}/sdk/ndk/${version}\nANDROID_NDK_ROOT=${root}/sdk/ndk/${version}\n`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
test('the Android cache ABI lane can reuse the resumable V8 producer without weakening failure propagation', () => {
  const start = workflow.indexOf('  patched-backend:');
  const body = workflow.slice(start, workflow.indexOf('\n  host-contract:', start));
  assert.match(body, /timeout-minutes: \$\{\{ matrix\.target == 'android-arm64' && (\d+) \|\| 45 \}\}/u);
  const budget = Number(body.match(/&& (\d+) \|\| 45/u)?.[1]);
  assert.ok(budget >= 150, 'the 120-minute V8 build and cache save cannot fit a 45-minute job');
  const producer = body.indexOf('uses: ./.github/actions/android-v8-source');
  assert.ok(producer > body.indexOf('- name: Select the Android host NDK from Gradle'));
  assert.ok(producer < body.indexOf('- name: Compile Android host against reconstructed backend'));
  const step = body.slice(body.lastIndexOf('      - ', producer), producer);
  assert.match(step, /matrix\.target == 'android-arm64'/u);
  assert.match(step, /hashFiles\('packages\/runtime-native\/scripts\/build-android-v8\.mjs'\) != ''/u);
  assert.doesNotMatch(step, /continue-on-error/u);
});
