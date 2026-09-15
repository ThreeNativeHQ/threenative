import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'vitest';
import { notarizeArchive, packageDesktopContainer } from '../scripts/desktop-distribution.mjs';

const config = { app: { id: 'com.example.orbit', name: 'Orbit Game', version: '1.2.3', build: 7 } };
const ok = { status: 0, stdout: '', stderr: '' };
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// Real filesystem and staging; OS signing/notary tools are fixtures, not credentialed proof.
// Archive bytes are deterministic stand-ins here. The local verification also runs real ZIP/tar.
function fixture(runTest) {
  const root = mkdtempSync(join(tmpdir(), 'threenative-release-transaction-'));
  try {
    const executable = join(root, 'input');
    writeFileSync(executable, 'unsigned executable');
    runTest({ executable, root, output: join(root, 'game.zip') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const previous of [false, true]) {
  for (const failure of ['notary', 'staple', 'final archive']) {
    test(`macOS ${failure} failure ${previous ? 'preserves the previous artifact' : 'leaves no release artifact'}`, () => {
      fixture(({ executable, root, output }) => {
        if (previous) writeFileSync(output, 'previous verified release');
        let archives = 0;
        const run = (command, args) => {
          if (command === 'zip') {
            archives += 1;
            if (failure === 'final archive' && archives === 2) return { ...ok, status: 1, stderr: 'disk full' };
            writeFileSync(args[2], `candidate archive ${archives}`);
          }
          if (command === 'xcrun' && args[0] === 'notarytool') {
            return { ...ok, stdout: JSON.stringify({ id: 'request-id', status: failure === 'notary' ? 'Invalid' : 'Accepted' }) };
          }
          if (command === 'xcrun' && args[0] === 'stapler' && failure === 'staple') return { ...ok, status: 1 };
          return ok;
        };
        assert.throws(() => packageDesktopContainer({
          platform: 'darwin', arch: 'x64', config, executable, output, run,
          signing: { identity: 'fixture identity', keychainProfile: 'fixture profile', notarize: true },
        }), /TN_DESKTOP_(?:NOTARY|ARCHIVE)/u);
        assert.equal(existsSync(output), previous);
        if (previous) assert.equal(readFileSync(output, 'utf8'), 'previous verified release');
        assert.deepEqual(readdirSync(root).sort(), previous ? ['game.zip', 'input'] : ['input']);
      });
    });
  }
}

test('macOS notarization does not publish the candidate before every stage succeeds', () => {
  fixture(({ executable, output }) => {
    writeFileSync(output, 'previous verified release');
    let archives = 0;
    let submittedHash;
    const run = (command, args) => {
      if (command === 'zip') {
        archives += 1;
        writeFileSync(args[2], `candidate archive ${archives}`);
      }
      if (command === 'xcrun') {
        assert.equal(readFileSync(output, 'utf8'), 'previous verified release');
        if (args[0] === 'notarytool') {
          assert.notEqual(args[2], output);
          submittedHash = digest(args[2]);
          return { ...ok, stdout: JSON.stringify({ id: 'request-id', status: 'Accepted' }) };
        }
      }
      return ok;
    };
    const packed = packageDesktopContainer({
      platform: 'darwin', arch: 'x64', config, executable, output, run,
      signing: { identity: 'fixture identity', keychainProfile: 'fixture profile', notarize: true },
    });
    assert.equal(packed.archive, output);
    assert.equal(readFileSync(output, 'utf8'), 'candidate archive 2');
    assert.notEqual(digest(output), submittedHash);
  });
});

test('notary evidence refuses archive bytes replaced while submitting', () => {
  fixture(({ output }) => {
    writeFileSync(output, 'archive sent to Apple');
    assert.throws(() => notarizeArchive({
      archive: output, signing: { keychainProfile: 'fixture profile' },
      run: () => {
        writeFileSync(output, 'different archive after submit');
        return { ...ok, stdout: JSON.stringify({ id: 'request-id', status: 'Accepted' }) };
      },
    }), /TN_DESKTOP_NOTARY_MISMATCH/u);
  });
});

test('macOS iconutil receives a .iconset directory with the complete Retina icon family', () => {
  fixture(({ executable, root, output }) => {
    const icon = join(root, 'authored.png');
    writeFileSync(icon, 'authored icon');
    let iconset;
    const run = (command, args) => {
      if (command === 'sips') writeFileSync(args.at(-1), 'resized icon');
      if (command === 'iconutil') {
        iconset = args[2];
        assert.equal(basename(iconset).endsWith('.iconset'), true);
        for (const size of [16, 32, 128, 256, 512]) {
          assert.equal(existsSync(join(iconset, `icon_${size}x${size}.png`)), true);
          assert.equal(existsSync(join(iconset, `icon_${size}x${size}@2x.png`)), true);
        }
        writeFileSync(args.at(-1), 'converted icon');
      }
      if (command === 'zip') writeFileSync(args[2], 'archive');
      return ok;
    };
    packageDesktopContainer({ platform: 'darwin', arch: 'x64', config, executable, icon, output, run });
    assert.equal(existsSync(dirname(iconset)), false);
  });
});
