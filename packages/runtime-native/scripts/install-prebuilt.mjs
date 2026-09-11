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
  'darwin-arm64-tools': 'threenative-tools-darwin-arm64',
  'ios-simulator-arm64': 'threenative-ios-simulator-arm64.zip',
  'linux-x64': 'threenative-runtime-linux-x64',
  'linux-x64-tools': 'threenative-tools-linux-x64',
  'win32-x64': 'threenative-runtime-win32-x64.exe',
  'win32-x64-tools': 'threenative-tools-win32-x64.exe',
});

/** Every key a packaged consumer or native release workflow may request. */
export const PREBUILT_KEYS = Object.freeze(Object.keys(PREBUILT_ASSET_NAMES));

/**
 * Rows this repository builds and verifies on every release run but does not publish.
 *
 * Only macOS. Gatekeeper hard-refuses an unsigned, un-notarized bundle downloaded from the web, so
 * a macOS asset without an Apple Developer Program identity is not a shippable artifact — it is a
 * support ticket. Windows is different: an unsigned executable runs, SmartScreen only warns, so
 * `win32-x64` ships unsigned rather than waiting on a certificate.
 *
 * The row keeps building and verifying on every release run — a row that stops compiling rots
 * silently — it is simply not advertised as downloadable, which is the narrowing PRD-262 allows in
 * place of building every claimed row. Publishing it again is one entry, once the Apple identity
 * exists. Status and cost of every platform's signing inputs: `docs/RELEASE-SIGNING.md`.
 */
export const UNPUBLISHED_PREBUILT_KEYS = Object.freeze(['darwin-arm64', 'darwin-arm64-tools']);

/** The exact cohort a release publishes and a consumer may download. */
export const PUBLISHED_PREBUILT_KEYS = Object.freeze(
  PREBUILT_KEYS.filter((key) => !UNPUBLISHED_PREBUILT_KEYS.includes(key)),
);

const supported = new Set(['darwin-arm64', 'linux-x64', 'win32-x64']);

/**
 * The desktop runtime dispatches `threenative build --target desktop` to a `mystral-tools` helper
 * sitting beside its own executable (`src/cli/tool_dispatch.cpp:52`). A consumer that installs only
 * the runtime gets `build tool helper is missing` and exit 127, so the helper is a published
 * release asset of its own and is installed beside the runtime by the same atomic install.
 */
export function toolsKey(key) {
  return supported.has(key) ? `${key}-tools` : undefined;
}

export function toolsFilename(platform = process.platform) {
  return platform === 'win32' ? 'mystral-tools.exe' : 'mystral-tools';
}

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
  if (UNPUBLISHED_PREBUILT_KEYS.includes(key)) {
    const error = new Error(
      `No prebuilt release is published for '${key}'. This platform builds from an engine checkout until its release credentials exist; see PRD-262.`,
    );
    error.code = 'PREBUILT_RELEASE_UNPUBLISHED';
    throw error;
  }
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

function isLoopbackFixture(url) {
  return process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT === '1' &&
    url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
    !url.username && !url.password;
}

function validateManifestEnvelope(manifest, options) {
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
  return version;
}

function validateManifestArtifact(manifest, key, version) {
  if (!Object.hasOwn(PREBUILT_ASSET_NAMES, key)) throw new Error(`Unknown prebuilt release key '${key}'.`);
  const release = releaseFromManifest(manifest, key);
  if (!Number.isSafeInteger(release.size) || release.size <= 0) {
    throw new Error(`Prebuilt release size for '${key}' must be a positive integer.`);
  }
  const expectedUrl = `${releaseManifestUrl(version).replace('/prebuilt-lock.json', '')}/${PREBUILT_ASSET_NAMES[key]}`;
  const url = new URL(release.url);
  if (release.url !== expectedUrl && !isLoopbackFixture(url)) {
    throw new Error(`Prebuilt release URL for '${key}' must match version ${version}: ${expectedUrl}.`);
  }
}

/** Validate the entire advertised cohort before selecting even one consumer artifact. */
export function validateReleaseManifest(manifest, options = {}) {
  const version = validateManifestEnvelope(manifest, options);
  // iOS retains its separate release gate; it is not a prerequisite for a non-iOS consumer.
  const requiredKeys = options.requiredKeys ??
    PUBLISHED_PREBUILT_KEYS.filter((key) => !key.startsWith('ios-'));
  for (const key of requiredKeys) releaseFromManifest(manifest, key);
  for (const key of Object.keys(manifest.artifacts)) validateManifestArtifact(manifest, key, version);
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
  const published = PUBLISHED_PREBUILT_KEYS.map((key) => [key, PREBUILT_ASSET_NAMES[key]]);
  const expected = published.map(([, name]) => name).sort();
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Incomplete prebuilt release matrix: expected ${expected.join(', ')}; received ${actual.join(', ')}.`);
  }
  const artifacts = Object.fromEntries(published.map(([key, name]) => {
    const contents = readFileSync(join(directory, name));
    if (contents.length === 0) throw new Error(`Prebuilt release asset '${key}' is empty.`);
    return [key, { sha256: sha256(contents), size: contents.length,
      url: `${releaseManifestUrl().replace('/prebuilt-lock.json', '')}/${name}` }];
  }));
  return validateReleaseManifest({ schemaVersion: 1, version: packageVersion, sourceSha, artifacts },
    { sourceSha, requiredKeys: PUBLISHED_PREBUILT_KEYS });
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

function createInstallPlan(options) {
  const platform = options.platform ?? process.platform;
  const key = `${platform}-${options.arch ?? process.arch}`;
  const filename = platform === 'win32' ? 'threenative-runtime.exe' : 'threenative-runtime';
  const output = resolve(options.output ?? join(packageRoot, 'prebuilt', key, filename));
  const statusPath = resolve(options.statusPath ?? (options.output
    ? join(dirname(output), 'install-status.json')
    : join(packageRoot, 'prebuilt', 'install-status.json')));
  if (output === statusPath) throw new Error('Prebuilt output and install status paths must differ.');
  const toolsOutput = join(dirname(output), toolsFilename(platform));
  if (toolsOutput === output) throw new Error('Prebuilt runtime and build tool helper paths must differ.');
  return { platform, key, output, statusPath, toolsOutput, toolsKey: toolsKey(key),
    status: { key, url: options.manifestPath ?? process.env.THREENATIVE_PREBUILT_MANIFEST ??
      options.manifestUrl ?? releaseManifestUrl(), version: packageVersion } };
}

function beginInstall(plan, arch) {
  rmSync(plan.output, { force: true });
  rmSync(plan.toolsOutput, { force: true });
  rmSync(plan.statusPath, { force: true });
  writeInstallStatus({ ...plan.status, ok: false, reason: 'installing' }, plan.statusPath);
  platformKey(plan.platform, arch);
}

function publishBinary(target, contents, platform) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, contents, { flag: 'wx' });
    if (platform !== 'win32') chmodSync(temporary, 0o755);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

// The success marker is written only once both binaries are in place: a desktop build that finds
// the runtime but not the helper dies inside the packager with exit 127, which is exactly the
// stale-success shape this install exists to prevent.
function publishInstall(plan, contents, toolsContents) {
  publishBinary(plan.output, contents, plan.platform);
  publishBinary(plan.toolsOutput, toolsContents, plan.platform);
  writeInstallStatus({ ...plan.status, ok: true, reason: 'installed', sha256: sha256(contents),
    toolsSha256: sha256(toolsContents) }, plan.statusPath);
}

function recordInstallFailure(plan, error) {
  try {
    rmSync(plan.output, { force: true });
    rmSync(plan.toolsOutput, { force: true });
    writeInstallStatus({ ...plan.status, ok: false,
      reason: error instanceof Error ? error.message : String(error) }, plan.statusPath);
  } catch (statusError) {
    rmSync(plan.statusPath, { force: true });
    throw new Error(`Could not invalidate prebuilt install for '${plan.key}': ${statusError instanceof Error ? statusError.message : String(statusError)}`, { cause: error });
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

/** Reuse only a complete install for this exact package, platform and manifest selection. */
function isVerifiedInstall(plan, options) {
  try {
    const status = JSON.parse(readFileSync(plan.statusPath, 'utf8'));
    if (status.ok !== true || status.key !== plan.key ||
        status.version !== plan.status.version || status.url !== plan.status.url) return false;
    // A caller can replace a local lock without changing its path. That explicit pin must
    // still authorize these bytes, and a missing/invalid pin must never be bypassed by cache.
    const manifestPath = options.manifestPath ?? process.env.THREENATIVE_PREBUILT_MANIFEST;
    const pinned = manifestPath ? readRelease(resolve(manifestPath), plan.key) : undefined;
    if (pinned && pinned.sha256 !== status.sha256) return false;
    const contents = readFileSync(plan.output);
    if (contents.length === 0 || (pinned?.size !== undefined && contents.length !== pinned.size)) return false;
    verifyChecksum(contents, status.sha256, plan.key);
    // A cached runtime without its verified helper is not a reusable desktop install.
    if (typeof status.toolsSha256 !== 'string') return false;
    const pinnedTools = manifestPath ? readRelease(resolve(manifestPath), plan.toolsKey) : undefined;
    if (pinnedTools && pinnedTools.sha256 !== status.toolsSha256) return false;
    const tools = readFileSync(plan.toolsOutput);
    if (tools.length === 0 || (pinnedTools?.size !== undefined && tools.length !== pinnedTools.size)) return false;
    verifyChecksum(tools, status.toolsSha256, plan.toolsKey);
    return true;
  } catch {
    return false;
  }
}

export async function installPrebuilt(options = {}) {
  const plan = createInstallPlan(options);
  try {
    // Packaging may reuse verified bytes offline. Explicit install/retry keeps its original
    // invalidation semantics, including removing an earlier binary on a failed retry.
    if (options.reuse === true) {
      platformKey(plan.platform, options.arch);
      if (isVerifiedInstall(plan, options)) return plan.output;
    }
    // A failed retry must not leave an earlier binary usable or its old success marker intact.
    beginInstall(plan, options.arch);
    const contents = await downloadReleaseArtifact(plan.key, options);
    const toolsContents = await downloadReleaseArtifact(plan.toolsKey, options);
    publishInstall(plan, contents, toolsContents);
    console.log(`Installed verified ThreeNative runtime and build tool helper for '${plan.key}'.`);
    return plan.output;
  } catch (error) {
    recordInstallFailure(plan, error);
    throw error;
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
        if (error instanceof Error &&
            ['PREBUILT_RELEASE_MISSING', 'PREBUILT_RELEASE_UNPUBLISHED'].includes(error.code)) {
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
