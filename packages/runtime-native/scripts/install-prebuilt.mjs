#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
export const RELEASE_REPOSITORY = 'ThreeNativeHQ/threenative';

/** Every asset a packaged consumer or native release workflow may request. */
export const PREBUILT_ASSET_NAMES = Object.freeze({
  'android-arm64-v8a-runtime': 'threenative-runtime-android-arm64-v8a.so',
  'android-arm64-v8a-runtime-v8': 'threenative-runtime-android-arm64-v8a-v8.so',
  'android-arm64-v8a-sdl3': 'threenative-sdl3-android-arm64-v8a.so',
  'android-arm64-v8a-v8': 'threenative-v8-android-arm64-v8a.so',
  'android-arm64-v8a-libcxx': 'threenative-libcxx-android-arm64-v8a.so',
  'android-arm64-v8a-v8-snapshot': 'threenative-v8-snapshot-android-arm64-v8a.bin',
  'android-sdl3-aar': 'threenative-sdl3-android.aar',
  'android-x86_64-runtime': 'threenative-runtime-android-x86_64.so',
  'android-x86_64-runtime-v8': 'threenative-runtime-android-x86_64-v8.so',
  'android-x86_64-sdl3': 'threenative-sdl3-android-x86_64.so',
  'android-x86_64-v8': 'threenative-v8-android-x86_64.so',
  'android-x86_64-libcxx': 'threenative-libcxx-android-x86_64.so',
  'android-x86_64-v8-snapshot': 'threenative-v8-snapshot-android-x86_64.bin',
  'darwin-arm64': 'threenative-runtime-darwin-arm64',
  'ios-simulator-arm64': 'threenative-ios-simulator-arm64.zip',
  'linux-x64': 'threenative-runtime-linux-x64',
  'win32-x64': 'threenative-runtime-win32-x64.exe',
});

/** Every key a packaged consumer or native release workflow may request. */
export const PREBUILT_KEYS = Object.freeze(Object.keys(PREBUILT_ASSET_NAMES));

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
  const release = manifest?.artifacts?.[key];
  if (!release?.url || !release?.sha256) {
    throw new Error(`No prebuilt release asset is recorded for '${key}'.`);
  }
  if (typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(release.sha256)) {
    throw new Error(`Invalid prebuilt SHA-256 for '${key}'.`);
  }
  const url = new URL(release.url);
  if (url.protocol !== 'https:' && process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT !== '1') {
    throw new Error(`Prebuilt release URL for '${key}' must use HTTPS.`);
  }
  return release;
}

/** Validate the entire advertised cohort before selecting even one consumer artifact. */
export function validateReleaseManifest(manifest, options = {}) {
  if (manifest?.schemaVersion !== 1) throw new Error('Unsupported or missing prebuilt manifest schemaVersion.');
  const version = options.version ?? packageVersion;
  if (manifest.version !== version) {
    throw new Error(`Prebuilt manifest version mismatch: expected ${version}, received ${manifest.version}.`);
  }
  if (typeof manifest.sourceSha !== 'string' || !/^[a-f0-9]{40}$/u.test(manifest.sourceSha)) {
    throw new Error('Prebuilt manifest must record a full source SHA.');
  }
  if (options.sourceSha !== undefined && manifest.sourceSha !== options.sourceSha) {
    throw new Error(`Prebuilt source SHA mismatch: expected ${options.sourceSha}, received ${manifest.sourceSha}.`);
  }
  if (!manifest.artifacts || typeof manifest.artifacts !== 'object' || Array.isArray(manifest.artifacts)) {
    throw new Error('Prebuilt manifest artifacts must be an object.');
  }
  // iOS retains its separate release gate; it is not a prerequisite for a non-iOS consumer.
  const requiredKeys = options.requiredKeys ?? PREBUILT_KEYS.filter((key) => !key.startsWith('ios-'));
  for (const key of requiredKeys) releaseFromManifest(manifest, key);
  for (const key of Object.keys(manifest.artifacts)) {
    if (!Object.hasOwn(PREBUILT_ASSET_NAMES, key)) throw new Error(`Unknown prebuilt release key '${key}'.`);
    const release = releaseFromManifest(manifest, key);
    if (!Number.isSafeInteger(release.size) || release.size <= 0) {
      throw new Error(`Prebuilt release size for '${key}' must be a positive integer.`);
    }
    const expectedUrl = `${releaseManifestUrl(version).replace('/prebuilt-lock.json', '')}/${PREBUILT_ASSET_NAMES[key]}`;
    const url = new URL(release.url);
    const loopbackFixture = process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT === '1' &&
      url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
      !url.username && !url.password;
    if (release.url !== expectedUrl && !loopbackFixture) {
      throw new Error(`Prebuilt release URL for '${key}' must match version ${version}: ${expectedUrl}.`);
    }
  }
  return manifest;
}

/** The release workflow uses this same validator, including its existing iOS requirement. */
export function generateReleaseManifest(directory, { repository, tag, sourceSha }) {
  if (repository !== RELEASE_REPOSITORY) {
    throw new Error(`Prebuilt releases must be published by ${RELEASE_REPOSITORY}, received ${repository}.`);
  }
  if (tag !== `runtime-native-v${packageVersion}`) {
    throw new Error(`Prebuilt release tag must be runtime-native-v${packageVersion}, received ${tag}.`);
  }
  const expected = Object.values(PREBUILT_ASSET_NAMES).sort();
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Incomplete prebuilt release matrix: expected ${expected.join(', ')}; received ${actual.join(', ')}.`);
  }
  const artifacts = Object.fromEntries(Object.entries(PREBUILT_ASSET_NAMES).map(([key, name]) => {
    const contents = readFileSync(join(directory, name));
    if (contents.length === 0) throw new Error(`Prebuilt release asset '${key}' is empty.`);
    return [key, { sha256: sha256(contents), size: contents.length,
      url: `${releaseManifestUrl().replace('/prebuilt-lock.json', '')}/${name}` }];
  }));
  return validateReleaseManifest({ schemaVersion: 1, version: packageVersion, sourceSha, artifacts },
    { sourceSha, requiredKeys: PREBUILT_KEYS });
}

export function readRelease(manifestPath, key) {
  if (!existsSync(manifestPath)) {
    const error = new Error(`No prebuilt release manifest exists for '${key}'; this target remains OPEN.`);
    error.code = 'PREBUILT_RELEASE_MISSING';
    throw error;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Explicit artifact-only local pins predate the envelope. Never downgrade a partially
  // specified candidate, and never allow this compatibility path for a remote default lock.
  if (manifest && ['schemaVersion', 'version', 'sourceSha'].some((field) => Object.hasOwn(manifest, field))) {
    validateReleaseManifest(manifest);
  }
  return releaseFromManifest(manifest, key);
}

export function releaseManifestUrl(version = packageVersion) {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/runtime-native-v${encodeURIComponent(version)}/prebuilt-lock.json`;
}

export function writeInstallStatus(status, statusPath = join(packageRoot, 'prebuilt', 'install-status.json')) {
  mkdirSync(dirname(statusPath), { recursive: true });
  const temporary = `${statusPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, statusPath);
    return statusPath;
  } finally {
    rmSync(temporary, { force: true });
  }
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
    const error = new Error(
      `Prebuilt release manifest fetch failed for '${key}' at ${url.href}: HTTP ${response.status}.`,
    );
    if (response.status === 404) error.code = 'PREBUILT_RELEASE_MISSING';
    throw error;
  }
  return releaseFromManifest(validateReleaseManifest(await response.json()), key);
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
  let contents;
  try {
    contents = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`Prebuilt release body failed for '${key}' at ${release.url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  verifyChecksum(contents, release.sha256, key);
  if (contents.length === 0 || (release.size !== undefined && contents.length !== release.size)) {
    throw new Error(`Prebuilt release size verification failed for '${key}': received ${contents.length} bytes.`);
  }
  return contents;
}

export async function installPrebuilt(options = {}) {
  const platform = options.platform ?? process.platform;
  const key = `${platform}-${options.arch ?? process.arch}`;
  const filename = platform === 'win32' ? 'threenative-runtime.exe' : 'threenative-runtime';
  const output = resolve(options.output ?? join(packageRoot, 'prebuilt', key, filename));
  const statusPath = resolve(options.statusPath ?? (options.output
    ? join(dirname(output), 'install-status.json')
    : join(packageRoot, 'prebuilt', 'install-status.json')));
  if (output === statusPath) throw new Error('Prebuilt output and install status paths must differ.');
  const status = { key, url: options.manifestPath ?? process.env.THREENATIVE_PREBUILT_MANIFEST ??
    options.manifestUrl ?? releaseManifestUrl(), version: packageVersion };
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    // A failed retry must not leave an earlier binary usable or its old success marker intact.
    rmSync(output, { force: true });
    rmSync(statusPath, { force: true });
    writeInstallStatus({ ...status, ok: false, reason: 'installing' }, statusPath);
    platformKey(platform, options.arch);
    const contents = await downloadReleaseArtifact(key, options);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(temporary, contents, { flag: 'wx' });
    if (platform !== 'win32') chmodSync(temporary, 0o755);
    renameSync(temporary, output);
    writeInstallStatus({ ...status, ok: true, reason: 'installed', sha256: sha256(contents) }, statusPath);
    console.log(`Installed verified ThreeNative runtime for '${key}'.`);
    return output;
  } catch (error) {
    try {
      rmSync(output, { force: true });
      writeInstallStatus({ ...status, ok: false,
        reason: error instanceof Error ? error.message : String(error) }, statusPath);
    } catch (statusError) {
      rmSync(statusPath, { force: true });
      throw new Error(`Could not invalidate prebuilt install for '${key}': ${statusError instanceof Error ? statusError.message : String(statusError)}`, { cause: error });
    }
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceCheckout = existsSync(join(packageRoot, 'src')) && existsSync(join(packageRoot, 'CMakeLists.txt'));
  if (sourceCheckout) {
    console.log('ThreeNative runtime source checkout detected; prebuilt install is deferred to package testing.');
  } else {
    installPrebuilt()
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        // An unpublished release is a packaging-state fact, not a broken download. The web game
        // this install carries must not lose node_modules/.bin over an optional native binary;
        // the native lanes fail closed later, on the missing binary itself.
        if (error instanceof Error && error.code === 'PREBUILT_RELEASE_MISSING') {
          console.warn(
            `No prebuilt release is published for v${packageVersion} (${reason}). Continuing without the native runtime; desktop and device lanes fail closed on the missing binary.`,
          );
          return;
        }
        console.error(reason);
        process.exitCode = 1;
      });
  }
}
