import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'vitest';

import { inspectContainerBrand } from '../scripts/inspect-container-brand.mjs';
import { verifyStarterContainer } from '../scripts/verify-starter-desktop.mjs';

function sha256Of(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function writeContainerFile(root, relative, contents) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return { path, sha256: sha256Of(contents) };
}

function authoredIcon(contents = 'authored game icon') {
  const directory = makeTempDirSync('starter-brand-icon-');
  const path = join(directory, 'icon.png');
  writeFileSync(path, contents);
  return path;
}

function brandConfig(iconPath) {
  return {
    app: { id: 'com.example.orbit', name: 'Orbit Game', version: '1.2.3', build: 7, icon: iconPath },
    ui: { renderer: 'web' },
    bootSplash: { backgroundColor: '#0d1b2a' },
  };
}

function stageIcon(root, platform, embeddedIcon, app, resources) {
  if (embeddedIcon === null) return;
  const iconRelative =
    platform === 'darwin'
      ? 'Contents/Resources/orbit.icns'
      : 'share/icons/hicolor/256x256/apps/com.example.orbit.png';
  const icon = writeContainerFile(root, iconRelative, embeddedIcon);
  resources[iconRelative] = { sha256: icon.sha256 };
  app.icon = iconRelative;
  app.iconSha256 = icon.sha256;
}

function stagePlatformMetadata(root, platform, app, resources, { dropPlistName, dropDesktopName }) {
  if (platform === 'linux') {
    const relative = 'share/applications/com.example.orbit.desktop';
    const entry = dropDesktopName
      ? '[Desktop Entry]\nType=Application\n'
      : `[Desktop Entry]\nType=Application\nName=${app.name}\nExec=orbit\nIcon=com.example.orbit\n`;
    resources[relative] = { sha256: writeContainerFile(root, relative, entry).sha256 };
  }
  if (platform === 'darwin') {
    const plist = dropPlistName
      ? '<plist version="1.0"><dict></dict></plist>'
      : `<plist version="1.0"><dict><key>CFBundleName</key><string>${app.name}</string><key>CFBundleIconFile</key><string>orbit</string></dict></plist>`;
    resources['Contents/Info.plist'] = {
      sha256: writeContainerFile(root, 'Contents/Info.plist', plist).sha256,
    };
  }
}

function brandedContainer({
  platform = 'linux',
  config,
  embeddedIcon = Buffer.from('authored game icon'),
  manifestName,
  dropIconResource = false,
  dropPlistName = false,
  dropDesktopName = false,
  loading,
  ui = true,
} = {}) {
  const directory = makeTempDirSync('starter-brand-container-');
  const root = join(directory, 'game');
  mkdirSync(root, { recursive: true });
  const executableRelative =
    platform === 'darwin' ? 'Contents/MacOS/orbit' : platform === 'win32' ? 'orbit.exe' : 'orbit';
  const executable = writeContainerFile(root, executableRelative, Buffer.from('game executable'));
  const resources = { [executableRelative]: { sha256: executable.sha256 } };
  const app = {
    id: config.app.id,
    name: manifestName ?? config.app.name,
    version: config.app.version,
    build: config.app.build,
  };
  stageIcon(root, platform, dropIconResource ? null : embeddedIcon, app, resources);
  stagePlatformMetadata(root, platform, app, resources, { dropPlistName, dropDesktopName });
  if (ui) {
    resources['ui/index.html'] = {
      sha256: writeContainerFile(root, 'ui/index.html', '<main>HUD</main>').sha256,
    };
  }
  const manifestRelative =
    platform === 'darwin'
      ? 'Contents/Resources/threenative-container.json'
      : 'threenative-container.json';
  writeContainerFile(
    root,
    manifestRelative,
    JSON.stringify(
      {
        app,
        dependencies: [],
        executable: executableRelative,
        format: platform === 'linux' ? 'tar.gz' : 'zip',
        platform: `${platform}-x64`,
        prerequisites: [],
        resources,
        schemaVersion: 1,
        ui: ui ? { directory: 'ui', entry: 'ui/index.html' } : null,
        ...(loading === undefined ? {} : { loading }),
      },
      null,
      2,
    ),
  );
  return root;
}

const ENGINE_ICON = authoredIcon('the engine default icon');

test('a branded container matches its consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, loading: { bootSplash: config.bootSplash } });
  const report = inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON });
  assert.equal(report.name.name, 'Orbit Game');
  assert.equal(report.icon.sha256, sha256Of(readFileSync(icon)));
});

test('should reject a distributed starter when the embedded application icon or runtime brand differs from its consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const wrongIcon = brandedContainer({ config, embeddedIcon: Buffer.from('another game icon') });
  assert.throws(
    () => inspectContainerBrand(wrongIcon, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u,
  );
  const wrongName = brandedContainer({ config, manifestName: 'Engine Default' });
  assert.throws(
    () => inspectContainerBrand(wrongName, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u,
  );
});

test('an embedded engine-default icon is rejected even when the config declares custom art', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, embeddedIcon: readFileSync(ENGINE_ICON) });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT/u,
  );
});

test('a container that dropped its icon resource fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, dropIconResource: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_MISSING/u,
  );
});

test('a macOS bundle without a CFBundleName entry fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, platform: 'darwin', dropPlistName: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING/u,
  );
});

test('a Linux container without .desktop metadata fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, dropDesktopName: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING/u,
  );
});

test('a missing container or malformed manifest is a hard failure', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  assert.throws(
    () => inspectContainerBrand(join(makeTempDirSync('starter-brand-empty-'), 'absent'), config),
    /TN_NATIVE_STARTER_CONTAINER_MISSING/u,
  );
  const malformed = brandedContainer({ config });
  writeFileSync(join(malformed, 'threenative-container.json'), '{ not json');
  assert.throws(
    () => inspectContainerBrand(malformed, config),
    /TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID/u,
  );
});

test('the declared loading sequence must match the consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const matching = brandedContainer({
    config,
    loading: { bootSplash: { backgroundColor: '#0d1b2a', imageSha256: null } },
  });
  assert.deepEqual(
    inspectContainerBrand(matching, config, { engineIcon: ENGINE_ICON }).loading.bootSplash,
    { backgroundColor: '#0d1b2a', imageSha256: null },
  );
  const wrong = brandedContainer({
    config,
    loading: { bootSplash: { backgroundColor: '#ffffff', imageSha256: null } },
  });
  assert.throws(
    () => inspectContainerBrand(wrong, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH/u,
  );
});

test('a container with no inspectable brand is a failure, not a pass', () => {
  const bare = { app: { id: 'com.example.orbit', version: '1.2.3', build: 7 } };
  const root = brandedContainer({ config: bare, dropIconResource: true, ui: false });
  assert.throws(
    () => inspectContainerBrand(root, bare),
    /TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED/u,
  );
});

test('a malformed consumer config throws instead of reporting a pass', () => {
  assert.throws(
    () => inspectContainerBrand(makeTempDirSync('starter-brand-config-'), null),
    /TN_NATIVE_STARTER_BRAND_CONFIG_INVALID/u,
  );
});

function reviewBrandFixture(platform = 'linux') {
  const directory = makeTempDirSync('prd375-review-');
  const root = join(directory, 'game');
  mkdirSync(root);
  const icon = join(directory, 'authored.png');
  const engine = join(directory, 'engine.png');
  writeFileSync(icon, 'authored icon');
  writeFileSync(engine, 'engine icon');
  const config = {
    app: { id: 'com.example.orbit', name: 'Orbit Game', icon },
    ui: { renderer: 'web' },
  };
  const iconPath =
    platform === 'darwin'
      ? 'Contents/Resources/Orbit-Game.icns'
      : 'share/icons/hicolor/256x256/apps/com.example.orbit.png';
  const manifest = {
    schemaVersion: 1,
    platform: `${platform}-x64`,
    app: { ...config.app, icon: iconPath, iconSha256: sha256Of('authored icon') },
    resources: {},
    dependencies: [],
    executable: 'orbit',
    ui: { entry: 'ui/index.html' },
  };
  const manifestPath = join(
    root,
    platform === 'darwin'
      ? 'Contents/Resources/threenative-container.json'
      : 'threenative-container.json',
  );
  function file(path, contents) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    manifest.resources[path] = { sha256: sha256Of(contents) };
    return target;
  }
  file('orbit', 'executable');
  file(iconPath, 'authored icon');
  file('ui/index.html', '<main>Orbit</main>');
  if (platform === 'linux') {
    file(
      'share/applications/com.example.orbit.desktop',
      '[Desktop Entry]\nType=Application\nName=Orbit Game\nIcon=com.example.orbit\n',
    );
  }
  if (platform === 'darwin') {
    file(
      'Contents/Info.plist',
      '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleDisplayName</key><string>Orbit Game</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>',
    );
  }
  function save() {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  function inspect(options = {}) {
    save();
    return inspectContainerBrand(root, config, { engineIcon: engine, ...options });
  }
  return { directory, root, icon, engine, config, manifest, file, save, inspect, manifestPath };
}

test('matching Linux artifact stays accepted', () => {
  const f = reviewBrandFixture();
  assert.equal(f.inspect().name.name, 'Orbit Game');
});
test('matching macOS artifact stays accepted', () => {
  const f = reviewBrandFixture('darwin');
  assert.equal(f.inspect().name.name, 'Orbit Game');
});
for (const renderer of ['web', 'native']) {
  test(`a declared splash cannot be replaced with ${renderer} launch metadata`, () => {
    const f = reviewBrandFixture();
    f.config.bootSplash = { backgroundColor: '#010203' };
    f.config.ui.renderer = renderer;
    if (renderer === 'native') f.manifest.ui = null;
    assert.throws(() => f.inspect(), /CONTAINER_LOADING_MISSING/);
  });
}
test('a loading declaration cannot bypass a missing web entry', () => {
  const f = reviewBrandFixture();
  f.config.bootSplash = { backgroundColor: '#010203' };
  f.manifest.loading = { bootSplash: { backgroundColor: '#010203' } };
  f.manifest.ui = null;
  assert.throws(() => f.inspect(), /CONTAINER_LOADING_MISSING/);
});
test('a directory is not a web entry', () => {
  const f = reviewBrandFixture();
  f.manifest.ui.entry = 'ui';
  assert.throws(() => f.inspect(), /CONTAINER_(LOADING_MISSING|MANIFEST_INVALID)/);
});
for (const [key, value] of [
  ['ui', 'web'],
  ['bootSplash', 42],
  ['app', []],
]) {
  test(`malformed config.${key} fails before inspection`, () => {
    const f = reviewBrandFixture();
    f.config[key] = value;
    assert.throws(() => f.inspect(), /BRAND_CONFIG_INVALID/);
  });
}
for (const platform of [undefined, 'other-x64', 'linux-riscv64']) {
  test(`unsupported or missing platform ${platform} cannot select a fallback`, () => {
    const f = reviewBrandFixture();
    f.manifest.platform = platform;
    assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
  });
}
test('icon traversal outside the container fails', () => {
  const f = reviewBrandFixture();
  f.manifest.app.icon = '../authored.png';
  f.manifest.resources['../authored.png'] = { sha256: sha256Of('authored icon') };
  assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('a resource symlink cannot borrow an icon from outside the container', () => {
  const f = reviewBrandFixture();
  const path = join(f.root, f.manifest.app.icon);
  rmSync(path);
  symlinkSync(f.icon, path);
  assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('a symlinked manifest cannot borrow an external manifest', () => {
  const f = reviewBrandFixture();
  f.save();
  const outside = join(f.directory, 'manifest.json');
  writeFileSync(outside, readFileSync(f.manifestPath));
  rmSync(f.manifestPath);
  symlinkSync(outside, f.manifestPath);
  assert.throws(
    () => inspectContainerBrand(f.root, f.config, { engineIcon: f.engine }),
    /CONTAINER_MANIFEST_INVALID/,
  );
});
test('a desktop action name is not the launcher name', () => {
  const f = reviewBrandFixture();
  f.file(
    'share/applications/com.example.orbit.desktop',
    '[Desktop Action Play]\nName=Orbit Game\n[Desktop Entry]\nType=Application\nName=Wrong Game\nIcon=com.example.orbit\n',
  );
  assert.throws(() => f.inspect(), /CONTAINER_NAME_MISMATCH/);
});
test('a wrong desktop icon reference fails despite correct sidecar bytes', () => {
  const f = reviewBrandFixture();
  f.file(
    'share/applications/com.example.orbit.desktop',
    '[Desktop Entry]\nType=Application\nName=Orbit Game\nIcon=engine-default\n',
  );
  assert.throws(() => f.inspect(), /CONTAINER_ICON_(MISSING|MISMATCH)/);
});
test('a stale macOS display name is not hidden by a correct bundle name', () => {
  const f = reviewBrandFixture('darwin');
  f.file(
    'Contents/Info.plist',
    '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleDisplayName</key><string>Engine</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>',
  );
  assert.throws(() => f.inspect(), /CONTAINER_NAME_MISMATCH/);
});
test('a wrong macOS icon reference fails despite a matching source hash', () => {
  const f = reviewBrandFixture('darwin');
  f.file(
    'Contents/Info.plist',
    '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleIconFile</key><string>Missing</string></dict></plist>',
  );
  assert.throws(() => f.inspect(), /CONTAINER_ICON_(MISSING|MISMATCH)/);
});
test('converted macOS bytes have their own payload hash, not the source PNG hash', () => {
  const f = reviewBrandFixture('darwin');
  f.file(f.manifest.app.icon, 'converted ICNS payload');
  const report = f.inspect();
  assert.equal(report.icon.sha256, sha256Of('converted ICNS payload'));
  assert.equal(report.icon.sourceSha256, sha256Of('authored icon'));
});
test('Windows manifest and sidecar are not PE-resource verification', () => {
  const f = reviewBrandFixture('win32');
  assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/);
});
test('missing icon source hash fails closed', () => {
  const f = reviewBrandFixture();
  delete f.manifest.app.iconSha256;
  assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('an incorrect payload integrity hash fails', () => {
  const f = reviewBrandFixture();
  f.manifest.resources[f.manifest.app.icon].sha256 = '0'.repeat(64);
  assert.throws(() => f.inspect(), /CONTAINER_TAMPERED/);
});
test('relative authored paths resolve against the supplied project, not process cwd', () => {
  const f = reviewBrandFixture();
  f.config.app.icon = 'authored.png';
  assert.equal(f.inspect({ project: f.directory }).icon.sha256, sha256Of('authored icon'));
});
test('UI metadata alone cannot satisfy a brand inspection', () => {
  const f = reviewBrandFixture();
  f.config.app = {};
  assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/);
});
test('null loading metadata is a named malformed-manifest error', () => {
  const f = reviewBrandFixture();
  f.manifest.loading = null;
  assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('a valid loading declaration and UI launch both remain inspectable', () => {
  const f = reviewBrandFixture();
  f.config.bootSplash = { backgroundColor: '#010203' };
  f.manifest.loading = { bootSplash: { backgroundColor: '#010203' } };
  const report = f.inspect();
  assert.equal(report.loading.bootSplash.backgroundColor, '#010203');
  assert.equal(report.loading.uiEntry, 'ui/index.html');
});
test('an empty splash object is not a brand assertion', () => {
  const f = reviewBrandFixture();
  f.config.app = {};
  f.config.bootSplash = {};
  f.manifest.loading = { bootSplash: {} };
  assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/);
});
test('a missing authored splash image has an actionable config error', () => {
  const f = reviewBrandFixture();
  f.config.bootSplash = { image: join(f.directory, 'missing.png') };
  f.manifest.loading = { bootSplash: { imageSha256: '0'.repeat(64) } };
  assert.throws(() => f.inspect(), /BRAND_CONFIG_IMAGE_MISSING/);
});
test('duplicate macOS name keys are ambiguous, not matching evidence', () => {
  const f = reviewBrandFixture('darwin');
  f.file(
    'Contents/Info.plist',
    '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleName</key><string>Wrong Game</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>',
  );
  assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});

// PRD-375 phase 2: the inspector's live caller, and real Windows PE resource inspection.

const RSRC_RVA = 0x1000;
const PE_HEADER_SIZE = 0x400;

function pad4(buffer) {
  return Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
}

/** One VS_VERSIONINFO node: wLength, wValueLength, wType, UTF-16 key, padded value, children. */
function vsNode(key, type, value, children) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2);
  head.writeUInt16LE(type, 4);
  const body = Buffer.concat([
    pad4(Buffer.concat([head, Buffer.from(`${key}\0`, 'utf16le')])),
    pad4(value),
  ]);
  const node = Buffer.concat([body, ...children]);
  node.writeUInt16LE(node.length, 0);
  return node;
}

function versionResource(version, strings) {
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  const [major, minor, build, revision] = `${version}.0.0.0`.split('.').map(Number);
  for (const offset of [8, 16]) fixed.writeUInt32LE(((major << 16) >>> 0) + minor, offset);
  for (const offset of [12, 20]) fixed.writeUInt32LE(((build << 16) >>> 0) + revision, offset);
  const table = vsNode(
    '040904b0',
    1,
    Buffer.alloc(0),
    Object.entries(strings).map(([key, value]) =>
      vsNode(key, 1, Buffer.from(`${value}\0`, 'utf16le'), []),
    ),
  );
  return vsNode('VS_VERSION_INFO', 0, fixed, [vsNode('StringFileInfo', 1, Buffer.alloc(0), [table])]);
}

function groupIcon(ids) {
  const buffer = Buffer.alloc(6 + ids.length * 14);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(ids.length, 4);
  ids.forEach((id, index) => buffer.writeUInt16LE(id, 6 + index * 14 + 12));
  return buffer;
}

/** A real three-level .rsrc tree: type directory, name directory, language data entry. */
function resourceSection(entries) {
  const types = [...new Set(entries.map((entry) => entry.type))].sort((a, b) => a - b);
  const directorySize = (count) => 16 + count * 8;
  let cursor = directorySize(types.length);
  const typeDirectories = types.map((type) => {
    const members = entries.filter((entry) => entry.type === type);
    const offset = cursor;
    cursor += directorySize(members.length);
    return { members, offset, type };
  });
  const members = typeDirectories.flatMap((directory) => directory.members);
  for (const member of members) {
    member.languageOffset = cursor;
    cursor += directorySize(1);
  }
  for (const member of members) {
    member.dataOffset = cursor;
    cursor += 16;
  }
  for (const member of members) {
    member.payloadOffset = cursor;
    cursor += pad4(member.data).length;
  }
  const section = Buffer.alloc(cursor);
  const writeDirectory = (offset, children) => {
    section.writeUInt16LE(children.length, offset + 14);
    children.forEach(([id, target, isDirectory], index) => {
      section.writeUInt32LE(id, offset + 16 + index * 8);
      section.writeUInt32LE(isDirectory ? target + 0x80000000 : target, offset + 20 + index * 8);
    });
  };
  writeDirectory(0, typeDirectories.map((directory) => [directory.type, directory.offset, true]));
  for (const directory of typeDirectories) {
    writeDirectory(
      directory.offset,
      directory.members.map((member) => [member.id, member.languageOffset, true]),
    );
  }
  for (const member of members) {
    writeDirectory(member.languageOffset, [[0x0409, member.dataOffset, false]]);
    section.writeUInt32LE(RSRC_RVA + member.payloadOffset, member.dataOffset);
    section.writeUInt32LE(member.data.length, member.dataOffset + 4);
    member.data.copy(section, member.payloadOffset);
  }
  return section;
}

/** A byte-accurate minimal PE32 carrying exactly the resources rcedit embeds. */
function windowsExecutable(entries, { resourceDirectory = true, directoryCount = 16 } = {}) {
  const section = resourceSection(entries);
  const rawSize = section.length + ((512 - (section.length % 512)) % 512);
  const file = Buffer.alloc(PE_HEADER_SIZE + rawSize);
  file.writeUInt16LE(0x5a4d, 0);
  file.writeUInt32LE(0x80, 0x3c);
  file.write('PE\0\0', 0x80, 'latin1');
  file.writeUInt16LE(0x014c, 0x84);
  file.writeUInt16LE(1, 0x86);
  file.writeUInt16LE(224, 0x94);
  const optional = 0x98;
  file.writeUInt16LE(0x10b, optional);
  file.writeUInt32LE(directoryCount, optional + 92);
  if (resourceDirectory) {
    file.writeUInt32LE(RSRC_RVA, optional + 112);
    file.writeUInt32LE(section.length, optional + 116);
  }
  const header = optional + 224;
  file.write('.rsrc\0\0\0', header, 'latin1');
  file.writeUInt32LE(section.length, header + 8);
  file.writeUInt32LE(RSRC_RVA, header + 12);
  file.writeUInt32LE(rawSize, header + 16);
  file.writeUInt32LE(PE_HEADER_SIZE, header + 20);
  section.copy(file, PE_HEADER_SIZE);
  return file;
}

const WINDOWS_ICON_ID = 1;

function windowsFixture({
  productName = 'Orbit Game',
  fileDescription = 'Orbit Game',
  peVersion = '1.2.3',
  iconBytes,
  groupIconIds = [WINDOWS_ICON_ID],
  iconId = WINDOWS_ICON_ID,
  resources: peResources,
  ...peOptions
} = {}) {
  const directory = makeTempDirSync('prd375-windows-');
  const root = join(directory, 'game');
  mkdirSync(root);
  const icon = join(directory, 'authored.png');
  const engine = join(directory, 'engine.png');
  writeFileSync(icon, 'authored icon');
  writeFileSync(engine, 'engine icon');
  const config = { app: { id: 'com.example.orbit', name: 'Orbit Game', version: '1.2.3', icon } };
  const manifest = {
    app: {
      icon: 'com.example.orbit.png',
      iconSha256: sha256Of('authored icon'),
      id: 'com.example.orbit',
      name: 'Orbit Game',
      version: '1.2.3',
    },
    dependencies: [],
    executable: 'orbit.exe',
    platform: 'win32-x64',
    resources: {},
    schemaVersion: 1,
    ui: null,
  };
  function file(path, contents) {
    writeFileSync(join(root, path), contents);
    manifest.resources[path] = { sha256: sha256Of(contents) };
  }
  file(
    'orbit.exe',
    windowsExecutable(
      peResources ?? [
        { data: Buffer.from(iconBytes ?? 'authored icon'), id: iconId, type: 3 },
        { data: groupIcon(groupIconIds), id: 1, type: 14 },
        {
          data: versionResource(peVersion, {
            FileDescription: fileDescription,
            ProductName: productName,
          }),
          id: 1,
          type: 16,
        },
      ],
      peOptions,
    ),
  );
  file('com.example.orbit.png', 'authored icon');
  function inspect() {
    writeFileSync(join(root, 'threenative-container.json'), JSON.stringify(manifest));
    return inspectContainerBrand(root, config, { engineIcon: engine });
  }
  return { config, engine, icon, inspect, manifest, root };
}

test('a packaged Windows executable is inspected through its real PE resources', () => {
  const report = windowsFixture().inspect();
  assert.equal(report.name.name, 'Orbit Game');
  assert.equal(report.windows.fileVersion, '1.2.3.0');
  assert.equal(report.windows.images[0].sha256, sha256Of('authored icon'));
});

test('a Windows executable with no resource directory fails closed', () => {
  assert.throws(
    () => windowsFixture({ resourceDirectory: false }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING/u,
  );
});

test('a file that is not a PE image is never accepted as Windows brand evidence', () => {
  const fixture = windowsFixture();
  writeFileSync(join(fixture.root, 'orbit.exe'), 'not an executable');
  fixture.manifest.resources['orbit.exe'] = { sha256: sha256Of('not an executable') };
  assert.throws(() => fixture.inspect(), /TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED/u);
});

test('a PE ProductName that differs from the consumer config fails', () => {
  assert.throws(
    () => windowsFixture({ productName: 'Engine Default' }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u,
  );
});

test('a stale PE FileDescription is not hidden by a correct ProductName', () => {
  assert.throws(
    () => windowsFixture({ fileDescription: 'ThreeNative' }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u,
  );
});

test('a PE file version that differs from the container version fails', () => {
  assert.throws(
    () => windowsFixture({ peVersion: '9.9.9' }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_VERSION_MISMATCH/u,
  );
});

test('an embedded engine-default PE icon is rejected despite a correct sidecar', () => {
  assert.throws(
    () => windowsFixture({ iconBytes: 'engine icon' }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT/u,
  );
});

test('a PE icon that is neither the authored art nor the engine default fails', () => {
  assert.throws(
    () => windowsFixture({ iconBytes: 'some other icon' }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u,
  );
});

test('an RT_GROUP_ICON naming an absent RT_ICON fails closed', () => {
  assert.throws(
    () => windowsFixture({ groupIconIds: [7] }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID/u,
  );
});

test('a Windows executable with no RT_VERSION resource fails closed', () => {
  assert.throws(
    () =>
      windowsFixture({
        resources: [
          { data: Buffer.from('authored icon'), id: 1, type: 3 },
          { data: groupIcon([1]), id: 1, type: 14 },
        ],
      }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING/u,
  );
});

test('a Windows executable with no icon resources fails closed', () => {
  assert.throws(
    () =>
      windowsFixture({
        resources: [
          {
            data: versionResource('1.2.3', {
              FileDescription: 'Orbit Game',
              ProductName: 'Orbit Game',
            }),
            id: 1,
            type: 16,
          },
        ],
      }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING/u,
  );
});

test('the container verifier rejects a mismatched brand before it launches anything', () => {
  const fixture = reviewBrandFixture();
  fixture.manifest.app.name = 'Engine Default';
  fixture.save();
  assert.throws(
    () => verifyStarterContainer({ root: fixture.root, config: fixture.config }),
    /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u,
  );
});

test('a matching brand lets the container verifier reach the launch it guards', () => {
  const fixture = reviewBrandFixture();
  fixture.save();
  assert.throws(
    () => verifyStarterContainer({ root: fixture.root, config: fixture.config }),
    (error) => !/TN_NATIVE_STARTER_CONTAINER_(NAME|ICON|LOADING)_/u.test(error.message),
  );
});

test('the verifier CLI inspects the brand of the container it is pointed at', () => {
  const fixture = reviewBrandFixture();
  fixture.manifest.app.name = 'Engine Default';
  fixture.save();
  const configPath = join(fixture.directory, 'threenative.config.json');
  writeFileSync(configPath, JSON.stringify(fixture.config));
  const result = spawnSync(
    process.execPath,
    [
      new URL('../scripts/verify-starter-desktop.mjs', import.meta.url).pathname,
      '--container',
      fixture.root,
      '--config',
      configPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u);
});

// Independent review of 7bb0df3a6 found these three: each is a check that retires itself when the
// artifact under test omits or duplicates the evidence it reads, instead of failing closed.

test('a container manifest that omits app.version cannot retire the PE version check', () => {
  const fixture = windowsFixture({ peVersion: '9.9.9' });
  fixture.manifest.app.version = undefined;
  assert.throws(() => fixture.inspect(), /TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID/u);
});

test('a non-string app.version cannot retire the PE version check', () => {
  const fixture = windowsFixture({ peVersion: '9.9.9' });
  fixture.manifest.app.version = 1;
  assert.throws(() => fixture.inspect(), /TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID/u);
});

test('a container version that disagrees with the consumer config fails', () => {
  const fixture = windowsFixture();
  fixture.manifest.app.version = '9.9.9';
  assert.throws(() => fixture.inspect(), /TN_NATIVE_STARTER_CONTAINER_WINDOWS_VERSION_MISMATCH/u);
});

test('a second RT_GROUP_ICON cannot hide behind the first', () => {
  assert.throws(
    () =>
      windowsFixture({
        resources: [
          { data: Buffer.from('authored icon'), id: 1, type: 3 },
          { data: Buffer.from('engine icon'), id: 2, type: 3 },
          { data: groupIcon([1]), id: 1, type: 14 },
          { data: groupIcon([2]), id: 2, type: 14 },
          {
            data: versionResource('1.2.3', {
              FileDescription: 'Orbit Game',
              ProductName: 'Orbit Game',
            }),
            id: 1,
            type: 16,
          },
        ],
      }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID/u,
  );
});

test('a truncated PE fails with a named cause, not an unnamed RangeError', () => {
  const fixture = windowsFixture();
  const executable = join(fixture.root, 'orbit.exe');
  const truncated = readFileSync(executable).subarray(0, 0xa0);
  writeFileSync(executable, truncated);
  fixture.manifest.resources['orbit.exe'] = { sha256: sha256Of(truncated) };
  assert.throws(() => fixture.inspect(), /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID/u);
});

test('an executable with no FileDescription cannot pass on ProductName alone', () => {
  assert.throws(
    () =>
      windowsFixture({
        resources: [
          { data: Buffer.from('authored icon'), id: 1, type: 3 },
          { data: groupIcon([1]), id: 1, type: 14 },
          { data: versionResource('1.2.3', { ProductName: 'Orbit Game' }), id: 1, type: 16 },
        ],
      }).inspect(),
    /TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_MISSING/u,
  );
});
