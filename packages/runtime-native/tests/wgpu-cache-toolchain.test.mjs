import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { resolveWgpuCacheToolchain, WGPU_CACHE_NDK_VERSION, WGPU_CACHE_RUST_VERSION } from '../scripts/wgpu-cache-toolchain.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tn-cache-ndk-'));
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
  const sdk = mkdtempSync(join(tmpdir(), 'tn-cache-sdk-'));
  const preset = mkdtempSync(join(tmpdir(), 'tn-cache-image-ndk-'));
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
