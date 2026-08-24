#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
export const RELEASE_REPOSITORY = 'ThreeNativeHQ/threenative';

/** Every key a packaged consumer or native release workflow may request. */
export const PREBUILT_KEYS = Object.freeze([
  'android-arm64-v8a-runtime',
  'android-arm64-v8a-runtime-v8',
  'android-arm64-v8a-sdl3',
  'android-arm64-v8a-v8',
  'android-arm64-v8a-libcxx',
  'android-arm64-v8a-v8-snapshot',
  'android-sdl3-aar',
  'android-x86_64-runtime',
  'android-x86_64-runtime-v8',
  'android-x86_64-sdl3',
  'android-x86_64-v8',
  'android-x86_64-libcxx',
  'android-x86_64-v8-snapshot',
  'darwin-arm64',
  'linux-x64',
  'ios-simulator-arm64',
  'win32-x64',
]);

const supported = new Set(['darwin-arm64', 'linux-x64', 'win32-x64']);

export function platformKey(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!supported.has(key)) throw new Error(`Unsupported native runtime platform '${key}'.`);
  return key;
}

export function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function verifyChecksum(contents, expected, key) {
  const actual = sha256(contents);
  if (!/^[a-f0-9]{64}$/u.test(expected) || actual !== expected) {
    throw new Error(`Checksum verification failed for '${key}': expected ${expected}, received ${actual}.`);
  }
}

function releaseFromManifest(manifest, key) {
  const release = manifest.artifacts?.[key];
  if (!release?.url || !release?.sha256) {
    throw new Error(`No prebuilt release asset is recorded for '${key}'.`);
  }
  const url = new URL(release.url);
  if (url.protocol !== 'https:' && process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT !== '1') {
    throw new Error(`Prebuilt release URL for '${key}' must use HTTPS.`);
  }
  return release;
}

export function readRelease(manifestPath, key) {
  if (!existsSync(manifestPath)) {
    throw new Error(`No prebuilt release manifest exists for '${key}'; this target remains OPEN.`);
  }
  return releaseFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), key);
}

export function releaseManifestUrl(version = packageVersion) {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/runtime-native-v${encodeURIComponent(version)}/prebuilt-lock.json`;
}

export function writeInstallStatus(status, statusPath = join(packageRoot, 'prebuilt', 'install-status.json')) {
  mkdirSync(dirname(statusPath), { recursive: true });
  writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  return statusPath;
}

async function fetchRelease(manifestUrl, key) {
  const url = new URL(manifestUrl);
  if (url.protocol !== 'https:' && process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT !== '1') {
    throw new Error(`Prebuilt release manifest for '${key}' must use HTTPS.`);
  }
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Prebuilt release manifest fetch failed for '${key}' at ${url.href}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Prebuilt release manifest fetch failed for '${key}' at ${url.href}: HTTP ${response.status}.`,
    );
  }
  return releaseFromManifest(await response.json(), key);
}

export async function downloadReleaseArtifact(key, options = {}) {
  const manifestPath = options.manifestPath ?? process.env.THREENATIVE_PREBUILT_MANIFEST;
  const release = manifestPath
    ? readRelease(resolve(manifestPath), key)
    : await fetchRelease(options.manifestUrl ?? releaseManifestUrl(), key);
  let response;
  try {
    response = await fetch(release.url);
  } catch (error) {
    throw new Error(
      `Prebuilt release fetch failed for '${key}' at ${release.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Prebuilt release fetch failed for '${key}' at ${release.url}: HTTP ${response.status}.`);
  }
  const contents = Buffer.from(await response.arrayBuffer());
  verifyChecksum(contents, release.sha256, key);
  return contents;
}

export async function installPrebuilt(options = {}) {
  const key = platformKey(options.platform, options.arch);
  const contents = await downloadReleaseArtifact(key, options);
  const filename = process.platform === 'win32' ? 'threenative-runtime.exe' : 'threenative-runtime';
  const output = resolve(options.output ?? join(packageRoot, 'prebuilt', key, filename));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, contents);
  if (process.platform !== 'win32') chmodSync(output, 0o755);
  console.log(`Installed verified ThreeNative runtime for '${key}'.`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceCheckout = existsSync(join(packageRoot, 'src')) && existsSync(join(packageRoot, 'CMakeLists.txt'));
  if (sourceCheckout) {
    console.log('ThreeNative runtime source checkout detected; prebuilt install is deferred to package testing.');
  } else {
    const key = `${process.platform}-${process.arch}`;
    const url = process.env.THREENATIVE_PREBUILT_MANIFEST ?? releaseManifestUrl();
    installPrebuilt()
      .then(() => writeInstallStatus({ key, ok: true, reason: 'installed', url, version: packageVersion }))
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        try {
          writeInstallStatus({ key, ok: false, reason, url, version: packageVersion });
        } catch (statusError) {
          console.error(
            `Could not record prebuilt install status: ${statusError instanceof Error ? statusError.message : String(statusError)}`,
          );
        }
        console.error(reason);
        process.exitCode = 1;
      });
  }
}
