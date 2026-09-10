// PRD-368: the cache patch is rebuilt with one pinned bindgen toolchain on Linux and Android.
// A stock prebuilt remains the normal dependency path; this is the explicit source-build route.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const WGPU_CACHE_NDK_VERSION = '27.1.12297006';
export const WGPU_CACHE_RUST_VERSION = '1.90.0';

export function resolveWgpuCacheToolchain({
  target = 'linux-x64', env = process.env, platform = process.platform, arch = process.arch,
} = {}) {
  if (!['linux-x64', 'android-arm64'].includes(target)) {
    throw new Error(`TN_WGPU_CACHE_TARGET: unsupported target ${target}`);
  }
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error('TN_WGPU_CACHE_BUILD_HOST: the pinned cache source build requires Linux x64');
  }
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  const ndk = env.ANDROID_NDK_HOME || env.ANDROID_NDK_ROOT || (sdk && join(sdk, 'ndk', WGPU_CACHE_NDK_VERSION));
  if (!ndk || !existsSync(join(ndk, 'source.properties'))) {
    throw new Error(`TN_WGPU_CACHE_NDK_MISSING: install NDK ${WGPU_CACHE_NDK_VERSION} and set ANDROID_NDK_HOME or ANDROID_HOME`);
  }
  const revision = readFileSync(join(ndk, 'source.properties'), 'utf8').match(/^Pkg\.Revision\s*=\s*(\S+)\s*$/m)?.[1];
  if (revision !== WGPU_CACHE_NDK_VERSION) {
    throw new Error(`TN_WGPU_CACHE_NDK_VERSION: expected ${WGPU_CACHE_NDK_VERSION}, got ${revision ?? 'missing'}`);
  }
  const llvm = join(ndk, 'toolchains/llvm/prebuilt/linux-x86_64');
  const libclang = join(llvm, 'musl/lib');
  if (!existsSync(join(libclang, 'libclang.so'))) {
    throw new Error(`TN_WGPU_CACHE_LIBCLANG_MISSING: ${join(libclang, 'libclang.so')}`);
  }
  const cargoArgs = [`+${WGPU_CACHE_RUST_VERSION}`, 'build', '--release', '--locked', '-j', '2'];
  const buildEnv = { ...env, LIBCLANG_PATH: libclang };
  let rustTarget = null;
  if (target === 'android-arm64') {
    rustTarget = 'aarch64-linux-android';
    const compiler = join(llvm, 'bin/aarch64-linux-android21-clang');
    const archiver = join(llvm, 'bin/llvm-ar');
    for (const tool of [compiler, archiver]) {
      if (!existsSync(tool)) throw new Error(`TN_WGPU_CACHE_TOOL_MISSING: ${tool}`);
    }
    buildEnv.CC_aarch64_linux_android = compiler;
    buildEnv.AR_aarch64_linux_android = archiver;
    buildEnv.CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = compiler;
    buildEnv.BINDGEN_EXTRA_CLANG_ARGS = `--sysroot=${join(llvm, 'sysroot')} --target=aarch64-linux-android21`;
    buildEnv.RUSTFLAGS = `${env.RUSTFLAGS ?? ''} -C link-arg=-Wl,-z,max-page-size=16384`.trim();
    cargoArgs.push('--target', rustTarget);
  }
  return { target, rustTarget, rustVersion: WGPU_CACHE_RUST_VERSION, ndkVersion: revision, cargoArgs, env: buildEnv };
}
