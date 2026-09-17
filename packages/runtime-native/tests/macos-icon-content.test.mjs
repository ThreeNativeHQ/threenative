import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { test } from 'vitest';
import { assertIconPixels, inspectMacosIcon } from '../scripts/inspect-macos-icon.mjs';
import { packageDesktopContainer } from '../scripts/desktop-distribution.mjs';
import { verifyContainerBrand, verifyStarterContainer } from '../scripts/verify-starter-desktop-base.mjs';

const INVALID = /TN_NATIVE_STARTER_CONTAINER_MACOS_ICON_INVALID/u;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const NAMES = [16, 32, 128, 256, 512].flatMap((size) => [
  `icon_${size}x${size}.png`, `icon_${size}x${size}@2x.png`,
]);

function temporary(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'prd375-icon-test-'));
  try { return fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

// Only a structurally bounded ICNS envelope. Command-boundary tests never claim it decodes.
function icnsEnvelope() {
  const bytes = Buffer.alloc(17);
  bytes.write('icns'); bytes.writeUInt32BE(bytes.length, 4);
  bytes.write('icp4', 8); bytes.writeUInt32BE(9, 12); bytes[16] = 1;
  return bytes;
}

function fixture(directory, platform = 'darwin-arm64') {
  const root = join(directory, 'Orbit.app');
  const source = join(directory, 'authored.png');
  writeFileSync(source, 'authored icon');
  const manifestPath = join(root, 'Contents/Resources/threenative-container.json');
  const manifest = {
    schemaVersion: 1, platform,
    app: { id: 'com.example.orbit', name: 'Orbit', icon: 'Contents/Resources/orbit.icns', iconSha256: hash('authored icon') },
    executable: 'Contents/MacOS/orbit', bundle: 'Contents/Resources/game.bundle',
    dependencies: [], resources: {}, ui: null,
  };
  const put = (path, bytes) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes); manifest.resources[path] = { sha256: hash(bytes) };
  };
  put(manifest.executable, 'unsigned fixture executable');
  put(manifest.bundle, 'fixture game bundle');
  put(manifest.app.icon, 'plain text is not an ICNS');
  put('Contents/Info.plist', '<plist><dict><key>CFBundleName</key><string>Orbit</string><key>CFBundleIconFile</key><string>orbit</string></dict></plist>');
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest));
  save();
  return { root, source, manifest, manifestPath, put, save, config: { app: { name: 'Orbit', icon: source } } };
}

for (const verify of [verifyContainerBrand, verifyStarterContainer]) {
  test(`${verify.name} rejects plain-text ICNS even with self-consistent hashes`, () => temporary((directory) => {
    const f = fixture(directory);
    assert.throws(() => verify({ root: f.root, config: f.config, project: directory }), INVALID);
    assert.equal(existsSync(join(directory, 'artifacts')), false, 'reject before launch or capture');
  }));
}

test('the verifier CLI rejects malformed ICNS through --brand-only', () => temporary((directory) => {
  const f = fixture(directory);
  const config = join(directory, 'config.json'); writeFileSync(config, JSON.stringify(f.config));
  const cli = fileURLToPath(new URL('../scripts/verify-starter-desktop.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--brand-only', '--container', f.root, '--config', config], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, INVALID);
  assert.doesNotMatch(result.stdout, /brand .*verified/u);
}));

for (const [name, mutate] of [
  ['plain text', () => Buffer.from('not an icon')],
  ['empty ICNS', () => { const b = Buffer.alloc(8); b.write('icns'); b.writeUInt32BE(8, 4); return b; }],
  ['incorrect total length', (b) => { b.writeUInt32BE(100, 4); return b; }],
  ['zero-length element', (b) => { b.writeUInt32BE(0, 12); return b; }],
  ['element past EOF', (b) => { b.writeUInt32BE(100, 12); return b; }],
  ['trailing partial header', (b) => { const c = Buffer.concat([b, Buffer.from([1])]); c.writeUInt32BE(c.length, 4); return c; }],
]) {
  test(`macOS icon inspection rejects ${name} before invoking a tool`, () => temporary((directory) => {
    const icon = join(directory, 'game.icns'); writeFileSync(icon, mutate(icnsEnvelope()));
    let calls = 0;
    assert.throws(() => inspectMacosIcon(icon, icon, { run: () => { calls++; return { status: 0 }; } }), INVALID);
    assert.equal(calls, 0, 'reject the malformed envelope before invoking a tool');
  }));
}

test('a preconverted authored ICNS cannot be replaced by a different ICNS', () => temporary((directory) => {
  const icon = join(directory, 'game.icns');
  const source = join(directory, 'source.icns');
  const bytes = icnsEnvelope(); writeFileSync(icon, bytes); bytes[16] = 2; writeFileSync(source, bytes);
  assert.throws(() => inspectMacosIcon(icon, source), /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u);
}));

for (const [name, message, action] of [
  ['missing tool', /iconutil could not inspect the icon.*ENOENT/u, () => ({ error: new Error('spawn iconutil ENOENT'), status: null })],
  ['nonzero tool exit', /iconutil could not inspect the icon \(1\)/u, () => ({ status: 1 })],
  ['signal exit', /iconutil could not inspect the icon.*no exit status/u, () => ({ status: null, signal: 'SIGTERM' })],
  ['timeout', /iconutil could not inspect the icon.*ETIMEDOUT/u, () => ({ error: new Error('ETIMEDOUT'), status: null })],
  ['missing output directory', /could not read iconutil output/u, () => ({ status: 0 })],
  ['empty iconset', /no bounded set of icon representations/u, (output) => { mkdirSync(output); return { status: 0 }; }],
  ['unexpected filename', /unexpected iconutil output surprise.png/u, (output) => { mkdirSync(output); writeFileSync(join(output, 'surprise.png'), 'not PNG'); return { status: 0 }; }],
  ['nested directory', /unexpected iconutil output icon_16x16.png/u, (output) => { mkdirSync(join(output, 'icon_16x16.png'), { recursive: true }); return { status: 0 }; }],
  ['unbounded representations', /no bounded set of icon representations/u, (output) => { mkdirSync(output); for (let i = 0; i < 33; i++) writeFileSync(join(output, `extra-${i}.png`), 'x'); return { status: 0 }; }],
  ['invalid PNG dimensions', /not a 16x16 PNG representation/u, (output) => { mkdirSync(output); writeFileSync(join(output, 'icon_16x16.png'), Buffer.alloc(33)); return { status: 0 }; }],
]) {
  test(`macOS icon inspection fails closed on ${name} and removes scratch`, () => temporary((directory) => {
    const icon = join(directory, 'game.icns'); writeFileSync(icon, icnsEnvelope());
    let scratch;
    const calls = [];
    const run = (command, args, options) => {
      calls.push({ command, args, options });
      scratch = dirname(args[3]);
      return action(args[3]);
    };
    assert.throws(() => inspectMacosIcon(icon, icon, { run }), (error) => {
      assert.match(error.message, INVALID);
      assert.match(error.message, message);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'iconutil');
    assert.deepEqual(calls[0].args.slice(0, 3), ['-c', 'iconset', '-o']);
    assert.equal(calls[0].args[4], icon);
    assert.equal(calls[0].options.timeout, 30_000);
    assert.equal(existsSync(scratch), false);
    assert.deepEqual(readFileSync(icon), icnsEnvelope(), 'inspection must not mutate the app');
  }));
}

test('a converted PNG must retain every packager size and scale', () => temporary((directory) => {
  const icon = join(directory, 'game.icns');
  const source = join(directory, 'source.png');
  writeFileSync(icon, icnsEnvelope()); writeFileSync(source, 'authored PNG');
  const run = (_command, args) => {
    mkdirSync(args[3]);
    for (const name of NAMES.slice(1)) writeFileSync(join(args[3], name), 'not decoded: census fails first');
    return { status: 0 };
  };
  assert.throws(() => inspectMacosIcon(icon, source, { run }), /missing a size or scale/u);
}));

test.skipIf(process.platform === 'win32')('iconutil symlinks cannot borrow external images', () => temporary((directory) => {
  const icon = join(directory, 'game.icns'); writeFileSync(icon, icnsEnvelope());
  const run = (_command, args) => { mkdirSync(args[3]); symlinkSync(icon, join(args[3], 'icon_16x16.png')); return { status: 0 }; };
  assert.throws(() => inspectMacosIcon(icon, icon, { run }), /unexpected iconutil output/u);
}));

const image = (data = [1, 2, 3, 255]) => ({ width: 1, height: 1, data: Buffer.from(data) });

test('decoded RGBA comparison ignores non-pixel PNG metadata', () => {
  const actual = { ...image(), gamma: 0.45455 };
  assert.equal(assertIconPixels(actual, image(), 'icon_16x16.png'), hash(actual.data));
});
for (const [name, pixels] of [['RGB', [1, 2, 4, 255]], ['alpha', [1, 2, 3, 254]]]) {
  test(`a single ${name} channel mismatch cannot pass`, () => {
    assert.throws(() => assertIconPixels(image(pixels), image(), 'icon_16x16.png'), /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u);
  });
}
for (const [name, invalid] of [
  ['empty image', { width: 0, height: 0, data: Buffer.alloc(0) }],
  ['incomplete RGBA', image([1, 2, 3])],
  ['unbounded size', { width: 1025, height: 1, data: Buffer.alloc(4100) }],
  ['noninteger size', { ...image(), width: 0.5 }],
]) {
  test(`decoded icon evidence rejects ${name}`, () => {
    assert.throws(() => assertIconPixels(invalid, image(), 'icon_16x16.png'), INVALID);
  });
}

function tool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, `${command}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
}

// These exercise real Apple converters and pngjs, not command stubs. Other hosts explicitly skip
// the platform proof. The fixture executable is never launched; this is the artifact-brand gate.
function nativeFixture(directory) {
  const source = join(directory, 'authored.png');
  const data = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    data.set([x * 4, y * 4, (x ^ y) * 4, 255], offset);
  }
  writeFileSync(source, PNG.sync.write({ width: 64, height: 64, data }));
  const executable = join(directory, 'fixture-runtime');
  const bundle = join(directory, 'fixture.bundle');
  writeFileSync(executable, 'not launched'); writeFileSync(bundle, 'not launched');
  const config = { app: { id: 'com.example.orbit', name: 'Orbit Proof', version: '1.2.3', icon: source } };
  const built = packageDesktopContainer({ platform: 'darwin', arch: process.arch, executable, bundle, config, icon: source, output: join(directory, 'release.zip') });
  const unpacked = join(directory, 'unpacked'); mkdirSync(unpacked);
  tool('unzip', ['-q', built.archive, '-d', unpacked]);
  const root = join(unpacked, built.rootFolder);
  const icon = join(root, built.manifest.app.icon);
  const save = () => {
    built.manifest.resources[built.manifest.app.icon].sha256 = hash(readFileSync(icon));
    writeFileSync(join(root, 'Contents/Resources/threenative-container.json'), JSON.stringify(built.manifest));
  };
  return { root, icon, source, config, built, save };
}

test.skipIf(process.platform !== 'darwin')('real packager ICNS passes decoded-pixel inspection without changing the app', () => temporary((directory) => {
  const f = nativeFixture(directory);
  const before = readFileSync(f.icon);
  const brand = verifyContainerBrand({ root: f.root, config: f.config, project: directory });
  assert.equal(brand.icon.macos.method, 'iconutil-decoded-rgba');
  assert.equal(brand.icon.macos.representations.length, NAMES.length);
  assert.deepEqual(readFileSync(f.icon), before);
}));

test.skipIf(process.platform !== 'darwin')('real ICNS with one substituted size fails despite rehashed inventory', () => temporary((directory) => {
  const f = nativeFixture(directory);
  const decoded = join(directory, 'tampered.iconset');
  tool('iconutil', ['-c', 'iconset', '-o', decoded, f.icon]);
  const size = join(decoded, 'icon_16x16.png');
  const png = PNG.sync.read(readFileSync(size)); png.data.fill(255);
  writeFileSync(size, PNG.sync.write(png));
  rmSync(f.icon); tool('iconutil', ['-c', 'icns', decoded, '-o', f.icon]); f.save();
  assert.throws(() => verifyContainerBrand({ root: f.root, config: f.config, project: directory }), /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u);
}));

test.skipIf(process.platform !== 'darwin')('a real authored ICNS is decoded even when copied without conversion', () => temporary((directory) => {
  const f = nativeFixture(directory);
  const authored = join(directory, 'authored.icns');
  copyFileSync(f.icon, authored); f.config.app.icon = authored;
  f.built.manifest.app.iconSha256 = hash(readFileSync(authored)); f.save();
  const brand = verifyContainerBrand({ root: f.root, config: f.config, project: directory });
  assert.equal(brand.icon.macos.representations.length, NAMES.length);
}));


test('the runtime package includes the strict macOS validator', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('scripts/inspect-macos-icon.mjs'));
});

test('fully transparent RGB does not create a false artwork mismatch', () => {
  assert.equal(
    assertIconPixels(image([1, 2, 3, 0]), image([9, 8, 7, 0]), 'transparent.png'),
    hash(Buffer.from([0, 0, 0, 0])),
  );
});

test('partially transparent RGB is still compared', () => {
  assert.throws(() => assertIconPixels(image([1, 2, 3, 1]), image([9, 8, 7, 1]), 'alpha.png'), /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u);
});

test('Linux brand-only verification does not require Apple tools', () => temporary((directory) => {
  const f = fixture(directory, 'linux-x64');
  f.manifest.app.icon = 'share/icons/hicolor/256x256/apps/com.example.orbit.png';
  f.put(f.manifest.app.icon, 'authored icon');
  f.put('share/applications/com.example.orbit.desktop', '[Desktop Entry]\nType=Application\nName=Orbit\nIcon=com.example.orbit\n');
  f.save();
  const report = verifyContainerBrand({ root: f.root, config: f.config, project: directory });
  assert.equal(report.name.name, 'Orbit');
  assert.equal(report.icon.macos, undefined);
}));


for (const substituted of [false, true]) {
  test(`ICNS round-trip reference ${substituted ? 'rejects a visible pixel change' : 'accepts converter-normalized artwork'}`, () => temporary((directory) => {
    const icon = join(directory, 'game.icns');
    const source = join(directory, 'source.png');
    writeFileSync(icon, icnsEnvelope());
    writeFileSync(source, 'authored fixture: command boundary only');
    const calls = [];
    const writeRepresentation = (path, pixels, red) => {
      const data = Buffer.alloc(pixels * pixels * 4);
      for (let offset = 0; offset < data.length; offset += 4) data.set([red, 71, 101, 255], offset);
      writeFileSync(path, PNG.sync.write({ width: pixels, height: pixels, data }));
    };
    const run = (command, args) => {
      calls.push({ command, args });
      if (command === 'sips') {
        assert.equal(args[3], source, 'derive reference from authored input, never the packaged icon');
        writeRepresentation(args[5], Number(args[1]), 41);
      } else if (command === 'iconutil' && args[1] === 'icns') {
        assert.notEqual(args[2], icon, 'the reference must not be copied from the artifact under test');
        writeFileSync(args[4], icnsEnvelope());
      } else if (command === 'iconutil' && args[1] === 'iconset') {
        const output = args[3];
        mkdirSync(output);
        for (const name of NAMES) {
          const match = /^icon_(\d+)x\1(@2x)?\.png$/u.exec(name);
          const pixels = Number(match[1]) * (match[2] ? 2 : 1);
          // Model deterministic OS conversion, not image correctness. The real-Mac tests below
          // exercise Apple's converters; here the actual comparison must use their output.
          const red = substituted && args[4] === icon && name === NAMES[0] ? 39 : 40;
          writeRepresentation(join(output, name), pixels, red);
        }
      } else {
        assert.fail(`unexpected tool ${command} ${args.join(' ')}`);
      }
      return { status: 0 };
    };
    if (substituted) {
      assert.throws(() => inspectMacosIcon(icon, source, { run }), /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u);
    } else {
      const proof = inspectMacosIcon(icon, source, { run });
      assert.equal(proof.representations.length, NAMES.length);
      assert.equal(calls.filter(({ command, args }) => command === 'iconutil' && args[1] === 'icns').length, 1);
      assert.equal(calls.filter(({ command, args }) => command === 'iconutil' && args[1] === 'iconset').length, 2);
    }
    assert.deepEqual(readFileSync(icon), icnsEnvelope(), 'never modify the packaged icon');
    const scratch = dirname(calls[0].args[3]);
    assert.equal(existsSync(scratch), false, 'remove both reference and artifact scratch after success or refusal');
  }));
}
