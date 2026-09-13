import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'vitest';
import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import {
  assertContainerIdentity,
  CONTAINER_MANIFEST,
  containerMetadata,
  packageDesktopContainer,
  parseLinkedLibraries,
  resolveContainer,
} from '../scripts/desktop-distribution.mjs';

const config = { app: { id: 'com.example.orbit', name: 'Orbit Game', version: '1.2.3', build: 7 } };
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// Exercise the real staging and resolver. Only OS resource tools/archive transport are replaced;
// these unit cases do not claim a Windows/macOS native launch or signing proof.
function fixture(platform = 'linux', { icon = false, convertIcon = false } = {}) {
  const directory = makeTempDirSync('threenative-container-regression-');
  const executable = join(directory, 'input');
  const captured = join(directory, 'relocated container');
  const uiDirectory = join(directory, 'ui');
  const iconPath = join(directory, convertIcon ? 'icon.png' : 'icon.icns');
  const dependency = join(directory, 'dependency');
  writeFileSync(executable, 'original executable');
  writeFileSync(iconPath, 'authored icon');
  writeFileSync(dependency, 'native dependency');
  mkdirSync(uiDirectory);
  writeFileSync(join(uiDirectory, 'index.html'), '<main>HUD</main>');
  const run = (command, args, options) => {
    if (command === 'rcedit') writeFileSync(args[0], 'executable with PE resources');
    else if (command === 'sips') writeFileSync(args.at(-1), 'resized icon');
    else if (command === 'iconutil') writeFileSync(args.at(-1), 'converted icns');
    else {
      assert.ok(command === 'tar' || command === 'zip', `unexpected tool: ${command}`);
      const staging = command === 'tar' ? args[args.indexOf('-C') + 1] : options.cwd;
      cpSync(join(staging, args.at(-1)), captured, { recursive: true });
      writeFileSync(command === 'tar' ? args[1] : args[2], 'archive bytes');
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const packed = packageDesktopContainer({
    platform, arch: 'x64', executable, config, uiDirectory, uiRenderer: 'web',
    dependencies: [{ name: 'sidecar.bin', source: dependency }],
    ...(icon ? { icon: iconPath } : {}), output: join(directory, 'game'), run,
  });
  const manifestPath = join(captured, platform === 'darwin' ? 'Contents/Resources' : '', CONTAINER_MANIFEST);
  return { ...packed, root: captured, directory, manifestPath, icon: iconPath };
}

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform}: records the final executable in the integrity manifest without an icon`, () => {
    const { root, manifest } = fixture(platform);
    assert.equal(manifest.resources[manifest.executable]?.sha256, digest(join(root, manifest.executable)));
    assert.deepEqual(resolveContainer(root, { platform }), manifest);
  });
  test(`${platform}: refuses a missing executable after relocation`, () => {
    const { root, manifest } = fixture(platform);
    rmSync(join(root, manifest.executable));
    assert.throws(() => resolveContainer(root, { platform }), /TN_DESKTOP_CONTAINER_INCOMPLETE/);
  });
  test(`${platform}: refuses executable bytes changed after packaging`, () => {
    const { root, manifest } = fixture(platform);
    writeFileSync(join(root, manifest.executable), 'tampered');
    assert.throws(() => resolveContainer(root, { platform }), /TN_DESKTOP_CONTAINER_TAMPERED/);
  });
}

test('Windows hashes the executable after PE resource editing', () => {
  const { root, manifest } = fixture('win32', { icon: true });
  assert.equal(readFileSync(join(root, manifest.executable), 'utf8'), 'executable with PE resources');
  assert.equal(manifest.resources[manifest.executable].sha256, digest(join(root, manifest.executable)));
  assert.deepEqual(resolveContainer(root, { platform: 'win32' }), manifest);
});

test('macOS stages Info.plist at the application bundle root, not under Resources', () => {
  const { root, manifest } = fixture('darwin', { icon: true });
  assert.ok(existsSync(join(root, 'Contents/Info.plist')));
  assert.ok(manifest.resources['Contents/Info.plist']);
  assert.equal(existsSync(join(root, 'Contents/Resources/Contents/Info.plist')), false);
});

test('macOS plist names the icon that was actually staged', () => {
  const { manifest } = fixture('darwin', { icon: true });
  const plist = containerMetadata({ platform: 'darwin', config })['Contents/Info.plist'];
  const iconName = /<key>CFBundleIconFile<\/key><string>(.*?)<\/string>/u.exec(plist)?.[1];
  assert.equal(`${iconName}.icns`, basename(manifest.app.icon));
});

test('macOS metadata escapes XML text from authored application identity', () => {
  const plist = containerMetadata({
    platform: 'darwin', config: { app: { ...config.app, name: 'R&D <Orbit>' } },
  })['Contents/Info.plist'];
  assert.match(plist, /<key>CFBundleName<\/key><string>R&amp;D &lt;Orbit&gt;<\/string>/u);
  assert.match(plist, /<key>CFBundleDisplayName<\/key><string>R&amp;D &lt;Orbit&gt;<\/string>/u);
});

test('macOS conversion preserves authored icon identity and separately hashes the converted payload', () => {
  const { root, manifest, icon } = fixture('darwin', { icon: true, convertIcon: true });
  assert.notEqual(digest(icon), digest(join(root, manifest.app.icon)));
  assert.equal(manifest.resources[manifest.app.icon].sha256, digest(join(root, manifest.app.icon)));
  assert.equal(assertContainerIdentity(manifest, config, { icon }), manifest);
});

test('Linux dependency inspection retains resolved paths containing spaces', () => {
  assert.deepEqual(parseLinkedLibraries('  libgame.so => /tmp/My Game/libgame.so (0x00001234)\n', 'linux'), [
    { name: 'libgame.so', path: '/tmp/My Game/libgame.so' },
  ]);
});

test('macOS dependency inspection retains install names containing spaces', () => {
  assert.deepEqual(parseLinkedLibraries('game:\n  /tmp/My Game/libgame.dylib (compatibility version 1.0.0, current version 1.0.0)\n', 'darwin'), [
    { name: 'libgame.dylib', path: '/tmp/My Game/libgame.dylib' },
  ]);
});

for (const [name, mutate] of [
  ['empty manifest', () => ({})],
  ['null manifest', () => null],
  ['unsupported schema', (manifest) => ({ ...manifest, schemaVersion: 99 })],
  ['missing resource map', (manifest) => ({ ...manifest, resources: undefined })],
  ['unrecorded executable', (manifest) => { delete manifest.resources[manifest.executable]; return manifest; }],
  ['unrecorded UI entry', (manifest) => { delete manifest.resources[manifest.ui.entry]; return manifest; }],
  ['unrecorded dependency', (manifest) => { delete manifest.resources[manifest.dependencies[0].path]; return manifest; }],
]) {
  test(`resolver fails closed for ${name}`, () => {
    const { root, manifest, manifestPath } = fixture();
    writeFileSync(manifestPath, JSON.stringify(mutate(manifest)));
    assert.throws(() => resolveContainer(root), /TN_DESKTOP_CONTAINER_MANIFEST_INVALID/);
  });
}

test('resolver rejects a manifest resource symlink escaping the container', () => {
  const { root, directory, manifest, manifestPath } = fixture();
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'payload'), 'outside payload');
  symlinkSync(outside, join(root, 'escape'), 'junction');
  manifest.resources['escape/payload'] = { sha256: digest(join(outside, 'payload')) };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => resolveContainer(root), /TN_DESKTOP_CONTAINER_MANIFEST_INVALID/);
});

for (const fail of [false, true]) {
  test(`archive replacement ${fail ? 'preserves the previous output on failure' : 'uses a fresh file instead of updating a stale ZIP'}`, () => {
    const root = makeTempDirSync('threenative-archive-replacement-');
    const executable = join(root, 'input');
    const output = join(root, 'game.zip');
    writeFileSync(executable, 'executable');
    writeFileSync(output, 'previous archive');
    const build = () => packageDesktopContainer({
      platform: 'darwin', arch: 'x64', executable, output, config,
      run: (command, args) => {
        assert.equal(command, 'zip');
        if (!fail) assert.equal(existsSync(args[2]), false, 'zip must not update an existing archive');
        writeFileSync(args[2], fail ? 'partial archive' : 'fresh archive');
        return { status: fail ? 1 : 0, stdout: '', stderr: 'archive failure fixture' };
      },
    });
    if (fail) assert.throws(build, /TN_DESKTOP_ARCHIVE_FAILED/);
    else assert.equal(build().archive, output);
    assert.equal(readFileSync(output, 'utf8'), fail ? 'previous archive' : 'fresh archive');
  });
}
