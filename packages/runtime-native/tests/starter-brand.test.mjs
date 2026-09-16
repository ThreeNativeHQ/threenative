import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'vitest';

import { inspectContainerBrand } from '../scripts/inspect-container-brand.mjs';

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
