import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER_MANIFEST = 'threenative-container.json';
// The scaffold copies this PNG to a starter's `public/icon.png` as the engine's own art. A
// distributed game whose embedded icon is still these bytes never replaced it.
const ENGINE_DEFAULT_ICON = new URL(
  '../../create-threenative/template-assets/icon.png',
  import.meta.url,
);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertBrandConfig(config, options) {
  if (!isRecord(config) || !isRecord(options)) {
    throw new Error('TN_NATIVE_STARTER_BRAND_CONFIG_INVALID: config and options must be objects.');
  }
  for (const field of ['app', 'ui', 'bootSplash']) {
    if (config[field] !== undefined && !isRecord(config[field])) {
      throw new Error(`TN_NATIVE_STARTER_BRAND_CONFIG_INVALID: ${field} must be an object.`);
    }
  }
  const strings = {
    'app.name': config.app?.name,
    'app.icon': config.app?.icon,
    'bootSplash.image': config.bootSplash?.image,
    'bootSplash.backgroundColor': config.bootSplash?.backgroundColor,
    'options.project': options.project,
    'options.engineIcon': options.engineIcon,
  };
  for (const [field, value] of Object.entries(strings)) {
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
      throw new Error(`TN_NATIVE_STARTER_BRAND_CONFIG_INVALID: ${field} must be a nonempty string.`);
    }
  }
  if (config.ui?.renderer !== undefined && !['web', 'native'].includes(config.ui.renderer)) {
    throw new Error('TN_NATIVE_STARTER_BRAND_CONFIG_INVALID: ui.renderer must be web or native.');
  }
}

// Every inspected byte must belong to the extracted container, including through symlinks.
// Check Windows paths on all hosts: these fixtures also inspect foreign-platform containers.
function containerFile(root, path, missingCode) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.split('/').includes('..')
  ) {
    throw new Error(`TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: unsafe resource path '${path}'.`);
  }
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${missingCode}: ${path} is not a file in the container.`);
  }
  const physical = relative(realpathSync(root), realpathSync(absolute));
  if (physical === '..' || physical.startsWith(`..${sep}`) || isAbsolute(physical)) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: ${path} resolves outside the container.`,
    );
  }
  return absolute;
}

function containerResource(root, manifest, path, missingCode) {
  const absolute = containerFile(root, path, missingCode);
  const record = Object.hasOwn(manifest.resources, path) ? manifest.resources[path] : undefined;
  if (
    !isRecord(record) ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.sha256)
  ) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: ${path} has no valid payload hash.`,
    );
  }
  if (sha256File(absolute) !== record.sha256) {
    throw new Error(`TN_NATIVE_STARTER_CONTAINER_TAMPERED: ${path} differs from its payload hash.`);
  }
  return absolute;
}

function containerManifestPath(root) {
  for (const path of ['Contents/Resources/threenative-container.json', CONTAINER_MANIFEST]) {
    if (existsSync(join(root, path))) {
      return containerFile(root, path, 'TN_NATIVE_STARTER_CONTAINER_MISSING');
    }
  }
  return undefined;
}

/** Inspect the authored application's launcher, never a different inventory entry. */
function desktopEntryPath(manifest) {
  const expected = `share/applications/${manifest.app.id}.desktop`;
  return Object.hasOwn(manifest.resources, expected) ? expected : undefined;
}

function desktopEntryValues(text) {
  const values = Object.create(null);
  let inDesktopEntry = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inDesktopEntry = trimmed === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry) continue;
    const match = /^([A-Za-z][A-Za-z0-9-]*)=(.*)$/u.exec(line.trimStart().replace(/\r$/u, ''));
    if (!match) continue;
    if (Object.hasOwn(values, match[1])) {
      throw new Error(
        `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: duplicate desktop key ${match[1]}.`,
      );
    }
    values[match[1]] = match[2].replace(/\\([sntr\\])/gu, (_, escaped) =>
      ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' })[escaped],
    );
  }
  return values;
}

function plistString(plist, key) {
  const matches = [
    ...plist.matchAll(
      new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'gu'),
    ),
  ];
  if (matches.length > 1) {
    throw new Error(`TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: duplicate plist key ${key}.`);
  }
  const match = matches[0];
  return match?.[1]
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function inspectContainerIcon(containerRoot, manifest, config, options) {
  const configured = config.app?.icon;
  if (configured === undefined) return undefined;
  const configuredPath = resolve(options.project ?? process.cwd(), configured);
  if (!existsSync(configuredPath) || !statSync(configuredPath).isFile()) {
    throw new Error(
      `TN_NATIVE_STARTER_BRAND_CONFIG_ICON_MISSING: app.icon is not a file: ${configuredPath}`,
    );
  }
  const declared = manifest.app.icon;
  if (typeof declared !== 'string' || declared.length === 0) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_MISSING: the container names no application icon.',
    );
  }
  const iconPath = containerResource(
    containerRoot,
    manifest,
    declared,
    'TN_NATIVE_STARTER_CONTAINER_ICON_MISSING',
  );
  const embedded = sha256File(iconPath);
  const source = sha256File(configuredPath);
  const engineIcon =
    options.engineIcon ??
    (existsSync(ENGINE_DEFAULT_ICON) ? fileURLToPath(ENGINE_DEFAULT_ICON) : undefined);
  if (engineIcon === undefined || !existsSync(engineIcon) || !statSync(engineIcon).isFile()) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: engine-default icon comparison is unavailable.',
    );
  }
  const engine = sha256File(engineIcon);
  if (embedded === engine || source === engine || manifest.app.iconSha256 === engine) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT: the application icon is the engine default.',
    );
  }
  if (
    typeof manifest.app.iconSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(manifest.app.iconSha256)
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: the icon has no valid source hash.',
    );
  }
  // PRD-365 records the input hash in app.iconSha256 and the final (possibly converted) bytes
  // in resources[path].sha256. A PNG and its generated ICNS must not be compared byte-for-byte.
  if (
    manifest.app.iconSha256 !== source ||
    (!manifest.platform.startsWith('darwin-') && embedded !== source)
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH: the container icon differs from app.icon.',
    );
  }
  return { path: declared, sha256: embedded, sourceSha256: source };
}

function linuxLauncherName(containerRoot, manifest) {
  const relativePath = desktopEntryPath(manifest);
  if (relativePath === undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING: the Linux container declares no .desktop application metadata.',
    );
  }
  const path = containerResource(
    containerRoot,
    manifest,
    relativePath,
    'TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING',
  );
  const entry = desktopEntryValues(readFileSync(path, 'utf8'));
  if (entry.Name === undefined || entry.Type !== 'Application') {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING: ${relativePath} has no Name= entry for the file manager.`,
    );
  }
  if (
    manifest.app.icon !== undefined &&
    (entry.Icon !== manifest.app.id ||
      manifest.app.icon !== `share/icons/hicolor/256x256/apps/${manifest.app.id}.png`)
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH: the Linux launcher does not reference the inspected icon.',
    );
  }
  return { name: entry.Name, source: relativePath };
}

function darwinLauncherName(containerRoot, manifest) {
  const relativePath = 'Contents/Info.plist';
  const path = containerResource(
    containerRoot,
    manifest,
    relativePath,
    'TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING',
  );
  const plist = readFileSync(path, 'utf8');
  const bundleName = plistString(plist, 'CFBundleName');
  const displayName = plistString(plist, 'CFBundleDisplayName');
  const name = bundleName ?? displayName;
  if (name === undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING: Info.plist has no application name.',
    );
  }
  const icon = plistString(plist, 'CFBundleIconFile');
  if (
    manifest.app.icon !== undefined &&
    (icon === undefined ||
      `Contents/Resources/${icon.replace(/\.icns$/u, '')}.icns` !== manifest.app.icon)
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH: Info.plist does not reference the inspected icon.',
    );
  }
  return { name, displayName, source: relativePath };
}

function inspectContainerName(containerRoot, manifest, config, platform) {
  const expected = config.app?.name;
  if (expected === undefined) return undefined;
  const found =
    platform === 'linux'
      ? linuxLauncherName(containerRoot, manifest)
      : darwinLauncherName(containerRoot, manifest);
  if (
    found.name !== expected ||
    (found.displayName !== undefined && found.displayName !== expected) ||
    manifest.app.name !== expected
  ) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH: the ${platform} launcher names '${found.name}', config says '${expected}'.`,
    );
  }
  return found;
}

function assertDeclaredLoading(declared, config, options) {
  const expected = config.bootSplash ?? null;
  const actual = declared.bootSplash ?? null;
  if (expected === null || actual === null) {
    if (expected !== actual) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: the container does not declare the boot/loading sequence the config requires.',
      );
    }
    return { bootSplash: actual, source: CONTAINER_MANIFEST };
  }
  let expectedImage = null;
  if (expected.image !== undefined) {
    const image = resolve(options.project ?? process.cwd(), expected.image);
    if (!existsSync(image) || !statSync(image).isFile()) {
      throw new Error(
        `TN_NATIVE_STARTER_BRAND_CONFIG_IMAGE_MISSING: bootSplash.image is not a file: ${image}`,
      );
    }
    expectedImage = sha256File(image);
  }
  if (
    actual.backgroundColor !== expected.backgroundColor ||
    (actual.imageSha256 ?? null) !== expectedImage
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH: the container boot/loading sequence differs from the consumer config.',
    );
  }
  return { bootSplash: actual, source: CONTAINER_MANIFEST };
}

function inspectContainerLoading(containerRoot, manifest, config, options) {
  const renderer = config.ui?.renderer ?? 'native';
  let uiEntry = null;
  if (renderer === 'web') {
    const entry = manifest.ui?.entry;
    if (typeof entry !== 'string') {
      throw new Error('TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: no web UI launch entry.');
    }
    containerResource(
      containerRoot,
      manifest,
      entry,
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING',
    );
    uiEntry = entry;
  } else if (manifest.ui !== null && manifest.ui !== undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH: a native UI config ships a web launch surface.',
    );
  }
  // A UI entry proves only a launch surface. It cannot stand in for a configured splash, and
  // a splash declaration must never bypass checking that the UI entry exists and is a file.
  if (config.bootSplash !== undefined && manifest.loading === undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: the configured splash has no container declaration.',
    );
  }
  if (manifest.loading !== undefined) {
    return { ...assertDeclaredLoading(manifest.loading, config, options), uiEntry };
  }
  if (config.ui === undefined) return undefined;
  return { uiEntry, source: CONTAINER_MANIFEST };
}

function readContainerManifest(containerRoot) {
  const manifestPath = containerManifestPath(containerRoot);
  if (manifestPath === undefined) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MISSING: no ${CONTAINER_MANIFEST} under ${containerRoot}.`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !isRecord(manifest) ||
    !isRecord(manifest.app) ||
    !isRecord(manifest.resources) ||
    manifest.schemaVersion !== 1 ||
    !['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'].includes(
      manifest.platform,
    ) ||
    (manifest.ui !== undefined && manifest.ui !== null && !isRecord(manifest.ui)) ||
    (manifest.loading !== undefined &&
      (!isRecord(manifest.loading) ||
        (manifest.loading.bootSplash !== undefined &&
          manifest.loading.bootSplash !== null &&
          !isRecord(manifest.loading.bootSplash))))
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: unsupported schema, platform or brand metadata.',
    );
  }
  return manifest;
}

/**
 * Inspect a distributed desktop container's brand against the consumer config that declared it.
 *
 * `root` is the directory PRD-365 packages (the single top-level folder an archive extracts to).
 * Three independent surfaces are compared and each failure names the actual cause: the embedded
 * application icon, the launcher/file-manager application name, and the declared loading/launch
 * sequence. It never launches the app and never inspects the runtime SDL window, so it makes no
 * claim about pixels a player sees.
 */
export function inspectContainerBrand(root, config, options = {}) {
  assertBrandConfig(config, options);
  const containerRoot = resolve(root);
  if (!existsSync(containerRoot) || !statSync(containerRoot).isDirectory()) {
    throw new Error(`TN_NATIVE_STARTER_CONTAINER_MISSING: ${containerRoot} is not a directory.`);
  }
  const manifest = readContainerManifest(containerRoot);
  const platform = manifest.platform.split('-')[0];
  if (platform === 'win32') {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: Windows PE name/icon resources were not inspected; a manifest and sidecar are not evidence.',
    );
  }
  const evidence = {
    icon: inspectContainerIcon(containerRoot, manifest, config, options),
    name: inspectContainerName(containerRoot, manifest, config, platform),
    loading: inspectContainerLoading(containerRoot, manifest, config, options),
  };
  const hasSplashAssertion =
    config.bootSplash?.backgroundColor !== undefined || config.bootSplash?.image !== undefined;
  if (evidence.icon === undefined && evidence.name === undefined && !hasSplashAssertion) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: the container and config declare no brand to inspect.',
    );
  }
  return evidence;
}
