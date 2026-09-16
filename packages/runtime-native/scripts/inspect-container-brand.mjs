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

// --- Windows PE resources -------------------------------------------------------------------
// A Windows game's launcher identity is the executable's own resource section, written by rcedit
// during packaging. The application manifest and the sidecar PNG beside it are inputs to that
// write, never evidence of it, so the bytes are read back out of the .exe here. Plain `fs` and
// `Buffer`: a resource directory is a fixed three-level tree and needs no dependency.
const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const RT_VERSION = 16;
const VS_FIXEDFILEINFO_SIGNATURE = 0xfeef04bd;

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parsePeImage(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: ${path} is not a PE image, so its Windows brand cannot be read.`,
    );
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: ${path} has no PE header, so its Windows brand cannot be read.`,
    );
  }
  const optional = peOffset + 24;
  const optionalSize = buffer.readUInt16LE(peOffset + 20);
  const magic = optional + 2 <= buffer.length ? buffer.readUInt16LE(optional) : 0;
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: ${path} declares optional-header magic 0x${magic.toString(16)}, which is neither PE32 nor PE32+.`,
    );
  }
  const directoriesOffset = optional + (magic === 0x20b ? 112 : 96);
  const countOffset = optional + (magic === 0x20b ? 108 : 92);
  // Bound the read before taking it: a truncated .exe must name its cause, not raise a bare
  // RangeError from deep inside the parser.
  if (countOffset + 4 > buffer.length || directoriesOffset + 24 > buffer.length) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: ${path} is truncated before its resource data directory.`,
    );
  }
  if (buffer.readUInt32LE(countOffset) < 3) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING: the packaged .exe has no resource data directory.',
    );
  }
  const resourceRva = buffer.readUInt32LE(directoriesOffset + 16);
  const resourceSize = buffer.readUInt32LE(directoriesOffset + 20);
  if (resourceRva === 0 || resourceSize === 0) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING: the packaged .exe carries an empty resource directory.',
    );
  }
  const sections = [];
  for (let index = 0; index < buffer.readUInt16LE(peOffset + 6); index += 1) {
    const offset = optional + optionalSize + index * 40;
    if (offset + 40 > buffer.length) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: a section header runs past the end of the .exe.',
      );
    }
    sections.push({
      rawOffset: buffer.readUInt32LE(offset + 20),
      rawSize: buffer.readUInt32LE(offset + 16),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      virtualSize: buffer.readUInt32LE(offset + 8),
    });
  }
  return { buffer, resourceRva, sections };
}

function rvaToOffset(image, rva) {
  for (const section of image.sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      const offset = section.rawOffset + (rva - section.virtualAddress);
      if (offset < image.buffer.length) return offset;
    }
  }
  throw new Error(
    `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: resource RVA 0x${rva.toString(16)} lies in no section of the .exe.`,
  );
}

/** One IMAGE_RESOURCE_DIRECTORY: 16 bytes of header, then named entries and id entries. */
function resourceDirectoryEntries(image, base, offset) {
  const { buffer } = image;
  if (offset + 16 > buffer.length) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: a resource directory runs past the end of the .exe.',
    );
  }
  const count = buffer.readUInt16LE(offset + 12) + buffer.readUInt16LE(offset + 14);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 16 + index * 8;
    if (entry + 8 > buffer.length) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: a resource entry runs past the end of the .exe.',
      );
    }
    const name = buffer.readUInt32LE(entry);
    const target = buffer.readUInt32LE(entry + 4);
    entries.push({
      directory: (target & 0x80000000) !== 0,
      id: (name & 0x80000000) === 0 ? name : undefined,
      offset: base + (target & 0x7fffffff),
    });
  }
  return entries;
}

/** Every leaf of one resource type, addressed type -> name -> language, with its payload bytes. */
function resourceLeaves(image, type) {
  const base = rvaToOffset(image, image.resourceRva);
  const leaves = [];
  for (const typeEntry of resourceDirectoryEntries(image, base, base)) {
    if (typeEntry.id !== type || !typeEntry.directory) continue;
    for (const nameEntry of resourceDirectoryEntries(image, base, typeEntry.offset)) {
      if (!nameEntry.directory) continue;
      for (const language of resourceDirectoryEntries(image, base, nameEntry.offset)) {
        if (language.directory || language.offset + 16 > image.buffer.length) {
          throw new Error(
            'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: a resource language entry is not a data entry.',
          );
        }
        const start = rvaToOffset(image, image.buffer.readUInt32LE(language.offset));
        const size = image.buffer.readUInt32LE(language.offset + 4);
        if (size === 0 || start + size > image.buffer.length) {
          throw new Error(
            'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: a resource payload is empty or runs past the end of the .exe.',
          );
        }
        leaves.push({ data: image.buffer.subarray(start, start + size), id: nameEntry.id });
      }
    }
  }
  return leaves;
}

const align4 = (value) => (value + 3) & ~3;

/** VS_VERSIONINFO nodes: wLength, wValueLength, wType, a UTF-16 key, a padded value, children. */
function versionNodes(data, start, end) {
  const nodes = [];
  let cursor = start;
  while (cursor + 6 <= end) {
    const length = data.readUInt16LE(cursor);
    if (length < 6) break;
    const limit = Math.min(cursor + length, end);
    const type = data.readUInt16LE(cursor + 4);
    let keyEnd = cursor + 6;
    while (keyEnd + 1 < limit && data.readUInt16LE(keyEnd) !== 0) keyEnd += 2;
    const valueStart = align4(keyEnd + 2);
    const valueLength = data.readUInt16LE(cursor + 2);
    const valueEnd = Math.min(valueStart + (type === 1 ? valueLength * 2 : valueLength), limit);
    nodes.push({
      binary: type === 0 && valueEnd > valueStart ? data.subarray(valueStart, valueEnd) : undefined,
      childrenEnd: limit,
      childrenStart: align4(valueEnd),
      key: data.toString('utf16le', cursor + 6, keyEnd),
      value:
        type === 1 && valueEnd > valueStart
          ? data.toString('utf16le', valueStart, valueEnd).replace(/\0+$/u, '')
          : undefined,
    });
    cursor = align4(limit);
  }
  return nodes;
}

function parseVersionResource(data) {
  const [root] = versionNodes(data, 0, data.length);
  if (
    root?.key !== 'VS_VERSION_INFO' ||
    root.binary === undefined ||
    root.binary.length < 52 ||
    root.binary.readUInt32LE(0) !== VS_FIXEDFILEINFO_SIGNATURE
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: RT_VERSION carries no VS_FIXEDFILEINFO block.',
    );
  }
  const fixed = root.binary;
  const strings = Object.create(null);
  for (const child of versionNodes(data, root.childrenStart, root.childrenEnd)) {
    if (child.key !== 'StringFileInfo') continue;
    for (const table of versionNodes(data, child.childrenStart, child.childrenEnd)) {
      for (const entry of versionNodes(data, table.childrenStart, table.childrenEnd)) {
        if (entry.value !== undefined) strings[entry.key] = entry.value;
      }
    }
  }
  return {
    fileVersion: [
      fixed.readUInt16LE(10),
      fixed.readUInt16LE(8),
      fixed.readUInt16LE(14),
      fixed.readUInt16LE(12),
    ].join('.'),
    strings,
  };
}

/** The icon ids one RT_GROUP_ICON directory points at, in GRPICONDIRENTRY order. */
function groupIconIds(data) {
  if (data.length < 6 || data.readUInt16LE(2) !== 1) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: RT_GROUP_ICON is not an icon directory.',
    );
  }
  const count = data.readUInt16LE(4);
  if (count === 0 || 6 + count * 14 > data.length) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: RT_GROUP_ICON declares no usable image entries.',
    );
  }
  return Array.from({ length: count }, (_, index) => data.readUInt16LE(6 + index * 14 + 12));
}

function inspectWindowsResources(containerRoot, manifest) {
  const executable = containerResource(
    containerRoot,
    manifest,
    manifest.executable,
    'TN_NATIVE_STARTER_CONTAINER_EXECUTABLE_MISSING',
  );
  const image = parsePeImage(executable);
  const version = resourceLeaves(image, RT_VERSION);
  if (version.length !== 1) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING: the packaged .exe carries ${version.length} RT_VERSION resources, not one.`,
    );
  }
  const groups = resourceLeaves(image, RT_GROUP_ICON);
  if (groups.length === 0) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING: the packaged .exe carries no RT_GROUP_ICON, so no launcher icon is embedded.',
    );
  }
  // Inspecting the first of several groups leaves the rest unexamined, and which one Explorer
  // draws is the lowest id, not the tree order this walk returns. rcedit writes exactly one.
  if (groups.length > 1) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: the packaged .exe carries ${groups.length} RT_GROUP_ICON resources, so which icon it shows is ambiguous.`,
    );
  }
  const icons = new Map(resourceLeaves(image, RT_ICON).map((leaf) => [leaf.id, leaf.data]));
  const images = groupIconIds(groups[0].data).map((id) => {
    const data = icons.get(id);
    if (data === undefined) {
      throw new Error(
        `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: RT_GROUP_ICON names icon ${id}, which the .exe does not carry.`,
      );
    }
    return { id, sha256: sha256Buffer(data) };
  });
  const { fileVersion, strings } = parseVersionResource(version[0].data);
  return { fileVersion, images, source: manifest.executable, strings };
}

/**
 * The version Explorer reports, against the version the author configured.
 *
 * Anchoring this on the container's own `app.version` alone let a manifest retire the assertion
 * against itself by omitting the field, which is the shape every sibling check here refuses.
 */
function assertWindowsVersion(windows, manifest, config) {
  const declared = manifest.app.version;
  if (typeof declared !== 'string' || declared.length === 0) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: a Windows container declares no application version to check its PE resources against.',
    );
  }
  const authored = config.app?.version;
  if (typeof authored === 'string' && authored !== declared) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_WINDOWS_VERSION_MISMATCH: the container says version ${declared}, config says ${authored}.`,
    );
  }
  const expected = `${declared}.0.0.0`.split('.').slice(0, 4).join('.');
  if (windows.fileVersion !== expected) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_WINDOWS_VERSION_MISMATCH: the .exe reports file version ${windows.fileVersion}, the container says ${declared}.`,
    );
  }
}

function windowsLauncherName(windows) {
  // Both names are required, not just the one that happens to be present: the packager writes
  // ProductName and FileDescription together, so an absent FileDescription is a name that was
  // never embedded — and treating it as "nothing to compare" is the same self-retiring shape the
  // review found in the version check, letting a stale second name ride along unexamined.
  for (const key of ['ProductName', 'FileDescription']) {
    if (typeof windows.strings[key] !== 'string' || windows.strings[key].length === 0) {
      throw new Error(
        `TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING: the packaged .exe declares no ${key} for Explorer to show.`,
      );
    }
  }
  return { displayName: windows.strings.FileDescription, name: windows.strings.ProductName, source: windows.source };
}

function inspectContainerIcon(containerRoot, manifest, config, options, windows) {
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
  // The sidecar PNG proves provenance of the input; only the .exe's own RT_ICON proves what
  // Explorer will draw, so a Windows container is judged on the bytes rcedit actually embedded.
  if (windows !== undefined) {
    const embeddedIcons = windows.images.map((image) => image.sha256);
    if (embeddedIcons.includes(engine)) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT: the .exe embeds the engine-default icon.',
      );
    }
    if (!embeddedIcons.includes(source)) {
      throw new Error(
        `TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH: the .exe embeds ${embeddedIcons.join(', ')}, none of which is app.icon (${source}).`,
      );
    }
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

function inspectContainerName(containerRoot, manifest, config, platform, windows) {
  const expected = config.app?.name;
  if (expected === undefined) return undefined;
  const found =
    windows === undefined
      ? platform === 'linux'
        ? linuxLauncherName(containerRoot, manifest)
        : darwinLauncherName(containerRoot, manifest)
      : windowsLauncherName(windows);
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
  const windows = platform === 'win32' ? inspectWindowsResources(containerRoot, manifest) : undefined;
  if (windows !== undefined) assertWindowsVersion(windows, manifest, config);
  const evidence = {
    icon: inspectContainerIcon(containerRoot, manifest, config, options, windows),
    name: inspectContainerName(containerRoot, manifest, config, platform, windows),
    loading: inspectContainerLoading(containerRoot, manifest, config, options),
    windows,
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
